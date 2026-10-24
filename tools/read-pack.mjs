#!/usr/bin/env node
// List (and optionally extract) entries of a Total War PFH4/PFH5 pack.
// Usage:
//   node tools/read-pack.mjs <pack> [--filter <regex>] [--limit N]
//   node tools/read-pack.mjs <pack> --extract <entryPath> [--out <file>]
//   node tools/read-pack.mjs <pack> --cat <entryPath>
import fs from "node:fs";
import path from "node:path";
import { readPackIndex, readEntry } from "./pack-format.mjs";

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  console.log("usage: node tools/read-pack.mjs <pack> [--filter regex] [--limit N] [--extract entry [--out file]] [--cat entry]");
  process.exit(args.length ? 0 : 1);
}
const packPath = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const info = readPackIndex(packPath);
const { header, dependencies, entries } = info;
const typeNames = ["boot", "release", "patch", "mod", "movie"];

const extract = opt("--extract");
const cat = opt("--cat");
if (extract || cat) {
  const wanted = (extract || cat).replace(/\//g, "\\").toLowerCase();
  const entry = entries.find(e => e.path.toLowerCase() === wanted);
  if (!entry) { console.error(`entry not found: ${extract || cat}`); process.exit(2); }
  const data = readEntry(packPath, entry);
  if (cat) { process.stdout.write(data); process.exit(0); }
  const out = opt("--out") || path.basename(entry.path.replace(/\\/g, "/"));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, data);
  console.log(`extracted ${entry.path} (${entry.size} bytes) -> ${out}`);
  process.exit(0);
}

console.log(`${packPath}`);
console.log(`  magic=${header.magic} type=${typeNames[header.type] ?? header.type}(${header.type}) flags=0x${header.flags.toString(16)} timestamp=${header.timestamp} (${header.timestamp ? new Date(header.timestamp * 1000).toISOString() : "none"})`);
console.log(`  dependencies=${header.packFileCount} files=${header.fileCount} indexSize=${header.fileIndexSize} dataEnd=${info.dataEnd} fileSize=${info.fileSize} ${info.dataEnd === info.fileSize ? "OK" : "MISMATCH"}`);
for (const d of dependencies) console.log(`  depends: ${d}`);

const filter = opt("--filter") ? new RegExp(opt("--filter"), "i") : null;
const limit = Number(opt("--limit") || 0);
let shown = 0, matched = 0;
for (const e of entries) {
  if (filter && !filter.test(e.path)) continue;
  matched++;
  if (limit && shown >= limit) continue;
  shown++;
  console.log(`  ${String(e.size).padStart(10)}  ${e.compressed ? "Z " : "  "}${e.timestamp != null ? e.timestamp + " " : ""}${e.path}`);
}
console.log(`  ${matched} entries${filter ? " matched" : ""}${limit && matched > shown ? ` (showing ${shown})` : ""}`);
