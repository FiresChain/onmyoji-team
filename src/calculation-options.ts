import type { Catalog } from './types';
import type { CalculationMetricId, ExtraAttributeStat, MainStat, MainStatSlot } from './calculation-types';

export const MAIN_STAT_LABELS: Record<MainStat, string> = {
  attackPercent: '攻击加成', hpPercent: '生命加成', defensePercent: '防御加成',
  speed: '速度', effectHit: '效果命中', effectResist: '效果抵抗', crit: '暴击', critDamage: '暴击伤害',
};
export const MAIN_STAT_OPTIONS: Record<MainStatSlot, readonly MainStat[]> = {
  2: ['attackPercent', 'hpPercent', 'defensePercent', 'speed'],
  4: ['attackPercent', 'hpPercent', 'defensePercent', 'effectHit', 'effectResist'],
  6: ['attackPercent', 'hpPercent', 'defensePercent', 'crit', 'critDamage'],
};
const METRIC_PRESETS: Record<CalculationMetricId, Record<MainStatSlot, MainStat[]>> = {
  1: { 2: ['attackPercent'], 4: ['attackPercent'], 6: ['crit', 'critDamage'] },
  2: { 2: ['speed'], 4: ['effectHit'], 6: [] },
  3: { 2: ['speed'], 4: ['effectResist'], 6: [] },
  4: { 2: ['hpPercent'], 4: ['hpPercent'], 6: ['hpPercent'] },
  5: { 2: ['attackPercent'], 4: ['attackPercent'], 6: ['attackPercent'] },
  6: { 2: ['defensePercent'], 4: ['defensePercent'], 6: ['defensePercent'] },
  7: { 2: ['speed'], 4: [], 6: [] }, 8: { 2: [], 4: [], 6: ['crit'] },
  9: { 2: [], 4: [], 6: ['critDamage'] },
  10: { 2: ['speed'], 4: ['hpPercent'], 6: ['crit', 'critDamage'] },
  11: { 2: ['speed'], 4: ['effectHit', 'effectResist'], 6: ['hpPercent'] },
  12: { 2: ['defensePercent'], 4: ['defensePercent'], 6: ['crit', 'critDamage'] },
};
export function metricMainStatPreset(metric: CalculationMetricId): Record<MainStatSlot, MainStat[]> {
  const preset = METRIC_PRESETS[metric];
  return { 2: [...preset[2]], 4: [...preset[4]], 6: [...preset[6]] };
}
export const EXTRA_ATTRIBUTE_LABELS: Record<ExtraAttributeStat, string> = {
  attackPercent: '攻击加成 (%)', attack: '固定攻击', crit: '暴击 (%)', critDamage: '暴击伤害 (%)',
};
export const YUHUN_CATEGORIES = ['全部', '攻击加成', '暴击', '暴击伤害', '防御加成', '生命加成', '效果命中', '效果抵抗', '首领御魂', '其他'] as const;
const CATEGORY_BY_TYPE: Record<string, string> = {
  attack: '攻击加成', Crit: '暴击', CritDamage: '暴击伤害', Defense: '防御加成', Health: '生命加成',
  ControlHit: '效果命中', ControlMiss: '效果抵抗', PVE: '首领御魂',
};
export interface SuitOption {
  id: string;
  name: string;
  avatar: string;
  category: string;
  kind: 'suit' | 'two-piece-effect';
  twoPieceOnly: boolean;
}
export const TWO_PIECE_EFFECT_OPTIONS: readonly SuitOption[] = (
  ['attackPercent', 'crit', 'critDamage', 'hpPercent', 'defensePercent', 'effectHit', 'effectResist'] as const
).map((stat) => ({ id: `two-piece-effect:${stat}`, name: MAIN_STAT_LABELS[stat], avatar: '',
  category: MAIN_STAT_LABELS[stat], kind: 'two-piece-effect', twoPieceOnly: true }));

export function calculationSuitOptions(catalog: Catalog | null): SuitOption[] {
  return [...TWO_PIECE_EFFECT_OPTIONS, ...(catalog?.yuhun ?? []).filter((asset) => asset.name !== '散件').map((asset): SuitOption => ({
    id: asset.id, name: asset.name, avatar: asset.avatar, category: CATEGORY_BY_TYPE[asset.type ?? ''] ?? '其他',
    kind: 'suit', twoPieceOnly: asset.type === 'PVE',
  }))];
}

export function shikigamiRarities(catalog: Catalog | null): string[] {
  const found = [...new Set((catalog?.shikigami ?? []).map((asset) => asset.rarity).filter((value): value is string => !!value))];
  const order = ['UR', 'SP', 'SSR', 'SR', 'R', 'N', 'L', 'G'];
  return ['全部', ...order.filter((rarity) => found.includes(rarity)), ...found.filter((rarity) => !order.includes(rarity)).sort((a, b) => a.localeCompare(b, 'zh'))];
}
export function rarityLabel(rarity: string): string {
  return ({ L: '联动', G: '呱太' } as Record<string, string>)[rarity] ?? rarity;
}
