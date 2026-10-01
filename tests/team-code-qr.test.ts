import assert from 'node:assert/strict';
import test from 'node:test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { teamCodeQrDataUrl } from '../src/team-code-qr';

test('downloaded QR PNG scans back to exactly the full API team code', async () => {
  const teamCode = '#TA#' + 'eJxAbcDEFGH0123456789+/'.repeat(25) + '==';
  const url = await teamCodeQrDataUrl(teamCode);
  assert.ok(url.startsWith('data:image/png;base64,'));
  const png = PNG.sync.read(Buffer.from(url.split(',')[1]!, 'base64'));
  const scanned = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(scanned?.data, teamCode);
  assert.equal(png.width, png.height);
  // A four-module quiet zone remains white at the image edge.
  assert.ok(png.data.subarray(0, png.width * 4).every((value) => value === 255));
});

test('rejects JSON, image URLs and codes exceeding a single QR capacity', async () => {
  await assert.rejects(teamCodeQrDataUrl('{"teamCode":"#TA#YQ=="}'), /有效阵容码/);
  await assert.rejects(teamCodeQrDataUrl('data:image/png;base64,AAA'), /有效阵容码/);
  await assert.rejects(teamCodeQrDataUrl('#TA#' + 'a'.repeat(10000)), /过长/);
});
