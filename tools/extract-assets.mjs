#!/usr/bin/env node
// Pulls the web app's map and flag assets out of the installed game (and optionally mods):
//   public/maps/<campaign>.png          campaign_maps\<campaign>\*_map_minimap.png
//   public/flags/<folder>/mon_64.png    ui\flags\<folder>\mon_64.png
//   public/flags/index.json             faction key -> { flag: <folder>, name: <english name> }
//
//   node tools/extract-assets.mjs [--game "<Rome II dir>"] [--mods-dir "<workshop\214950>"] [--mod <pack>]...
//
// Faction -> flag folder comes from db\factions_tables\* (key, ..., "data\ui\flags\<folder>").
// Mod packs are read after the game packs, so their rows and flag images win.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPackIndex, readEntry } from "./pack-format.mjs";

// Region lookup rasters: campaign_maps\<campaign>\*_lookup.tga is an 8-bit palette TGA whose pixel
// index identifies the region; the web app reads it to find the region under a dropped army.
const LOOKUPS = {
  main_rome: "campaign_maps\\main_rome_map\\main_rome_lookup.tga",
};

/** Uncompressed 8-bit colour-mapped TGA -> { width, height, indices (top-down) }. */
export function parseIndexedTga(buf) {
  const idLen = buf[0], imgType = buf[2], cmapLen = buf.readUInt16LE(5), cmapBpp = buf[7];
  const width = buf.readUInt16LE(12), height = buf.readUInt16LE(14), bpp = buf[16], desc = buf[17];
  if (imgType !== 1 || bpp !== 8) throw new Error(`unsupported TGA (type ${imgType}, ${bpp} bpp)`);
  const topDown = (desc & 0x20) !== 0;
  const start = 18 + idLen + cmapLen * (cmapBpp / 8);
  const indices = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    buf.copy(indices, y * width, start + srcRow * width, start + (srcRow + 1) * width);
  }
  return { width, height, indices };
}

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 8-bit greyscale PNG where each pixel value is the region index. */
export function encodeGreyPng(width, height, indices) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // depth 8, greyscale, deflate, filter 0, no interlace
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; indices.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));

// Label-free terrain maps (campaign_maps\<campaign>\clickgen_map.jpg, ~2 px per logical tile, square
// tiles). Language-neutral, so they ship on the Workshop; re-encoded to JPEG q80 to keep them ~1-2 MB.
// The app prefers <campaign>_terrain.jpg and falls back to the small <campaign>.png minimap.
const TERRAIN_MAPS = {
  main_rome: "campaign_maps\\main_rome_map\\clickgen_map.jpg",
};

const MAPS = {
  main_rome: "campaign_maps\\main_rome_map\\main_rome_map_minimap.png",
};

function gameDir() {
  if (opt("--game")) return opt("--game");
  for (const lib of ["D:\\Steam", "E:\\SteamLibrary", "C:\\Program Files (x86)\\Steam"]) {
    const dir = path.join(lib, "steamapps", "common", "Total War Rome II");
    if (fs.existsSync(path.join(dir, "data", "data.pack"))) return dir;
  }
  throw new Error("Rome II not found; pass --game");
}

/** Opens every pack once; later packs override earlier ones for the same entry path. */
class PackSet {
  constructor(paths) {
    this.packs = paths.filter(p => fs.existsSync(p)).map(p => ({ path: p, index: readPackIndex(p) }));
    this.lookup = new Map();
    for (const pack of this.packs) {
      for (const e of pack.index.entries) this.lookup.set(e.path.toLowerCase(), { pack: pack.path, entry: e });
    }
  }
  get(entryPath) {
    const hit = this.lookup.get(entryPath.toLowerCase());
    return hit ? readEntry(hit.pack, hit.entry) : null;
  }
  find(regex) {
    const out = [];
    for (const [key, hit] of this.lookup) if (regex.test(key)) out.push(hit);
    return out;
  }
}

/** Length-prefixed 8-bit strings as stored in Rome II DB tables (header GUID is UTF-16, skipped). */
function dbStrings(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length - 2) {
    const len = buf.readUInt16LE(i);
    if (len >= 2 && len <= 120 && i + 2 + len <= buf.length) {
      let s = "", ok = true;
      for (let k = 0; k < len; k++) {
        const c = buf[i + 2 + k];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        s += String.fromCharCode(c);
      }
      if (ok) { out.push(s); i += 2 + len; continue; }
    }
    i++;
  }
  return out;
}

/** A row starts with <faction key> followed by its subculture (sc_*); the first flags path after that is the faction's. */
export function parseFactionRows(strings) {
  const rows = new Map();
  for (let i = 0; i < strings.length - 1; i++) {
    if (!/^sc_/.test(strings[i + 1]) || !/^[a-z0-9_]+$/i.test(strings[i])) continue;
    const key = strings[i];
    let flag = null, name = null;
    for (let j = i + 2; j < Math.min(i + 16, strings.length); j++) {
      const s = strings[j];
      if (/^sc_/.test(strings[j + 1] ?? "")) break;                 // next row
      if (!flag && /^data\\ui\\flags\\/i.test(s)) flag = s.replace(/^data\\ui\\flags\\/i, "");
      if (!name && j === i + 3) name = s;                            // key, subculture, "playable"?, name
    }
    if (flag) rows.set(key, { flag, name: name && !/^(playable|data\\)/.test(name) ? name : undefined });
  }
  return rows;
}

function main() {
  const game = gameDir();
  const gamePacks = ["data.pack", "data_rome2.pack"].map(p => path.join(game, "data", p));
  const modPacks = [...opts("--mod")];
  if (opt("--mods-dir")) {
    for (const dir of fs.readdirSync(opt("--mods-dir"))) {
      const full = path.join(opt("--mods-dir"), dir);
      if (!fs.statSync(full).isDirectory()) continue;
      for (const f of fs.readdirSync(full)) if (f.endsWith(".pack")) modPacks.push(path.join(full, f));
    }
  }
  // Rome II loads mods alphabetically and the first one wins, so reverse that order for "later wins".
  modPacks.sort((a, b) => path.basename(b).toLowerCase().localeCompare(path.basename(a).toLowerCase()));
  const packs = new PackSet([...gamePacks, ...modPacks]);
  console.log(`packs: ${packs.packs.length} (${gamePacks.length} game, ${packs.packs.length - gamePacks.length} mod)`);

  const mapsDir = path.join(root, "public", "maps");
  fs.mkdirSync(mapsDir, { recursive: true });
  for (const [campaign, entry] of Object.entries(MAPS)) {
    const data = packs.get(entry);
    if (data) fs.writeFileSync(path.join(mapsDir, `${campaign}.png`), data);
    console.log(`map ${campaign}: ${data ? data.length + " bytes" : "missing"}`);
  }
  for (const [campaign, entry] of Object.entries(TERRAIN_MAPS)) {
    const data = packs.get(entry);
    if (!data) { console.log(`terrain ${campaign}: missing`); continue; }
    const rawPath = path.join(mapsDir, `${campaign}_terrain_src.jpg`);
    const outPath = path.join(mapsDir, `${campaign}_terrain.jpg`);
    fs.writeFileSync(rawPath, data);
    let done = false;
    if (process.platform === "win32" && !opt("--no-jpeg")) {
      const script = `Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile('${rawPath}'); Write-Output ($img.Width.ToString() + 'x' + $img.Height); $enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $p=New-Object System.Drawing.Imaging.EncoderParameters(1); $p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]80); $img.Save('${outPath}', $enc, $p); $img.Dispose()`;
      const res = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
      if (res.status === 0 && fs.existsSync(outPath)) {
        fs.unlinkSync(rawPath);
        console.log(`terrain ${campaign}: ${res.stdout.trim()} -> ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB jpg`);
        done = true;
      }
    }
    if (!done) { fs.renameSync(rawPath, outPath); console.log(`terrain ${campaign}: ${(data.length / 1024).toFixed(0)} KB jpg (not re-encoded)`); }
  }
  for (const [campaign, entry] of Object.entries(LOOKUPS)) {
    const data = packs.get(entry);
    if (!data) { console.log(`lookup ${campaign}: missing`); continue; }
    const tga = parseIndexedTga(data);
    const png = encodeGreyPng(tga.width, tga.height, tga.indices);
    fs.writeFileSync(path.join(mapsDir, `${campaign}_lookup.png`), png);
    console.log(`lookup ${campaign}: ${tga.width}x${tga.height} -> ${png.length} bytes`);
  }

  const factions = new Map();
  for (const hit of packs.find(/^db\\factions_tables\\/)) {
    const rows = parseFactionRows(dbStrings(readEntry(hit.pack, hit.entry)));
    for (const [key, row] of rows) factions.set(key, row);
  }
  console.log(`factions with flags: ${factions.size}`);

  const flagsDir = path.join(root, "public", "flags");
  fs.mkdirSync(flagsDir, { recursive: true });
  const index = {};
  let written = 0, missing = 0;
  const folders = new Map();
  for (const [key, row] of factions) {
    const folder = row.flag.toLowerCase().replace(/[^a-z0-9_\- ']/g, "_");
    index[key] = { flag: folder, name: row.name };
    if (!folders.has(folder)) folders.set(folder, row.flag);
  }
  for (const [folder, original] of folders) {
    const data = packs.get(`ui\\flags\\${original}\\mon_64.png`) ?? packs.get(`ui\\flags\\${original}\\mon_24.png`);
    if (!data) { missing++; continue; }
    fs.mkdirSync(path.join(flagsDir, folder), { recursive: true });
    fs.writeFileSync(path.join(flagsDir, folder, "mon_64.png"), data);
    written++;
  }
  fs.writeFileSync(path.join(flagsDir, "index.json"), JSON.stringify(index));
  console.log(`flags: ${written} folders written, ${missing} referenced folders without an image, index ${Object.keys(index).length} keys`);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) main();
