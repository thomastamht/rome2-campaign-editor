#!/usr/bin/env node
// Extracts the localisation strings the web app needs (faction / region / province / unit / culture names
// and character names) from the game's .loc tables into public/loc/<lang>.json.
//
//   node tools/extract-loc.mjs [--game "<Rome II dir>"] [--mods-dir "<workshop\214950>"]
//
// Language sets (later packs override earlier ones):
//   en: local_en.pack, then English mod packs (e.g. DEI)
//   zh: everything from en, then packs whose name contains "cn" or "chinese" (e.g. patch_cn, ____dei_cn)
// .loc format: FF FE "LOC\0" u32 version u32 count, entries of (u16 len + UTF-16LE key, u16 len + UTF-16LE text, u8 tooltip).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackIndex, readEntry } from "./pack-format.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const PREFIXES = ["factions_screen_name_", "regions_onscreen_", "provinces_onscreen_", "names_name_", "land_units_onscreen_name_",
  "cultures_name_", "cultures_subcultures_name_", "building_culture_variants_name_"];

export function parseLoc(buf) {
  const out = [];
  if (buf.length < 14 || buf.readUInt16LE(0) !== 0xfeff || buf.toString("latin1", 2, 5) !== "LOC") return out;
  const count = buf.readUInt32LE(10);
  let pos = 14;
  const readString = () => {
    const len = buf.readUInt16LE(pos); pos += 2;
    const s = buf.toString("utf16le", pos, pos + len * 2); pos += len * 2;
    return s;
  };
  for (let i = 0; i < count && pos + 4 <= buf.length; i++) {
    const key = readString();
    const text = readString();
    pos += 1; // tooltip flag
    out.push([key, text]);
  }
  return out;
}

function gameDir() {
  if (opt("--game")) return opt("--game");
  for (const lib of ["D:\\Steam", "E:\\SteamLibrary", "C:\\Program Files (x86)\\Steam"]) {
    const dir = path.join(lib, "steamapps", "common", "Total War Rome II");
    if (fs.existsSync(path.join(dir, "data", "data.pack"))) return dir;
  }
  throw new Error("Rome II not found; pass --game");
}

function locEntries(packPath) {
  const index = readPackIndex(packPath);
  const out = new Map();
  for (const e of index.entries) {
    if (!/\.loc$/i.test(e.path)) continue;
    for (const [key, text] of parseLoc(readEntry(packPath, e))) {
      if (PREFIXES.some(p => key.startsWith(p)) && text) out.set(key, text);
    }
  }
  return out;
}

function main() {
  const game = gameDir();
  const modPacks = [];
  if (opt("--mods-dir")) {
    for (const dir of fs.readdirSync(opt("--mods-dir"))) {
      const full = path.join(opt("--mods-dir"), dir);
      if (!fs.statSync(full).isDirectory()) continue;
      for (const f of fs.readdirSync(full)) if (f.endsWith(".pack")) modPacks.push(path.join(full, f));
    }
  }
  // Rome II: alphabetically earlier packs win, so apply them last.
  modPacks.sort((a, b) => path.basename(b).toLowerCase().localeCompare(path.basename(a).toLowerCase()));
  const isChinese = (p) => /(^|[^a-z])cn([^a-z]|$)|chinese|zh/i.test(path.basename(p)) || /[\u4e00-\u9fff]/.test(path.basename(p));
  const enPacks = [path.join(game, "data", "local_en.pack"), ...modPacks.filter(p => !isChinese(p))];
  const zhPacks = [...enPacks, ...modPacks.filter(isChinese)];

  const outDir = path.join(root, "public", "loc");
  fs.mkdirSync(outDir, { recursive: true });

  // Unit picker catalogue: every land unit with a name, flagged by origin so the UI can offer
  // "base game only" (mod unit keys do not exist in a vanilla campaign).
  const unitPrefix = "land_units_onscreen_name_";
  const gameUnits = locEntries(path.join(game, "data", "local_en.pack"));
  const units = {};
  const collect = (packs, lang) => {
    for (const p of packs) {
      if (!fs.existsSync(p)) continue;
      for (const [k, v] of locEntries(p)) {
        if (!k.startsWith(unitPrefix)) continue;
        const key = k.slice(unitPrefix.length);
        units[key] ??= { game: gameUnits.has(k) };
        units[key][lang] = v;
      }
    }
  };
  collect(enPacks, "en");
  collect(zhPacks.filter(isChinese), "zh");
  fs.writeFileSync(path.join(outDir, "units.json"), JSON.stringify(units));
  console.log(`units: ${Object.keys(units).length} (${Object.values(units).filter(u => u.game).length} base game)`);

  for (const [lang, packs] of [["en", enPacks], ["zh", zhPacks]]) {
    const merged = new Map();
    let used = 0;
    for (const p of packs) {
      if (!fs.existsSync(p)) continue;
      const entries = locEntries(p);
      if (!entries.size) continue;
      used++;
      for (const [k, v] of entries) merged.set(k, v);
    }
    const obj = Object.fromEntries([...merged.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const file = path.join(outDir, `${lang}.json`);
    fs.writeFileSync(file, JSON.stringify(obj));
    console.log(`${lang}: ${merged.size} strings from ${used} packs -> ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) main();
