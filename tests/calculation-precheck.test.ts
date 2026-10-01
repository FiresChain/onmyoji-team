import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReproductionTolerance, createCalculationDraft, serializeCalculationDraft } from '../src/calculation-config';
import baseData from '../src/data/shikigami-base-panels.json';
import type { Member, Stat } from '../src/types';
import type { CalculationDraft } from '../src/calculation-types';

function source(slot: number, id: string, panel: number[]): Member {
  const stats: Stat[] = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'effectHit', 'effectResist'];
  return { slot, shikigami: { id, name: id, rawText: null, candidates: [] },
    panel: Object.fromEntries(stats.map((stat, i) => [stat, panel[i]!])) as Member['panel'],
    yuhun: { catalogId: null, name: null, status: 'unavailable', candidates: [] }, needsReview: [] };
}
function unorderedDraft(sources: Member[]): CalculationDraft {
  const draft = createCalculationDraft(sources);
  draft.reproduction.orderStats = [];
  return draft;
}
const blue = () => [
  source(1, '363', [4341, 24354, 702, 201, 59, 206, 30, 24]),
  source(2, '231', [5513, 14870, 785, 144, 58, 311, 0, 48]),
  source(3, '601', [2630, 21159, 750, 122, 8, 150, 0, 86]),
  source(4, '241', [2925, 30433, 876, 121, 60, 150, 0, 72]),
  source(5, '559', [4238, 12706, 723, 115, 65, 185, 0, 0]),
];
function blueDraft(members: Member[]): CalculationDraft {
  const draft = createCalculationDraft(members);
  draft.reproduction.orderStats = [];
  const pairs = [['300035', '魅妖'], ['300004', '蝠翼'], ['300006', '涅槃火'], ['300007', '三味'], ['300026', '网切']];
  draft.members.forEach((member, i) => { member.suitRequirements = [{ catalogId: pairs[i]![0]!, name: pairs[i]![1]!, count: 4, kind: 'suit' }]; });
  return draft;
}

test('public level-40 panels carry separate bases and innate bonuses', () => {
  assert.equal(baseData.schemaVersion, 2);
  assert.equal(baseData.panels.length, 278);
  assert.ok(baseData.panels.some((row) => row.heroId === 241 && row.precheckSupported));
  for (const row of baseData.panels) {
    assert.deepEqual(Object.keys(row).sort(), ['awake', 'base', 'heroId', 'innate', 'level', 'precheckSupported', 'reason', 'star']);
    assert.deepEqual(Object.keys(row.base).sort(), ['attack', 'crit', 'critDamage', 'defense', 'effectHit', 'effectResist', 'hp', 'speed']);
    assert.deepEqual(Object.keys(row.innate).sort(), ['attackPercent', 'crit', 'critDamage', 'defensePercent', 'effectHit', 'effectResist', 'hpPercent', 'speed']);
    assert.deepEqual([row.star, row.level], [6, 40]);
    assert.ok(row.awake === 0 || row.awake === 1);
    assert.ok(Object.values(row.base).every(Number.isFinite));
    assert.ok(Object.values(row.innate).every(Number.isFinite));
  }
});

test('innate bonuses are separate additive terms at exact upper bounds', () => {
  const cases: { id: string; stat: Stat; mainStats: CalculationDraft['members'][number]['mainStats']; upper: number; below: number; belowStatus: 'conflict' | 'relaxed' | 'manual-adjustment' }[] = [
    { id: '601', stat: 'effectResist', mainStats: { 2: ['speed'], 4: ['effectHit'], 6: ['critDamage'] }, upper: 30, below: 29.99, belowStatus: 'conflict' },
    { id: '255', stat: 'speed', mainStats: { 2: ['attackPercent'], 4: ['effectHit'], 6: ['critDamage'] }, upper: 127, below: 126.99, belowStatus: 'conflict' },
    { id: '202', stat: 'speed', mainStats: { 2: ['attackPercent'], 4: ['effectHit'], 6: ['critDamage'] }, upper: 122, below: 121.99, belowStatus: 'conflict' },
    { id: '217', stat: 'attack', mainStats: { 2: ['attackPercent'], 4: ['effectHit'], 6: ['critDamage'] }, upper: 5659.74, below: 5659.73, belowStatus: 'manual-adjustment' },
    { id: '200', stat: 'hp', mainStats: { 2: ['hpPercent'], 4: ['effectHit'], 6: ['critDamage'] }, upper: 20850.45, below: 20850.44, belowStatus: 'manual-adjustment' },
    { id: '248', stat: 'crit', mainStats: { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] }, upper: 75, below: 74.99, belowStatus: 'relaxed' },
  ];
  for (const { id, stat, mainStats, upper, below, belowStatus } of cases) {
    const sources = [source(1, id, [5000, 30000, 800, 200, 100, 300, 0, 100])];
    const draft = unorderedDraft(sources), member = draft.members[0]!;
    member.mainStats = mainStats;
    member.limits = [{ id: 1, stat, min: '0', max: String(upper) }];
    const exact = serializeCalculationDraft(draft, sources);
    assert.equal(exact.prechecks[0]!.status, 'compatible', `${id} ${stat}: exact upper bound`);
    member.limits[0]!.max = String(below);
    const lower = serializeCalculationDraft(draft, sources);
    assert.equal(lower.prechecks[0]!.status, belowStatus, `${id} ${stat}: just below minimum`);
  }
});

test('unverified and absent panels leave constraints editable', () => {
  for (const id of ['362', '999001']) {
    const sources = [source(1, id, [5000, 30000, 800, 200, 100, 300, 0, 100])];
    const draft = unorderedDraft(sources);
    draft.members[0]!.limits = [{ id: 1, stat: 'attack', min: '0', max: '1' }];
    const result = serializeCalculationDraft(draft, sources);
    assert.equal(result.prechecks[0]!.status, 'unchecked');
    if (id === '362') assert.match(result.prechecks[0]!.reason, /来源差异待核验/);
    assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, true);
    assert.equal(result.value!.targets[0]!.ranges[0]!.max, 1);
  }
});

test('blue screenshot uses tier fallback at 10 and fixed-position adjustment at 20', () => {
  const sources = blue();
  for (const tolerance of ['10', '20']) {
    const draft = applyReproductionTolerance(blueDraft(sources), sources, tolerance), original = structuredClone(draft);
    const result = serializeCalculationDraft(draft, sources);
    assert.deepEqual(result.issues, []);
    assert.equal(result.value!.targets.length, 5);
    for (const slot of [3, 5]) {
      const target = result.value!.targets.find((target) => target.slot === slot)!;
      assert.equal(target.yuhunConfigEnabled, true);
      assert.equal(target.shikigami!.catalogId, sources[slot - 1]!.shikigami.id);
      assert.equal(target.sixStarOnly, true);
      assert.ok(target.mainStats[2].length && target.mainStats[4].length && target.mainStats[6].length);
      assert.equal(target.ranges.length, draft.members[slot - 1]!.limits.length);
      assert.deepEqual(target.suitRequirements, draft.members[slot - 1]!.suitRequirements);
      const diagnostic = result.prechecks.find((d) => d.slot === slot)!;
      assert.equal(diagnostic.checkedCombinations, 100);
      assert.ok(diagnostic.survivingCombinations! > 0);
      assert.ok(Object.values(diagnostic.removedMainStats).some((values) => values.length));
      if (tolerance === '10') {
        assert.equal(target.maxLevelOnly, false);
        assert.equal(diagnostic.status, 'relaxed');
        assert.match(diagnostic.reason, /已取消“仅满级”，保留“仅六星”/);
        assert.equal(diagnostic.manualAdjustments, undefined);
      } else {
        assert.equal(target.maxLevelOnly, true);
        assert.equal(diagnostic.status, 'manual-adjustment');
        assert.deepEqual(diagnostic.manualAdjustments?.map((item) => item.position), slot === 3 ? [3, 5] : [3]);
        for (const adjustment of diagnostic.manualAdjustments!) {
          const range = target.ranges.find((item) => item.stat === adjustment.stat)!;
          assert.equal(range.max, adjustment.calculationMax);
          assert.equal(range.min, Number(draft.members[slot - 1]!.limits.find((item) => item.stat === adjustment.stat)!.min));
        }
      }
    }
    assert.equal(result.prechecks.find((d) => d.slot === 1)!.status, 'optimized');
    assert.deepEqual(result.value!.targets[0]!.mainStats[2], ['hpPercent', 'speed']);
    assert.equal(result.value!.targets[0]!.sixStarOnly, true);
    assert.equal(result.value!.targets[0]!.maxLevelOnly, true);
    assert.equal(result.value!.targets[3]!.yuhunConfigEnabled, true);
    assert.equal(result.prechecks.find((d) => d.slot === 4)!.status, 'optimized');
    assert.ok(!result.value!.targets[3]!.mainStats[2].includes('speed'));
    if (tolerance === '10') {
      assert.ok(!result.value!.targets[2]!.mainStats[6].includes('crit'));
      assert.ok(!result.value!.targets[4]!.mainStats[4].includes('effectResist'));
      assert.equal(result.prechecks[2]!.survivingCombinations, 80);
      assert.equal(result.prechecks[4]!.survivingCombinations, 60);
    } else {
      assert.deepEqual(result.value!.targets[2]!.mainStats[2], ['hpPercent', 'defensePercent']);
      assert.deepEqual(result.value!.targets[4]!.mainStats, { 2: ['defensePercent'], 4: ['effectHit'], 6: ['defensePercent'] });
      assert.equal(result.prechecks[2]!.survivingCombinations, 4);
      assert.equal(result.prechecks[4]!.survivingCombinations, 1);
    }
    assert.ok(result.prechecks.every((d) => d.checkedCombinations <= 100));
    assert.deepEqual(draft, original);
  }
});

test('changing constraints and tolerance restores six-star checks but never restores manual disabled members', () => {
  const sources = blue(), draft = blueDraft(sources);
  assert.equal(serializeCalculationDraft(draft, sources).prechecks[4]!.status, 'relaxed');
  draft.members[4]!.suitRequirements = []; draft.members[4]!.limits = [];
  const restored = serializeCalculationDraft(draft, sources);
  assert.equal(restored.value!.targets[4]!.yuhunConfigEnabled, true);
  assert.deepEqual([restored.value!.targets[4]!.sixStarOnly, restored.value!.targets[4]!.maxLevelOnly], [true, true]);
  const widened = serializeCalculationDraft(applyReproductionTolerance(blueDraft(sources), sources, '40'), sources);
  assert.ok(widened.value!.targets.every((target) => target.sixStarOnly && target.maxLevelOnly));
  draft.members[4]!.enabled = false;
  const result = serializeCalculationDraft(draft, sources);
  assert.equal(result.value!.targets[4]!.yuhunConfigEnabled, false);
  assert.equal(result.prechecks[4]!.status, 'unchecked');
});

test('all five proven conflicts still produce a five-member disabled config', () => {
  const sources = ['363', '231', '601', '559', '356'].map((id, i) => source(i + 1, id, [1000, 20000, 600, 120, 10, 150, 0, 0]));
  const draft = unorderedDraft(sources);
  draft.members.forEach((member) => { member.limits = [{ id: 1, stat: 'attack', min: '0', max: '0' }]; });
  const result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.ok(result.value!.targets.every((target) => !target.yuhunConfigEnabled && target.shikigami !== null));
  assert.equal(result.prechecks.filter((d) => d.status === 'conflict').length, 5);
});

test('a tier fallback preserves the caller-selected main stats and does not turn manual restrictions back on', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [{ id: 1, stat: 'crit', min: '0', max: '63.99' }];
  member.suitRequirements = [{ catalogId: '300004', name: '蝠翼', count: 4, kind: 'suit' }];
  member.targetScore = '1234'; member.extraAttributes.attackPercent = '20'; member.extraAttributes.attack = '50';
  const original = structuredClone(draft), relaxed = serializeCalculationDraft(draft, sources);
  assert.equal(relaxed.prechecks[0]!.status, 'relaxed');
  assert.equal(relaxed.prechecks[0]!.checkedCombinations, 1);
  assert.equal(relaxed.prechecks[0]!.survivingCombinations, 1);
  assert.deepEqual(relaxed.prechecks[0]!.removedMainStats, { 2: [], 4: [], 6: [] });
  assert.deepEqual(relaxed.value!.targets[0]!.mainStats, member.mainStats);
  assert.equal(relaxed.value!.targets[0]!.ranges[0]!.max, 63.99);
  assert.equal(relaxed.value!.targets[0]!.targetScore, 1234);
  assert.deepEqual(relaxed.value!.targets[0]!.suitRequirements, member.suitRequirements);
  assert.deepEqual(relaxed.value!.targets[0]!.extraAttributes, { attackPercent: .2, attack: 50 });
  assert.deepEqual([relaxed.value!.targets[0]!.sixStarOnly, relaxed.value!.targets[0]!.maxLevelOnly], [true, false]);
  assert.deepEqual(draft, original);
  for (const [sixStarOnly, maxLevelOnly] of [[false, false], [false, true], [true, false]]) {
    member.sixStarOnly = sixStarOnly; member.maxLevelOnly = maxLevelOnly;
    const result = serializeCalculationDraft(draft, sources);
    assert.equal(result.prechecks[0]!.status, sixStarOnly ? 'compatible' : 'unchecked');
    assert.equal(result.prechecks[0]!.checkedCombinations, sixStarOnly ? 1 : 0);
    assert.deepEqual([result.value!.targets[0]!.sixStarOnly, result.value!.targets[0]!.maxLevelOnly], [sixStarOnly, maxLevelOnly]);
    assert.deepEqual(result.value!.targets[0]!.mainStats, member.mainStats);
  }
});

test('six-star level-0 fixed defense is 14 and a lower upper bound triggers low-star fallback', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const baseDefense = baseData.panels.find((row) => row.heroId === 363)!.base.defense;
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  draft.reproduction.orderStats = ['defense']; // keep fixed-position compensation out of this tier boundary check
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [{ id: 1, stat: 'defense', min: '0', max: String(baseDefense + 14) }];
  const atFloor = serializeCalculationDraft(draft, sources);
  assert.equal(atFloor.prechecks[0]!.status, 'relaxed');
  assert.deepEqual([atFloor.value!.targets[0]!.sixStarOnly, atFloor.value!.targets[0]!.maxLevelOnly], [true, false]);
  assert.equal(atFloor.prechecks[0]!.survivingCombinations, 1);
  member.limits[0]!.max = String(baseDefense + 13.99);
  const belowFloor = serializeCalculationDraft(draft, sources);
  assert.equal(belowFloor.prechecks[0]!.status, 'relaxed');
  assert.equal(belowFloor.prechecks[0]!.checkedCombinations, 0);
  assert.equal(belowFloor.prechecks[0]!.survivingCombinations, null);
  assert.deepEqual(belowFloor.prechecks[0]!.removedMainStats, { 2: [], 4: [], 6: [] });
  assert.deepEqual(belowFloor.value!.targets[0]!.mainStats, member.mainStats);
  assert.deepEqual([belowFloor.value!.targets[0]!.sixStarOnly, belowFloor.value!.targets[0]!.maxLevelOnly], [false, false]);
  assert.equal(belowFloor.value!.targets[0]!.yuhunConfigEnabled, true);
  member.maxLevelOnly = false;
  const manualNonmax = serializeCalculationDraft(draft, sources);
  assert.equal(manualNonmax.prechecks[0]!.status, 'relaxed');
  assert.doesNotMatch(manualNonmax.prechecks[0]!.reason, /六星满级/);
});

test('manual six-star nonmax mode prunes main stats using the level-0 floor', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.sixStarOnly = true; member.maxLevelOnly = false;
  member.mainStats = { 2: ['attackPercent', 'speed'], 4: ['effectHit'], 6: ['critDamage'] };
  member.limits = [{ id: 1, stat: 'attack', min: '0', max: '3400' }];
  const result = serializeCalculationDraft(draft, sources);
  assert.equal(result.prechecks[0]!.status, 'optimized');
  assert.equal(result.prechecks[0]!.checkedCombinations, 2);
  assert.equal(result.prechecks[0]!.survivingCombinations, 1);
  assert.deepEqual(result.value!.targets[0]!.mainStats[2], ['speed']);
  assert.deepEqual(result.prechecks[0]!.removedMainStats[2], ['attackPercent']);
  assert.deepEqual([result.value!.targets[0]!.sixStarOnly, result.value!.targets[0]!.maxLevelOnly], [true, false]);
  assert.deepEqual(member.mainStats[2], ['attackPercent', 'speed']);
});

test('fixed positions 1, 3 and 5 each expand only their existing upper bound while keeping the draft intact', () => {
  const base = baseData.panels.find((row) => row.heroId === 363)!.base;
  for (const { stat, originalMax, position, amount } of [
    { stat: 'attack', originalMax: base.attack + 100, position: 1, amount: 486 },
    { stat: 'defense', originalMax: base.defense + 50, position: 3, amount: 104 },
    { stat: 'hp', originalMax: base.hp + 1000, position: 5, amount: 2052 },
  ] as const) {
    const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
    const draft = unorderedDraft(sources), member = draft.members[0]!;
    member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
    member.limits = [{ id: 1, stat, min: '1', max: String(originalMax) }];
    const before = structuredClone(draft), result = serializeCalculationDraft(draft, sources);
    assert.equal(result.prechecks[0]!.status, 'manual-adjustment', stat);
    assert.deepEqual(result.prechecks[0]!.manualAdjustments, [{ position, stat, amount, originalMax, calculationMax: originalMax + amount }]);
    assert.deepEqual(result.value!.targets[0]!.ranges, [{ stat, percentage: false, min: 1, max: originalMax + amount }]);
    assert.deepEqual(result.value!.targets[0]!.mainStats, member.mainStats);
    assert.deepEqual([result.value!.targets[0]!.sixStarOnly, result.value!.targets[0]!.maxLevelOnly], [true, true]);
    assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, true);
    assert.equal(result.prechecks[0]!.checkedCombinations, 1);
    assert.equal(result.prechecks[0]!.survivingCombinations, 1);
    assert.deepEqual(draft, before);
  }
});

test('attack fixed-position compensation scales with user extra attack percent', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [{ id: 1, stat: 'attack', min: '0', max: '4300' }];
  member.extraAttributes.attackPercent = '20'; member.extraAttributes.attack = '50';
  const result = serializeCalculationDraft(draft, sources);
  const adjustment = result.prechecks[0]!.manualAdjustments![0]!;
  assert.equal(result.prechecks[0]!.status, 'manual-adjustment');
  assert.equal(adjustment.position, 1);
  assert.ok(Math.abs(adjustment.amount - 583.2) < 1e-9);
  assert.ok(adjustment.calculationMax >= adjustment.originalMax + adjustment.amount);
  assert.equal(result.value!.targets[0]!.ranges[0]!.max, adjustment.calculationMax);
  assert.deepEqual(result.value!.targets[0]!.extraAttributes, { attackPercent: .2, attack: 50 });
});

test('manual compensation excludes only stats selected for screenshot ordering', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const base = baseData.panels.find((row) => row.heroId === 363)!.base;
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [{ id: 1, stat: 'hp', min: '0', max: String(base.hp + 1000) }];
  draft.reproduction.orderStats = ['attack'];
  const hp = serializeCalculationDraft(draft, sources);
  assert.deepEqual(hp.issues, []);
  assert.equal(hp.prechecks[0]!.phase, 'strict-order');
  assert.equal(hp.prechecks[0]!.status, 'manual-adjustment');
  assert.deepEqual(hp.prechecks[0]!.manualAdjustments?.map(({ position }) => position), [5]);
  draft.reproduction.orderStats = ['hp'];
  const protectedHp = serializeCalculationDraft(draft, sources);
  assert.equal(protectedHp.prechecks[0]!.status, 'relaxed');
  assert.equal(protectedHp.prechecks[0]!.manualAdjustments, undefined);
  member.limits = [{ id: 1, stat: 'attack', min: '0', max: String(base.attack + 100) }];
  draft.reproduction.orderStats = ['hp'];
  assert.deepEqual(serializeCalculationDraft(draft, sources).prechecks[0]!.manualAdjustments?.map(({ position }) => position), [1]);
  draft.reproduction.orderStats = ['attack'];
  assert.equal(serializeCalculationDraft(draft, sources).prechecks[0]!.status, 'relaxed');
});

test('equally sized successful adjustments choose the smaller normalized upper-bound increase', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.mainStats = { 2: ['attackPercent', 'hpPercent'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [
    { id: 1, stat: 'attack', min: '0', max: '5100' },
    { id: 2, stat: 'hp', min: '0', max: '25000' },
  ];
  const result = serializeCalculationDraft(draft, sources);
  assert.equal(result.prechecks[0]!.status, 'manual-adjustment');
  assert.deepEqual(result.prechecks[0]!.manualAdjustments?.map((item) => item.position), [5]);
  assert.deepEqual(result.value!.targets[0]!.mainStats[2], ['hpPercent']);
  assert.deepEqual(result.value!.targets[0]!.ranges.map((range) => range.max), [5100, 27052]);
  assert.ok(2052 / 25000 < 486 / 5100);
});

test('two fixed-position removals require two free soul positions; a 4+2 set skips the suggestion', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const base = baseData.panels.find((row) => row.heroId === 363)!.base;
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [
    { id: 1, stat: 'defense', min: '1', max: String(base.defense + 50) },
    { id: 2, stat: 'hp', min: '1', max: String(base.hp + 1000) },
  ];
  member.suitRequirements = [{ catalogId: '300036', name: '针女', count: 4, kind: 'suit' }];
  const result = serializeCalculationDraft(draft, sources);
  assert.equal(result.prechecks[0]!.status, 'manual-adjustment');
  assert.deepEqual(result.prechecks[0]!.manualAdjustments?.map((item) => item.position), [3, 5]);
  assert.deepEqual(result.value!.targets[0]!.ranges.map((range) => range.max), [base.defense + 154, base.hp + 3052]);
  member.suitRequirements.push({ catalogId: '300019', name: '火灵', count: 2, kind: 'suit' });
  const fullSet = serializeCalculationDraft(draft, sources);
  assert.equal(fullSet.prechecks[0]!.status, 'relaxed');
  assert.equal(fullSet.prechecks[0]!.manualAdjustments, undefined);
  assert.deepEqual(fullSet.value!.targets[0]!.ranges.map((range) => range.max), [base.defense + 50, base.hp + 1000]);
});

test('bare panel and guaranteed suit floors still prove conflicts across every yuhun tier', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])];
  const draft = unorderedDraft(sources), member = draft.members[0]!;
  member.sixStarOnly = false; member.maxLevelOnly = false;
  member.limits = [{ id: 1, stat: 'attack', min: '0', max: '3108.79' }];
  let result = serializeCalculationDraft(draft, sources);
  assert.equal(result.prechecks[0]!.status, 'conflict');
  assert.equal(result.prechecks[0]!.checkedCombinations, 0);
  assert.equal(result.prechecks[0]!.manualAdjustments, undefined);
  assert.match(result.prechecks[0]!.reason, /不计御魂主副属性和固定属性.*攻击最低3108.8/);
  assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, false);
  member.limits[0]!.max = '3500';
  member.suitRequirements = [{ catalogId: '300004', name: '蝠翼', count: 4, kind: 'suit' }];
  result = serializeCalculationDraft(draft, sources);
  assert.equal(result.prechecks[0]!.status, 'conflict');
  assert.match(result.prechecks[0]!.reason, /攻击最低3575.12/);
  member.suitRequirements = [];
  result = serializeCalculationDraft(draft, sources);
  assert.equal(result.prechecks[0]!.status, 'unchecked');
  assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, true);
});

test('strict ordering can trigger tier relaxation without losing the ordered ranges', () => {
  const sources = [source(1, '363', [3000, 20000, 600, 150, 60, 200, 0, 0]), source(2, '231', [4000, 20000, 600, 150, 60, 200, 0, 0])];
  const draft = unorderedDraft(sources);
  draft.members.forEach((member) => { member.limits = [{ id: 1, stat: 'attack', min: '2000', max: '5000' }]; });
  draft.reproduction.orderStats = ['attack'];
  const original = structuredClone(draft), result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.equal(result.value!.targets[0]!.yuhunConfigEnabled, true);
  assert.equal(result.prechecks[0]!.status, 'relaxed');
  assert.equal(result.prechecks[0]!.phase, 'strict-order');
  assert.equal(result.prechecks[0]!.manualAdjustments, undefined);
  assert.deepEqual([result.value!.targets[0]!.sixStarOnly, result.value!.targets[0]!.maxLevelOnly], [true, false]);
  assert.equal(result.value!.targets[0]!.ranges[0]!.max, 3500);
  assert.equal(result.value!.targets[1]!.ranges[0]!.min, 3500.01);
  assert.deepEqual(draft, original);
  draft.reproduction.orderStats = [];
  assert.ok(serializeCalculationDraft(draft, sources).value!.targets.every((t) => t.yuhunConfigEnabled));
});

test('zero percentage bounds, post-panel extras and 55/89 percentage points use correct units', () => {
  const sources = [source(1, '363', [5000, 30000, 1000, 200, 80, 300, 0, 0])], draft = unorderedDraft(sources);
  const member = draft.members[0]!;
  member.mainStats = { 2: ['speed'], 4: ['effectHit'], 6: ['crit'] };
  member.limits = [{ id: 1, stat: 'crit', min: '0', max: '64' }];
  assert.equal(serializeCalculationDraft(draft, sources).value!.targets[0]!.yuhunConfigEnabled, true);
  member.limits[0]!.max = '63.99';
  assert.equal(serializeCalculationDraft(draft, sources).prechecks[0]!.status, 'relaxed');
  member.limits = [{ id: 1, stat: 'attack', min: '0', max: String((3108.8 + 486) * 1.2 + 50) }];
  member.extraAttributes.attackPercent = '20'; member.extraAttributes.attack = '50';
  assert.equal(serializeCalculationDraft(draft, sources).value!.targets[0]!.yuhunConfigEnabled, true);
  member.limits[0]!.max = '4300';
  assert.equal(serializeCalculationDraft(draft, sources).prechecks[0]!.status, 'manual-adjustment');
  member.extraAttributes.attackPercent = ''; member.extraAttributes.attack = '';
  member.mainStats[6] = ['critDamage']; member.limits = [{ id: 1, stat: 'critDamage', min: '0', max: '239' }];
  assert.equal(serializeCalculationDraft(draft, sources).value!.targets[0]!.yuhunConfigEnabled, true);
  member.limits[0]!.max = '0';
  assert.equal(serializeCalculationDraft(draft, sources).prechecks[0]!.status, 'conflict');
});

test('six-star nonmax inventory can be pruned while unknown bonuses and dynamic maxima stay unchecked', () => {
  const sources = blue();
  for (const [change, expected] of [
    [(draft: CalculationDraft) => { draft.members[2]!.maxLevelOnly = false; }, 'optimized'],
    [(draft: CalculationDraft) => { draft.members[2]!.sixStarOnly = false; }, 'unchecked'],
    [(draft: CalculationDraft) => { draft.members[2]!.suitRequirements = [{ catalogId: '300092', name: '无刀取', count: 4, kind: 'suit' }]; }, 'unchecked'],
    [(draft: CalculationDraft) => { draft.members[2]!.suitRequirements = [{ catalogId: 'two-piece-effect:hpPercent', name: '生命加成', count: 2, kind: 'two-piece-effect' }]; }, 'unchecked'],
    [(draft: CalculationDraft) => { draft.members[0]!.highestStat = 'attack'; }, 'unchecked'],
  ] as const) {
    const draft = blueDraft(sources); change(draft);
    const result = serializeCalculationDraft(draft, sources);
    assert.deepEqual(result.issues, []);
    assert.equal(result.value!.targets[2]!.yuhunConfigEnabled, true);
    assert.equal(result.prechecks[2]!.status, expected);
  }
});

test('dynamic highest outside selected order remains an unchecked precheck without an order error', () => {
  const sources = blue(), draft = blueDraft(sources);
  draft.reproduction.orderStats = ['speed'];
  draft.members[0]!.highestStat = 'attack';
  const result = serializeCalculationDraft(draft, sources);
  assert.deepEqual(result.issues, []);
  assert.ok(result.prechecks.every(({ status }) => status === 'unchecked'));
  assert.ok(result.value!.targets.every(({ yuhunConfigEnabled }) => yuhunConfigEnabled));
});

test('format errors stay fatal rather than becoming automatic disabled exports', () => {
  const sources = blue(), draft = blueDraft(sources);
  draft.members[2]!.limits[0]!.max = 'Infinity';
  const result = serializeCalculationDraft(draft, sources);
  assert.equal(result.value, null); assert.ok(result.issues.length); assert.deepEqual(result.prechecks, []);
});
