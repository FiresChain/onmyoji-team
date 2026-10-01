import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustSoulRegions, clampRegion } from '../src/soul-geometry';

test('original screenshot offsets remain correct after OCR resizing and rounding', () => {
  const originalImage = { width: 1073, height: 607 };
  const image = { width: 1800, height: 1018 };
  const baseline = [{ x: 500, y: 750, width: 78, height: 78 }];
  const adjustment = { offsetX: -5, offsetY: 2, scale: 1 };
  const [region] = adjustSoulRegions(baseline, adjustment, image, originalImage);
  assert.ok(Math.abs((region!.x - 500) * 1073 / 1800 + 5) < 1e-10);
  assert.ok(Math.abs((region!.y - 750) * 607 / 1018 - 2) < 1e-10);
  assert.ok(Math.abs(region!.width - 78) < 1e-10);
  assert.deepEqual(adjustSoulRegions(baseline, adjustment, image, originalImage), [region]);
  assert.deepEqual(baseline, [{ x: 500, y: 750, width: 78, height: 78 }]);
});

test('resizing keeps all five centers fixed and reset restores the automatic boxes', () => {
  const image = { width: 1000, height: 600 };
  const baseline = Array.from({ length: 5 }, (_, i) => ({ x: 200 + i * 130, y: 420, width: 40, height: 40 }));
  const enlarged = adjustSoulRegions(baseline, { offsetX: 0, offsetY: 0, scale: 1.2 }, image, image);
  enlarged.forEach((region, i) => {
    assert.equal(region.x + region.width / 2, baseline[i]!.x + 20);
    assert.equal(region.y + region.height / 2, 440);
    assert.equal(region.width, 48);
  });
  assert.deepEqual(adjustSoulRegions(baseline, { offsetX: 0, offsetY: 0, scale: 1 }, image, image), baseline);
});

test('edge-clipped and off-image regions never include pixels beyond the image', () => {
  const image = { width: 100, height: 100 };
  const clipped = clampRegion({ x: -10, y: 80, width: 40, height: 40 }, image);
  assert.deepEqual(clipped, { x: 0, y: 80, width: 30, height: 20 });
  assert.deepEqual(adjustSoulRegions([clipped], { offsetX: 0, offsetY: 0, scale: 1 }, image, image), [clipped]);
  assert.deepEqual(adjustSoulRegions([clipped], { offsetX: -20, offsetY: 20, scale: 1 }, image, image), [{ x: 0, y: 100, width: 10, height: 0 }]);
  assert.deepEqual(clampRegion({ x: 110, y: -50, width: 40, height: 40 }, image), { x: 100, y: 0, width: 0, height: 0 });
});

test('invalid adjustments fail before cropping an image', () => {
  const image = { width: 100, height: 100 };
  for (const adjustment of [
    { offsetX: NaN, offsetY: 0, scale: 1 }, { offsetX: 21, offsetY: 0, scale: 1 },
    { offsetX: 0, offsetY: 0, scale: 0 }, { offsetX: 0, offsetY: Infinity, scale: 1 },
  ]) assert.throws(() => adjustSoulRegions([], adjustment, image, image), /超出范围/);
  assert.throws(() => adjustSoulRegions([], { offsetX: 0, offsetY: 0, scale: 1 }, image, { width: 0, height: 100 }), /超出范围/);
});
