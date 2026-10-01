import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRecognizedSuits, applyReproductionSettings, applyReproductionTolerance, CALCULATION_METRICS, createEmptyCalculationMember, createCalculationDraft, DEFAULT_ORDER_STATS, effectiveOrderStats, REPRODUCTION_STATS, resetMemberConstraints, serializeCalculationDraft } from '../src/calculation-config';
import type { CalculationConfig, CalculationDraft, CalculationMemberDraft, CalculationMetricId, MainStat, SuitRequirement } from '../src/calculation-types';
import type { Catalog, Member, Stat } from '../src/types';

const catalog: Catalog = {
  version: '1', shikigami: [], yuhun: [
    { id: 'suit:1', name: '招财猫', avatar: '', type: 'Defense' },
    { id: 'suit:2', name: '火灵', avatar: '', type: 'ControlHit' },
    { id: 'suit:3', name: '蜃气楼', avatar: '', type: 'PVE' },
  ],
};

function source(slot = 1): Member {
  return {
    slot, shikigami: { id: 'test', name: '截图成员', rawText: '截图成员', candidates: [] },
    panel: { attack: 5374, hp: 23472, defense: 794, speed: 185, crit: 40, critDamage: 150, effectHit: 66, effectResist: 80 },
    yuhun: { catalogId: null, name: null, status: 'unavailable', candidates: [] }, needsReview: [],
  };
}

const findLimit = (member: CalculationMemberDraft, stat: typeof member.limits[number]['stat']) => member.limits.find((limit) => limit.stat === stat);

test('asynchronous accepted soul matches populate empty settings once the catalog is ready', () => {
  const sources = [source(1), source(2)], draft = createCalculationDraft(sources);
  assert.equal(applyRecognizedSuits(draft, sources, catalog), draft);
  sources[0]!.yuhun = { catalogId: null, name: null, status: 'candidate', candidates: [{ catalogId: 'suit:1', name: '招财猫', similarity: .92 }] };
  sources[1]!.yuhun = { catalogId: null, name: null, status: 'candidate', candidates: [{ catalogId: 'suit:3', name: '蜃气楼', similarity: .91 }] };
  assert.equal(applyRecognizedSuits(draft, sources, null), draft);
  const populated = applyRecognizedSuits(draft, sources, catalog);
  assert.deepEqual(populated.members.map((member) => member.suitRequirements), [
    [{ catalogId: 'suit:1', name: '招财猫', count: 4, kind: 'suit' }],
    [{ catalogId: 'suit:3', name: '蜃气楼', count: 2, kind: 'suit' }],
  ]);
  assert.deepEqual(draft.members[0]!.suitRequirements, []);
  assert.deepEqual(populated.members[0]!.limits, draft.members[0]!.limits);
  const serialized = serializeCalculationDraft(populated, sources, catalog);
  assert.deepEqual(serialized.value!.targets[0]!.suitRequirements, populated.members[0]!.suitRequirements);
  sources[0]!.yuhun.candidates = [{ catalogId: 'suit:2', name: '火灵', similarity: .99 }];
  assert.equal(applyRecognizedSuits(populated, sources, catalog), populated, 'rematching keeps saved selections');
});

test('soul defaults never apply rejected matches or replace manual selections and changed identities', () => {
  const sources = [source()];
  sources[0]!.yuhun = { catalogId: null, name: null, status: 'candidate', candidates: [{ catalogId: 'suit:1', name: '招财猫', similarity: .92 }] };
  for (const change of [
    (draft: CalculationDraft) => { draft.members[0]!.enabled = false; },
    (draft: CalculationDraft) => { draft.members[0]!.shikigami = null; },
    (draft: CalculationDraft) => { draft.members[0]!.shikigami!.catalogId = 'another'; },
    (draft: CalculationDraft) => { draft.members[0]!.suitSelectionComplete = true; },
    (draft: CalculationDraft) => { draft.members[0]!.suitRequirements = [{ catalogId: 'suit:2', name: '火灵', count: 4, kind: 'suit' }]; },
  ]) {
    const draft = createCalculationDraft(sources); change(draft);
    assert.equal(applyRecognizedSuits(draft, sources, catalog), draft);
  }
  const empty = createCalculationDraft(sources);
  assert.equal(applyRecognizedSuits(empty, sources, catalog, new Set([1])), empty, 'a manual clear stays empty');
  for (const status of ['unavailable', 'unrecognized'] as const) {
    sources[0]!.yuhun.status = status;
    assert.equal(applyRecognizedSuits(empty, sources, catalog), empty);
  }
  sources[0]!.yuhun.status = 'candidate';
  sources[0]!.yuhun.candidates[0]!.name = 'wrong identity';
  assert.equal(applyRecognizedSuits(empty, sources, catalog), empty);
});

test('defaults keep metadata and bound seven screenshot stats in their own units', () => {
  const members = [1, 2, 3, 4, 5].map(source), snapshot = structuredClone(members);
  const draft = createCalculationDraft(members), first = draft.members[0]!;
  assert.equal(draft.name, '对弈竞猜阵容'); assert.equal(draft.scene, '对弈竞猜');
  assert.equal(draft.calculationMode, 'force'); assert.equal(draft.difficulty, '1');
  assert.deepEqual(draft.reproduction, { tolerancePercent: '10', constraintStats: [...REPRODUCTION_STATS], orderStats: [...DEFAULT_ORDER_STATS] });
  assert.ok(draft.members.every((member) => member.enabled && member.metricId === 2));
  assert.equal(findLimit(first, 'effectHit'), undefined);
  for (const [stat, min, max] of [
    ['attack', '4836.6', '5911.4'], ['hp', '21124.8', '25819.2'], ['defense', '714.6', '873.4'],
    ['speed', '166.5', '203.5'], ['crit', '36', '44'], ['critDamage', '135', '165'], ['effectResist', '72', '88'],
  ] as const) {
    const limit = findLimit(first, stat)!;
    assert.equal(limit.min, min); assert.equal(limit.max, max);
  }
  assert.equal(new Set(first.limits.map(({ id }) => id)).size, first.limits.length);
  assert.ok(first.limits.every(({ id }) => Number.isInteger(id) && id > 0));
  assert.deepEqual(members, snapshot);
  for (const member of draft.members) {
    assert.deepEqual(member.shikigami, { catalogId: 'test', name: '截图成员' });
    assert.equal(member.targetScore, '');
    assert.deepEqual(member.suitRequirements, []); assert.equal(member.suitSelectionComplete, false);
    assert.deepEqual(member.mainStats, { 2: [], 4: [], 6: [] }); assert.equal(member.highestStat, null);
    assert.deepEqual(member.extraAttributes, { attackPercent: '', attack: '', crit: '', critDamage: '' });
    assert.equal(member.scope, 'all'); assert.equal(member.sixStarOnly, true); assert.equal(member.maxLevelOnly, true); assert.equal(member.excludeOccupied, false);
  }
  first.mainStats[2].push('speed'); first.limits[0]!.min = 'changed';
  assert.deepEqual(draft.members[1]!.mainStats[2], []);
  assert.equal(findLimit(draft.members[1]!, 'attack')!.min, '4836.6');
});

test('known zero values get ranges while unknown or abnormal values remain absent and defaults round to two decimals', () => {
  const member = source();
  member.panel = { attack: 0, hp: null, defense: NaN, speed: 0, crit: 0, critDamage: Infinity, effectHit: 0, effectResist: -1 };
  const limits = createCalculationDraft([member]).members[0]!.limits;
  assert.deepEqual(limits.map(({ stat, min, max }) => ({ stat, min, max })), [
    { stat: 'attack', min: '0', max: '0' }, { stat: 'speed', min: '0', max: '0' }, { stat: 'crit', min: '0', max: '0' },
  ]);
  member.panel.attack = 12.345;
  const limit = findLimit(createCalculationDraft([member]).members[0]!, 'attack')!;
  assert.equal(limit.min, '11.11'); assert.equal(limit.max, '13.58');
});

test('reset rebuilds all seven ranges regardless of metric and clones every nested member selection', () => {
  const member = source(), originalMember = structuredClone(member);
  for (const metricId of [1, 10, 11, 12] as const) {
    const draft = createCalculationDraft([member]), draftMember = draft.members[0]!;
    draft.name = '自定义阵容'; draft.scene = '自定义场景'; draft.calculationMode = 'difficulty'; draft.difficulty = '75';
    draftMember.enabled = false; draftMember.metricId = metricId;
    draftMember.shikigami = { catalogId: 'selected', name: '手动选择' };
    draftMember.targetScore = '0';
    draftMember.suitRequirements = [{ catalogId: 'suit:1', name: '招财猫', count: 4, kind: 'suit' }];
    draftMember.suitSelectionComplete = true;
    draftMember.mainStats = { 2: ['speed'], 4: ['effectHit', 'effectResist'], 6: ['hpPercent'] };
    draftMember.highestStat = 'speed';
    draftMember.extraAttributes = { attackPercent: '20', attack: '100', crit: '0', critDamage: '50' };
    draftMember.scope = 'unequipped'; draftMember.sixStarOnly = false; draftMember.maxLevelOnly = false; draftMember.excludeOccupied = true;
    draftMember.limits = [{ id: 90, stat: 'speed', min: '123', max: '999' }];
    const snapshot = structuredClone(draft), reset = resetMemberConstraints(draftMember, member);
    assert.deepEqual(reset.limits.map(({ stat }) => stat), [...REPRODUCTION_STATS]);
    assert.equal(findLimit(reset, 'speed')!.min, '166.5');
    assert.equal(findLimit(reset, 'effectHit'), undefined);
    assert.deepEqual({ ...reset, limits: undefined }, { ...snapshot.members[0], limits: undefined });
    draft.members[0] = reset;
    assert.deepEqual({ ...draft, members: undefined }, { ...snapshot, members: undefined });
    reset.shikigami!.name = 'changed'; reset.suitRequirements[0]!.count = 2;
    reset.mainStats[2].push('attackPercent'); reset.extraAttributes.crit = '100';
    assert.deepEqual(draftMember, snapshot.members[0]); assert.deepEqual(member, originalMember);
  }
  const removed = createEmptyCalculationMember(1);
  assert.equal(resetMemberConstraints(removed, member).shikigami, null);
});

test('metric IDs and names stay compatible and changing the metric alone does not change rows', () => {
  assert.deepEqual(CALCULATION_METRICS.map(({ id, name }) => [id, name]), [
    [1, '伤害输出'], [2, '效果命中'], [3, '效果抵抗'], [4, '生命'], [5, '攻击'], [6, '防御'],
    [7, '速度'], [8, '暴击'], [9, '暴击伤害'], [10, '治疗量'], [11, '命抗双修'], [12, '防御输出'],
  ]);
  const member = source(), draft = createCalculationDraft([member]), snapshot = structuredClone(draft.members[0]!.limits);
  draft.members[0]!.metricId = 7;
  const result = serializeCalculationDraft(draft, [member]);
  assert.deepEqual(draft.members[0]!.limits, snapshot);
  assert.equal(result.value!.targets[0]!.metricName, '速度');
  assert.ok(result.value!.targets[0]!.ranges.some(({ stat }) => stat === 'speed'));
});

test('disabled and removed members ignore inactive settings without mutating their backing drafts', () => {
  const members = [source(1), source(2)], draft = createCalculationDraft(members);
  const inactive = draft.members[1]!;
  inactive.enabled = false; inactive.metricId = 99 as CalculationMetricId;
  inactive.limits = [{ id: NaN, stat: 'attack', min: 'not a number', max: '' }];
  inactive.targetScore = 'Infinity';
  inactive.suitRequirements = [{ catalogId: 'invented', name: 'wrong', count: 99, kind: 'suit' } as unknown as SuitRequirement];
  inactive.mainStats[2] = ['crit' as MainStat]; inactive.highestStat = 'not a stat' as CalculationMemberDraft['highestStat'];
  inactive.extraAttributes = { attackPercent: '-1', attack: 'bad', crit: 'NaN', critDamage: 'Infinity' };
  inactive.scope = 'invalid' as CalculationMemberDraft['scope']; inactive.shikigami = { catalogId: null, name: null };
  for (const removed of [false, true]) {
    if (removed) { inactive.shikigami = null; inactive.enabled = true; }
    const snapshot = structuredClone(draft), result = serializeCalculationDraft(draft, members, catalog);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.value!.targets[1], {
      slot: 2, shikigami: removed ? null : { catalogId: null, name: null }, yuhunConfigEnabled: false,
      metricId: 2, metricName: '效果命中', targetScore: null, suitRequirements: [], suitSelectionComplete: false,
      mainStats: { 2: [], 4: [], 6: [] }, highestStat: null, extraAttributes: {},
      scope: 'all', sixStarOnly: false, maxLevelOnly: false, excludeOccupied: false, ranges: [],
    });
    assert.deepEqual(draft, snapshot);
  }
  draft.members[0]!.enabled = false;
  const disabled = serializeCalculationDraft(draft, members);
  assert.deepEqual(disabled.issues, []);
  assert.ok(disabled.value!.targets.every((target) => !target.yuhunConfigEnabled));
});

test('remove and re-add retain five source slots while null and unknown objects have distinct semantics', () => {
  const members = [1, 2, 3, 4, 5].map(source), draft = createCalculationDraft(members);
  draft.members[0] = createEmptyCalculationMember(1);
  const empty = draft.members[0]!;
  assert.equal(empty.shikigami, null); assert.equal(empty.enabled, true); assert.equal(empty.metricId, 2);
  assert.deepEqual(empty.limits, []); assert.deepEqual(empty.suitRequirements, []); assert.deepEqual(empty.mainStats, { 2: [], 4: [], 6: [] });
  let result = serializeCalculationDraft(draft, members);
  assert.deepEqual(result.issues, []); assert.equal(result.value!.targets.length, 5);
  assert.equal(result.value!.targets[0]!.shikigami, null); assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, false);
  empty.shikigami = { catalogId: null, name: null };
  result = serializeCalculationDraft(draft, members);
  assert.deepEqual(result.issues, []); assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, true);
  assert.deepEqual(result.value!.targets[0]!.shikigami, { catalogId: null, name: null });
  draft.members = members.map(({ slot }) => createEmptyCalculationMember(slot));
  assert.ok(serializeCalculationDraft(draft, members).issues.some(({ field }) => field === 'members'));
  draft.members.pop();
  assert.ok(serializeCalculationDraft(draft, members).issues.some(({ field }) => field === 'slot'));
});

test('export keeps percentage points, open bounds and zero without guessing upper caps', () => {
  const members = [source()], draft = createCalculationDraft(members);
  draft.members[0]!.limits = [
    { id: 1, stat: 'attack', min: '0', max: ' ' }, { id: 2, stat: 'crit', min: '125', max: '200' },
    { id: 3, stat: 'critDamage', min: '', max: '250.75' },
  ];
  const result = serializeCalculationDraft(draft, members);
  assert.deepEqual(result.issues, []); assert.equal(result.value!.percentageUnit, 'percentage-points');
  assert.deepEqual(result.value!.targets[0]!.ranges, [
    { stat: 'attack', percentage: false, min: 0 }, { stat: 'crit', percentage: true, min: 125, max: 200 },
    { stat: 'critDamage', percentage: true, max: 250.75 },
  ]);
});

test('range bounds report row IDs and reject blanks, nonfinite numbers, negatives and reversal', () => {
  const members = [source()];
  for (const min of ['abc', 'NaN', 'Infinity', '1e309', '-1', '0x10']) {
    const draft = createCalculationDraft(members); draft.members[0]!.limits = [{ id: 57, stat: 'crit', min, max: '' }];
    const result = serializeCalculationDraft(draft, members);
    assert.equal(result.value, null, min);
    assert.ok(result.issues.some(({ stat, field }) => stat === 'crit' && field === 'limits.57.min'));
  }
  for (const [min, max, field] of [[' ', '', 'limits'], ['2', '1', 'limits.57.max'], ['', 'Infinity', 'limits.57.max']]) {
    const draft = createCalculationDraft(members); draft.members[0]!.limits = [{ id: 57, stat: 'crit', min: min!, max: max! }];
    const result = serializeCalculationDraft(draft, members);
    assert.equal(result.value, null); assert.ok(result.issues.some((issue) => issue.field === field && issue.stat === 'crit'));
  }
});

test('limits reject duplicate properties, invalid IDs and duplicate IDs without collapsing rows', () => {
  const members = [source()];
  const cases = [
    [{ id: 1, stat: 'crit', min: '0', max: '' }, { id: 2, stat: 'crit', min: '5', max: '' }],
    [{ id: 1, stat: 'crit', min: '0', max: '' }, { id: 1, stat: 'speed', min: '5', max: '' }],
    ...[0, -1, 1.5, NaN, Infinity].map((id) => [{ id, stat: 'crit', min: '0', max: '' }]),
    [{ id: 1, stat: 'unknown', min: '0', max: '' }],
  ];
  for (const limits of cases) {
    const draft = createCalculationDraft(members); draft.members[0]!.limits = limits as CalculationMemberDraft['limits'];
    const snapshot = structuredClone(draft), result = serializeCalculationDraft(draft, members);
    assert.equal(result.value, null); assert.ok(result.issues.some(({ field }) => field === 'limits'));
    assert.deepEqual(draft, snapshot);
  }
});

test('metadata trims name and scene and validates difficulty only when selected', () => {
  const members = [source()], draft = createCalculationDraft(members);
  draft.name = '  自定义阵容  '; draft.scene = ' 自定义场景 '; draft.difficulty = 'invalid';
  let result = serializeCalculationDraft(draft, members);
  assert.deepEqual(result.issues, []); assert.equal(result.value!.name, '自定义阵容');
  assert.equal(result.value!.scene, '自定义场景'); assert.equal(result.value!.difficulty, null);
  assert.equal(draft.name, '  自定义阵容  ');
  for (const [field, value] of [['name', ' '], ['name', 'x'.repeat(81)], ['scene', ' '], ['calculationMode', 'invalid']] as const) {
    const invalid = structuredClone(draft); (invalid as unknown as Record<string, string>)[field] = value;
    result = serializeCalculationDraft(invalid, members);
    assert.equal(result.value, null); assert.ok(result.issues.some((issue) => issue.field === field && issue.slot === null));
  }
  draft.calculationMode = 'difficulty';
  for (const value of [' ', '0', '101', '1.5', 'Infinity', '1e309', 'abc', '0x10']) {
    draft.difficulty = value; result = serializeCalculationDraft(draft, members);
    assert.equal(result.value, null); assert.ok(result.issues.some(({ field }) => field === 'difficulty'));
  }
  for (const value of ['1', ' 100 ']) {
    draft.difficulty = value; result = serializeCalculationDraft(draft, members);
    assert.deepEqual(result.issues, []); assert.equal(result.value!.difficulty, Number(value));
    assert.equal(result.value!.calculationMode, 'difficulty');
  }
});

test('slot identity survives reordering while duplicate, missing, stale slots and active invalid metrics fail', () => {
  const members = [source(3), source(1)], draft = createCalculationDraft(members);
  draft.members.reverse();
  assert.deepEqual(serializeCalculationDraft(draft, members).value!.targets.map(({ slot }) => slot), [1, 3]);
  for (const change of [
    (value: CalculationDraft) => { value.members[0]!.slot = 2; },
    (value: CalculationDraft) => { value.members[1]!.slot = value.members[0]!.slot; },
    (value: CalculationDraft) => { value.members.pop(); },
    (value: CalculationDraft) => { value.members[0]!.slot = NaN; },
    (value: CalculationDraft) => { value.members[0]!.slot = 6; },
    (value: CalculationDraft) => { value.members[0]!.metricId = 99 as CalculationMetricId; },
  ]) {
    const invalid = structuredClone(draft); change(invalid);
    assert.equal(serializeCalculationDraft(invalid, members).value, null);
  }
  assert.equal(serializeCalculationDraft(createCalculationDraft([source(1), source(1)]), [source(1), source(1)]).value, null);
  const tooMany = [1, 2, 3, 4, 5, 6].map(source);
  assert.equal(serializeCalculationDraft(createCalculationDraft(tooMany), tooMany).value, null);
  assert.equal(serializeCalculationDraft(createCalculationDraft([]), []).value, null);
});

test('complete manual configuration exports metadata, both unit systems and independent cloned selections', () => {
  const members = [source()], draft = createCalculationDraft(members), member = draft.members[0]!;
  member.shikigami = { catalogId: 'new-hero', name: '改选式神' }; member.metricId = 11; member.targetScore = '0';
  member.suitRequirements = [
    { catalogId: 'suit:1', name: '招财猫', count: 4, kind: 'suit' },
    { catalogId: 'two-piece-effect:effectHit', name: '效果命中', count: 2, kind: 'two-piece-effect' },
  ];
  member.suitSelectionComplete = true;
  member.mainStats = { 2: ['speed', 'attackPercent'], 4: ['effectHit', 'effectResist'], 6: ['hpPercent'] };
  member.highestStat = 'speed'; member.extraAttributes = { attackPercent: '20.5', attack: '100', crit: '0', critDamage: '150' };
  member.scope = 'unequipped'; member.sixStarOnly = false; member.maxLevelOnly = true; member.excludeOccupied = true;
  member.limits.push({ id: 99, stat: 'effectHit', min: '125', max: '' });
  const sourceSnapshot = structuredClone(members), draftSnapshot = structuredClone(draft);
  const result = serializeCalculationDraft(draft, members, catalog);
  assert.deepEqual(result.issues, []); assert.equal(result.value!.percentageUnit, 'percentage-points');
  assert.equal(result.value!.extraAttributesPercentageUnit, 'ratio');
  assert.equal(result.value!.name, draft.name); assert.equal(result.value!.scene, draft.scene);
  const target = result.value!.targets[0]!;
  assert.deepEqual(target.shikigami, { catalogId: 'new-hero', name: '改选式神' });
  assert.equal(target.metricId, 11); assert.equal(target.targetScore, 0);
  assert.deepEqual(target.suitRequirements, member.suitRequirements); assert.equal(target.suitSelectionComplete, true);
  assert.deepEqual(target.mainStats, member.mainStats); assert.equal(target.highestStat, 'speed');
  assert.deepEqual(target.extraAttributes, { attackPercent: 0.205, attack: 100, crit: 0, critDamage: 1.5 });
  assert.equal(target.scope, 'unequipped'); assert.equal(target.sixStarOnly, false); assert.equal(target.maxLevelOnly, true); assert.equal(target.excludeOccupied, true);
  assert.equal(target.ranges.some(({ stat }) => stat === 'effectHit'), false);
  target.shikigami!.name = 'changed'; target.suitRequirements[0]!.count = 2;
  target.mainStats[2].push('hpPercent'); target.extraAttributes.crit = 1; target.ranges[0]!.min = 999;
  assert.deepEqual(draft, draftSnapshot); assert.deepEqual(members, sourceSnapshot);
});

test('unknown screenshot shikigami remains exportable and raw text is a name fallback', () => {
  const member = source(); member.shikigami = { id: null, name: null, rawText: '待确认文本', candidates: [] };
  let draft = createCalculationDraft([member]);
  assert.deepEqual(draft.members[0]!.shikigami, { catalogId: null, name: '待确认文本' });
  assert.deepEqual(serializeCalculationDraft(draft, [member]).value!.targets[0]!.shikigami, { catalogId: null, name: '待确认文本' });
  member.shikigami.rawText = null; draft = createCalculationDraft([member]);
  assert.deepEqual(serializeCalculationDraft(draft, [member]).value!.targets[0]!.shikigami, { catalogId: null, name: null });
});

test('invalid active score and extra attributes fail with their own field while blanks omit values', () => {
  const members = [source()];
  for (const value of ['abc', 'NaN', 'Infinity', '1e309', '-0.1', '0x10']) {
    for (const field of ['targetScore', 'attackPercent', 'attack', 'crit', 'critDamage'] as const) {
      const draft = createCalculationDraft(members), member = draft.members[0]!;
      if (field === 'targetScore') member.targetScore = value;
      else member.extraAttributes[field] = value;
      const result = serializeCalculationDraft(draft, members);
      assert.equal(result.value, null, `${field}: ${value}`);
      assert.ok(result.issues.some((issue) => issue.field === (field === 'targetScore' ? field : `extraAttributes.${field}`)));
    }
  }
  const result = serializeCalculationDraft(createCalculationDraft(members), members);
  assert.equal(result.value!.targets[0]!.targetScore, null);
  assert.deepEqual(result.value!.targets[0]!.extraAttributes, {});
});

test('suit counts, capacity, identity, symbolic effect and catalog PVE restrictions are validated', () => {
  const regular: SuitRequirement = { catalogId: 'suit:1', name: '招财猫', count: 4, kind: 'suit' };
  const invalidCases: { suits: SuitRequirement[]; field: string }[] = [
    { suits: [regular, { catalogId: 'suit:2', name: '火灵', count: 4, kind: 'suit' }], field: 'suitRequirements' },
    { suits: [regular, { ...regular, count: 2 }], field: 'suitRequirements.1' },
    { suits: [{ ...regular, count: 3 as 2 }], field: 'suitRequirements.0.count' },
    { suits: [{ catalogId: 'suit:3', name: '蜃气楼', count: 4, kind: 'suit' }], field: 'suitRequirements.0.count' },
    { suits: [{ ...regular, catalogId: 'invented' }], field: 'suitRequirements.0' },
    { suits: [{ ...regular, name: '不存在' }], field: 'suitRequirements.0' },
    { suits: [{ catalogId: 'two-piece-effect:crit', name: '暴击', count: 4, kind: 'two-piece-effect' }], field: 'suitRequirements.0.count' },
    { suits: [{ catalogId: 'two-piece-effect:crit', name: '效果命中', count: 2, kind: 'two-piece-effect' }], field: 'suitRequirements.0' },
    { suits: [{ catalogId: null, name: '暴击', count: 2, kind: 'two-piece-effect' }], field: 'suitRequirements.0' },
    { suits: [{ catalogId: 'two-piece-effect:crit', name: '暴击', count: 2, kind: 'suit' }], field: 'suitRequirements.0.catalogId' },
  ];
  const members = [source()];
  for (const { suits, field } of invalidCases) {
    const draft = createCalculationDraft(members); draft.members[0]!.suitRequirements = suits;
    const result = serializeCalculationDraft(draft, members, catalog);
    assert.equal(result.value, null, JSON.stringify(suits));
    assert.ok(result.issues.some((issue) => issue.field === field), field);
  }
  const draft = createCalculationDraft(members);
  draft.members[0]!.suitRequirements = [regular, { catalogId: null, name: '蜃气楼', count: 2, kind: 'suit' }];
  const result = serializeCalculationDraft(draft, members, catalog);
  assert.deepEqual(result.issues, []);
  assert.equal(result.value!.targets[0]!.suitRequirements[1]!.catalogId, null);
});

test('each main stat slot rejects illegal or duplicate choices and highest stat is checked', () => {
  const members = [source()];
  for (const [slot, selected] of [[2, ['crit']], [4, ['speed']], [6, ['effectHit']], [2, ['speed', 'speed']]] as const) {
    const draft = createCalculationDraft(members);
    draft.members[0]!.mainStats[slot] = [...selected];
    const result = serializeCalculationDraft(draft, members);
    assert.equal(result.value, null);
    assert.ok(result.issues.some(({ field }) => field === `mainStats.${slot}`));
  }
  const draft = createCalculationDraft(members); draft.members[0]!.highestStat = 'invalid' as CalculationMemberDraft['highestStat'];
  const result = serializeCalculationDraft(draft, members);
  assert.equal(result.value, null); assert.ok(result.issues.some(({ field }) => field === 'highestStat'));
});

test('global tolerance rebuilds relative ranges and retains every other calculation setting', () => {
  const sources = [source()], draft = createCalculationDraft(sources), member = draft.members[0]!;
  member.metricId = 1; member.targetScore = '7000';
  member.suitRequirements = [{ catalogId: 'suit:1', name: '招财猫', count: 4, kind: 'suit' }];
  member.mainStats[2] = ['speed']; member.highestStat = 'speed'; member.extraAttributes.crit = '20';
  member.scope = 'unequipped'; member.sixStarOnly = false; member.excludeOccupied = true;
  member.limits = [{ id: 99, stat: 'crit', min: '1', max: '99' }];
  const snapshot = structuredClone(draft);
  assert.equal(applyReproductionTolerance(draft, sources, '10').members[0]!.limits[0]!.id, 99, 'unchanged tolerance preserves manual rows');
  for (const [percent, min, max] of [['20', '32', '48'], ['0', '40', '40'], ['100', '0', '80']]) {
    const changed = applyReproductionTolerance(draft, sources, percent!);
    const next = changed.members[0]!;
    assert.equal(findLimit(next, 'crit')!.min, min); assert.equal(findLimit(next, 'crit')!.max, max);
    assert.ok(findLimit(next, 'attack')); assert.ok(findLimit(next, 'critDamage'));
    assert.equal(findLimit(next, 'effectHit'), undefined);
    assert.deepEqual({ ...next, limits: undefined }, { ...member, limits: undefined });
    assert.deepEqual(changed.reproduction, { tolerancePercent: percent, constraintStats: [...REPRODUCTION_STATS], orderStats: [...DEFAULT_ORDER_STATS] });
    const result = serializeCalculationDraft(changed, sources);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.value!.reproduction, { tolerancePercent: Number(percent), constraintStats: [...REPRODUCTION_STATS], orderStats: [...DEFAULT_ORDER_STATS] });
    assert.notEqual(next.mainStats[2], member.mainStats[2]);
    assert.deepEqual(draft, snapshot);
  }
  assert.equal(findLimit(resetMemberConstraints(member, sources[0]!, '20'), 'speed')!.min, '148');
  sources[0]!.panel.crit = 0;
  assert.deepEqual(findLimit(applyReproductionTolerance(draft, sources, '20').members[0]!, 'crit'),
    { id: 5, stat: 'crit', min: '0', max: '0' });
  sources[0]!.panel.speed = 12.345;
  assert.deepEqual(findLimit(applyReproductionTolerance(draft, sources, '0').members[0]!, 'speed'),
    { id: 4, stat: 'speed', min: '12.345', max: '12.345' }, 'zero tolerance keeps the exact original value');
});

test('invalid tolerance retains edited ranges and reports a global export error', () => {
  const sources = [source()], draft = createCalculationDraft(sources);
  draft.members[0]!.limits[0]!.min = '123';
  const snapshot = structuredClone(draft);
  for (const percent of ['', ' ', 'abc', '-1', '101', 'Infinity', 'NaN', '1e309', '0x10']) {
    const changed = applyReproductionTolerance(draft, sources, percent);
    assert.equal(changed.reproduction.tolerancePercent, percent);
    assert.deepEqual(changed.members, snapshot.members);
    const result = serializeCalculationDraft(changed, sources);
    assert.equal(result.value, null);
    assert.ok(result.issues.some(({ slot, field }) => slot === null && field === 'reproduction.tolerancePercent'), percent);
  }
  assert.deepEqual(draft, snapshot);
  (draft.reproduction as unknown as Record<string, unknown>).orderStats = ['attack', 'attack'];
  assert.ok(serializeCalculationDraft(draft, sources).issues.some(({ field }) => field === 'reproduction.orderStats'));
});

test('checkbox changes filter export and restore saved values without rebuilding limits', () => {
  const sources = [source()], draft = createCalculationDraft(sources);
  draft.members[0]!.limits.find(({ stat }) => stat === 'attack')!.min = 'manual';
  const original = structuredClone(draft.members[0]!.limits);
  const constraints: CalculationDraft['reproduction']['constraintStats'] = ['crit'];
  const ordered: CalculationDraft['reproduction']['orderStats'] = ['attack', 'critDamage'];
  const selected = applyReproductionSettings(draft, sources, { constraintStats: constraints, orderStats: ordered });
  constraints.push('hp'); ordered.push('speed');
  assert.deepEqual(selected.reproduction.constraintStats, ['crit']);
  assert.deepEqual(selected.reproduction.orderStats, ['attack', 'critDamage']);
  assert.deepEqual(effectiveOrderStats(selected.reproduction), []);
  assert.deepEqual(selected.members[0]!.limits, original);
  assert.deepEqual(serializeCalculationDraft(selected, sources).value!.targets[0]!.ranges.map(({ stat }) => stat), ['crit']);
  const none = applyReproductionSettings(selected, sources, { constraintStats: [], orderStats: [] });
  assert.deepEqual(serializeCalculationDraft(none, sources).value!.targets[0]!.ranges, []);
  const restored = applyReproductionSettings(none, sources, { constraintStats: [...REPRODUCTION_STATS] });
  assert.deepEqual(restored.members[0]!.limits, original);
  assert.equal(serializeCalculationDraft(restored, sources).value, null, 'reselected invalid value is validated again');
  const rebuilt = applyReproductionSettings(selected, sources, { tolerancePercent: '20' });
  assert.equal(findLimit(rebuilt.members[0]!, 'attack')!.min, '4299.2');
  assert.deepEqual(rebuilt.reproduction.constraintStats, ['crit']);
});

test('global stat lists reject invalid and repeated values while unselected rows do not validate or export', () => {
  const sources = [source()], draft = createCalculationDraft(sources);
  draft.members[0]!.limits.push({ id: 99, stat: 'effectHit', min: 'bad', max: '' });
  draft.members[0]!.limits.find(({ stat }) => stat === 'attack')!.max = 'bad';
  draft.reproduction.constraintStats = ['crit'];
  draft.reproduction.orderStats = ['attack'];
  let result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value!.targets[0]!.ranges.map(({ stat }) => stat), ['crit']);
  assert.deepEqual(result.value!.reproduction, { tolerancePercent: 10, constraintStats: ['crit'], orderStats: ['attack'] });
  for (const [field, value] of [
    ['constraintStats', ['crit', 'crit']], ['constraintStats', ['effectHit']], ['constraintStats', 'attack'],
    ['orderStats', ['speed', 'speed']], ['orderStats', ['effectHit']], ['orderStats', null],
  ] as const) {
    const broken = structuredClone(draft);
    (broken.reproduction as unknown as Record<string, unknown>)[field] = value;
    result = serializeCalculationDraft(broken, sources);
    assert.equal(result.value, null);
    assert.ok(result.issues.some((issue) => issue.field === `reproduction.${field}`));
  }
});

test('default order separates only speed, attack and crit damage', () => {
  const sources = [source(1), source(2)];
  Object.assign(sources[0]!.panel, { attack: 7000, speed: 100, critDamage: 200, hp: 10000 });
  Object.assign(sources[1]!.panel, { attack: 7200, speed: 120, critDamage: 220, hp: 12000 });
  const draft = createCalculationDraft(sources);
  const result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assertOrderAndSubset(result.value!, draft, sources, [...DEFAULT_ORDER_STATS]);
  assert.deepEqual(result.value!.targets.map((target) => target.ranges.find(({ stat }) => stat === 'hp')), [
    { stat: 'hp', percentage: false, min: 9000, max: 11000 },
    { stat: 'hp', percentage: false, min: 10800, max: 13200 },
  ]);
  const hpOnly = applyReproductionSettings(draft, sources, { orderStats: ['hp'] });
  const reordered = serializeCalculationDraft(hpOnly, sources);
  assertOrderAndSubset(reordered.value!, hpOnly, sources, ['hp']);
  assert.deepEqual(reordered.value!.targets.map((target) => target.ranges.find(({ stat }) => stat === 'attack')),
    draft.members.map((member) => ({ stat: 'attack', percentage: false, min: Number(findLimit(member, 'attack')!.min), max: Number(findLimit(member, 'attack')!.max) })));
});

test('tolerance preserves disabled, removed, changed and unknown screenshot identities', () => {
  const sources = [1, 2, 3, 4, 5].map(source), draft = createCalculationDraft(sources);
  draft.members[0]!.enabled = false;
  draft.members[1]!.shikigami = null;
  draft.members[2]!.shikigami!.catalogId = 'changed';
  sources[3]!.shikigami.id = null; draft.members[3]!.shikigami!.catalogId = null;
  for (const member of draft.members) member.limits = [{ id: 50, stat: 'crit', min: '1', max: '99' }];
  const changed = applyReproductionTolerance(draft, sources, '20');
  for (let index = 0; index < 4; index++) assert.equal(changed.members[index], draft.members[index]);
  assert.equal(findLimit(changed.members[4]!, 'crit')!.min, '32');
  assert.equal(findLimit(changed.members[4]!, 'crit')!.max, '48');
});

function orderDraft(sources: Member[], stats: Stat[] = ['attack']): CalculationDraft {
  const draft = createCalculationDraft(sources);
  draft.reproduction.orderStats = stats as CalculationDraft['reproduction']['orderStats'];
  for (const member of draft.members) member.limits = member.limits.filter(({ stat }) => stats.includes(stat));
  return draft;
}

function assertOrderAndSubset(config: CalculationConfig, draft: CalculationDraft, sources: Member[], stats: Stat[]): void {
  for (const stat of stats) {
    const participants = config.targets.filter(({ yuhunConfigEnabled, ranges }) => yuhunConfigEnabled && ranges.some((range) => range.stat === stat));
    for (const target of participants) {
      const range = target.ranges.find((item) => item.stat === stat)!;
      const edited = draft.members.find(({ slot }) => slot === target.slot)!.limits.find((item) => item.stat === stat)!;
      assert.ok(range.min! >= Number(edited.min)); assert.ok(range.max! <= Number(edited.max));
      assert.ok(range.min! <= range.max!);
      for (const higher of participants) {
        const original = sources.find(({ slot }) => slot === target.slot)!.panel[stat]!;
        if (original >= sources.find(({ slot }) => slot === higher.slot)!.panel[stat]!) continue;
        const higherRange = higher.ranges.find((item) => item.stat === stat)!;
        assert.ok(Math.round(higherRange.min! * 100) - Math.round(range.max! * 100) >= 1,
          `${stat}: slot ${target.slot} must stay below slot ${higher.slot}`);
      }
    }
  }
}

test('strict attack order separates 7200 and 7000 within tolerance and cancel restores edited ranges', () => {
  const sources = [source(1), source(2)]; sources[0]!.panel.attack = 7200; sources[1]!.panel.attack = 7000;
  const draft = orderDraft(sources), snapshot = structuredClone(draft);
  const result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value!.targets.map(({ ranges }) => ranges), [
    [{ stat: 'attack', percentage: false, min: 7100.01, max: 7920 }],
    [{ stat: 'attack', percentage: false, min: 6300, max: 7100 }],
  ]);
  assertOrderAndSubset(result.value!, draft, sources, ['attack']);
  assert.deepEqual(draft, snapshot);
  draft.reproduction.orderStats = [];
  const restored = serializeCalculationDraft(draft, sources);
  assert.deepEqual(restored.value!.targets.map(({ ranges }) => ranges), [
    [{ stat: 'attack', percentage: false, min: 6480, max: 7920 }],
    [{ stat: 'attack', percentage: false, min: 6300, max: 7700 }],
  ]);
  const wider = applyReproductionTolerance(draft, sources, '20'); wider.reproduction.orderStats = ['attack'];
  assertOrderAndSubset(serializeCalculationDraft(wider, sources).value!, wider, sources, ['attack']);
});

test('strict order follows each attribute across multiple groups and leaves ties unordered without changing slots', () => {
  const sources = [source(3), source(1), source(2), source(4)];
  const panels = { 1: [7200, 100, 40], 2: [7000, 120, 40], 3: [7100, 110, 30], 4: [7200, 105, 40] };
  for (const member of sources) {
    const [attack, speed, crit] = panels[member.slot as keyof typeof panels]!;
    Object.assign(member.panel, { attack, speed, crit });
  }
  const draft = orderDraft(sources, ['attack', 'speed', 'crit']), snapshot = structuredClone(draft);
  const result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value!.targets.map(({ slot }) => slot), [3, 1, 2, 4]);
  assertOrderAndSubset(result.value!, draft, sources, ['attack', 'speed', 'crit']);
  const attack = (slot: number) => result.value!.targets.find((target) => target.slot === slot)!.ranges.find(({ stat }) => stat === 'attack');
  assert.deepEqual(attack(1), attack(4), 'equal screenshot values never impose arbitrary slot order');
  const crit = (slot: number) => result.value!.targets.find((target) => target.slot === slot)!.ranges.find(({ stat }) => stat === 'crit');
  assert.deepEqual(crit(1), crit(2)); assert.deepEqual(crit(2), crit(4));
  assert.deepEqual(draft, snapshot);
});

test('strict order keeps manual ranges already separated by a hundredth unchanged and handles decimal midpoints', () => {
  const sources = [source(1), source(2)]; sources[0]!.panel.attack = 7000; sources[1]!.panel.attack = 7200;
  let draft = orderDraft(sources);
  draft.members[0]!.limits = [{ id: 1, stat: 'attack', min: '6500', max: '7000' }];
  draft.members[1]!.limits = [{ id: 1, stat: 'attack', min: '7000.01', max: '8000' }];
  const unchanged = serializeCalculationDraft(draft, sources);
  assert.deepEqual(unchanged.issues, []);
  assert.deepEqual(unchanged.value!.targets.map(({ ranges }) => ranges), [
    [{ stat: 'attack', percentage: false, min: 6500, max: 7000 }],
    [{ stat: 'attack', percentage: false, min: 7000.01, max: 8000 }],
  ]);
  sources[0]!.panel.attack = 0.29; sources[1]!.panel.attack = 0.3;
  draft = orderDraft(sources);
  const decimals = serializeCalculationDraft(draft, sources);
  assert.deepEqual(decimals.issues, []);
  assert.equal(decimals.value!.targets[0]!.ranges[0]!.max, 0.29);
  assert.equal(decimals.value!.targets[1]!.ranges[0]!.min, 0.3);
  assertOrderAndSubset(decimals.value!, draft, sources, ['attack']);
});

test('strict order disables contradictory members without expanding ranges or discarding identities', () => {
  const sources = [source(1), source(2)]; sources[0]!.panel.attack = 7000; sources[1]!.panel.attack = 7200;
  const draft = orderDraft(sources), snapshot = structuredClone(draft);
  draft.members[0]!.limits[0]!.min = '7400'; draft.members[0]!.limits[0]!.max = '7500';
  draft.members[1]!.limits[0]!.min = '6800'; draft.members[1]!.limits[0]!.max = '6900';
  const edited = structuredClone(draft), result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.ok(result.value!.targets.every((target) => !target.yuhunConfigEnabled && target.shikigami?.catalogId === 'test'));
  assert.ok(result.prechecks.every(({ status, reason }) => status === 'conflict' && reason.includes('没有可用范围')));
  assert.deepEqual(draft, edited); assert.notDeepEqual(draft, snapshot);
});

test('strict order refuses unknown panels, changed identities, open bounds and insufficient precision', () => {
  const changes = [
    (sources: Member[], _draft: CalculationDraft) => { sources[0]!.panel.attack = null; },
    (sources: Member[], _draft: CalculationDraft) => { sources[0]!.panel.attack = NaN; },
    (sources: Member[], _draft: CalculationDraft) => { sources[0]!.panel.attack = Infinity; },
    (sources: Member[], _draft: CalculationDraft) => { sources[0]!.panel.attack = 7000.001; },
    (sources: Member[], _draft: CalculationDraft) => { sources[0]!.panel.attack = 1e16; },
    (sources: Member[], _draft: CalculationDraft) => { sources[0]!.shikigami.id = null; },
    (_sources: Member[], draft: CalculationDraft) => { draft.members[0]!.shikigami!.catalogId = 'another'; },
    (_sources: Member[], draft: CalculationDraft) => { draft.members[0]!.limits[0]!.min = ''; },
    (_sources: Member[], draft: CalculationDraft) => { draft.members[0]!.limits[0]!.max = ''; },
    (_sources: Member[], draft: CalculationDraft) => { draft.members[0]!.limits[0]!.min = '6300.001'; },
    (_sources: Member[], draft: CalculationDraft) => { draft.members[0]!.limits[0]!.max = '1e16'; },
  ];
  for (const change of changes) {
    const sources = [source(1), source(2)]; sources[0]!.panel.attack = 7000; sources[1]!.panel.attack = 7200;
    const draft = orderDraft(sources); change(sources, draft);
    const result = serializeCalculationDraft(draft, sources);
    assert.equal(result.value, null);
    assert.ok(result.issues.some(({ slot, stat, field }) => slot === 1 && stat === 'attack' && field === 'reproduction.orderStats'));
    draft.reproduction.orderStats = [];
    assert.deepEqual(serializeCalculationDraft(draft, sources).issues, [], 'turning strict off retains the existing range contract');
  }
});

test('strict order excludes disabled, removed and unbounded members while metric changes retain constraints', () => {
  const sources = [source(1), source(2), source(3)]; sources[0]!.panel.attack = 7000; sources[1]!.panel.attack = 7200;
  for (const exclude of ['disabled', 'removed', 'no-range'] as const) {
    const draft = orderDraft(sources);
    sources[2]!.panel.attack = null; sources[2]!.shikigami.id = null;
    draft.members[2]!.shikigami = { catalogId: 'different', name: 'different' };
    if (exclude === 'disabled') draft.members[2]!.enabled = false;
    else if (exclude === 'removed') draft.members[2]!.shikigami = null;
    else draft.members[2]!.limits = [];
    const result = serializeCalculationDraft(draft, sources);
    assert.deepEqual(result.issues, []);
    assertOrderAndSubset(result.value!, draft, sources, ['attack']);
  }
  const optimized = orderDraft(sources.slice(0, 2));
  for (let index = 0; index < 2; index++) {
    const member = optimized.members[index]!; member.metricId = 5;
    optimized.members[index] = resetMemberConstraints(member, sources[index]!);
  }
  assert.ok(serializeCalculationDraft(optimized, sources.slice(0, 2)).value!.targets.every(({ ranges }) => ranges.some(({ stat }) => stat === 'attack')));
  assertOrderAndSubset(serializeCalculationDraft(optimized, sources.slice(0, 2)).value!, optimized, sources.slice(0, 2), ['attack']);
});

test('highest stat blocks distinct-group strict order even from a member outside the static ranges', () => {
  const sources = [source(1), source(2), source(3)]; sources[0]!.panel.attack = 7000; sources[1]!.panel.attack = 7200;
  const draft = orderDraft(sources); draft.members[2]!.limits = []; draft.members[2]!.highestStat = 'attack';
  const snapshot = structuredClone(draft), conflict = serializeCalculationDraft(draft, sources);
  assert.equal(conflict.value, null);
  assert.ok(conflict.issues.some(({ slot, stat, field, message }) => slot === 3 && stat === 'attack' && field === 'highestStat' && message.includes('动态覆盖')));
  assert.deepEqual(draft, snapshot);
  draft.members[2]!.highestStat = 'speed';
  assert.deepEqual(serializeCalculationDraft(draft, sources).issues, [], 'unconstrained highest attribute does not conflict');
  draft.members[2]!.highestStat = 'attack'; draft.members[2]!.enabled = false;
  assert.deepEqual(serializeCalculationDraft(draft, sources).issues, [], 'inactive highest constraint does not conflict');
  draft.members[2]!.enabled = true; sources[1]!.panel.attack = 7000;
  const tied = serializeCalculationDraft(draft, sources);
  assert.deepEqual(tied.issues, [], 'one equal-value group has no ordering relationship');
  assert.equal(tied.value!.targets[2]!.highestStat, 'attack');
  assert.deepEqual(tied.value!.targets[0]!.ranges[0], { stat: 'attack', percentage: false, min: 6300, max: 7700 });
  assert.deepEqual(tied.value!.targets[1]!.ranges[0], { stat: 'attack', percentage: false, min: 6480, max: 7920 });
});
