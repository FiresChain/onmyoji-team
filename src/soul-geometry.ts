import type { Rect, SoulRegionAdjustment } from './types';

export const SOUL_GRID_SIZE = 24;
export const SOUL_MASK_RADIUS = 0.39;
export const SOUL_SOURCE_SCALES = [0.85, 1, 1.15] as const;
export const SOUL_TEMPLATE_SCALES = [1, 0.85, 0.7] as const;
export const SOUL_SEARCH_OFFSETS = [-0.12, -0.06, 0, 0.06, 0.12] as const;

export function clampRegion(region: Rect, image: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.min(image.width, region.x));
  const y = Math.max(0, Math.min(image.height, region.y));
  const right = Math.max(x, Math.min(image.width, region.x + region.width));
  const bottom = Math.max(y, Math.min(image.height, region.y + region.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function scaleSoulRegion(region: Rect, scale: number): Rect {
  const size = region.width * scale;
  return { x: region.x + (region.width - size) / 2, y: region.y + (region.height - size) / 2, width: size, height: size };
}

// Offsets use original screenshot pixels; OCR and matching use the resized canvas.
// Always start from the automatic regions so reapplying a value cannot accumulate drift.
export function adjustSoulRegions(
  baseline: Rect[], adjustment: SoulRegionAdjustment,
  image: { width: number; height: number }, originalImage: { width: number; height: number },
): Rect[] {
  const { offsetX, offsetY, scale } = adjustment;
  if (![offsetX, offsetY, scale].every(Number.isFinite)
    || Math.abs(offsetX) > 20 || Math.abs(offsetY) > 20 || scale < 0.7 || scale > 1.3
    || ![image.width, image.height, originalImage.width, originalImage.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('御魂区域调整超出范围');
  }
  return baseline.map((region) => {
    const width = region.width * scale;
    const height = region.height * scale;
    return clampRegion({
      width, height,
      x: region.x + (region.width - width) / 2 + offsetX * image.width / originalImage.width,
      y: region.y + (region.height - height) / 2 + offsetY * image.height / originalImage.height,
    }, image);
  });
}

export function isSoulComparisonPixel(x: number, y: number, templateAlpha: number): boolean {
  return templateAlpha >= 160 && Math.hypot(x + 0.5 - SOUL_GRID_SIZE / 2, y + 0.5 - SOUL_GRID_SIZE / 2) <= SOUL_GRID_SIZE * SOUL_MASK_RADIUS;
}
