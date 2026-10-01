import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTeam } from '../src/parse-team';
import type { Catalog, OcrLine } from '../src/types';

const line = (text: string, x: number, y: number, width = 50): OcrLine => ({
  text, score: 0.99, poly: [[x - width / 2, y - 7], [x + width / 2, y - 7], [x + width / 2, y + 7], [x - width / 2, y + 7]],
});
const names = ['跳跳哥哥', '惠比寿', '化鲸', '千姬', '神堕八岐大蛇'];
const catalog: Catalog = {
  version: 'test', yuhun: [], shikigami: names.map((name, i) => ({ id: String(200 + i), name, avatar: `/test/${i}.png` })),
};
const rowNames = ['攻击', '生命', '防御', '速度', '暴击', '暴击伤害', '效果命中', '效果抵抗'];
const values = [
  ['5100', '3600', '4500', '3400', '5800'],
  ['23000', '21000', '18000', '15000', '15000'],
  ['790', '750', '680', '510', '600'],
  ['185', '149', '129', '121', '118'],
  ['40%', '25%', '25%', '23%', '55%'],
  ['150%', '206%', '227%', '227%', '220%'],
  ['66%', '0%', '0%', '0%', '0%'],
  ['80%', '88%', '63%', '24%', '56%'],
];
function fixture(): OcrLine[] {
  return [line('红方', 100, 70), ...names.map((name, i) => line(name, 220 + 130 * i, 70)),
    ...rowNames.flatMap((name, row) => [line(name, 100, 100 + 30 * row), ...values[row]!.map((value, col) => line(value, 220 + 130 * col, 100 + 30 * row))]),
    line('御魂效果', 100, 352), line('活动奖励', 30, 560), line('999999', 800, 590)];
}
const image = { width: 1000, height: 650 };

test('extracts five columns with zero values and percent points; ignores background text', () => {
  const { draft, soulRegions, soulRegionSource } = parseTeam(fixture(), catalog, image);
  assert.equal(draft.members.length, 5);
  assert.equal(draft.side, 'red');
  assert.equal(draft.members[0]!.shikigami.name, '跳跳哥哥');
  assert.equal(draft.members[4]!.panel.speed, 118);
  assert.equal(draft.members[1]!.panel.effectHit, 0);
  assert.equal(draft.members[2]!.panel.critDamage, 227);
  assert.equal(draft.percentageUnit, 'percentage-points');
  assert.equal(soulRegions.length, 5);
  assert.equal(soulRegionSource, 'label');
  assert.equal(soulRegions[0]!.y + soulRegions[0]!.height / 2, 352);
  assert.equal(draft.members[0]!.yuhun.catalogId, null);
});

test('reports estimated icon positioning when the yuhun row label is missing', () => {
  const parsed = parseTeam(fixture().filter((item) => item.text !== '御魂效果'), catalog, image);
  assert.equal(parsed.soulRegionSource, 'estimated');
  assert.equal(parsed.soulRegions.length, 5);
  assert.ok(parsed.draft.warnings.some((warning) => warning.includes('图标位置为估算')));
  assert.equal(parseTeam([], catalog, image).soulRegionSource, 'unavailable');
});

test('does not shift later columns or invent zeros when a numeric cell is missing', () => {
  const lines = fixture().filter((item) => !(item.text === '149'));
  const { draft } = parseTeam(lines, catalog, image);
  assert.equal(draft.members[1]!.panel.speed, null);
  assert.equal(draft.members[2]!.panel.speed, 129);
  assert.ok(draft.members[1]!.needsReview.includes('速度未识别'));
});

test('rejects incomplete column layouts instead of assigning members to the wrong slots', () => {
  const lines = fixture().filter((item) => Math.abs(item.poly[0]![0] + 25 - 480) > 20);
  const { draft } = parseTeam(lines, catalog, image);
  assert.equal(draft.members.length, 0);
  assert.ok(draft.warnings.some((text) => text.includes('四') || text.includes('4 列')));
});

test('fills a one-character OCR mistake from the catalog and flags it for review', () => {
  const lines = fixture().map((item) => item.text === '跳跳哥哥' ? { ...item, text: '跳跳哥各' } : item);
  const { draft } = parseTeam(lines, catalog, image);
  assert.equal(draft.members[0]!.shikigami.id, '200');
  assert.equal(draft.members[0]!.shikigami.name, '跳跳哥哥');
  assert.equal(draft.members[0]!.shikigami.rawText, '跳跳哥各');
  assert.equal(draft.members[0]!.shikigami.candidates[0]!.name, '跳跳哥哥');
  assert.ok(draft.members[0]!.needsReview.some((warning) => warning.includes('模糊匹配') && warning.includes('请核对')));
});

test('matches a six-character catalog name when OCR drops one character; exact names still win', () => {
  const lines = fixture().map((item) => item.text === '神堕八岐大蛇' ? { ...item, text: '神堕八岐蛇' } : item);
  const { draft } = parseTeam(lines, catalog, image);
  assert.equal(draft.members[4]!.shikigami.id, '204');
  assert.equal(draft.members[4]!.shikigami.name, '神堕八岐大蛇');
  assert.equal(draft.members[4]!.shikigami.rawText, '神堕八岐蛇');
  assert.ok(draft.members[4]!.needsReview.some((warning) => warning.includes('模糊匹配')));

  const withExact: Catalog = { ...catalog, shikigami: [
    { id: '999', name: '神堕八岐蛇', avatar: '/test/exact.png' }, ...catalog.shikigami,
  ] };
  const exact = parseTeam(lines, withExact, image).draft.members[4]!;
  assert.equal(exact.shikigami.id, '999');
  assert.equal(exact.shikigami.name, '神堕八岐蛇');
  assert.deepEqual(exact.shikigami.candidates, []);
  assert.ok(!exact.needsReview.some((warning) => warning.includes('模糊匹配')));
});

test('chooses the same closest name for tied similarities regardless of catalog order', () => {
  const lines = fixture().map((item) => item.text === '化鲸' ? { ...item, text: '化鱼' } : item);
  const tied: Catalog = { ...catalog, shikigami: [
    { id: 'a', name: '化牛', avatar: '/test/a.png' },
    { id: 'b', name: '化马', avatar: '/test/b.png' },
  ] };
  const forward = parseTeam(lines, tied, image).draft.members[2]!.shikigami;
  const reversed = parseTeam(lines, { ...tied, shikigami: [...tied.shikigami].reverse() }, image).draft.members[2]!.shikigami;
  assert.deepEqual(forward, reversed);
  assert.equal(forward.name, '化牛');
});

test('does not invent a shikigami when OCR finds no name or the catalog is empty', () => {
  const noName = parseTeam(fixture().filter((item) => item.text !== '跳跳哥哥'), catalog, image).draft.members[0]!;
  assert.deepEqual(noName.shikigami, { id: null, name: null, rawText: null, candidates: [] });
  assert.ok(noName.needsReview.some((warning) => warning.includes('未识别')));

  const noCatalog = parseTeam(fixture(), { ...catalog, shikigami: [] }, image).draft.members[0]!;
  assert.equal(noCatalog.shikigami.id, null);
  assert.equal(noCatalog.shikigami.name, null);
  assert.equal(noCatalog.shikigami.rawText, '跳跳哥哥');
  assert.deepEqual(noCatalog.shikigami.candidates, []);

  const unnamedCatalog = parseTeam(fixture(), { ...catalog, shikigami: [{ id: '0', name: '', avatar: '' }] }, image).draft.members[0]!;
  assert.equal(unnamedCatalog.shikigami.id, null);
  assert.equal(unnamedCatalog.shikigami.name, null);
});

test('extracts the same panels from translated, scaled and shuffled OCR boxes', () => {
  const original = parseTeam(fixture(), catalog, image);
  const transformed = fixture().reverse().map((item) => ({ ...item, poly: item.poly.map(([x, y]): [number, number] => [x * 1.8 + 90, y * 1.8 + 40]) }));
  const actual = parseTeam(transformed, catalog, { width: 2000, height: 1300 });
  assert.deepEqual(actual.draft.members.map((member) => member.panel), original.draft.members.map((member) => member.panel));
});

test('keeps OCR data usable when R2 is unavailable and rejects unrelated images', () => {
  const { draft } = parseTeam(fixture(), null, image);
  assert.equal(draft.members.length, 5);
  assert.equal(draft.members[0]!.shikigami.rawText, '跳跳哥哥');
  assert.equal(draft.members[0]!.shikigami.id, null);
  assert.ok(draft.warnings.length > 0);
  assert.equal(parseTeam([line('hello', 100, 100)], catalog, image).draft.members.length, 0);
});

test('marks ambiguous numeric cells for review instead of picking one result', () => {
  const { draft } = parseTeam([...fixture(), line('198', 220, 190)], catalog, image);
  assert.equal(draft.members[0]!.panel.speed, null);
  assert.ok(draft.members[0]!.needsReview.includes('速度有多个识别值'));
});
