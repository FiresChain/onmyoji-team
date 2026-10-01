import { TWO_PIECE_EFFECT_OPTIONS } from './calculation-options';
import type { CalculationConfig } from './calculation-types';
import { STATS, type Catalog } from './types';

const EFFECT_IDS: Record<string, number> = { attackPercent: 0, crit: 1, critDamage: 2, effectHit: 4, effectResist: 5, hpPercent: 6, defensePercent: 7 };
type Suit = { suitId: number; count: 2 | 4 } | { effectId: number; count: 2 };
export interface TeamEncodeResult { teamCode: string; inspection: Record<string, unknown>; warnings: string[] }
export interface EncodeOptions { signal?: AbortSignal; apiBaseUrl?: string }

export function buildTeamEncodeDraft(config: CalculationConfig, catalog: Catalog | null) {
  if (config.percentageUnit !== 'percentage-points' || config.extraAttributesPercentageUnit !== 'ratio') throw new Error('计算配置的百分比单位不正确');
  if (config.targets.length !== 5 || new Set(config.targets.map((target) => target.slot)).size !== 5 || config.targets.some((target) => target.slot < 1 || target.slot > 5)) throw new Error('阵容编码需要五个固定式神槽位');
  const targets = config.targets.map((target) => {
    const fail = (message: string): never => { throw new Error(`第 ${target.slot} 位：${message}`); };
    let shikigamiId: number | null = null;
    if (target.shikigami !== null) {
      const id = target.shikigami.catalogId;
      if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) fail('请先在编辑阵容中确认式神');
      const asset = catalog?.shikigami.find((item) => item.id === id);
      if (!asset || (target.shikigami.name && target.shikigami.name !== asset.name)) fail('式神与素材目录不一致，请重新选择式神');
      shikigamiId = Number(id);
    }
    if (target.scope !== 'all') fail('当前阵容码尚不支持“仅未装备”范围，请改为全部');
    if (target.excludeOccupied) fail('当前阵容码尚不支持排除其他阵容占用，请取消该选项');
    if (target.yuhunConfigEnabled && !target.suitRequirements.length && !target.suitSelectionComplete) fail('御魂尚未指定，请在编辑阵容中选择御魂');
    const suitRequirements: Suit[] = target.suitRequirements.map((suit) => {
      if (suit.kind === 'two-piece-effect') {
        const option = TWO_PIECE_EFFECT_OPTIONS.find((item) => item.id === suit.catalogId);
        const stat = option?.id.slice('two-piece-effect:'.length);
        const effectId = stat === undefined ? undefined : EFFECT_IDS[stat];
        if (!option || effectId === undefined || option.name !== suit.name || suit.count !== 2) return fail('两件套效果不正确，请重新选择');
        return { effectId, count: 2 };
      }
      const id = suit.catalogId;
      if (!id || !/^300\d{3}$/.test(id) || id === '300000') return fail('御魂套装尚未对应到游戏 ID，请重新选择');
      const asset = catalog?.yuhun.find((item) => item.id === id);
      if (!asset || asset.name !== suit.name) return fail('御魂套装与素材目录不一致，请重新选择');
      return { suitId: Number(id), count: suit.count };
    });
    if (suitRequirements.filter((suit) => 'suitId' in suit && suit.count === 4).length > 1 || suitRequirements.filter((suit) => 'suitId' in suit && suit.count === 2).length > 1) fail('当前阵容码支持一组具体四件套和一组具体两件套，请调整套装组合');
    const ranges = target.ranges.map((range) => {
      const definition = STATS.find(([stat]) => stat === range.stat);
      if (!definition || definition[2] !== range.percentage) fail('属性范围的单位不正确');
      if (range.min === undefined || range.max === undefined) fail(`${definition![1]}请同时填写上下限，当前编码尚未确认单边范围协议`);
      // Game-code ranges use percentage points; extra attributes separately use ratios.
      return { ...range };
    });
    return { slot: target.slot, shikigamiId, ...(shikigamiId === null ? {} : { level: 40 as const }),
      yuhunConfigEnabled: target.yuhunConfigEnabled, metricId: target.metricId, targetScore: target.targetScore,
      suitRequirements, mainStats: { 2: [...target.mainStats[2]], 4: [...target.mainStats[4]], 6: [...target.mainStats[6]] },
      highestStat: target.highestStat, extraAttributes: { ...target.extraAttributes }, ranges,
      scope: target.scope, sixStarOnly: target.sixStarOnly, maxLevelOnly: target.maxLevelOnly, excludeOccupied: target.excludeOccupied };
  });
  return { name: config.name, percentageUnit: 'percentage-points' as const, extraAttributesPercentageUnit: 'ratio' as const, targets };
}

export async function encodeTeamConfiguration(config: CalculationConfig, catalog: Catalog | null, templateTeamCode: string, options: EncodeOptions = {}): Promise<TeamEncodeResult> {
  const template = templateTeamCode.trim();
  if (!template.startsWith('#TA#') || template.length <= 4) throw new Error('请先填入游戏内导出的 #TA# 阵容码模板');
  const draft = buildTeamEncodeDraft(config, catalog);
  const apiBase = (options.apiBaseUrl ?? import.meta.env?.VITE_ONMYOJI_API_URL ?? 'https://api.fireschain.org').replace(/\/$/, '');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(`${apiBase}/onmyoji/v1/team-code/encode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateTeamCode: template, draft }), signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 404) throw new Error('阵容编码接口尚未部署或地址不正确');
    if (!response.ok || payload?.ok !== true) throw new Error(typeof payload?.error === 'string' ? payload.error : `阵容编码失败（${response.status}）`);
    const data = payload.data;
    if (typeof data?.teamCode !== 'string' || !/^#TA#[A-Za-z0-9+/_=-]+$/.test(data.teamCode)
      || !data.inspection || typeof data.inspection !== 'object' || Array.isArray(data.inspection)
      || !Array.isArray(data.warnings) || data.warnings.some((warning: unknown) => typeof warning !== 'string')) throw new Error('编码接口返回了无效的阵容码结果');
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
    if (timedOut) throw new Error('阵容编码请求超时，请重试');
    if (error instanceof TypeError) throw new Error('无法连接阵容编码服务，请确认 API 已启动或部署');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
