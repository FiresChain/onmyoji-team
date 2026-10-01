import { assetRequestUrl } from './catalog';
import type { Asset, Candidate, Rect, SoulRegionDiagnostic, SoulScoreBreakdown } from './types';
import { SOUL_GRID_SIZE as GRID, SOUL_SOURCE_SCALES, SOUL_TEMPLATE_SCALES, SOUL_SEARCH_OFFSETS, scaleSoulRegion } from './soul-geometry';
import { decideSoulCandidates, isSoulScoringPixel, prepareSoulImage, scoreSoulImages, soulComparisonCoverage,
  soulScoreRejectionReasons, SOUL_SCORE_THRESHOLDS, type PreparedSoulImage } from './soul-scoring';

interface TemplateVariant { scale: number; image: ImageData; prepared: PreparedSoulImage }
interface Template { asset: Asset; variants: TemplateVariant[] }
interface SourceCrop { scale: number; offsetX: number; offsetY: number; region: Rect; image: ImageData; prepared: PreparedSoulImage }
interface RankedTemplate {
  asset: Asset;
  crop: SourceCrop;
  variant: TemplateVariant;
  scores: SoulScoreBreakdown;
  rejectionReasons: string[];
}
const cached = new Map<string, Template>();
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const validRegion = (region: Rect) => [region.x, region.y, region.width, region.height].every(Number.isFinite)
  && region.width >= 4 && region.height >= 4;

function canvas(size: number) {
  const element = document.createElement('canvas');
  element.width = element.height = size;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器不支持 Canvas 图片读取');
  return { element, context };
}

async function loadTemplate(asset: Asset, version: string, signal: AbortSignal): Promise<Template> {
  const key = `${version}:${asset.avatar}`;
  const existing = cached.get(key);
  if (existing) return existing;
  const response = await fetch(assetRequestUrl(asset.avatar), { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
  if (!response.ok) throw new Error(`御魂图片读取失败：${asset.name}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const variants = SOUL_TEMPLATE_SCALES.map((fraction) => {
      const { context } = canvas(GRID);
      const size = Math.min(bitmap.width, bitmap.height) * fraction;
      context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, GRID, GRID);
      const image = context.getImageData(0, 0, GRID, GRID);
      return { scale: fraction, image, prepared: prepareSoulImage(image) };
    });
    const template = { asset, variants };
    cached.set(key, template);
    return template;
  } finally { bitmap.close(); }
}

export function createSoulDiagnostics(source: HTMLCanvasElement, regions: Rect[]): SoulRegionDiagnostic[] {
  return regions.map((region, index) => {
    let cropDataUrl: string | null = null;
    if (validRegion(region)) {
      const { element, context } = canvas(Math.ceil(Math.max(region.width, region.height)));
      element.width = Math.ceil(region.width);
      element.height = Math.ceil(region.height);
      context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, element.width, element.height);
      cropDataUrl = element.toDataURL('image/png');
    }
    return {
      slot: index + 1, region: { ...region }, cropDataUrl, candidates: [],
      matchStatus: validRegion(region) ? 'pending' : 'unavailable',
      reason: validRegion(region) ? null : '没有有效的御魂截图区域',
    };
  });
}

function comparisonPreview(image: ImageData, source: ImageData, template: ImageData): string {
  const { element, context } = canvas(GRID);
  const masked = context.createImageData(GRID, GRID);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const offset = (y * GRID + x) * 4;
    if (!isSoulScoringPixel(x, y, source.data[offset + 3]!, template.data[offset + 3]!)) continue;
    masked.data.set(image.data.subarray(offset, offset + 3), offset);
    masked.data[offset + 3] = 255;
  }
  context.putImageData(masked, 0, 0);
  return element.toDataURL('image/png');
}

async function sourceCrops(source: HTMLCanvasElement, region: Rect, signal: AbortSignal): Promise<SourceCrop[]> {
  const crops: SourceCrop[] = [];
  const { context } = canvas(GRID);
  let lastYield = performance.now();
  for (const y of SOUL_SEARCH_OFFSETS) for (const x of SOUL_SEARCH_OFFSETS) for (const scale of SOUL_SOURCE_SCALES) {
    signal.throwIfAborted();
    const offsetX = x * region.width, offsetY = y * region.height;
    const scaled = scaleSoulRegion(region, scale);
    const rectangle = { ...scaled, x: scaled.x + offsetX, y: scaled.y + offsetY };
    // Keep out-of-image pixels transparent, rather than stretching a clipped
    // crop or retaining pixels from the preceding search position.
    context.clearRect(0, 0, GRID, GRID);
    context.drawImage(source, rectangle.x, rectangle.y, rectangle.width, rectangle.height, 0, 0, GRID, GRID);
    const image = context.getImageData(0, 0, GRID, GRID);
    crops.push({ scale, offsetX, offsetY, region: rectangle, image, prepared: prepareSoulImage(image) });
    if (performance.now() - lastYield >= 12) { await yieldToUi(); lastYield = performance.now(); }
  }
  return crops;
}

function rankTemplate(template: Template, crops: SourceCrop[]): RankedTemplate {
  let best: RankedTemplate | null = null;
  for (const crop of crops) for (const variant of template.variants) {
    const scores = scoreSoulImages(crop.prepared, variant.prepared);
    const rejectionReasons = soulScoreRejectionReasons(scores);
    if (soulComparisonCoverage(crop.prepared, variant.prepared) < SOUL_SCORE_THRESHOLDS.coverage) {
      rejectionReasons.unshift('截图有效像素覆盖不足');
    }
    const current = { asset: template.asset, crop, variant, scores, rejectionReasons };
    const qualified = rejectionReasons.length === 0, bestQualified = best?.rejectionReasons.length === 0;
    if (!best || (qualified && !bestQualified) || (qualified === bestQualified && scores.total > best.scores.total)) best = current;
  }
  return best!;
}

export async function matchSouls(
  source: HTMLCanvasElement, regions: Rect[], assets: Asset[], version: string,
  signal: AbortSignal, onProgress: (done: number, total: number) => void,
): Promise<{ candidates: Candidate[][]; failed: number; diagnostics: SoulRegionDiagnostic[] }> {
  const templates: Template[] = [];
  const list = assets.filter((asset) => asset.name !== '散件');
  let next = 0, done = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, async () => {
    while (next < list.length) {
      signal.throwIfAborted();
      const asset = list[next++]!;
      try { templates.push(await loadTemplate(asset, version, signal)); }
      catch (error) { signal.throwIfAborted(); failed++; }
      onProgress(++done, list.length);
    }
  }));
  const candidates: Candidate[][] = [];
  const diagnostics = createSoulDiagnostics(source, regions);
  for (const [index, region] of regions.entries()) {
    signal.throwIfAborted();
    if (!validRegion(region)) { candidates.push([]); continue; }
    if (!templates.length) {
      candidates.push([]);
      diagnostics[index]!.matchStatus = 'unavailable';
      diagnostics[index]!.reason = '没有可用的 R2 御魂模板';
      continue;
    }
    // Crop and HSV features are prepared once per region, never per template.
    const crops = await sourceCrops(source, region, signal);
    const ranked: RankedTemplate[] = [];
    let lastYield = performance.now();
    for (const template of templates) {
      signal.throwIfAborted();
      ranked.push(rankTemplate(template, crops));
      if (performance.now() - lastYield >= 12) { await yieldToUi(); lastYield = performance.now(); }
    }
    ranked.sort((a, b) => Number(a.rejectionReasons.length > 0) - Number(b.rejectionReasons.length > 0) || b.scores.total - a.scores.total);
    const decision = decideSoulCandidates(ranked);
    candidates.push(decision.accepted.map(({ asset, scores }) => ({ catalogId: asset.id, name: asset.name, similarity: Number(scores.total.toFixed(4)) })));
    diagnostics[index]!.matchStatus = decision.status;
    diagnostics[index]!.reason = decision.reason;
    diagnostics[index]!.candidates = ranked.slice(0, 3).map(({ asset, crop, variant, scores, rejectionReasons }) => ({
      catalogId: asset.id, name: asset.name, similarity: Number(scores.total.toFixed(4)), avatar: asset.avatar,
      sourceScale: crop.scale, templateScale: variant.scale,
      sourceOffsetX: crop.offsetX, sourceOffsetY: crop.offsetY, sourceRegion: { ...crop.region }, scores, rejectionReasons,
      screenshotDataUrl: comparisonPreview(crop.image, crop.image, variant.image),
      templateDataUrl: comparisonPreview(variant.image, crop.image, variant.image),
    }));
    await yieldToUi();
  }
  return { candidates, failed, diagnostics };
}
