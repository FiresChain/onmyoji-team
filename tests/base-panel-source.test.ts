import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  awakeForRarity, parseOfficialAttr, parseAwakening, splitPanel, compareReference, generate,
} from '../scripts/update-base-panels.mjs';

const raw = (overrides = {}) => ({ success: true, data: {
  attack: 3300, maxHp: 12000, defense: 480, speed: 120,
  critRate: .15, critPower: .5, debuffEnhance: .2, debuffResist: .3, ...overrides,
} });
const skill = (add: string) => ({ success: true, data: { add_type: 3, add: `属性增强:${add}` } });

test('rarity policy selects the official state and rejects new categories', () => {
  for (const rarity of ['SSR', 'SR', 'R', 'L']) assert.equal(awakeForRarity(rarity), 1);
  for (const rarity of ['SP', 'UR', 'N', 'G', '素材']) assert.equal(awakeForRarity(rarity), 0);
  assert.throws(() => awakeForRarity('NEW'), /Unknown rarity/);
});

test('fixed awakening bonus separates raw base from innate without compounding', () => {
  const official = parseOfficialAttr(raw(), 200);
  assert.equal(official.critDamage, 1.5);
  const attackBonus = parseAwakening(skill('攻击加成增加10%'), 200);
  const attackBase = splitPanel(official, attackBonus, 200);
  assert.ok(Math.abs(attackBase.attack - 3000) < 1e-9);
  assert.ok(Math.abs(attackBase.attack * (1 + attackBonus.attackPercent) - 3300) < 1e-9);
  assert.equal(attackBase.critDamage, 1.5);
  const speedBonus = parseAwakening(skill('速度增加20'), 202);
  assert.equal(splitPanel(official, speedBonus, 202).speed, 100);
  const resistBonus = parseAwakening(skill('效果抵抗增加30%'), 601);
  assert.equal(splitPanel(official, resistBonus, 601).effectResist, 0);
  assert.deepEqual(Object.keys(resistBonus).sort(), [
    'attackPercent', 'crit', 'critDamage', 'defensePercent', 'effectHit', 'effectResist', 'hpPercent', 'speed',
  ]);
});

test('official success flag is insufficient without valid data and known bonuses', () => {
  assert.throws(() => parseOfficialAttr(raw({ attack: null }), 200), /Invalid 200.attack/);
  assert.throws(() => parseOfficialAttr(raw({ debuffResist: Infinity }), 200), /Invalid 200.debuffResist/);
  assert.throws(() => parseAwakening(skill('神秘属性增加10%'), 200), /Unknown fixed awakening bonus/);
  assert.throws(() => parseAwakening(skill('速度增加10%'), 200), /Invalid awakening unit/);
  assert.deepEqual(parseAwakening(skill('吸血增加10%'), 254), {
    attackPercent: 0, hpPercent: 0, defensePercent: 0, speed: 0,
    crit: 0, critDamage: 0, effectHit: 0, effectResist: 0,
  });
  assert.throws(() => splitPanel(parseOfficialAttr(raw({ critRate: .05 }), 200),
    parseAwakening(skill('暴击增加10%'), 200), 200), /Invalid 200.base.crit/);
});

test('reference conflicts fail closed except the documented hero 362 discrepancy', () => {
  const row = { heroId: 362, base: { attack: 2680, hp: 10025.96, defense: 493.92, speed: 109, crit: .08, critDamage: 1.5 } };
  const old = { schemaVersion: 1, panels: [{ ...row, base: { ...row.base, attack: 3001.6, defense: 441 } }] };
  assert.deepEqual(compareReference([row], old), {
    referenceCount: 1, matchedCount: 0,
    mismatches: [{ heroId: 362, fields: ['attack', 'defense'] }],
  });
  assert.throws(() => compareReference([{ ...row, heroId: 361 }],
    { schemaVersion: 1, panels: [{ ...old.panels[0], heroId: 361 }] }), /Unexpected reference conflicts/);
});

test('generation leaves prior artifacts untouched when a source fails validation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onmyoji-panels-test-'));
  try {
    const awakeDir = join(directory, 'awake'), nativeDir = join(directory, 'native'), skillDir = join(directory, 'skills');
    await Promise.all([awakeDir, nativeDir, skillDir].map((path) => mkdir(path)));
    const catalog = join(directory, 'catalog.json'), output = join(directory, 'panels.json'), auditOutput = join(directory, 'audit.json');
    await writeFile(catalog, JSON.stringify([{ id: '200', rarity: 'SSR' }]));
    await writeFile(join(awakeDir, '200.json'), JSON.stringify(raw()));
    await writeFile(join(skillDir, '200.json'), JSON.stringify(skill('未知属性增加10%')));
    await writeFile(output, 'old panels');
    await writeFile(auditOutput, 'old audit');
    await writeFile(catalog, '[]');
    await assert.rejects(generate({ catalog, awakeDir, nativeDir, skillDir, output, auditOutput, fetch: false, reference: null }),
      /nonempty array/);
    await writeFile(catalog, JSON.stringify([{ id: '200', rarity: 'SSR' }]));
    await assert.rejects(generate({ catalog, awakeDir, nativeDir, skillDir, output, auditOutput, fetch: false, reference: null }),
      /Unknown fixed awakening bonus/);
    assert.equal(await readFile(output, 'utf8'), 'old panels');
    assert.equal(await readFile(auditOutput, 'utf8'), 'old audit');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
