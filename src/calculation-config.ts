import { STATS, type Catalog, type Member, type Stat } from './types';
import { EXTRA_ATTRIBUTE_LABELS, MAIN_STAT_OPTIONS, TWO_PIECE_EFFECT_OPTIONS } from './calculation-options';
import { conflictDiagnostic, disableCalculationTarget, precheckCalculationTarget } from './calculation-precheck';
import { createHitMetricPools, effectiveCalculationMetricId } from './calculation-metric-pools';
import type { CalculationConfig, CalculationDraft, CalculationIssue, CalculationMemberDraft,
  CalculationLimitDraft, CalculationMetric, CalculationRange, CalculationPrecheckDiagnostic, ExtraAttributeStat, MainStatSlot, ReproductionStat } from './calculation-types';

// Stable IDs and display names follow onmyoji-yuhun's team-calculation contract.
export const CALCULATION_METRICS: readonly CalculationMetric[] = [
  { id: 1, name: '伤害输出', stats: ['attack', 'critDamage'] },
  { id: 2, name: '效果命中', stats: ['effectHit'] },
  { id: 3, name: '效果抵抗', stats: ['effectResist'] },
  { id: 4, name: '生命', stats: ['hp'] },
  { id: 5, name: '攻击', stats: ['attack'] },
  { id: 6, name: '防御', stats: ['defense'] },
  { id: 7, name: '速度', stats: ['speed'] },
  { id: 8, name: '暴击', stats: ['crit'] },
  { id: 9, name: '暴击伤害', stats: ['critDamage'] },
  { id: 10, name: '治疗量', stats: ['hp', 'critDamage'] },
  { id: 11, name: '命抗双修', stats: ['effectHit', 'effectResist'] },
  { id: 12, name: '防御输出', stats: ['defense', 'critDamage'] },
];

export const REPRODUCTION_STATS = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'effectResist'] as const satisfies readonly ReproductionStat[];
export const DEFAULT_ORDER_STATS = ['speed', 'attack', 'critDamage'] as const satisfies readonly ReproductionStat[];
export const DEFAULT_TOLERANCE_TEXT = '默认以截图数值的 ±10% 重建七项属性范围；可单独选择参与限制和保序的属性。';
export function effectiveOrderStats(reproduction: Pick<CalculationDraft['reproduction'], 'constraintStats' | 'orderStats'>): ReproductionStat[] {
  const selected = new Set(reproduction.constraintStats);
  return reproduction.orderStats.filter((stat) => selected.has(stat));
}
const formatDefault = (value: number) => String(Number(value.toFixed(2)));

function tolerancePercent(text: string): number | null {
  if (typeof text !== 'string' || !numericText.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value === 0 ? 0 : value : null;
}

function defaultConstraint(value: number | null, percent: number): Pick<CalculationLimitDraft, 'min' | 'max'> | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (percent === 0) return { min: String(value), max: String(value) };
  const tolerance = value * (percent / 100);
  const min = Math.max(0, value - tolerance), max = value + tolerance;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: formatDefault(min), max: formatDefault(max) };
}

function rebuildConstraints(source: Member, percent: number): CalculationLimitDraft[] {
  return REPRODUCTION_STATS.flatMap((stat) => {
    const range = defaultConstraint(source.panel[stat], percent);
    const index = STATS.findIndex(([value]) => value === stat);
    return range ? [{ id: index + 1, stat, ...range }] : [];
  });
}

export function resetMemberConstraints(draftMember: CalculationMemberDraft, source: Member, percentText = '10'): CalculationMemberDraft {
  const percent = tolerancePercent(percentText);
  return {
    ...draftMember,
    shikigami: draftMember.shikigami === null ? null : { ...draftMember.shikigami },
    suitRequirements: draftMember.suitRequirements.map((suit) => ({ ...suit })),
    mainStats: { 2: [...draftMember.mainStats[2]], 4: [...draftMember.mainStats[4]], 6: [...draftMember.mainStats[6]] },
    extraAttributes: { ...draftMember.extraAttributes },
    limits: percent === null ? draftMember.limits.map((range) => ({ ...range })) : rebuildConstraints(source, percent),
  };
}

export function createEmptyCalculationMember(slot: number): CalculationMemberDraft {
  return {
    slot, shikigami: null, enabled: true, metricId: 2, targetScore: '',
    suitRequirements: [], suitSelectionComplete: false,
    mainStats: { 2: [], 4: [], 6: [] }, highestStat: null,
    extraAttributes: { attackPercent: '', attack: '', crit: '', critDamage: '' },
    scope: 'all', sixStarOnly: true, maxLevelOnly: true, excludeOccupied: false, limits: [],
  };
}

export function createCalculationDraft(members: readonly Member[]): CalculationDraft {
  return {
    name: '对弈竞猜阵容', scene: '对弈竞猜', calculationMode: 'force', difficulty: '1',
    hitMetricPools: createHitMetricPools(),
    reproduction: { tolerancePercent: '10', constraintStats: [...REPRODUCTION_STATS], orderStats: [...DEFAULT_ORDER_STATS] },
    members: members.map((member) => ({
      ...createEmptyCalculationMember(member.slot),
      shikigami: { catalogId: member.shikigami.id, name: member.shikigami.name || member.shikigami.rawText },
      limits: rebuildConstraints(member, 10),
    })),
  };
}

/** A changed valid tolerance rebuilds screenshot ranges; checkbox changes preserve edits. */
export function applyReproductionSettings(
  draft: CalculationDraft, sources: readonly Member[], settings: Partial<CalculationDraft['reproduction']>,
): CalculationDraft {
  const reproduction = {
    tolerancePercent: settings.tolerancePercent ?? draft.reproduction.tolerancePercent,
    constraintStats: [...(settings.constraintStats ?? draft.reproduction.constraintStats)],
    orderStats: [...(settings.orderStats ?? draft.reproduction.orderStats)],
  };
  if (reproduction.tolerancePercent === draft.reproduction.tolerancePercent
    || tolerancePercent(reproduction.tolerancePercent) === null) return { ...draft, reproduction };
  const bySlot = new Map(sources.map((source) => [source.slot, source]));
  return { ...draft, reproduction, members: draft.members.map((member) => {
    const source = bySlot.get(member.slot);
    return member.enabled && member.shikigami !== null && source?.shikigami.id
      && member.shikigami.catalogId === source.shikigami.id
      ? resetMemberConstraints(member, source, reproduction.tolerancePercent) : member;
  }) };
}

export function applyReproductionTolerance(
  draft: CalculationDraft, sources: readonly Member[], percentText: string,
): CalculationDraft {
  return applyReproductionSettings(draft, sources, { tolerancePercent: percentText });
}

/** Fill untouched empty selections when asynchronous recognition and the catalog are ready. */
export function applyRecognizedSuits(
  draft: CalculationDraft, sources: readonly Member[], catalog: Catalog | null,
  editedSlots: ReadonlySet<number> = new Set(),
): CalculationDraft {
  if (!catalog) return draft;
  let changed = false;
  const members = draft.members.map((member) => {
    if (editedSlots.has(member.slot) || !member.enabled || !member.shikigami?.catalogId
      || member.suitRequirements.length || member.suitSelectionComplete) return member;
    const source = sources.find((item) => item.slot === member.slot);
    if (source?.shikigami.id !== member.shikigami.catalogId || source.yuhun.status !== 'candidate') return member;
    const candidate = source.yuhun.candidates[0];
    const asset = candidate && catalog.yuhun.find((item) => item.id === candidate.catalogId && item.name === candidate.name);
    if (!asset || asset.id === '300000' || asset.name === '散件') return member;
    changed = true;
    return { ...member, suitRequirements: [{ catalogId: asset.id, name: asset.name,
      count: asset.type === 'PVE' ? 2 as const : 4 as const, kind: 'suit' as const }] };
  });
  return changed ? { ...draft, members } : draft;
}

const validSlot = (slot: number) => Number.isInteger(slot) && slot > 0 && slot <= 5;
const numericText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAIN_SLOTS: readonly MainStatSlot[] = [2, 4, 6];

/** Integer hundredths keep midpoint cuts and strict gaps independent of float rounding. */
function hundredths(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  const units = Math.round(value * 100);
  if (!Number.isSafeInteger(units) || units >= Number.MAX_SAFE_INTEGER || units / 100 !== value
    || (units + 1) / 100 <= value || (units > 0 && (units - 1) / 100 >= value)) return null;
  return units;
}

function preserveScreenshotOrder(
  targets: CalculationConfig['targets'], sources: ReadonlyMap<number, Member>, issues: CalculationIssue[],
  conflicts: Map<number, CalculationPrecheckDiagnostic>, orderStats: readonly ReproductionStat[],
): void {
  const active = targets.filter((target) => target.yuhunConfigEnabled);
  for (const stat of orderStats) {
    const label = STATS.find(([value]) => value === stat)?.[1] ?? stat;
    const participants = active.flatMap((target) => {
      const range = target.ranges.find((item) => item.stat === stat);
      return range ? [{ target, range }] : [];
    });
    if (participants.length < 2) continue;
    const before = issues.length;
    const entries: { range: CalculationRange; slot: number; original: number; min: number; max: number }[] = [];
    for (const { target, range } of participants) {
      const issue = (message: string) => issues.push({ slot: target.slot, stat, field: 'reproduction.orderStats', message });
      const source = sources.get(target.slot);
      if (!source?.shikigami.id || target.shikigami?.catalogId !== source.shikigami.id) {
        issue(`${label}无法保序：式神身份未知或已更换，请恢复截图式神或取消该属性保序`);
        continue;
      }
      const original = hundredths(source.panel[stat]);
      if (original === null) {
        issue(`${label}无法严格保序：截图数值未知或不能精确表示到两位小数`);
        continue;
      }
      if (range.min === undefined || range.max === undefined) {
        issue(`${label}严格保序需要同时填写范围下限和上限`);
        continue;
      }
      const min = hundredths(range.min), max = hundredths(range.max);
      if (min === null || max === null) {
        issue(`${label}严格保序需要可安全表示到两位小数的上下限`);
        continue;
      }
      entries.push({ range, slot: target.slot, original, min, max });
    }
    if (issues.length !== before) continue;
    const groups = new Map<number, typeof entries>();
    for (const entry of entries) {
      const group = groups.get(entry.original) ?? [];
      group.push(entry);
      groups.set(entry.original, group);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => a - b);
    if (ordered.length < 2) continue;
    const highest = active.filter((target) => target.highestStat === stat);
    if (highest.length) {
      for (const target of highest) issues.push({ slot: target.slot, stat, field: 'highestStat',
        message: `${label}最高属性会动态覆盖上限，与该属性保序冲突；请取消最高属性或取消该属性保序` });
      continue;
    }
    for (let index = 1; index < ordered.length; index++) {
      const [lowerValue, lower] = ordered[index - 1]!, [higherValue, higher] = ordered[index]!;
      if (Math.max(...lower.map((entry) => entry.max)) + 1 <= Math.min(...higher.map((entry) => entry.min))) continue;
      const boundary = lowerValue + Math.floor((higherValue - lowerValue) / 2);
      for (const entry of lower) entry.max = Math.min(entry.max, boundary);
      for (const entry of higher) entry.min = Math.max(entry.min, boundary + 1);
    }
    for (const entry of entries) {
      if (entry.min > entry.max) conflicts.set(entry.slot, conflictDiagnostic(entry.slot,
        `${label}范围与截图次序冲突，按截图中点收紧后没有可用范围；导出时不配置御魂`, 'strict-order'));
    }
    if (conflicts.size) return;
    if (issues.length !== before) continue;
    for (const entry of entries) { entry.range.min = entry.min / 100; entry.range.max = entry.max / 100; }
  }
}

export function serializeCalculationDraft(
  draft: CalculationDraft, sourceMembers: readonly Member[], catalog: Catalog | null = null,
): { value: CalculationConfig | null; issues: CalculationIssue[]; prechecks: CalculationPrecheckDiagnostic[] } {
  const issues: CalculationIssue[] = [];
  const name = draft.name.trim(), scene = draft.scene.trim();
  if (!name || name.length > 80) issues.push({ slot: null, field: 'name', message: '阵容名称不能为空且不能超过八十个字符' });
  if (!scene) issues.push({ slot: null, field: 'scene', message: '场景不能为空' });
  if (draft.calculationMode !== 'difficulty' && draft.calculationMode !== 'force') {
    issues.push({ slot: null, field: 'calculationMode', message: '计算方式无效' });
  }
  const percent = tolerancePercent(draft.reproduction?.tolerancePercent);
  if (percent === null) issues.push({ slot: null, field: 'reproduction.tolerancePercent', message: '截图误差必须为零到一百之间的有限百分比' });
  const validSelection = (value: unknown, field: 'constraintStats' | 'orderStats'): value is ReproductionStat[] => {
    if (!Array.isArray(value) || value.some((stat) => !REPRODUCTION_STATS.includes(stat))
      || new Set(value).size !== value.length) {
      issues.push({ slot: null, field: `reproduction.${field}`, message: '属性选择必须为七项属性中不重复的有效列表' });
      return false;
    }
    return true;
  };
  const constraintStats = validSelection(draft.reproduction?.constraintStats, 'constraintStats') ? draft.reproduction.constraintStats : [];
  const orderStats = validSelection(draft.reproduction?.orderStats, 'orderStats') ? draft.reproduction.orderStats : [];
  const effectiveOrders = effectiveOrderStats({ constraintStats, orderStats });
  const selectedConstraints = new Set<Stat>(constraintStats);
  const protectedOrders = new Set<Stat>(effectiveOrders);
  const validPoolIds = (value: unknown, field: 'shikigamiIds' | 'yuhunIds'): string[] => {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())
      || new Set(value).size !== value.length) {
      issues.push({ slot: null, field: `hitMetricPools.${field}`, message: '命中池标识必须为不重复的非空字符串列表' });
      return [];
    }
    return [...value];
  };
  const hitMetricPools = {
    shikigamiIds: validPoolIds(draft.hitMetricPools?.shikigamiIds, 'shikigamiIds'),
    yuhunIds: validPoolIds(draft.hitMetricPools?.yuhunIds, 'yuhunIds'),
  };
  let difficulty: number | null = null;
  if (draft.calculationMode === 'difficulty') {
    const text = draft.difficulty.trim(), number = Number(text);
    if (!numericText.test(text) || !Number.isInteger(number) || number < 1 || number > 100) {
      issues.push({ slot: null, field: 'difficulty', message: '计算难度必须为一到一百的整数' });
    } else difficulty = number;
  }
  const sources = new Map<number, Member>(), draftSlots = new Set<number>();
  if (draft.members.length > 5 || sourceMembers.length > 5) {
    issues.push({ slot: null, field: 'members', message: '队伍最多包含五位式神' });
  }
  for (const source of sourceMembers) {
    if (!validSlot(source.slot) || sources.has(source.slot)) {
      issues.push({ slot: Number.isFinite(source.slot) ? source.slot : null, field: 'slot', message: '原识别成员槽位无效或重复' });
    }
    sources.set(source.slot, source);
  }
  const targets: CalculationConfig['targets'] = [];
  for (const member of draft.members) {
    if (!validSlot(member.slot) || draftSlots.has(member.slot)) {
      issues.push({ slot: Number.isFinite(member.slot) ? member.slot : null, field: 'slot', message: '配装成员槽位无效或重复' });
    }
    draftSlots.add(member.slot);
    if (!sources.has(member.slot)) issues.push({ slot: member.slot, field: 'slot', message: '配装成员槽位与原识别成员不符' });
    const active = member.enabled && member.shikigami !== null;
    const manualMetric = CALCULATION_METRICS.find((item) => item.id === member.metricId) ?? (active ? undefined : CALCULATION_METRICS[1]);
    const metric = manualMetric && active
      ? CALCULATION_METRICS.find((item) => item.id === effectiveCalculationMetricId(member, hitMetricPools))
      : manualMetric;
    if (!metric) {
      issues.push({ slot: member.slot, field: 'metricId', message: '配装指标无效' });
      continue;
    }
    const ranges: CalculationRange[] = [];
    const target: CalculationConfig['targets'][number] = {
      slot: member.slot, shikigami: member.shikigami === null ? null : { ...member.shikigami },
      yuhunConfigEnabled: active, metricId: metric.id, metricName: metric.name,
      targetScore: null, suitRequirements: [], suitSelectionComplete: false,
      mainStats: { 2: [], 4: [], 6: [] }, highestStat: null, extraAttributes: {},
      scope: 'all', sixStarOnly: false, maxLevelOnly: false, excludeOccupied: false, ranges,
    };
    if (active) {
      const issue = (field: string, message: string, stat?: Stat) => issues.push({ slot: member.slot, field, message, ...(stat ? { stat } : {}) });
      const parseNumber = (raw: string, field: string, label: string, stat?: Stat): number | undefined => {
        const text = raw.trim();
        if (!text) return undefined;
        const number = Number(text);
        if (!numericText.test(text) || !Number.isFinite(number) || number < 0) {
          issue(field, `${label}必须为有限的非负数字`, stat);
          return undefined;
        }
        return number === 0 ? 0 : number;
      };
      target.targetScore = parseNumber(member.targetScore, 'targetScore', '目标评分') ?? null;
      target.suitSelectionComplete = member.suitSelectionComplete;
      const suitIds = new Set<string>(), suitNames = new Set<string>();
      let capacity = 0;
      for (const [index, suit] of member.suitRequirements.entries()) {
        const field = `suitRequirements.${index}`;
        if (suit.count !== 2 && suit.count !== 4) issue(`${field}.count`, '御魂套装件数必须为二件或四件');
        else capacity += suit.count;
        if (!suit.name.trim()) issue(`${field}.name`, '请选择御魂套装');
        if (suitNames.has(suit.name) || (suit.catalogId !== null && suitIds.has(suit.catalogId))) {
          issue(field, '同一御魂套装不能重复选择');
        }
        suitNames.add(suit.name);
        if (suit.catalogId !== null) {
          if (typeof suit.catalogId !== 'string' || !suit.catalogId.trim()) issue(`${field}.catalogId`, '御魂素材标识无效');
          suitIds.add(suit.catalogId);
        }
        if (suit.kind === 'two-piece-effect') {
          const option = TWO_PIECE_EFFECT_OPTIONS.find((item) => item.id === suit.catalogId);
          if (!option || option.name !== suit.name) issue(field, '二件套效果的标识或名称无效');
          if (suit.count !== 2) issue(`${field}.count`, '二件套效果仅支持二件');
        } else if (suit.kind === 'suit') {
          if (suit.catalogId?.startsWith('two-piece-effect:')) issue(`${field}.catalogId`, '御魂套装不能使用二件套效果标识');
          if (catalog) {
            const asset = catalog.yuhun.find((item) => suit.catalogId === null ? item.name === suit.name : item.id === suit.catalogId);
            if (!asset || asset.name !== suit.name || asset.name === '散件') issue(field, '御魂套装与素材目录不符');
            if (asset?.type === 'PVE' && suit.count !== 2) issue(`${field}.count`, '首领御魂仅支持二件');
          }
        } else issue(`${field}.kind`, '御魂套装类型无效');
        target.suitRequirements.push({ ...suit });
      }
      if (capacity > 6) issue('suitRequirements', '御魂套装总件数不能超过六件');
      for (const slot of MAIN_SLOTS) {
        const selected = member.mainStats[slot];
        if (selected.some((stat) => !MAIN_STAT_OPTIONS[slot].includes(stat)) || new Set(selected).size !== selected.length) {
          issue(`mainStats.${slot}`, `${slot}号位主属性无效或重复`);
        }
        target.mainStats[slot] = [...selected];
      }
      if (member.highestStat !== null && !STATS.some(([stat]) => stat === member.highestStat)) issue('highestStat', '最高属性无效');
      target.highestStat = member.highestStat;
      for (const stat of Object.keys(EXTRA_ATTRIBUTE_LABELS) as ExtraAttributeStat[]) {
        const number = parseNumber(member.extraAttributes[stat], `extraAttributes.${stat}`, EXTRA_ATTRIBUTE_LABELS[stat]);
        if (number !== undefined) target.extraAttributes[stat] = stat === 'attack' ? number : number / 100;
      }
      if (member.scope !== 'all' && member.scope !== 'unequipped') issue('scope', '御魂选择范围无效');
      target.scope = member.scope;
      for (const field of ['suitSelectionComplete', 'sixStarOnly', 'maxLevelOnly', 'excludeOccupied'] as const) {
        if (typeof member[field] !== 'boolean') issue(field, '选项值必须为布尔值');
        target[field] = member[field];
      }
      const limitIds = new Set<number>(), limitStats = new Set<Stat>();
      for (const constraint of member.limits) {
        const { id, stat } = constraint;
        if (!Number.isInteger(id) || !Number.isFinite(id) || id <= 0 || limitIds.has(id)) {
          issue('limits', '属性限制行标识必须为不重复的正整数');
        }
        limitIds.add(id);
        const definition = STATS.find(([value]) => value === stat);
        if (!definition) { issue('limits', '属性限制的属性无效'); continue; }
        const [, label, percentage] = definition;
        if (limitStats.has(stat)) issue('limits', `${label}不能重复添加限制`, stat);
        limitStats.add(stat);
        if (!selectedConstraints.has(stat)) continue;
        const minText = constraint.min.trim(), maxText = constraint.max.trim();
        if (!minText && !maxText) {
          issue('limits', `${label}范围请至少填写一个上下限`, stat);
          continue;
        }
        const min = parseNumber(minText, `limits.${id}.min`, `${label}下限`, stat);
        const max = parseNumber(maxText, `limits.${id}.max`, `${label}上限`, stat);
        if (min !== undefined && max !== undefined && min > max) {
          issue(`limits.${id}.max`, `${label}下限不能大于上限`, stat);
        }
        ranges.push({ stat, percentage, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
      }
    }
    targets.push(target);
  }
  for (const slot of sources.keys()) {
    if (!draftSlots.has(slot)) issues.push({ slot, field: 'slot', message: '原识别成员缺少对应的配装配置' });
  }
  if (!draft.members.some((member) => member.shikigami !== null)) issues.push({ slot: null, field: 'members', message: '请至少选择一位式神' });
  const diagnostics = new Map<number, CalculationPrecheckDiagnostic>();
  let effectiveTargets = targets;
  if (!issues.length) {
    const original = structuredClone(targets);
    const disabled = new Set<number>();
    const dynamic = targets.some((target) => target.yuhunConfigEnabled && target.highestStat !== null)
      ? '队伍包含动态最高属性，无法可靠使用静态上限预检' : undefined;
    // First remove proofs from unmodified static ranges, then recompute ordering
    // from those originals after every removal. A removed member leaves no cuts.
    for (const target of original) {
      const result = precheckCalculationTarget(target, 'base', dynamic, protectedOrders);
      diagnostics.set(target.slot, result.diagnostic);
      if (result.diagnostic.status === 'conflict') disabled.add(target.slot);
    }
    for (let pass = 0; pass <= original.length; pass++) {
      effectiveTargets = structuredClone(original).map((target) => disabled.has(target.slot) ? disableCalculationTarget(target) : target);
      const conflicts = new Map<number, CalculationPrecheckDiagnostic>();
      if (effectiveOrders.length) preserveScreenshotOrder(effectiveTargets, sources, issues, conflicts, effectiveOrders);
      if (issues.length) break;
      if (conflicts.size) {
        for (const [slot, diagnostic] of conflicts) { disabled.add(slot); diagnostics.set(slot, diagnostic); }
        continue;
      }
      let changed = false;
      effectiveTargets = effectiveTargets.map((target) => {
        if (disabled.has(target.slot)) return target;
        const result = precheckCalculationTarget(target, effectiveOrders.length ? 'strict-order' : 'base', dynamic, protectedOrders);
        diagnostics.set(target.slot, result.diagnostic);
        if (result.diagnostic.status === 'conflict') { disabled.add(target.slot); changed = true; }
        return result.target;
      });
      if (!changed) break;
    }
  }
  return {
    value: issues.length ? null : { mode: 'screenshot-reproduction', percentageUnit: 'percentage-points', extraAttributesPercentageUnit: 'ratio', name, scene, calculationMode: draft.calculationMode, difficulty,
      hitMetricPools: { shikigamiIds: [...hitMetricPools.shikigamiIds], yuhunIds: [...hitMetricPools.yuhunIds] },
      reproduction: { tolerancePercent: percent!, constraintStats: [...constraintStats], orderStats: [...orderStats] }, targets: effectiveTargets },
    issues,
    prechecks: targets.flatMap((target) => { const result = diagnostics.get(target.slot); return result ? [result] : []; }),
  };
}
