import { STATS, type Asset, type Catalog, type OcrLine, type ParsedTeam, type Rect, type TeamDraft } from './types';
import { clampRegion } from './soul-geometry';

export function bounds(line: OcrLine): Rect {
  const xs = line.poly.map((point) => point[0]);
  const ys = line.poly.map((point) => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
const center = (line: OcrLine) => { const box = bounds(line); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
const normalize = (text: string) => text.normalize('NFKC').replace(/[\s·:：,，。]/g, '');
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}

function matchName(text: string, entries: Asset[]) {
  const normalized = normalize(text);
  const namedEntries = entries.map((asset) => ({ asset, name: normalize(asset.name) })).filter(({ name }) => name);
  if (!normalized || !namedEntries.length) return { id: null, name: null, rawText: text || null, candidates: [] };
  const exact = namedEntries.find(({ name }) => name === normalized)?.asset;
  if (exact) return { id: exact.id, name: exact.name, rawText: text || null, candidates: [] };
  const ranked = namedEntries.map(({ asset, name }) => {
    const edits = distance(normalized, name);
    return { asset, edits, similarity: 1 - edits / Math.max(normalized.length, name.length) };
  }).sort((a, b) => b.similarity - a.similarity || a.edits - b.edits
    || (a.asset.name < b.asset.name ? -1 : a.asset.name > b.asset.name ? 1 : 0)
    || (a.asset.id < b.asset.id ? -1 : a.asset.id > b.asset.id ? 1 : 0));
  const best = ranked[0]!.asset;
  const candidates = ranked.slice(0, 3).map(({ asset, similarity }) => ({
    catalogId: asset.id, name: asset.name, similarity: Number(similarity.toFixed(3)),
  }));
  return { id: best.id, name: best.name, rawText: text || null, candidates };
}

interface NumberToken { x: number; y: number; value: number; percent: boolean; score: number; split: boolean }
function numericTokens(lines: OcrLine[]): NumberToken[] {
  return lines.flatMap((line) => {
    const text = line.text.normalize('NFKC').trim();
    if (!/^[\d\s.%％,，]+$/.test(text)) return [];
    const matches = [...text.matchAll(/\d+(?:[,.]\d+)?\s*%?/g)];
    const box = bounds(line);
    return matches.flatMap((match) => {
      // Commas are ambiguous (decimal separator versus thousands grouping).
      if (match[0].includes(',')) return [];
      const value = Number(match[0].replace(/[\s%]/g, ''));
      if (!Number.isFinite(value)) return [];
      return [{
        x: matches.length === 1 ? center(line).x : box.x + ((match.index + match[0].length / 2) / text.length) * box.width,
        y: center(line).y, value, percent: match[0].includes('%'), score: line.score, split: matches.length > 1,
      }];
    });
  });
}

export function parseTeam(lines: OcrLine[], catalog: Catalog | null, image: { width: number; height: number }): ParsedTeam {
  const draft: TeamDraft = {
    schemaVersion: 1, source: 'duel-quiz-screenshot', side: null,
    catalogVersion: catalog?.version ?? null, percentageUnit: 'percentage-points', members: [], warnings: [],
    unresolved: ['技能等级', '具体两件套', '2/4/6 号位主属性', '截图面板的取整规则'],
  };
  const empty = (): ParsedTeam => ({ draft, soulRegions: [], soulRegionSource: 'unavailable' });
  if (!catalog) draft.warnings.push('素材目录未加载：保留识别文字，式神 ID 与御魂匹配暂不可用。');
  // Find a vertically aligned label column rather than accepting similar text in the background.
  const labels = lines.flatMap((line) => {
    const index = STATS.findIndex(([, label]) => normalize(line.text) === label);
    return index < 0 ? [] : [{ line, index, ...center(line) }];
  });
  const group = labels.map((anchor) => labels.filter((label) => Math.abs(label.x - anchor.x) < Math.max(24, bounds(anchor.line).height * 1.8)))
    .sort((a, b) => new Set(b.map((item) => item.index)).size - new Set(a.map((item) => item.index)).size)[0] ?? [];
  const unique = [...new Map(group.sort((a, b) => a.line.score - b.line.score).map((item) => [item.index, item])).values()].sort((a, b) => a.index - b.index);
  if (unique.length < 4) {
    draft.warnings.push('未定位到完整属性表：至少需要识别出四种属性行标签。请粘贴清晰的阵容详情截图。');
    return empty();
  }
  const steps = unique.slice(1).map((item, i) => (item.y - unique[i]!.y) / (item.index - unique[i]!.index)).filter((step) => step > 5);
  const step = median(steps);
  const top = median(unique.map((item) => item.y - item.index * step));
  if (!step || unique.some((item) => Math.abs(item.y - (top + item.index * step)) > step * 0.55)) {
    draft.warnings.push('属性行位置不规则，无法可靠分配数值。请使用完整、未拼接的阵容详情截图。');
    return empty();
  }
  const left = Math.max(...unique.map((item) => bounds(item.line).x + bounds(item.line).width));
  const numbers = numericTokens(lines).filter((item) => item.x > left + step * 0.4 && item.y > top - step * 0.45 && item.y < top + step * 7.45);
  const clusters: NumberToken[][] = [];
  for (const token of [...numbers].sort((a, b) => a.x - b.x)) {
    const cluster = clusters.find((items) => Math.abs(median(items.map((item) => item.x)) - token.x) < step * 0.8);
    if (cluster) cluster.push(token); else clusters.push([token]);
  }
  const columns = clusters.filter((items) => new Set(items.map((item) => Math.round((item.y - top) / step))).size >= 3)
    .map((items) => median(items.map((item) => item.x))).sort((a, b) => a - b);
  if (columns.length !== 5) {
    draft.warnings.push(`识别到 ${columns.length} 列属性，预期为五列；为避免串列，暂不生成成员。请查看 OCR 原始结果或换用清晰截图。`);
    return empty();
  }
  const colWidth = median(columns.slice(1).map((x, i) => x - columns[i]!));
  if (columns.slice(1).some((x, i) => Math.abs(x - columns[i]! - colWidth) > colWidth * 0.3)) {
    draft.warnings.push('五列间距异常，暂不生成成员，避免数值归到错误式神。');
    return empty();
  }
  const side = lines.find((line) => ['红方', '蓝方'].includes(normalize(line.text)) && center(line).x < columns[0]! && Math.abs(center(line).y - (top - step)) < step * 2);
  draft.side = side ? normalize(side.text) === '红方' ? 'red' : 'blue' : null;
  if (unique.length < STATS.length) draft.warnings.push('部分属性行标签未识别，已按表格固定顺序定位，请核对这些行。');
  const soulLabel = lines.find((line) => normalize(line.text) === '御魂效果' && center(line).x < columns[0]! && center(line).y > top + step * 7.5);
  const soulY = soulLabel ? center(soulLabel).y : top + step * 8.4;
  if (!soulLabel) draft.warnings.push('御魂效果行未识别，图标位置为估算，请核对图片中的标记区域。');
  const size = Math.min(colWidth * 0.36, step * 1.5);
  const soulRegions = columns.map((x): Rect => clampRegion({ x: x - size / 2, y: soulY - size / 2, width: size, height: size }, image));
  draft.members = columns.map((x, index) => {
    const needsReview: string[] = [];
    const nameLines = lines.filter((line) => {
      const point = center(line);
      return Math.abs(point.x - x) < colWidth * 0.43 && point.y < top - step * 0.45 && point.y > top - step * 2.5 && /[\u3400-\u9fff]/.test(line.text);
    }).sort((a, b) => {
      const aExact = catalog?.shikigami.some((asset) => normalize(asset.name) === normalize(a.text)) ? 1 : 0;
      const bExact = catalog?.shikigami.some((asset) => normalize(asset.name) === normalize(b.text)) ? 1 : 0;
      return bExact - aExact || Math.abs(center(a).y - (top - step)) - Math.abs(center(b).y - (top - step));
    });
    const nameLine = nameLines[0];
    const shikigami = matchName(nameLine?.text ?? '', catalog?.shikigami ?? []);
    if (shikigami.candidates.length) needsReview.push(`式神名称模糊匹配为「${shikigami.name}」，请核对识别文字「${shikigami.rawText}」`);
    else if (!shikigami.id) needsReview.push('式神名称未识别或素材目录不可用');
    if (nameLine && nameLine.score < 0.85) needsReview.push('式神名称识别分数较低');
    const panel = Object.fromEntries(STATS.map(([key, label, percentage], row) => {
      const y = unique.find((item) => item.index === row)?.y ?? top + row * step;
      const matches = numbers.filter((item) => Math.abs(item.x - x) < colWidth * 0.4 && Math.abs(item.y - y) < step * 0.42);
      if (matches.length !== 1) { needsReview.push(`${label}${matches.length ? '有多个识别值' : '未识别'}`); return [key, null]; }
      const token = matches[0]!;
      if (!percentage && token.percent) { needsReview.push(`${label}包含异常百分号`); return [key, null]; }
      if (percentage && !token.percent) needsReview.push(`${label}未识别到百分号，按表格行单位解析`);
      if (token.score < 0.85 || token.split) needsReview.push(`${label}${token.split ? '来自合并文本框' : '识别分数较低'}`);
      return [key, token.value];
    })) as typeof draft.members[number]['panel'];
    return { slot: index + 1, shikigami, panel, yuhun: { catalogId: null, name: null, status: 'unavailable', candidates: [] }, needsReview };
  });
  return { draft, soulRegions, soulRegionSource: soulLabel ? 'label' : 'estimated' };
}
