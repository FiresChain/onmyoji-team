import assert from 'node:assert/strict';
import test from 'node:test';
import { SOUL_GRID_SIZE } from '../src/soul-geometry';
import { decideSoulCandidates, isSoulScoringPixel, prepareSoulImage, scoreSoulImages,
  soulComparisonCoverage, soulScoreRejectionReasons, type SoulPixelImage } from '../src/soul-scoring';

function image(pixel: (x: number, y: number) => readonly number[]): SoulPixelImage {
  const data = new Uint8ClampedArray(SOUL_GRID_SIZE * SOUL_GRID_SIZE * 4);
  for (let y = 0; y < SOUL_GRID_SIZE; y++) for (let x = 0; x < SOUL_GRID_SIZE; x++) {
    const channels = pixel(x, y), offset = (y * SOUL_GRID_SIZE + x) * 4;
    data.set([channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 255], offset);
  }
  return { width: SOUL_GRID_SIZE, height: SOUL_GRID_SIZE, data };
}
const prepare = (pixel: (x: number, y: number) => readonly number[]) => prepareSoulImage(image(pixel));
const brightness = (x: number, y: number) => 60 + (x * 5 + y * 3) % 160;

test('identical structured images pass, while the same gray structure in another hue is rejected', () => {
  const red = prepare((x, y) => [brightness(x, y), 0, 0]);
  const green = prepare((x, y) => [0, brightness(x, y) * .299 / .587, 0]);
  const same = scoreSoulImages(red, red), different = scoreSoulImages(red, green);
  assert.ok(same.total > .999 && same.structure > .999);
  assert.equal(decideSoulCandidates([{ scores: same }]).status, 'candidate');
  assert.ok(different.structure > .999, 'the negative case deliberately preserves luminance structure');
  assert.ok(different.color < .01);
  assert.equal(decideSoulCandidates([{ scores: different }]).status, 'unrecognized');
});

test('zero or negative gray correlation contributes zero rather than a half-score', () => {
  const horizontal = prepare((x) => [30 + x * 8, 30 + x * 8, 30 + x * 8]);
  const vertical = prepare((_, y) => [30 + y * 8, 30 + y * 8, 30 + y * 8]);
  const inverted = prepare((x) => [214 - x * 8, 214 - x * 8, 214 - x * 8]);
  for (const candidate of [vertical, inverted]) {
    const scores = scoreSoulImages(horizontal, candidate);
    assert.ok(scores.structure < 1e-10);
    assert.ok(scores.color > .999, 'the color distributions alone cannot rescue unrelated structure');
    assert.equal(decideSoulCandidates([{ scores }]).status, 'unrecognized');
  }
});

test('low-saturation neutrals preserve small tints and distinguish dark gray from white', () => {
  const gray = prepare((x, y) => { const v = brightness(x, y); return [v, v, v]; });
  const tint = prepare((x, y) => { const v = brightness(x, y); return [v, v + 1, v]; });
  const tintedScores = scoreSoulImages(gray, tint);
  assert.ok(tintedScores.color > .98 && tintedScores.total > .98);
  const dark = prepare(() => [45, 45, 45]), white = prepare(() => [220, 220, 220]);
  assert.ok(scoreSoulImages(dark, white).color < .01);
  const red = prepare((x, y) => [brightness(x, y), 0, 0]);
  assert.ok(scoreSoulImages(gray, red).color < .01, 'neutral pixels are separate from arbitrary hue bins');
});

test('nearby red hues across the hue wrap remain similar', () => {
  const left = prepare((x, y) => [brightness(x, y), 0, 3]);
  const right = prepare((x, y) => [brightness(x, y), 3, 0]);
  const scores = scoreSoulImages(left, right);
  assert.ok(scores.color > .95 && scores.total > .95);
});

test('flat and independent noise regions are not accepted as matching icons', () => {
  const blank = prepare(() => [173, 173, 173]);
  const blankScore = scoreSoulImages(blank, blank);
  assert.equal(blankScore.structure, 0);
  assert.equal(decideSoulCandidates([{ scores: blankScore }]).status, 'unrecognized');
  let state = 1;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state >>> 24; };
  const first = prepare(() => [random(), random(), random()]);
  const second = prepare(() => [random(), random(), random()]);
  const noiseScore = scoreSoulImages(first, second);
  assert.ok(noiseScore.structure < .35);
  assert.equal(decideSoulCandidates([{ scores: noiseScore }]).status, 'unrecognized');
});

test('transparent or off-image pixels cannot produce a high score from a small matching fragment', () => {
  const full = prepare((x, y) => { const v = brightness(x, y); return [v, v, v]; });
  const clipped = prepare((x, y) => { const v = brightness(x, y); return [v, v, v, x < 8 ? 0 : 255]; });
  const transparent = prepare(() => [0, 0, 0, 0]);
  assert.ok(soulComparisonCoverage(clipped, full) < .9);
  assert.equal(scoreSoulImages(clipped, full).total, 0);
  assert.equal(scoreSoulImages(transparent, full).total, 0);
  assert.equal(isSoulScoringPixel(12, 12, 0, 255), false);
  assert.equal(isSoulScoringPixel(12, 12, 255, 0), false);
  assert.equal(isSoulScoringPixel(0, 0, 255, 255), false);
});

test('ambiguous qualified candidates are refused and unavailable templates stay distinct', () => {
  const scores = { structure: .9, color: .9, pixel: .9, total: .9 };
  const close = { structure: .88, color: .88, pixel: .88, total: .88 };
  const decision = decideSoulCandidates([{ scores }, { scores: close }]);
  assert.equal(decision.status, 'unrecognized');
  assert.deepEqual(decision.accepted, []);
  assert.match(decision.reason!, /过于接近/);
  assert.equal(decideSoulCandidates([]).status, 'unavailable');
  assert.equal(decideSoulCandidates([{ scores, rejectionReasons: ['截图有效像素覆盖不足'] }]).status, 'unrecognized');
});

test('a numeric screenshot patch with moderate structure and matching background colors is refused', () => {
  // Recorded non-icon failure before tightening the total threshold; no asset ID
  // or name is involved in this acceptance decision.
  const scores = { structure: .42089, color: .83199, pixel: .69829, total: .64081 };
  assert.ok(soulScoreRejectionReasons(scores).includes('综合相似度不足'));
  const decision = decideSoulCandidates([{ scores }]);
  assert.equal(decision.status, 'unrecognized');
  assert.deepEqual(decision.accepted, []);
});
