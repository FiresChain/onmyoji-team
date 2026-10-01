import type { CalculationMemberDraft, CalculationMetricId, HitMetricPools } from './calculation-types';

/** User screenshot preset; display names document the verified catalog IDs. */
export const DEFAULT_HIT_METRIC_POOLS = {
  shikigamiIds: [
    '578', // 神酿星熊童子
    '572', // 遥念烟烟罗
    '396', // 修罗鬼童丸
    '385', // 大夜摩天阎魔
    '377', // 梦寻山兔
    '326', // 稻荷神御馔津
    '577', // 鬼金羊
    '575', // 封阳君
    '557', // 伊邪那美
    '550', // 孔雀明王
    '304', // 御馔津
    '255', // 阎魔
    '398', // 天逆每
    '378', // 迦楼罗
    '371', // 川猿
    '342', // 星熊童子
    '293', // 百目鬼
    '290', // 小松丸
    '281', // 烟烟罗
    '271', // 般若
    '257', // 食梦貘
    '201', // 雪女
    '215', // 孟婆
    '375', // 影鳄
    '227', // 兵俑
    '208', // 狸猫
  ],
  yuhunIds: [
    '300039', // 返魂香
    '300002', // 雪幽魂
    '300011', // 反枕
    '300035', // 魅妖
    '300008', // 魍魉之匣
    '300015', // 钟灵
  ],
} as const satisfies { shikigamiIds: readonly string[]; yuhunIds: readonly string[] };

export function createHitMetricPools(): HitMetricPools {
  return { shikigamiIds: [...DEFAULT_HIT_METRIC_POOLS.shikigamiIds], yuhunIds: [...DEFAULT_HIT_METRIC_POOLS.yuhunIds] };
}

/** Match only the currently selected identities, never recognition candidates or display names. */
export function matchHitMetricPool(
  member: CalculationMemberDraft, pools: HitMetricPools,
): { shikigami: boolean; yuhunIds: string[] } {
  if (!member.enabled || member.shikigami === null) return { shikigami: false, yuhunIds: [] };
  const heroId = member.shikigami.catalogId;
  return {
    shikigami: heroId !== null && pools.shikigamiIds.includes(heroId),
    yuhunIds: [...new Set(member.suitRequirements.flatMap((suit) =>
      suit.kind === 'suit' && suit.catalogId !== null && pools.yuhunIds.includes(suit.catalogId)
        ? [suit.catalogId] : []))],
  };
}

export function effectiveCalculationMetricId(member: CalculationMemberDraft, pools: HitMetricPools): CalculationMetricId {
  const match = matchHitMetricPool(member, pools);
  return match.shikigami || match.yuhunIds.length > 0 ? 8 : member.metricId;
}
