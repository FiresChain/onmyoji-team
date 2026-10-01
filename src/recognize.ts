import { loadCatalog } from './catalog';
import { readImage } from './ocr';
import { parseTeam } from './parse-team';
import { createSoulDiagnostics, matchSouls } from './soul-matcher';
import { adjustSoulRegions } from './soul-geometry';
import type { Catalog, RecognitionResult, SoulRegionAdjustment } from './types';

type Update = (message: string) => void;
type Preview = (result: RecognitionResult) => void;
const pendingReview = '御魂尚未完成匹配';
const candidateReview = '御魂仅提供相似度候选，尚未确认';
const unavailableReview = '御魂模板不可用';
const unrecognizedReview = '御魂未识别';
const matchReviews = new Set([pendingReview, candidateReview, unavailableReview]);
const isMatchReview = (text: string) => matchReviews.has(text) || text.startsWith(`${unrecognizedReview}：`) || text.startsWith('御魂匹配未完成：');
const isMatchWarning = (warning: string) => /^\d+ 张 R2 御魂图片读取失败/.test(warning);

async function prepareImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const originalImage = { width: bitmap.width, height: bitmap.height };
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(2, 1800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持图片处理');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); }
  return { canvas, originalImage };
}

async function withSoulMatches(
  source: RecognitionResult, canvas: HTMLCanvasElement, catalog: Catalog | null,
  signal: AbortSignal, update: Update,
): Promise<RecognitionResult> {
  if (!source.soulRegions.length) return source;
  if (!catalog) return {
    ...source,
    soulDiagnostics: source.soulDiagnostics.map((entry) => ({ ...entry, matchStatus: 'unavailable', reason: 'R2 素材目录未加载，无法比较御魂图片。' })),
  };
  update('正在读取 R2 御魂图片…');
  const matches = await matchSouls(canvas, source.soulRegions, catalog.yuhun, catalog.version, signal,
    (done, total) => update(`正在加载御魂模板 ${done} / ${total}…`));
  signal.throwIfAborted();
  return {
    ...source,
    soulDiagnostics: matches.diagnostics,
    draft: {
      ...source.draft,
      warnings: [...source.draft.warnings.filter((warning) => !isMatchWarning(warning)),
        ...(matches.failed ? [`${matches.failed} 张 R2 御魂图片读取失败，候选库不完整。`] : [])],
      members: source.draft.members.map((member, i) => {
        const candidates = matches.candidates[i] ?? [];
        const diagnostic = matches.diagnostics[i];
        const matchStatus = diagnostic?.matchStatus === 'unrecognized' ? 'unrecognized' : candidates.length ? 'candidate' : 'unavailable';
        const review = matchStatus === 'candidate' ? candidateReview : matchStatus === 'unrecognized'
          ? `${unrecognizedReview}：${diagnostic?.reason ?? '匹配分数不足，请核对区域'}` : unavailableReview;
        return {
          ...member,
          yuhun: { catalogId: null, name: null, status: matchStatus, candidates },
          needsReview: [...member.needsReview.filter((text) => !isMatchReview(text)), review],
        };
      }),
    },
  };
}

export async function recognize(blob: Blob, signal: AbortSignal, update: Update, preview?: Preview): Promise<RecognitionResult> {
  const started = performance.now();
  const { canvas, originalImage } = await prepareImage(blob);
  signal.throwIfAborted();
  let catalog: Catalog | null = null;
  let catalogError: string | null = null;
  const catalogTask = loadCatalog().then((value) => { catalog = value; }).catch((error: unknown) => { catalogError = error instanceof Error ? error.message : '素材目录加载失败'; });
  const raw = await readImage(canvas, signal, update);
  update('正在整理表格并加载 R2 素材目录…');
  await catalogTask;
  signal.throwIfAborted();
  const items = raw.items.filter((item) => item.poly.length >= 4 && item.poly.every((point) => point.every(Number.isFinite)));
  const parsed = parseTeam(items, catalog, raw.image);
  if (catalogError) parsed.draft.warnings.push(catalogError);
  for (const member of parsed.draft.members) member.needsReview.push(catalog ? pendingReview : unavailableReview);
  const initial: RecognitionResult = {
    draft: parsed.draft, soulRegions: parsed.soulRegions,
    soulRegionBaseline: parsed.soulRegions.map((region) => ({ ...region })),
    soulAdjustment: { offsetX: 0, offsetY: 0, scale: 1 },
    soulRegionSource: parsed.soulRegionSource,
    soulDiagnostics: createSoulDiagnostics(canvas, parsed.soulRegions),
    raw: { image: raw.image, originalImage, items, elapsedMs: Math.round(performance.now() - started) },
  };
  preview?.(initial);
  const result = await withSoulMatches(initial, canvas, catalog, signal, update);
  return { ...result, raw: { ...result.raw, elapsedMs: Math.round(performance.now() - started) } };
}

export async function rematchSouls(
  blob: Blob, previous: RecognitionResult, adjustment: SoulRegionAdjustment,
  signal: AbortSignal, update: Update, preview?: Preview,
): Promise<RecognitionResult> {
  const { canvas } = await prepareImage(blob);
  signal.throwIfAborted();
  const soulRegions = adjustSoulRegions(previous.soulRegionBaseline, adjustment, previous.raw.image, previous.raw.originalImage);
  const initial: RecognitionResult = {
    ...previous, soulRegions, soulAdjustment: { ...adjustment },
    soulDiagnostics: createSoulDiagnostics(canvas, soulRegions),
    draft: {
      ...previous.draft,
      warnings: previous.draft.warnings.filter((warning) => !isMatchWarning(warning)),
      members: previous.draft.members.map((member) => ({
        ...member,
        yuhun: { catalogId: null, name: null, status: 'unavailable', candidates: [] },
        needsReview: [...member.needsReview.filter((text) => !isMatchReview(text)), pendingReview],
      })),
    },
  };
  preview?.(initial);
  update('正在重新匹配御魂，已保留文字与数字结果…');
  const catalog = await loadCatalog();
  signal.throwIfAborted();
  return withSoulMatches(initial, canvas, catalog, signal, update);
}
