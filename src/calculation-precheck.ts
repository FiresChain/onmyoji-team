import panels from './data/shikigami-base-panels.json';
import { SIX_STAR_ZERO_FIXED, SIX_STAR_ZERO_MAIN } from './data/yuhun-main-stat-floors';
import { MAIN_STAT_OPTIONS } from './calculation-options';
import type { CalculationConfig, CalculationPrecheckDiagnostic, MainStat, MainStatSlot } from './calculation-types';
import { STATS, type Stat } from './types';

type Target = CalculationConfig['targets'][number];
type BonusStat = Exclude<MainStat, 'speed' | 'critDamage'>;
type ManualAdjustment = NonNullable<CalculationPrecheckDiagnostic['manualAdjustments']>[number];
const SLOTS = [2, 4, 6] as const;
type PanelStats = Record<Stat, number>;
type BasePanel = { heroId: number; star: number; level: number; awake: 0 | 1;
  base: PanelStats; innate: Omit<PanelStats, 'attack' | 'hp' | 'defense'> &
    { attackPercent: number; hpPercent: number; defensePercent: number };
  precheckSupported: boolean; reason: string | null };
const PANELS = new Map((panels.panels as unknown as BasePanel[]).map((entry) => [String(entry.heroId), entry]));
const BASE_STATS: readonly Stat[] = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'effectHit', 'effectResist'];
const INNATE_STATS = ['attackPercent', 'hpPercent', 'defensePercent', 'speed', 'crit', 'critDamage', 'effectHit', 'effectResist'] as const;
const NO_FIXED = { attack: 0, hp: 0, defense: 0 } as const;
const SIX_STAR_MAX_FIXED = { attack: 486, hp: 2052, defense: 104 } as const;
const SIX_STAR_MAX_MAIN: Readonly<Record<MainStat, number>> = {
  attackPercent: .55, hpPercent: .55, defensePercent: .55, speed: 57,
  crit: .55, critDamage: .89, effectHit: .55, effectResist: .55,
};
const SUIT_BONUSES: Record<string, { name: string; stat: BonusStat }> = {
  // Known 15-percent pairs from the maintained two-piece mapping.
  "300086": { name: "隐念", stat: "attackPercent" },
  "300082": { name: "贝吹坊", stat: "attackPercent" },
  "300074": { name: "兵主部", stat: "attackPercent" },
  "300048": { name: "狂骨", stat: "attackPercent" },
  "300027": { name: "阴摩罗", stat: "attackPercent" },
  "300022": { name: "心眼", stat: "attackPercent" },
  "300020": { name: "鸣屋", stat: "attackPercent" },
  "300018": { name: "狰", stat: "attackPercent" },
  "300012": { name: "轮入道", stat: "attackPercent" },
  "300004": { name: "蝠翼", stat: "attackPercent" },
  "300056": { name: "尘冢", stat: "attackPercent" },
  "300088": { name: "应声虫", stat: "crit" },
  "300083": { name: "海月火玉", stat: "crit" },
  "300075": { name: "青女房", stat: "crit" },
  "300036": { name: "针女", stat: "crit" },
  "300031": { name: "镇墓兽", stat: "crit" },
  "300030": { name: "破势", stat: "crit" },
  "300029": { name: "伤魂鸟", stat: "crit" },
  "300026": { name: "网切", stat: "crit" },
  "300007": { name: "三味", stat: "crit" },
  "300055": { name: "片叶之苇", stat: "crit" },
  "300087": { name: "叠叩", stat: "hpPercent" },
  "300081": { name: "恶楼", stat: "hpPercent" },
  "300076": { name: "涂佛", stat: "hpPercent" },
  "300024": { name: "树妖", stat: "hpPercent" },
  "300021": { name: "薙魂", stat: "hpPercent" },
  "300015": { name: "钟灵", stat: "hpPercent" },
  "300014": { name: "镜姬", stat: "hpPercent" },
  "300009": { name: "被服", stat: "hpPercent" },
  "300006": { name: "涅槃火", stat: "hpPercent" },
  "300003": { name: "地藏像", stat: "hpPercent" },
  "300058": { name: "夜啼石", stat: "hpPercent" },
  "300085": { name: "火之车", stat: "defensePercent" },
  "300084": { name: "出世螺", stat: "defensePercent" },
  "300035": { name: "魅妖", stat: "defensePercent" },
  "300032": { name: "珍珠", stat: "defensePercent" },
  "300023": { name: "木魅", stat: "defensePercent" },
  "300013": { name: "日女巳时", stat: "defensePercent" },
  "300011": { name: "反枕", stat: "defensePercent" },
  "300010": { name: "招财猫", stat: "defensePercent" },
  "300002": { name: "雪幽魂", stat: "defensePercent" },
  "300093": { name: "奉海图", stat: "defensePercent" },
  "300060": { name: "雨降", stat: "defensePercent" },
  "300089": { name: "元兴寺", stat: "effectHit" },
  "300079": { name: "遗念火", stat: "effectHit" },
  "300073": { name: "飞缘魔", stat: "effectHit" },
  "300034": { name: "蚌精", stat: "effectHit" },
  "300019": { name: "火灵", stat: "effectHit" },
  "300057": { name: "油赤子", stat: "effectHit" },
  "300090": { name: "钓瓶火", stat: "effectResist" },
  "300080": { name: "共潜", stat: "effectResist" },
  "300049": { name: "幽谷响", stat: "effectResist" },
  "300039": { name: "返魂香", stat: "effectResist" },
  "300033": { name: "骰子鬼", stat: "effectResist" },
  "300008": { name: "魍魉之匣", stat: "effectResist" },
  "300059": { name: "夜送犬", stat: "effectResist" },
};
const emptyStats = (): Record<MainStatSlot, MainStat[]> => ({ 2: [], 4: [], 6: [] });
const displayMinimum = (value: number, percentage: boolean): string =>
  `${Number((value * (percentage ? 100 : 1)).toFixed(2))}${percentage ? '%' : ''}`;

/** Keep the formation identity while emitting the encoder's standard disabled shape. */
export function disableCalculationTarget(target: Target): Target {
  return { ...target, yuhunConfigEnabled: false, metricId: 2, metricName: '效果命中',
    targetScore: null, suitRequirements: [], suitSelectionComplete: false,
    mainStats: emptyStats(), highestStat: null, extraAttributes: {}, scope: 'all',
    sixStarOnly: false, maxLevelOnly: false, excludeOccupied: false, ranges: [] };
}

export function conflictDiagnostic(slot: number, reason: string, phase: CalculationPrecheckDiagnostic['phase']): CalculationPrecheckDiagnostic {
  return { slot, status: 'conflict', reason, phase, checkedCombinations: 0,
    survivingCombinations: 0, removedMainStats: emptyStats() };
}

/** This is a necessary-condition proof, never an inventory/approximate search. */
export function precheckCalculationTarget(target: Target, phase: CalculationPrecheckDiagnostic['phase'] = 'base', unsupportedReason?: string,
  protectedOrderStats: ReadonlySet<Stat> = phase === 'strict-order' ? new Set<Stat>(['attack', 'hp', 'defense']) : new Set<Stat>(),
): { target: Target; diagnostic: CalculationPrecheckDiagnostic } {
  const diagnostic: CalculationPrecheckDiagnostic = { slot: target.slot, status: 'unchecked',
    reason: '', phase, checkedCombinations: 0, survivingCombinations: null, removedMainStats: emptyStats() };
  const unchecked = (reason: string) => { diagnostic.reason = reason; return { target, diagnostic }; };
  if (!target.yuhunConfigEnabled) return unchecked('未启用御魂配置');
  if (unsupportedReason) return unchecked(unsupportedReason);
  const panel = PANELS.get(target.shikigami?.catalogId ?? '');
  if (!panel) return unchecked('缺少六星40级基础面板');
  if (!panel.precheckSupported) return unchecked(panel.reason ?? '该式神的基础面板来源尚待核验');
  if (panel.star !== 6 || panel.level !== 40 || ![0, 1].includes(panel.awake)
    || !BASE_STATS.every((stat) => Number.isFinite(panel.base?.[stat]))
    || !INNATE_STATS.every((stat) => Number.isFinite(panel.innate?.[stat]))) {
    return unchecked('缺少可靠的六星40级基础或觉醒加成');
  }
  const { base, innate } = panel;
  if (target.highestStat !== null) return unchecked('动态最高属性尚不能预检');
  const bonus: Partial<Record<MainStat, number>> = {};
  for (const suit of target.suitRequirements) {
    // A broad effect may be matched by boss-yuhun intrinsic stats, and can
    // overlap with another named requirement. Neither guarantees another 15%.
    if (suit.kind === 'two-piece-effect') return unchecked('泛选二件套可能由首领固有属性满足，无法可靠预检');
    let stat: BonusStat | undefined;
    const definition = suit.catalogId === null
      ? Object.values(SUIT_BONUSES).find((entry) => entry.name === suit.name)
      : SUIT_BONUSES[suit.catalogId];
    if (definition?.name === suit.name) stat = definition.stat;
    if (!stat) return unchecked('御魂套装增益尚不能可靠预检');
    // Four pieces activate the same two-piece stat once, not twice.
    bonus[stat] = (bonus[stat] ?? 0) + .15;
  }
  const minimumFor = (stats: Partial<Record<MainStat, number>>, fixedYuhun: Readonly<{ attack: number; hp: number; defense: number }>): Record<Stat, number> => {
    const extra = target.extraAttributes;
    return {
      attack: (base.attack * (1 + innate.attackPercent + (stats.attackPercent ?? 0)) + fixedYuhun.attack) * (1 + (extra.attackPercent ?? 0)) + (extra.attack ?? 0),
      hp: base.hp * (1 + innate.hpPercent + (stats.hpPercent ?? 0)) + fixedYuhun.hp,
      defense: base.defense * (1 + innate.defensePercent + (stats.defensePercent ?? 0)) + fixedYuhun.defense,
      speed: base.speed + innate.speed + (stats.speed ?? 0),
      crit: base.crit + innate.crit + (stats.crit ?? 0) + (extra.crit ?? 0),
      critDamage: base.critDamage + innate.critDamage + (stats.critDamage ?? 0) + (extra.critDamage ?? 0),
      effectHit: base.effectHit + innate.effectHit + (stats.effectHit ?? 0),
      effectResist: base.effectResist + innate.effectResist + (stats.effectResist ?? 0),
    };
  };
  type Failure = { stat: Stat; minimum: number; upper: number; percentage: boolean };
  const failuresFor = (minimum: Record<Stat, number>, ranges = target.ranges): Failure[] => ranges.flatMap((range) => {
    if (range.max === undefined) return [];
    const upper = range.max / (range.percentage ? 100 : 1);
    return minimum[range.stat] > upper + Math.max(1, Math.abs(upper), Math.abs(minimum[range.stat])) * 1e-12
      ? [{ stat: range.stat, minimum: minimum[range.stat], upper, percentage: range.percentage }] : [];
  });
  const describeFailures = (failures: Failure[]): string => failures.slice(0, 2).map(({ stat, minimum, upper, percentage }) => {
    const label = STATS.find(([id]) => id === stat)?.[1] ?? stat;
    return `${label}最低${displayMinimum(minimum, percentage)}，允许上限${displayMinimum(upper, percentage)}`;
  }).join('；');
  // Every tier shares the shikigami panel and guaranteed set effects. If this
  // floor already breaks an upper bound, lowering yuhun tier cannot repair it.
  const intrinsic = minimumFor(bonus, NO_FIXED);
  if (!Object.values(intrinsic).every(Number.isFinite)) return unchecked('数值过大，无法可靠预检');
  const intrinsicFailures = failuresFor(intrinsic);
  if (intrinsicFailures.length) {
    diagnostic.status = 'conflict';
    diagnostic.survivingCombinations = 0;
    diagnostic.reason = `不计御魂主副属性和固定属性，仅式神基础、固有加成、已确定套装及额外属性已超出上限：${describeFailures(intrinsicFailures)}。放宽御魂星级或等级也无法满足；导出时不配置御魂`;
    return { target: disableCalculationTarget(target), diagnostic };
  }
  if (!target.sixStarOnly) return unchecked('已允许低星御魂；缺少可靠低星主属性下界，仍需实际库存计算');
  const choices = Object.fromEntries(SLOTS.map((slot) => [slot,
    target.mainStats[slot].length ? target.mainStats[slot] : MAIN_STAT_OPTIONS[slot]])) as Record<MainStatSlot, readonly MainStat[]>;
  type Stage = { checked: number; survivors: MainStat[][] };
  const checkStage = (fixed: Readonly<{ attack: number; hp: number; defense: number }>, mainValues: Readonly<Record<MainStat, number>>, ranges = target.ranges): Stage | null => {
    const result: Stage = { checked: 0, survivors: [] };
    for (const s2 of choices[2]) for (const s4 of choices[4]) for (const s6 of choices[6]) {
      result.checked++;
      const stats: Partial<Record<MainStat, number>> = { ...bonus };
      for (const main of [s2, s4, s6]) stats[main] = (stats[main] ?? 0) + mainValues[main];
      const minimum = minimumFor(stats, fixed);
      if (!Object.values(minimum).every(Number.isFinite)) return null;
      if (!failuresFor(minimum, ranges).length) result.survivors.push([s2, s4, s6]);
    }
    return result;
  };
  const accept = (stage: Stage, relaxedFromMax: boolean): { target: Target; diagnostic: CalculationPrecheckDiagnostic } => {
    diagnostic.checkedCombinations = stage.checked;
    diagnostic.survivingCombinations = stage.survivors.length;
    const mainStats = emptyStats();
    for (const [index, slot] of SLOTS.entries()) {
      mainStats[slot] = [...new Set(stage.survivors.map((row) => row[index]!))];
      diagnostic.removedMainStats[slot] = choices[slot].filter((stat) => !mainStats[slot].includes(stat));
    }
    const optimized = SLOTS.some((slot) => diagnostic.removedMainStats[slot].length);
    diagnostic.status = relaxedFromMax ? 'relaxed' : optimized ? 'optimized' : 'compatible';
    diagnostic.reason = relaxedFromMax
      ? '六星满级御魂无符合上限的主属性组合；已取消“仅满级”，保留“仅六星”，并按六星0级下界筛选主属性；是否有可用御魂仍需库存计算'
      : target.maxLevelOnly
        ? optimized ? '已排除六星满级最低面板超出上限的主属性；副属性与库存仍需计算' : '六星满级主属性通过必要条件预检；副属性与库存仍需计算'
        : optimized ? '已按六星0级下界排除主属性；是否可用仍需库存计算' : '六星0级主属性下界通过预检；是否可用仍需库存计算';
    return { target: { ...target, maxLevelOnly: relaxedFromMax ? false : target.maxLevelOnly, mainStats }, diagnostic };
  };
  if (target.maxLevelOnly) {
    const fullLevel = checkStage(SIX_STAR_MAX_FIXED, SIX_STAR_MAX_MAIN);
    if (!fullLevel) return unchecked('数值过大，无法可靠预检');
    if (fullLevel.survivors.length) return accept(fullLevel, false);
    // This preserves the six-star +15 calculation input. Enlarging only an
    // existing upper bound by a removable fixed main attribute permits a
    // post-calculation removal suggestion; it does not prove inventory or
    // lower bounds after removal. Four- and two-piece requirements leave no
    // position free for this maneuver.
    {
      const freePositions = Math.min(2, Math.max(0, 6 - target.suitRequirements.reduce((sum, suit) => sum + suit.count, 0)));
      if (freePositions > 0) {
        const options = ([
          { position: 1, stat: 'attack', fixed: SIX_STAR_MAX_FIXED.attack * (1 + (target.extraAttributes.attackPercent ?? 0)) },
          { position: 3, stat: 'defense', fixed: SIX_STAR_MAX_FIXED.defense },
          { position: 5, stat: 'hp', fixed: SIX_STAR_MAX_FIXED.hp },
        ] as const).flatMap(({ position, stat, fixed }): ManualAdjustment[] => {
          if (protectedOrderStats.has(stat)) return [];
          const range = target.ranges.find((item) => item.stat === stat && item.max !== undefined);
          if (!range || range.max === undefined || !Number.isFinite(fixed) || fixed <= 0) return [];
          const calculationMax = range.max + fixed;
          if (!Number.isFinite(calculationMax) || calculationMax <= range.max) return [];
          return [{ position, stat, amount: fixed, originalMax: range.max, calculationMax }];
        });
        const viable: { adjustments: ManualAdjustment[]; ranges: Target['ranges']; stage: Stage; score: number }[] = [];
        const subsets = [
          ...options.map((option) => [option]),
          ...(freePositions >= 2 ? options.flatMap((first, index) => options.slice(index + 1).map((second) => [first, second])) : []),
        ];
        for (const adjustments of subsets) {
          if (adjustments.length > freePositions) continue;
          const ranges = target.ranges.map((range) => {
            const adjustment = adjustments.find((item) => item.stat === range.stat);
            return adjustment ? { ...range, max: adjustment.calculationMax } : { ...range };
          });
          const stage = checkStage(SIX_STAR_MAX_FIXED, SIX_STAR_MAX_MAIN, ranges);
          if (!stage) return unchecked('数值过大，无法可靠预检');
          if (!stage.survivors.length) continue;
          const score = adjustments.reduce((sum, item) => sum + item.amount / Math.max(1, Math.abs(item.originalMax)), 0);
          if (Number.isFinite(score)) viable.push({ adjustments, ranges, stage, score });
        }
        viable.sort((a, b) => a.adjustments.length - b.adjustments.length || a.score - b.score
          || a.adjustments.map((item) => item.position).join('').localeCompare(b.adjustments.map((item) => item.position).join('')));
        const chosen = viable[0];
        if (chosen) {
          const result = accept(chosen.stage, false);
          diagnostic.status = 'manual-adjustment';
          diagnostic.manualAdjustments = chosen.adjustments;
          diagnostic.reason = `为保留六星满级，已放宽${chosen.adjustments.map((item) => STATS.find(([id]) => id === item.stat)?.[1] ?? item.stat).join('、')}上限；计算后需卸下${chosen.adjustments.map((item) => `${item.position}号位`).join('、')}，并复核副属性和套装`;
          return { target: { ...result.target, ranges: chosen.ranges }, diagnostic };
        }
      }
    }
  }
  // Re-evaluate the original choices: full-level removals are not valid for
  // lower enhancement levels. The observed level-0 values are the tier floor.
  const zeroLevel = checkStage(SIX_STAR_ZERO_FIXED, SIX_STAR_ZERO_MAIN);
  if (!zeroLevel) return unchecked('数值过大，无法可靠预检');
  if (zeroLevel.survivors.length) return accept(zeroLevel, target.maxLevelOnly);
  diagnostic.status = 'relaxed';
  diagnostic.reason = `${target.maxLevelOnly ? '六星满级及六星0级' : '六星0级'}主属性下界没有符合上限的组合；已取消“仅六星”和“仅满级”并恢复原主属性选择。低星缺少可靠数值表，能否满足仍需库存计算`;
  return { target: { ...target, sixStarOnly: false, maxLevelOnly: false,
    mainStats: { 2: [...target.mainStats[2]], 4: [...target.mainStats[4]], 6: [...target.mainStats[6]] } }, diagnostic };
}
