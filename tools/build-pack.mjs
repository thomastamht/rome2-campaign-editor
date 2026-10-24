#!/usr/bin/env node
// Build the Rome II Web Campaign Editor mod pack(s) without RPFM.
//
//   node tools/build-pack.mjs                       -> release/rome2_web_editor.pack
//   node tools/build-pack.mjs --game "<Rome II dir>"
//   node tools/build-pack.mjs --scripting-overlay "<some_mod.pack>"
//        -> additionally release/!rome2_web_editor_overlay_<mod>.pack  (fallback hook, see README)
//
// The base pack overrides lua_scripts\episodicscripting.lua with the game's own copy plus a
// bootstrap hook. Every Rome II campaign script (vanilla and DEI alike) requires that file, so one
// pack serves both; no scripting.lua override is needed unless a mod replaces episodicscripting.lua.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPfh4, parsePackBuffer, readPackIndex, readEntry } from "./pack-format.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const PACK_NAME = "rome2_web_editor";
const HOOK_MARKER = "[rome2_web_editor]";
const EPISODIC_PATH = "lua_scripts\\episodicscripting.lua";
const EPISODIC_ANCHOR = 'AddEventCallBack("UIDestroyed",';

const BRIDGE_FILES = [
  "lua_scripts\\rome2_web_editor.lua",
  "lua_scripts\\rome2_web_editor_json.lua",
];

// The bridge sources are embedded through package.preload so loading them never depends on the
// engine's module searcher; `require` then resolves them from memory. Boot failures are appended
// to rome2_web_editor_bridge.log in the game root (io.open resolves relative paths there).
function preloadChunk(moduleName, source) {
  return `package.preload[${JSON.stringify(moduleName)}] = function(...)\n${source}\nend\n`;
}

function bootstrapHook(scriptingExpr, where) {
  return `
do
  local function r2we_boot_log(msg)
    local f = io.open("rome2_web_editor_bridge.log", "a")
    if f then f:write((os.date and os.date("%H:%M:%S") or "?") .. " [hook:${where}] " .. tostring(msg) .. "\\n") f:close() end
  end
  local ok_r2we, err_r2we = pcall(function() require("lua_scripts.rome2_web_editor").attach(${scriptingExpr}) end)
  if ok_r2we then r2we_boot_log("attached") else r2we_boot_log("bootstrap failed: " .. tostring(err_r2we)) end
  if not ok_r2we and out and out.ting then out.ting("${HOOK_MARKER} bootstrap failed: " .. tostring(err_r2we)) end
end
`;
}

function hookBlock(scriptingExpr, where) {
  const sources = bridgeFiles();
  const json = sources.find(f => f.path.endsWith("rome2_web_editor_json.lua")).data.toString("utf8");
  const bridge = sources.find(f => f.path.endsWith("rome2_web_editor.lua")).data.toString("utf8");
  return `

-- ${HOOK_MARKER} Rome II Web Campaign Editor bridge (embedded by tools/build-pack.mjs; sources in mod/lua_scripts/).
${preloadChunk("lua_scripts.rome2_web_editor_json", json)}
${preloadChunk("lua_scripts.rome2_web_editor", bridge)}
${bootstrapHook(scriptingExpr, where)}`;
}

function findGameDir() {
  if (opt("--game")) return opt("--game");
  const candidates = [];
  for (const vdf of ["D:\\Steam\\steamapps\\libraryfolders.vdf", "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf"]) {
    if (!fs.existsSync(vdf)) continue;
    const text = fs.readFileSync(vdf, "utf8");
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) candidates.push(m[1].replace(/\\\\/g, "\\"));
  }
  candidates.push("D:\\Steam", "E:\\SteamLibrary", "C:\\Program Files (x86)\\Steam");
  for (const lib of candidates) {
    const dir = path.join(lib, "steamapps", "common", "Total War Rome II");
    if (fs.existsSync(path.join(dir, "data", "data.pack"))) return dir;
  }
  throw new Error("Rome II installation not found; pass --game \"<install dir>\"");
}

function extractFromGame(gameDir, entryPath) {
  // data_rome2.pack is the patch layer and wins over data.pack when both carry the file.
  for (const pack of ["data_rome2.pack", "data.pack"]) {
    const packPath = path.join(gameDir, "data", pack);
    if (!fs.existsSync(packPath)) continue;
    const index = readPackIndex(packPath);
    const entry = index.entries.find(e => e.path.toLowerCase() === entryPath.toLowerCase());
    if (entry) return { data: readEntry(packPath, entry), source: packPath };
  }
  throw new Error(`${entryPath} not found in the game's data packs`);
}

function hookedEpisodic(gameDir) {
  const { data, source } = extractFromGame(gameDir, EPISODIC_PATH);
  const text = data.toString("latin1");
  if (text.includes(HOOK_MARKER)) throw new Error(`${source} already contains the hook; refusing to double-patch`);
  if (!text.includes(EPISODIC_ANCHOR)) throw new Error(`${source}: ${EPISODIC_PATH} lacks the expected anchor ${EPISODIC_ANCHOR}; the game may have changed`);
  // Inside module(..., package.seeall) the module table is _M.
  return { data: Buffer.concat([Buffer.from(text, "latin1"), Buffer.from(hookBlock("_M", "episodic"), "utf8")]), source };
}

function bridgeFiles() {
  return BRIDGE_FILES.map(rel => {
    const abs = path.join(root, "mod", rel);
    if (!fs.existsSync(abs)) throw new Error(`missing ${abs}`);
    return { path: rel, data: fs.readFileSync(abs) };
  });
}

function writePack(outName, files) {
  const outDir = path.join(root, "release");
  fs.mkdirSync(outDir, { recursive: true });
  const sorted = [...files].sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  const image = buildPfh4(sorted);
  const outPath = path.join(outDir, `${outName}.pack`);
  fs.writeFileSync(outPath, image);
  selfTest(outPath, image, sorted);
  return outPath;
}

function selfTest(outPath, image, files) {
  const parsed = parsePackBuffer(image);
  if (parsed.header.magic !== "PFH4" || parsed.header.type !== 3) throw new Error("self-test: wrong header");
  if (parsed.entries.length !== files.length) throw new Error("self-test: entry count mismatch");
  parsed.entries.forEach((e, i) => {
    if (e.path !== files[i].path || !e.data.equals(files[i].data)) throw new Error(`self-test: entry ${i} mismatch`);
  });
  const reread = readPackIndex(outPath);
  if (reread.dataEnd !== reread.fileSize) throw new Error("self-test: on-disk size mismatch");
  console.log(`${outPath}`);
  console.log(`  PFH4 mod pack, ${files.length} files, ${image.length} bytes, self-test OK`);
  for (const f of files) console.log(`  ${String(f.data.length).padStart(8)}  ${f.path}`);
}

function copyPreview(outName) {
  const src = path.join(root, "workshop", outName === PACK_NAME ? "base" : "overlay", `${outName}.png`);
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, path.join(root, "release", `${outName}.png`));
  console.log(`  preview: ${outName}.png`);
}

function buildBase(gameDir) {
  const episodic = hookedEpisodic(gameDir);
  console.log(`base: ${EPISODIC_PATH} taken from ${episodic.source}`);
  const files = [{ path: EPISODIC_PATH, data: episodic.data }, ...bridgeFiles()];
  const out = writePack(PACK_NAME, files);
  copyPreview(PACK_NAME);
  return out;
}

// Fallback for mods that ship their own lua_scripts\episodicscripting.lua: hook every
// campaigns\<campaign>\scripting.lua from the given mod pack instead. Must load before that mod.
function buildScriptingOverlay(modPack) {
  const index = readPackIndex(modPack);
  const scripts = index.entries.filter(e => /^campaigns\\[^\\]+\\scripting\.lua$/i.test(e.path));
  if (!scripts.length) throw new Error(`${modPack} contains no campaigns\\*\\scripting.lua`);
  const files = scripts.map(e => {
    const text = readEntry(modPack, e).toString("latin1");
    if (text.includes(HOOK_MARKER)) throw new Error(`${e.path} in ${modPack} already hooked`);
    return { path: e.path, data: Buffer.concat([Buffer.from(text, "latin1"), Buffer.from(hookBlock('require("lua_scripts.EpisodicScripting")', "scripting"), "utf8")]) };
  });
  const base = path.basename(modPack, ".pack").replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9_]+/g, "_");
  const outName = `!${PACK_NAME}_overlay_${base}`;
  console.log(`overlay: ${scripts.length} scripting.lua from ${modPack}`);
  return writePack(outName, [...files, ...bridgeFiles()]);
}

export { hookBlock, bridgeFiles, HOOK_MARKER };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const gameDir = findGameDir();
    console.log(`game: ${gameDir}`);
    buildBase(gameDir);
    if (opt("--scripting-overlay")) buildScriptingOverlay(opt("--scripting-overlay"));
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}
