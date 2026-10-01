#!/usr/bin/env node
import { readFile, writeFile, rename, unlink, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTS = {
  catalog: resolve(projectRoot, '../onmyoji-data/catalogs/shikigami.json'),
  awakeDir: '/private/tmp/onmyoji-official-panels',
  nativeDir: '/private/tmp/onmyoji-official-panels-native',
  skillDir: '/private/tmp/onmyoji-official-awake-skills',
  output: resolve(projectRoot, 'src/data/shikigami-base-panels.json'),
  auditOutput: resolve(projectRoot, 'src/data/shikigami-base-panels-audit.json'),
};
const ATTR_URL = 'https://g37simulator.webapp.163.com/get_hero_attr';
const SKILL_URL = 'https://g37simulator.webapp.163.com/get_hero_skill';
const AWAKENED = new Set(['SSR', 'SR', 'R', 'L']);
const NATIVE = new Set(['SP', 'UR', 'N', 'G', '素材']);
const STATS = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'effectHit', 'effectResist'];
const SOURCE_STATS = ['attack', 'maxHp', 'defense', 'speed', 'critRate', 'critPower', 'debuffEnhance', 'debuffResist'];
const INNATE_STATS = ['attackPercent', 'hpPercent', 'defensePercent', 'speed', 'crit', 'critDamage', 'effectHit', 'effectResist'];
const KNOWN_UNSUPPORTED = new Map([[362, '官网面板与多份六星40级无御魂实例的攻击、防御基础值不一致，来源差异待核验']]);
const IGNORED_AWAKENING = new Set([
  '吸血增加10%', '伤害加成增加10%', '伤害减免增加10%', '忽略防御增加100',
]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(value, label, { positive = false } = {}) {
  assert(typeof value === 'number' && Number.isFinite(value) && (positive ? value > 0 : value >= 0), `Invalid ${label}: ${String(value)}`);
  return value;
}
export function awakeForRarity(rarity) {
  if (AWAKENED.has(rarity)) return 1;
  if (NATIVE.has(rarity)) return 0;
  throw new Error(`Unknown rarity ${String(rarity)}; update awakening policy before regenerating`);
}
export function parseOfficialAttr(response, heroId) {
  assert(response?.success === true && response.data && typeof response.data === 'object' && !Array.isArray(response.data), `Invalid official attributes for ${heroId}`);
  const data = response.data;
  for (const key of SOURCE_STATS) finite(data[key], `${heroId}.${key}`, { positive: ['attack', 'maxHp', 'defense', 'speed'].includes(key) });
  return {
    attack: data.attack, hp: data.maxHp, defense: data.defense, speed: data.speed,
    crit: data.critRate, critDamage: 1 + data.critPower,
    effectHit: data.debuffEnhance, effectResist: data.debuffResist,
  };
}
export function parseAwakening(response, heroId) {
  assert(response?.success === true && response.data && typeof response.data === 'object' && !Array.isArray(response.data), `Invalid official skill for ${heroId}`);
  const { add_type: type, add } = response.data;
  assert([1, 2, 3].includes(type), `Unknown awakening type ${String(type)} for ${heroId}`);
  const innate = Object.fromEntries(INNATE_STATS.map((key) => [key, 0]));
  if (type !== 3) return innate;
  assert(typeof add === 'string', `Missing fixed awakening bonus for ${heroId}`);
  const description = add.trim().replace(/^属性增强[:：]/, '').trim();
  if (IGNORED_AWAKENING.has(description)) return innate;
  const match = /^(攻击加成|生命加成|防御加成|暴击|暴击伤害|效果命中|效果抵抗|速度)增加(\d+(?:\.\d+)?)(%)?$/.exec(description);
  assert(match, `Unknown fixed awakening bonus for ${heroId}: ${description}`);
  const [, label, digits, percent] = match;
  const value = Number(digits);
  finite(value, `${heroId}.awakeningBonus`, { positive: true });
  const stat = {
    攻击加成: 'attackPercent', 生命加成: 'hpPercent', 防御加成: 'defensePercent',
    暴击: 'crit', 暴击伤害: 'critDamage', 效果命中: 'effectHit', 效果抵抗: 'effectResist', 速度: 'speed',
  }[label];
  assert((stat === 'speed') === (percent === undefined), `Invalid awakening unit for ${heroId}: ${description}`);
  innate[stat] = stat === 'speed' ? value : value / 100;
  return innate;
}
export function splitPanel(official, innate, heroId) {
  const base = {
    attack: official.attack / (1 + innate.attackPercent),
    hp: official.hp / (1 + innate.hpPercent),
    defense: official.defense / (1 + innate.defensePercent),
    speed: official.speed - innate.speed,
    crit: official.crit - innate.crit,
    critDamage: official.critDamage - innate.critDamage,
    effectHit: official.effectHit - innate.effectHit,
    effectResist: official.effectResist - innate.effectResist,
  };
  for (const key of STATS) finite(base[key], `${heroId}.base.${key}`, { positive: ['attack', 'hp', 'defense', 'speed', 'critDamage'].includes(key) });
  return base;
}
export function compareReference(panels, reference) {
  assert(reference?.schemaVersion === 1 && Array.isArray(reference.panels), 'Expected schemaVersion 1 reference panels');
  const generated = new Map(panels.map((p) => [p.heroId, p]));
  const mismatches = [];
  const matched = [];
  const seen = new Set();
  for (const old of reference.panels) {
    assert(Number.isSafeInteger(old.heroId) && !seen.has(old.heroId), `Duplicate/invalid reference hero ID ${old.heroId}`);
    seen.add(old.heroId);
    const next = generated.get(old.heroId);
    assert(next, `Reference hero ${old.heroId} missing from catalog`);
    const fields = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage'].filter((key) =>
      !Number.isFinite(old.base?.[key]) || Math.abs(next.base[key] - old.base[key]) > 1e-7);
    if (fields.length) mismatches.push({ heroId: old.heroId, fields });
    else matched.push(old.heroId);
  }
  assert(mismatches.every(({ heroId, fields }) =>
    heroId === 362 && fields.every((field) => ['attack', 'defense'].includes(field))),
  `Unexpected reference conflicts: ${JSON.stringify(mismatches)}`);
  return { referenceCount: seen.size, matchedCount: matched.length, mismatches };
}
function parseArgs(argv) {
  const options = { ...DEFAULTS, fetch: false, reference: null };
  const flags = { '--catalog': 'catalog', '--awake-dir': 'awakeDir', '--native-dir': 'nativeDir', '--skill-dir': 'skillDir', '--output': 'output', '--audit-output': 'auditOutput', '--reference': 'reference' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--fetch') options.fetch = true;
    else if (flags[flag] && argv[i + 1]) options[flags[flag]] = resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  return options;
}
async function jsonFile(path) { return JSON.parse(await readFile(path, 'utf8')); }
function endpoint(base, heroId, awake) {
  return `${base}?heroid=${heroId}&awake=${awake}&level=40&star=6`;
}
async function officialJson(url, totalSignal) {
  const signal = AbortSignal.any([totalSignal, AbortSignal.timeout(15_000)]);
  const response = await fetch(url, { signal });
  assert(response.ok, `HTTP ${response.status} from ${url}`);
  return response.json();
}
async function stageJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    return temporary;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
async function mapLimited(items, limit, process, abort) {
  let next = 0;
  let failure = null;
  const results = Array(items.length);
  await Promise.all(Array.from({ length: limit }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await process(items[index]); }
      catch (error) {
        if (!failure) { failure = error; abort(); }
      }
    }
  }));
  if (failure) throw failure;
  return results;
}
export async function generate(options) {
  const catalog = await jsonFile(options.catalog);
  assert(Array.isArray(catalog) && catalog.length > 0, 'Catalog must be a nonempty array');
  const ids = new Set();
  const entries = catalog.map((entry) => {
    const heroId = Number(entry.id);
    assert(Number.isSafeInteger(heroId) && heroId > 0 && String(heroId) === entry.id && !ids.has(heroId), `Invalid/duplicate catalog hero ID ${entry.id}`);
    ids.add(heroId);
    return { heroId, awake: awakeForRarity(entry.rarity) };
  }).sort((a, b) => a.heroId - b.heroId);
  const controller = new AbortController();
  const totalSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(8 * 60_000)]);
  const readSource = async (url, path) => options.fetch ? officialJson(url, totalSignal) : jsonFile(path);
  const panels = await mapLimited(entries, 3, async ({ heroId, awake }) => {
    const attrPath = resolve(awake ? options.awakeDir : options.nativeDir, `${heroId}.json`);
    const attrResponse = await readSource(endpoint(ATTR_URL, heroId, awake), attrPath);
    const official = parseOfficialAttr(attrResponse, heroId);
    let innate = Object.fromEntries(INNATE_STATS.map((key) => [key, 0]));
    if (awake) {
      const skillResponse = await readSource(endpoint(SKILL_URL, heroId, awake), resolve(options.skillDir, `${heroId}.json`));
      innate = parseAwakening(skillResponse, heroId);
    }
    return { heroId, star: 6, level: 40, awake, base: splitPanel(official, innate, heroId),
      innate, precheckSupported: !KNOWN_UNSUPPORTED.has(heroId), reason: KNOWN_UNSUPPORTED.get(heroId) ?? null };
  }, () => controller.abort());
  const dates = options.fetch ? [new Date()] : await Promise.all(entries.flatMap(({ heroId, awake }) => [
    stat(resolve(awake ? options.awakeDir : options.nativeDir, `${heroId}.json`)).then((value) => value.mtime),
    ...(awake ? [stat(resolve(options.skillDir, `${heroId}.json`)).then((value) => value.mtime)] : []),
  ]));
  const collectedAt = new Date(Math.max(...dates.map((value) => value.getTime()))).toISOString().slice(0, 10);
  const result = { schemaVersion: 2, source: {
    name: '阴阳师官网式神模拟器', page: 'https://yys.163.com/shishen/241.html',
    attributesEndpoint: `${ATTR_URL}?heroid={id}&awake={awake}&level=40&star=6`,
    skillsEndpoint: `${SKILL_URL}?heroid={id}&awake=1&level=40&star=6`,
    catalog: 'onmyoji-data/catalogs/shikigami.json', collectedAt,
    selection: { awake1: [...AWAKENED], awake0: [...NATIVE] },
    interpretation: 'critPower is extra critical damage above 100%; fixed awakening bonuses are separated into innate',
  }, panels };
  const comparison = options.reference ? compareReference(panels, await jsonFile(options.reference)) : null;
  const audit = { schemaVersion: 1, catalogCount: panels.length, supportedCount: panels.filter((p) => p.precheckSupported).length,
    unsupported: panels.filter((p) => !p.precheckSupported).map(({ heroId, reason }) => ({ heroId, reason })),
    ...(comparison ? { reference: comparison } : {}) };
  // Both documents are staged after validation; a failed audit write leaves prior panels intact.
  let stagedData, stagedAudit;
  try {
    stagedData = await stageJson(options.output, result);
    stagedAudit = await stageJson(options.auditOutput, audit);
    await rename(stagedData, options.output);
    stagedData = null;
    await rename(stagedAudit, options.auditOutput);
    stagedAudit = null;
  } finally {
    if (stagedData) await unlink(stagedData).catch(() => {});
    if (stagedAudit) await unlink(stagedAudit).catch(() => {});
  }
  return audit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const audit = await generate(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(audit)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
