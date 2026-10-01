import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalculationDraft, serializeCalculationDraft } from '../src/calculation-config';
import { createHitMetricPools, DEFAULT_HIT_METRIC_POOLS, effectiveCalculationMetricId, matchHitMetricPool } from '../src/calculation-metric-pools';
import type { HitMetricPools } from '../src/calculation-types';
import type { Member } from '../src/types';

function source(): Member {
  return {
    slot: 1,
    shikigami: { id: 'hero-a', name: '截图式神', rawText: '截图式神', candidates: [] },
    panel: { attack: 5000, hp: 20000, defense: 800, speed: 180, crit: 60, critDamage: 180, effectHit: 0, effectResist: 20 },
    yuhun: { catalogId: null, name: null, status: 'candidate', candidates: [{ catalogId: 'candidate-soul', name: '候选御魂', similarity: .9 }] },
    needsReview: [],
  };
}

test('hit pools match selected hero or concrete two/four-piece soul IDs only', () => {
  const pools = createHitMetricPools(), another = createHitMetricPools();
  pools.shikigamiIds = ['hero-a']; pools.yuhunIds = ['soul-2', 'soul-4', 'candidate-soul'];
  assert.deepEqual(another, DEFAULT_HIT_METRIC_POOLS);
  assert.notEqual(another.shikigamiIds, pools.shikigamiIds);
  assert.notEqual(another.yuhunIds, pools.yuhunIds);
  const member = createCalculationDraft([source()]).members[0]!;
  member.metricId = 7;
  member.suitRequirements = [
    { catalogId: 'soul-2', name: '任意二件', count: 2, kind: 'suit' },
    { catalogId: 'soul-4', name: '任意四件', count: 4, kind: 'suit' },
    { catalogId: 'candidate-soul', name: '符号化效果', count: 2, kind: 'two-piece-effect' },
  ];
  assert.deepEqual(matchHitMetricPool(member, pools), { shikigami: true, yuhunIds: ['soul-2', 'soul-4'] });
  assert.equal(effectiveCalculationMetricId(member, pools), 8);
  pools.shikigamiIds = [];
  assert.deepEqual(matchHitMetricPool(member, pools), { shikigami: false, yuhunIds: ['soul-2', 'soul-4'] });
  member.suitRequirements = member.suitRequirements.filter(({ kind }) => kind === 'two-piece-effect');
  assert.deepEqual(matchHitMetricPool(member, pools), { shikigami: false, yuhunIds: [] });
  assert.equal(effectiveCalculationMetricId(member, pools), 7);
  member.suitRequirements = [{ catalogId: null, name: 'soul-2', count: 2, kind: 'suit' }];
  assert.deepEqual(matchHitMetricPool(member, pools).yuhunIds, [], 'names alone do not match');
  member.suitRequirements = [{ catalogId: 'soul-2', name: '任意二件', count: 2, kind: 'suit' }];
  member.enabled = false;
  assert.deepEqual(matchHitMetricPool(member, pools), { shikigami: false, yuhunIds: [] });
  member.enabled = true; member.shikigami = null;
  assert.deepEqual(matchHitMetricPool(member, pools), { shikigami: false, yuhunIds: [] });
});

test('serialized metric8 override tracks current pools and restores the untouched manual metric', () => {
  const sources = [source()], draft = createCalculationDraft(sources), member = draft.members[0]!;
  draft.hitMetricPools = { shikigamiIds: [], yuhunIds: [] };
  member.metricId = 7;
  member.targetScore = '1234';
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['critDamage'] };
  member.suitRequirements = [{ catalogId: 'soul-a', name: '已选御魂', count: 4, kind: 'suit' }];
  const original = structuredClone(draft);
  const baseline = serializeCalculationDraft(draft, sources).value!.targets[0]!;
  assert.deepEqual([baseline.metricId, baseline.metricName], [7, '速度']);
  draft.hitMetricPools.yuhunIds.push('soul-a');
  const soulMatch = serializeCalculationDraft(draft, sources);
  assert.deepEqual([soulMatch.value!.targets[0]!.metricId, soulMatch.value!.targets[0]!.metricName], [8, '暴击']);
  assert.deepEqual(soulMatch.value!.targets[0]!.ranges, baseline.ranges);
  assert.deepEqual(soulMatch.value!.targets[0]!.mainStats, baseline.mainStats);
  assert.equal(soulMatch.value!.targets[0]!.targetScore, 1234);
  assert.equal(member.metricId, 7);
  assert.deepEqual(member.limits, original.members[0]!.limits);
  assert.deepEqual(member.mainStats, original.members[0]!.mainStats);
  assert.deepEqual(soulMatch.value!.hitMetricPools, { shikigamiIds: [], yuhunIds: ['soul-a'] });
  assert.notEqual(soulMatch.value!.hitMetricPools.yuhunIds, draft.hitMetricPools.yuhunIds);
  draft.hitMetricPools.yuhunIds = [];
  assert.deepEqual([serializeCalculationDraft(draft, sources).value!.targets[0]!.metricId, member.metricId], [7, 7]);
  draft.hitMetricPools.shikigamiIds = ['hero-a'];
  assert.equal(serializeCalculationDraft(draft, sources).value!.targets[0]!.metricId, 8);
  member.shikigami = { catalogId: 'hero-b', name: '改选式神' };
  assert.equal(serializeCalculationDraft(draft, sources).value!.targets[0]!.metricId, 7);
  member.shikigami = { catalogId: 'hero-a', name: '截图式神' }; member.enabled = false;
  assert.equal(serializeCalculationDraft(draft, sources).value!.targets[0]!.metricId, 7, 'inactive members keep their valid manual metric');
});

test('pool IDs validate structure without requiring the current catalog', () => {
  const sources = [source()], draft = createCalculationDraft(sources);
  assert.deepEqual(draft.hitMetricPools, DEFAULT_HIT_METRIC_POOLS);
  assert.notEqual(draft.hitMetricPools.shikigamiIds, DEFAULT_HIT_METRIC_POOLS.shikigamiIds);
  assert.notEqual(draft.hitMetricPools.yuhunIds, DEFAULT_HIT_METRIC_POOLS.yuhunIds);
  draft.hitMetricPools = { shikigamiIds: ['unknown-hero'], yuhunIds: ['unknown-soul'] };
  assert.deepEqual(serializeCalculationDraft(draft, sources).issues, []);
  const malformed: { field: keyof HitMetricPools; value: unknown }[] = [
    { field: 'shikigamiIds', value: [''] }, { field: 'shikigamiIds', value: ['  '] },
    { field: 'shikigamiIds', value: ['a', 'a'] }, { field: 'shikigamiIds', value: [null] },
    { field: 'yuhunIds', value: ['a', 'a'] }, { field: 'yuhunIds', value: 4 },
    { field: 'yuhunIds', value: ['ok', 123] },
  ];
  for (const { field, value } of malformed) {
    const invalid = structuredClone(draft);
    (invalid.hitMetricPools as unknown as Record<string, unknown>)[field] = value;
    const result = serializeCalculationDraft(invalid, sources);
    assert.equal(result.value, null);
    assert.ok(result.issues.some((issue) => issue.field === `hitMetricPools.${field}`));
  }
  const absent = structuredClone(draft);
  (absent as unknown as Record<string, unknown>).hitMetricPools = undefined;
  assert.equal(serializeCalculationDraft(absent, sources).value, null);
});
