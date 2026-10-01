import { SOUL_GRID_SIZE, isSoulComparisonPixel } from './soul-geometry';
import type { SoulScoreBreakdown } from './types';

export const SOUL_SCORE_WEIGHTS = { structure: 0.4, color: 0.4, pixel: 0.2 } as const;
export const SOUL_SCORE_THRESHOLDS = {
  total: 0.70, structure: 0.35, color: 0.50, margin: 0.035,
  coverage: 0.90, minimumPixels: 50, minimumGrayStdDev: 2, pixelErrorScale: 128,
} as const;

const HUE_BINS = 12, SATURATION_BINS = 3, VALUE_BINS = 3, NEUTRAL_BINS = 5;
const CHROMATIC_BINS = HUE_BINS * SATURATION_BINS * VALUE_BINS;
const HISTOGRAM_SIZE = CHROMATIC_BINS + NEUTRAL_BINS;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ZERO_SCORE: SoulScoreBreakdown = { structure: 0, color: 0, pixel: 0, total: 0 };
const CIRCLE_INDICES = Array.from({ length: SOUL_GRID_SIZE * SOUL_GRID_SIZE }, (_, index) => index)
  .filter((index) => isSoulComparisonPixel(index % SOUL_GRID_SIZE, Math.floor(index / SOUL_GRID_SIZE), 255));

export interface SoulPixelImage { width: number; height: number; data: ArrayLike<number> }
interface HistogramVote { indices: number[]; weights: number[] }
export interface PreparedSoulImage {
  readonly data: ArrayLike<number>;
  readonly gray: Float64Array;
  readonly valid: Uint8Array;
  readonly votes: readonly HistogramVote[];
  readonly validIndices: readonly number[];
  readonly histogram: Float64Array;
  readonly graySum: number;
  readonly graySumSquares: number;
}

// The diagnostic images use exactly the same joint mask as the scorer.
export function isSoulScoringPixel(x: number, y: number, sourceAlpha: number, templateAlpha: number): boolean {
  return sourceAlpha >= 160 && isSoulComparisonPixel(x, y, templateAlpha);
}

function linearVotes(value: number, bins: number): [number, number][] {
  const position = clamp(value) * (bins - 1);
  const left = Math.floor(position), fraction = position - left;
  return fraction > 0 ? [[left, 1 - fraction], [left + 1, fraction]] : [[left, 1]];
}

function hsvVotes(red: number, green: number, blue: number): HistogramVote {
  const r = red / 255, g = green / 255, b = blue / 255;
  const value = Math.max(r, g, b), minimum = Math.min(r, g, b), delta = value - minimum;
  const saturation = value ? delta / value : 0;
  let hue = 0;
  if (delta) {
    const sector = value === r ? (g - b) / delta : value === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = ((sector / 6) % 1 + 1) % 1;
  }
  const indices: number[] = [], weights: number[] = [];
  // Dark, gray and white pixels have separate value bins. Their unstable hue
  // gradually gains weight between saturation .10 and .25, rather than
  // assigning every neutral pixel to the red hue bin.
  const chromaticWeight = clamp((saturation - 0.10) / 0.15);
  if (chromaticWeight < 1) {
    for (const [bin, weight] of linearVotes(value, NEUTRAL_BINS)) {
      indices.push(CHROMATIC_BINS + bin); weights.push(weight * (1 - chromaticWeight));
    }
  }
  if (chromaticWeight > 0) {
    const position = hue * HUE_BINS, left = Math.floor(position), fraction = position - left;
    const hues: [number, number][] = [[left % HUE_BINS, 1 - fraction], [(left + 1) % HUE_BINS, fraction]];
    for (const [h, hw] of hues) for (const [s, sw] of linearVotes(saturation, SATURATION_BINS)) {
      for (const [v, vw] of linearVotes(value, VALUE_BINS)) {
        if (hw * sw * vw === 0) continue;
        indices.push((h * SATURATION_BINS + s) * VALUE_BINS + v);
        weights.push(chromaticWeight * hw * sw * vw);
      }
    }
  }
  return { indices, weights };
}

function addVotes(histogram: Float64Array, votes: HistogramVote) {
  for (let i = 0; i < votes.indices.length; i++) histogram[votes.indices[i]!]! += votes.weights[i]!;
}

export function prepareSoulImage(image: SoulPixelImage): PreparedSoulImage {
  if (image.width !== SOUL_GRID_SIZE || image.height !== SOUL_GRID_SIZE
    || image.data.length !== SOUL_GRID_SIZE * SOUL_GRID_SIZE * 4) throw new Error('御魂比较图必须为 24 × 24 RGBA');
  const gray = new Float64Array(SOUL_GRID_SIZE * SOUL_GRID_SIZE);
  const valid = new Uint8Array(gray.length), histogram = new Float64Array(HISTOGRAM_SIZE);
  const votes: HistogramVote[] = Array.from({ length: gray.length }, () => ({ indices: [], weights: [] }));
  const validIndices: number[] = [];
  let graySum = 0, graySumSquares = 0;
  for (const index of CIRCLE_INDICES) {
    const offset = index * 4;
    if (!isSoulScoringPixel(index % SOUL_GRID_SIZE, Math.floor(index / SOUL_GRID_SIZE), image.data[offset + 3]!, 255)) continue;
    const r = image.data[offset]!, g = image.data[offset + 1]!, b = image.data[offset + 2]!;
    const lightness = r * 0.299 + g * 0.587 + b * 0.114;
    valid[index] = 1; validIndices.push(index); gray[index] = lightness;
    graySum += lightness; graySumSquares += lightness * lightness;
    votes[index] = hsvVotes(r, g, b); addVotes(histogram, votes[index]!);
  }
  return { data: image.data, gray, valid, votes, validIndices, histogram, graySum, graySumSquares };
}

function histogramSimilarity(a: Float64Array, b: Float64Array, count: number): number {
  let coefficient = 0;
  for (let i = 0; i < a.length; i++) coefficient += Math.sqrt(a[i]! * b[i]!);
  return clamp(coefficient / count);
}

export function soulComparisonCoverage(source: PreparedSoulImage, template: PreparedSoulImage): number {
  if (!template.validIndices.length) return 0;
  let count = 0;
  for (const index of template.validIndices) count += source.valid[index]!;
  return count / template.validIndices.length;
}

export function scoreSoulImages(source: PreparedSoulImage, template: PreparedSoulImage): SoulScoreBreakdown {
  const complete = source.validIndices.length === CIRCLE_INDICES.length && template.validIndices.length === CIRCLE_INDICES.length;
  const sourceHistogram = complete ? source.histogram : new Float64Array(HISTOGRAM_SIZE);
  const templateHistogram = complete ? template.histogram : new Float64Array(HISTOGRAM_SIZE);
  let count = 0, sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0, error = 0;
  for (const index of template.validIndices) {
    if (!source.valid[index]) continue;
    const a = source.gray[index]!, b = template.gray[index]!, offset = index * 4;
    count++; sumAB += a * b;
    for (let channel = 0; channel < 3; channel++) error += Math.abs(source.data[offset + channel]! - template.data[offset + channel]!);
    if (!complete) {
      sumA += a; sumB += b; sumAA += a * a; sumBB += b * b;
      addVotes(sourceHistogram, source.votes[index]!); addVotes(templateHistogram, template.votes[index]!);
    }
  }
  if (count < SOUL_SCORE_THRESHOLDS.minimumPixels || count / template.validIndices.length < SOUL_SCORE_THRESHOLDS.coverage) return { ...ZERO_SCORE };
  if (complete) {
    sumA = source.graySum; sumB = template.graySum;
    sumAA = source.graySumSquares; sumBB = template.graySumSquares;
  }
  const varianceA = Math.max(0, sumAA - sumA * sumA / count), varianceB = Math.max(0, sumBB - sumB * sumB / count);
  const minimumVariance = count * SOUL_SCORE_THRESHOLDS.minimumGrayStdDev ** 2;
  const denominator = Math.sqrt(varianceA * varianceB);
  // Nearly flat patches have no useful structure. This also avoids treating
  // floating-point cancellation in a constant patch as positive correlation.
  const structure = varianceA >= minimumVariance && varianceB >= minimumVariance
    ? clamp((sumAB - sumA * sumB / count) / denominator) : 0;
  const color = histogramSimilarity(sourceHistogram, templateHistogram, count);
  const pixel = clamp(1 - error / (count * 3 * SOUL_SCORE_THRESHOLDS.pixelErrorScale));
  const total = structure * SOUL_SCORE_WEIGHTS.structure + color * SOUL_SCORE_WEIGHTS.color + pixel * SOUL_SCORE_WEIGHTS.pixel;
  return { structure, color, pixel, total };
}

export function soulScoreRejectionReasons(scores: SoulScoreBreakdown): string[] {
  const reasons: string[] = [];
  if (![scores.structure, scores.color, scores.pixel, scores.total].every(Number.isFinite)) return ['匹配分数无效'];
  if (scores.structure < SOUL_SCORE_THRESHOLDS.structure) reasons.push('灰度结构相似度不足');
  if (scores.color < SOUL_SCORE_THRESHOLDS.color) reasons.push('颜色分布相似度不足');
  if (scores.total < SOUL_SCORE_THRESHOLDS.total) reasons.push('综合相似度不足');
  return reasons;
}

export interface SoulCandidateDecision<T> {
  status: 'candidate' | 'unrecognized' | 'unavailable';
  accepted: T[];
  reason: string | null;
}

export function decideSoulCandidates<T extends { scores: SoulScoreBreakdown; rejectionReasons?: readonly string[] }>(ranked: readonly T[]): SoulCandidateDecision<T> {
  if (!ranked.length) return { status: 'unavailable', accepted: [], reason: '没有可用的御魂模板' };
  const qualified = ranked.filter((candidate) => !candidate.rejectionReasons?.length && !soulScoreRejectionReasons(candidate.scores).length)
    .sort((a, b) => b.scores.total - a.scores.total);
  if (!qualified.length) return { status: 'unrecognized', accepted: [], reason: '没有候选通过结构、颜色和综合分数要求' };
  if (qualified[1] && qualified[0]!.scores.total - qualified[1].scores.total < SOUL_SCORE_THRESHOLDS.margin) {
    return { status: 'unrecognized', accepted: [], reason: '前两名合格候选过于接近，暂不选择御魂' };
  }
  return { status: 'candidate', accepted: qualified.slice(0, 3), reason: null };
}
