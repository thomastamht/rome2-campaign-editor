// Game localisation extracted by tools/extract-loc.mjs (public/loc/<lang>.json + units.json).
// Rome II's Lua returns loc keys (names_name_123, faction keys) rather than display text.
// Game data exists in en and zh (the installed Chinese patch); the tw UI uses the zh data.

const base = import.meta.env?.BASE_URL ?? "/";
const tables = new Map();   // data lang -> { key: text }
let active = {};
let fallback = {};
let units = {};             // key -> { en, zh, game }
let uiLang = "en";

const dataLangOf = (lang) => (lang === "tw" ? "zh" : lang);

// The community Chinese patch spaces out CJK characters ("青 年 兵") for its font; undo that.
const tidy = (s) => (typeof s === "string" ? s.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1") : s);

async function fetchJson(file) {
  try {
    const res = await fetch(`${base}loc/${file}`);
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

export async function loadLoc(lang) {
  uiLang = lang;
  const dataLang = dataLangOf(lang);
  for (const l of [dataLang, "en"]) if (!tables.has(l)) tables.set(l, await fetchJson(`${l}.json`));
  if (!Object.keys(units).length) units = await fetchJson("units.json");
  active = tables.get(dataLang) ?? {};
  fallback = tables.get("en") ?? {};
  buildingNames.clear();
}

export function locText(key) {
  if (!key) return undefined;
  return tidy(active[key] ?? fallback[key]);
}

export const factionDisplayName = (key) => locText(`factions_screen_name_${key}`);
export const regionDisplayName = (key) => locText(`regions_onscreen_${key}`);
export const provinceDisplayName = (key) => locText(`provinces_onscreen_${key}`);
export const cultureDisplayName = (key) => locText(`cultures_name_${key}`);
export const subcultureDisplayName = (key) => locText(`cultures_subcultures_name_${key}`);
// building_culture_variants keys are building + culture + subculture concatenated
// (…_city_major_1rom_Roman, …_city_major_1rom_Barbariansc_rom_illyrian); any variant beats the raw key.
const BUILDING_PREFIX = "building_culture_variants_name_";
const buildingNames = new Map();
export function buildingDisplayName(key, culture = "", subculture = "") {
  if (!key) return undefined;
  const cacheKey = `${key}|${culture}|${subculture}`;
  if (buildingNames.has(cacheKey)) return buildingNames.get(cacheKey);
  let name = locText(`${BUILDING_PREFIX}${key}${culture}${subculture}`) ?? locText(`${BUILDING_PREFIX}${key}${culture}`);
  if (!name) {
    const prefix = `${BUILDING_PREFIX}${key}rom_`;
    const hit = Object.keys(active).find(k => k.startsWith(prefix)) ?? Object.keys(fallback).find(k => k.startsWith(prefix));
    name = hit ? locText(hit) : undefined;
  }
  buildingNames.set(cacheKey, name);
  return name;
}

/** Character names arrive as names_name_<id> keys (or already-localised text). */
export function personName(value) {
  if (!value) return "";
  return /^names_name_/.test(value) ? (locText(value) ?? "") : tidy(value);
}

const TEST_UNIT = /^test_|placeholder|dummy/i;

/** Unit catalogue for pickers: [{ key, name, game }] sorted by display name. only: "game" | "dei" | null. */
export function unitCatalogue({ only = "game" } = {}) {
  const dataLang = dataLangOf(uiLang);
  return Object.entries(units)
    .filter(([key, u]) => (!only || u[only]) && !TEST_UNIT.test(key))
    .map(([key, u]) => ({ key, name: tidy(u[dataLang] ?? u.en ?? key), game: Boolean(u.game) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
