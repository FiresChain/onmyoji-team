import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTeamEncodeDraft, encodeTeamConfiguration } from '../src/team-code-service';
import { applyReproductionTolerance, createCalculationDraft, serializeCalculationDraft } from '../src/calculation-config';
import type { Catalog, Member } from '../src/types';

// A synthetic ID keeps protocol-format checks independent of the real base-panel catalog.
const catalog: Catalog = { version: 'test', shikigami: [{ id: '999001', name: '测试式神', avatar: '' }], yuhun: [{ id: '300002', name: '雪幽魂', avatar: '' }] };
function configuration(strictOrder = false) {
  const members: Member[] = Array.from({ length: 5 }, (_, index) => ({ slot: index + 1,
    shikigami: { id: '999001', name: '测试式神', rawText: '测试式神', candidates: [] },
    panel: { attack: strictOrder ? 1000 + index * 50 : 1000, hp: 20000, defense: 500, speed: 185, crit: 40, critDamage: 150, effectHit: 0, effectResist: 0 },
    yuhun: { catalogId: null, name: null, status: 'unavailable', candidates: [] }, needsReview: [],
  }));
  const draft = createCalculationDraft(members);
  draft.reproduction.orderStats = strictOrder ? ['attack'] : [];
  for (const member of draft.members) member.suitRequirements = [{ catalogId: '300002', name: '雪幽魂', count: 4, kind: 'suit' }];
  draft.members[0]!.suitRequirements = [{ catalogId: '300002', name: '雪幽魂', count: 4, kind: 'suit' }, { catalogId: 'two-piece-effect:attackPercent', name: '攻击加成', count: 2, kind: 'two-piece-effect' }];
  draft.members[0]!.extraAttributes = { attackPercent: '20', attack: '0', crit: '0', critDamage: '27' };
  return serializeCalculationDraft(draft, members, catalog).value!;
}

test('encode adapter retains game percentage points, separate ratio extras and explicit 40-level members', () => {
  const config = configuration(), before = structuredClone(config);
  const draft = buildTeamEncodeDraft(config, catalog), target = draft.targets[0]!;
  assert.equal(target.level, 40);
  assert.equal(target.shikigamiId, 999001);
  assert.deepEqual(target.suitRequirements, [{ suitId: 300002, count: 4 }, { effectId: 0, count: 2 }]);
  assert.deepEqual(target.ranges.find((range) => range.stat === 'crit'), { stat: 'crit', min: 36, max: 44, percentage: true });
  assert.deepEqual(target.extraAttributes, { attackPercent: .2, attack: 0, crit: 0, critDamage: .27 });
  assert.equal('scene' in draft, false);
  assert.equal('calculationMode' in draft, false);
  target.mainStats[2].push('speed');
  assert.deepEqual(config, before);
});

test('strict ordering reaches the codec request as separated ranges without new protocol fields', () => {
  const config = configuration(true);
  const encoded = buildTeamEncodeDraft(config, catalog);
  assert.deepEqual(config.reproduction.orderStats, ['attack']);
  assert.equal('reproduction' in encoded, false);
  for (let index = 0; index < encoded.targets.length; index++) {
    assert.deepEqual(encoded.targets[index]!.ranges, config.targets[index]!.ranges);
    if (!index) continue;
    const lower = encoded.targets[index - 1]!.ranges.find((range) => range.stat === 'attack')!;
    const higher = encoded.targets[index]!.ranges.find((range) => range.stat === 'attack')!;
    assert.ok(lower.max! < higher.min!, 'every possible encoded value preserves the screenshot order');
  }
});

test('encoder distinguishes empty slots from unrecognized names and validates catalog IDs', () => {
  const unknown = configuration(); unknown.targets[0]!.shikigami = { catalogId: null, name: '测试式神' };
  assert.throws(() => buildTeamEncodeDraft(unknown, catalog), /确认式神/);
  const short = configuration(); short.targets[0]!.suitRequirements[0]!.catalogId = '2';
  assert.throws(() => buildTeamEncodeDraft(short, catalog), /游戏 ID/);
  const empty = configuration();
  empty.targets[0] = { ...empty.targets[1]!, slot: 1, shikigami: null, yuhunConfigEnabled: false, suitRequirements: [], ranges: [], extraAttributes: {}, sixStarOnly: false, maxLevelOnly: false };
  assert.equal(buildTeamEncodeDraft(empty, catalog).targets[0]!.shikigamiId, null);
  assert.equal('level' in buildTeamEncodeDraft(empty, catalog).targets[0]!, false);
});

test('unsupported game fields and open bounds fail rather than silently changing constraints', () => {
  const unspecified = configuration(); unspecified.targets[0]!.suitRequirements = [];
  assert.throws(() => buildTeamEncodeDraft(unspecified, catalog), /御魂尚未指定/);
  const oneSided = configuration(); delete oneSided.targets[0]!.ranges[0]!.max;
  assert.throws(() => buildTeamEncodeDraft(oneSided, catalog), /同时填写上下限/);
  const occupied = configuration(); occupied.targets[0]!.excludeOccupied = true;
  assert.throws(() => buildTeamEncodeDraft(occupied, catalog), /排除其他阵容/);
  const unequipped = configuration(); unequipped.targets[0]!.scope = 'unequipped';
  assert.throws(() => buildTeamEncodeDraft(unequipped, catalog), /仅未装备/);
});

test('client sends only the template and supported draft, surfaces absent endpoints and service errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'http://localhost:8787/onmyoji/v1/team-code/encode');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.templateTeamCode, '#TA#YQ==');
      assert.equal(body.draft.percentageUnit, 'percentage-points');
      assert.deepEqual(Object.keys(body).sort(), ['draft', 'templateTeamCode']);
      return Response.json({ ok: true, data: { teamCode: '#TA#YQ==', inspection: {}, warnings: [] } });
    };
    const result = await encodeTeamConfiguration(configuration(), catalog, ' #TA#YQ== ', { apiBaseUrl: 'http://localhost:8787/' });
    assert.equal(result.teamCode, '#TA#YQ==');
    globalThis.fetch = async () => Response.json({ ok: false, error: 'Not Found' }, { status: 404 });
    await assert.rejects(encodeTeamConfiguration(configuration(), catalog, '#TA#YQ=='), /尚未部署/);
    globalThis.fetch = async () => Response.json({ ok: false, error: '请求过于频繁' }, { status: 429 });
    await assert.rejects(encodeTeamConfiguration(configuration(), catalog, '#TA#YQ=='), /请求过于频繁/);
    globalThis.fetch = async () => Response.json({ ok: true, data: { teamCode: 'fake', inspection: {}, warnings: [] } });
    await assert.rejects(encodeTeamConfiguration(configuration(), catalog, '#TA#YQ=='), /无效/);
  } finally { globalThis.fetch = original; }
});

test('cancelled requests propagate cancellation instead of returning a stale code', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => { init?.signal?.throwIfAborted(); throw new Error('unexpected live request'); };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(encodeTeamConfiguration(configuration(), catalog, '#TA#YQ==', { signal: controller.signal }), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});

const blueRows = [
  ['363', '帝释天', '300035', '魅妖', [4341, 24354, 702, 201, 59, 206, 30, 24]],
  ['231', '鬼女红叶', '300004', '蝠翼', [5513, 14870, 785, 144, 58, 311, 0, 48]],
  ['601', '思金神', '300006', '涅槃火', [2630, 21159, 750, 122, 8, 150, 0, 86]],
  ['241', '蝴蝶精', '300007', '三味', [2925, 30433, 876, 121, 60, 150, 0, 72]],
  ['559', '本真三尾狐', '300026', '网切', [4238, 12706, 723, 115, 65, 185, 0, 0]],
] as const;
const blueCatalog: Catalog = {
  version: 'blue-screenshot',
  shikigami: blueRows.map(([id, name]) => ({ id, name, avatar: '' })),
  yuhun: blueRows.map(([, , id, name]) => ({ id, name, avatar: '' })),
};
function blueScreenshot() {
  const members: Member[] = blueRows.map(([id, name, , , values], index) => ({
    slot: index + 1, shikigami: { id, name, rawText: name, candidates: [] },
    panel: { attack: values[0], hp: values[1], defense: values[2], speed: values[3],
      crit: values[4], critDamage: values[5], effectHit: values[6], effectResist: values[7] },
    yuhun: { catalogId: null, name: null, status: 'unavailable', candidates: [] }, needsReview: [],
  }));
  const draft = createCalculationDraft(members);
  draft.reproduction.orderStats = [];
  for (const [index, member] of draft.members.entries()) {
    const [, , id, name] = blueRows[index]!;
    member.suitRequirements = [{ catalogId: id, name, count: 4, kind: 'suit' }];
  }
  return { members, draft };
}

test('hit pools send the effective crit metric to the codec without leaking pool metadata or changing manual settings', () => {
  const { members, draft } = blueScreenshot();
  draft.hitMetricPools = { shikigamiIds: ['363'], yuhunIds: ['300004'] };
  draft.members[0]!.metricId = 5;
  const original = structuredClone(draft);
  const projection = serializeCalculationDraft(draft, members, blueCatalog);
  assert.deepEqual(projection.issues, []);
  assert.ok(projection.value);
  const request = buildTeamEncodeDraft(projection.value, blueCatalog);
  assert.deepEqual(request.targets.map((target) => target.metricId), [8, 8, 2, 2, 2]);
  assert.equal('hitMetricPools' in request, false);
  assert.ok(request.targets.every((target) => !('hitMetricPools' in target)));
  assert.deepEqual(draft, original);
  draft.hitMetricPools = { shikigamiIds: [], yuhunIds: [] };
  const restored = serializeCalculationDraft(draft, members, blueCatalog);
  assert.ok(restored.value);
  const restoredRequest = buildTeamEncodeDraft(restored.value, blueCatalog);
  assert.deepEqual(restoredRequest.targets.map((target) => target.metricId), [5, 2, 2, 2, 2]);
  request.targets.forEach((target, index) => {
    assert.deepEqual(target.ranges, restoredRequest.targets[index]!.ranges);
    assert.deepEqual(target.mainStats, restoredRequest.targets[index]!.mainStats);
    assert.deepEqual(target.suitRequirements, restoredRequest.targets[index]!.suitRequirements);
  });
});

test('only checked attributes reach the codec and ordering ignores unchecked attributes without deleting their draft values', () => {
  const { members, draft } = blueScreenshot();
  draft.reproduction.constraintStats = ['speed', 'critDamage'];
  draft.reproduction.orderStats = ['speed', 'attack', 'critDamage'];
  const originalLimits = structuredClone(draft.members.map((member) => member.limits));
  const projection = serializeCalculationDraft(draft, members, blueCatalog);
  assert.deepEqual(projection.issues, []);
  assert.ok(projection.value);
  const encoded = buildTeamEncodeDraft(projection.value, blueCatalog);
  for (const target of encoded.targets) {
    assert.deepEqual(target.ranges.map((range) => range.stat).sort(), ['critDamage', 'speed']);
    assert.equal('constraintStats' in target, false);
    assert.equal('orderStats' in target, false);
  }
  assert.equal('reproduction' in encoded, false);
  const speedRanges = encoded.targets.map((target) => target.ranges.find((range) => range.stat === 'speed')!);
  for (let index = 1; index < speedRanges.length; index++) {
    assert.ok(speedRanges[index]!.max! < speedRanges[index - 1]!.min!, 'descending screenshot speeds retain strict order');
  }
  assert.deepEqual(draft.members.map((member) => member.limits), originalLimits);
  draft.reproduction.constraintStats = [];
  const cleared = serializeCalculationDraft(draft, members, blueCatalog);
  assert.deepEqual(cleared.issues, []);
  assert.ok(cleared.value);
  assert.ok(buildTeamEncodeDraft(cleared.value, blueCatalog).targets.every((target) => target.ranges.length === 0));
  assert.deepEqual(draft.members.map((member) => member.limits), originalLimits);
});

test('screenshot precheck exports compensated ranges or relaxed tiers without changing the screenshot draft', () => {
  const { members, draft } = blueScreenshot();
  const before = structuredClone(draft);
  for (const percent of ['10', '20']) {
    const adjusted = applyReproductionTolerance(draft, members, percent);
    const projection = serializeCalculationDraft(adjusted, members, blueCatalog);
    assert.deepEqual(projection.issues, []);
    assert.ok(projection.value);
    const encoded = buildTeamEncodeDraft(projection.value, blueCatalog);
    assert.deepEqual(encoded.targets.map((target) => target.shikigamiId), [363, 231, 601, 241, 559]);
    assert.deepEqual(encoded.targets.map((target) => target.yuhunConfigEnabled), [true, true, true, true, true]);
    assert.deepEqual(projection.prechecks.filter((entry) => entry.status === (percent === '20' ? 'manual-adjustment' : 'relaxed')).map((entry) => entry.slot), [3, 5]);
    assert.equal(projection.prechecks[3]!.status, 'optimized');
    assert.ok(!encoded.targets[3]!.mainStats[2].includes('speed'));
    for (const index of [2, 4]) {
      const target = encoded.targets[index]!;
      assert.equal(target.level, 40);
      assert.deepEqual([target.sixStarOnly, target.maxLevelOnly], [true, percent === '20']);
      assert.deepEqual(target.suitRequirements, [{ suitId: Number(blueRows[index]![2]), count: 4 }]);
      assert.ok(target.ranges.length > 0);
      assert.deepEqual(target.extraAttributes, {});
      assert.deepEqual(target.mainStats, projection.value.targets[index]!.mainStats);
      assert.ok(Object.values(target.mainStats).every((choices) => choices.length > 0));
      assert.deepEqual(target.ranges, projection.value.targets[index]!.ranges);
      assert.equal('manualAdjustments' in target, false, 'unload instructions stay outside the codec contract');
    }
    assert.ok(!encoded.targets[2]!.mainStats[6].includes('crit'), 'six-star +0 crit already exceeds 思金神的暴击上限');
    assert.ok(!encoded.targets[4]!.mainStats[4].includes('effectResist'), 'zero resistance still excludes a resistance main stat after relaxing level');
    if (percent === '10') assert.ok(!encoded.targets[4]!.mainStats[2].includes('speed'));
    if (percent === '20') {
      const soul3 = encoded.targets[2]!, soul5 = encoded.targets[4]!;
      assert.deepEqual(projection.prechecks[2]!.manualAdjustments?.map((item) => item.position), [3, 5]);
      assert.deepEqual(projection.prechecks[4]!.manualAdjustments?.map((item) => item.position), [3]);
      assert.deepEqual(soul3.ranges.find((range) => range.stat === 'defense'), { stat: 'defense', min: 600, max: 1004, percentage: false });
      assert.deepEqual(soul3.ranges.find((range) => range.stat === 'hp'), { stat: 'hp', min: 16927.2, max: 27442.8, percentage: false });
      assert.deepEqual(soul5.ranges.find((range) => range.stat === 'defense'), { stat: 'defense', min: 578.4, max: 971.6, percentage: false });
      assert.ok(soul3.mainStats[2].length < 4 && soul3.mainStats[6].length < 5, 'the compensated code retains specific main-stat choices');
    }
    for (const index of [0, 1, 3]) assert.deepEqual([encoded.targets[index]!.sixStarOnly, encoded.targets[index]!.maxLevelOnly], [true, true]);
    assert.equal('prechecks' in encoded, false, 'diagnostics do not extend the game protocol');
    assert.ok(!encoded.targets[0]!.mainStats[2].includes('attackPercent'));
  }
  assert.deepEqual(draft, before, 'tier fallback must not change editable settings');
  const restored = serializeCalculationDraft(applyReproductionTolerance(draft, members, '40'), members, blueCatalog);
  assert.ok(restored.value);
  assert.ok(buildTeamEncodeDraft(restored.value, blueCatalog).targets.every((target) => target.yuhunConfigEnabled));
  assert.ok(buildTeamEncodeDraft(restored.value, blueCatalog).targets.every((target) => target.sixStarOnly && target.maxLevelOnly));
});

test('position-one compensation reaches the encoder while the original attack upper bound stays editable', () => {
  const { members, draft } = blueScreenshot();
  draft.members[0]!.limits = [{ id: 1, stat: 'attack', min: '3000', max: '3500' }];
  const original = structuredClone(draft);
  const projection = serializeCalculationDraft(draft, members, blueCatalog);
  assert.deepEqual(projection.issues, []);
  assert.ok(projection.value);
  assert.equal(projection.prechecks[0]!.status, 'manual-adjustment');
  assert.deepEqual(projection.prechecks[0]!.manualAdjustments, [{ position: 1, stat: 'attack', amount: 486, originalMax: 3500, calculationMax: 3986 }]);
  const encoded = buildTeamEncodeDraft(projection.value, blueCatalog).targets[0]!;
  assert.deepEqual(encoded.ranges, [{ stat: 'attack', min: 3000, max: 3986, percentage: false }]);
  assert.equal(encoded.sixStarOnly && encoded.maxLevelOnly, true);
  assert.ok(!encoded.mainStats[2].includes('attackPercent'));
  assert.equal('manualAdjustments' in encoded, false);
  assert.deepEqual(draft, original);
});

test('a team whose five members conflict still exports five occupied no-yuhun slots', () => {
  const { members, draft } = blueScreenshot();
  for (const member of draft.members) {
    member.limits = [{ id: 1, stat: 'attack', min: '0', max: '1' }];
    member.shikigami = { catalogId: '363', name: '帝释天' };
  }
  const projection = serializeCalculationDraft(draft, members, blueCatalog);
  assert.deepEqual(projection.issues, []);
  assert.ok(projection.value);
  assert.equal(projection.prechecks.filter((entry) => entry.status === 'conflict').length, 5);
  const encoded = buildTeamEncodeDraft(projection.value, blueCatalog);
  assert.equal(encoded.targets.length, 5);
  assert.ok(encoded.targets.every((target) => target.shikigamiId === 363 && !target.yuhunConfigEnabled));
});
