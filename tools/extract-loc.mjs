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

// Unit keys in DEI's own main_units tables (ZUnused_Old holds the units DEI retired). DB rows are
// not parsed: every u16-length-prefixed key-like string is taken, and only names the picker knows
// are kept, so other columns can at most mark a unit DEI references anyway.
function deiUnitKeys(packs) {
  const keys = new Set();
  for (const p of packs.filter(p => /divide_et_impera/i.test(path.basename(p)))) {
    for (const e of readPackIndex(p).entries) {
      if (!/^db\\main_units_tables\\/i.test(e.path) || /unused/i.test(e.path)) continue;
      const buf = readEntry(p, e);
      for (let i = 0; i + 2 < buf.length; i++) {
        const n = buf.readUInt16LE(i);
        if (n < 3 || n > 80 || i + 2 + n > buf.length) continue;
        const s = buf.toString("latin1", i + 2, i + 2 + n);
        if (/^[A-Za-z0-9_]+$/.test(s)) keys.add(s);
      }
    }
  }
  return keys;
}

// Agent jobs are the same three everywhere. The title is a subculture override, or a faction override
// when one exists (agent_string_*_overrides). Gender is the final m/f on the loc key.
const AGENT_NAME_TYPES = ["dignitary", "champion", "spy"];
const AGENT_SUB_PREFIX = "agent_string_subculture_overrides_name_override_";
const AGENT_FAC_PREFIX = "agent_string_faction_overrides_name_override_";

function parseAgentNameKey(key, prefix) {
  if (!key.startsWith(prefix)) return null;
  let rest = key.slice(prefix.length);
  const gender = rest.endsWith("f") ? "f" : rest.endsWith("m") ? "m" : null;
  if (!gender) return null;
  rest = rest.slice(0, -1);
  const type = AGENT_NAME_TYPES.find(t => rest.startsWith(t));
  if (!type) return null;
  const owner = rest.slice(type.length);
  return owner ? { type, owner, gender } : null;
}

function toTraditionalAgentTitle(text) {
  const map = {
    间: "間", 谍: "諜", 鲁: "魯", 蛮: "蠻", 战: "戰", 斗: "鬥", 贵: "貴", 学: "學",
    长: "長", 队: "隊", 务: "務", 将: "將", 佣: "傭", 东: "東", 门: "門", 马: "馬",
    贝: "貝", 见: "見", 尔: "爾", 亚: "亞", 历: "歷", 罗: "羅", 凯: "凱", 卢: "盧",
    国: "國", 发: "發", 对: "對", 体: "體", 会: "會", 为: "為", 来: "來", 时: "時",
    后: "後", 从: "從", 过: "過", 还: "還", 经: "經", 现: "現", 开: "開", 关: "關",
    书: "書", 车: "車", 龙: "龍", 鸟: "鳥", 鱼: "魚", 页: "頁", 风: "風", 飞: "飛",
    义: "義", 产: "產", 众: "眾", 优: "優", 传: "傳", 伤: "傷", 余: "餘", 侠: "俠",
    侧: "側", 侦: "偵", 兰: "蘭", 兽: "獸", 内: "內", 军: "軍", 农: "農", 冲: "衝",
    决: "決", 净: "淨", 准: "準", 凤: "鳳", 刘: "劉", 则: "則", 刚: "剛", 创: "創",
    别: "別", 制: "製", 剑: "劍", 剧: "劇", 办: "辦", 动: "動", 势: "勢", 华: "華",
    卫: "衛", 厉: "厲", 参: "參", 双: "雙", 变: "變", 叶: "葉", 号: "號", 后: "後",
    启: "啟", 员: "員", 呜: "嗚", 咏: "詠", 响: "響", 圣: "聖", 场: "場", 坛: "壇",
    坏: "壞", 块: "塊", 坚: "堅", 垒: "壘", 坟: "墳", 壮: "壯", 声: "聲", 壳: "殼",
    处: "處", 备: "備", 复: "復", 头: "頭", 夺: "奪", 奋: "奮", 妇: "婦", 妈: "媽",
    娇: "嬌", 娱: "娛", 婴: "嬰", 孙: "孫", 宁: "寧", 宝: "寶", 实: "實", 审: "審",
    宫: "宮", 家: "家", 宽: "寬", 宾: "賓", 寻: "尋", 导: "導", 尘: "塵", 尧: "堯",
    层: "層", 岁: "歲", 岛: "島", 岭: "嶺", 岁: "歲", 帅: "帥", 师: "師", 帐: "帳",
    带: "帶", 干: "幹", 并: "並", 广: "廣", 庆: "慶", 库: "庫", 庙: "廟", 废: "廢",
    开: "開", 异: "異", 张: "張", 归: "歸", 当: "當", 录: "錄", 彻: "徹", 志: "誌",
    忧: "憂", 怀: "懷", 态: "態", 怜: "憐", 总: "總", 恒: "恆", 恶: "惡", 恼: "惱",
    战: "戰", 戏: "戲", 户: "戶", 执: "執", 扩: "擴", 扫: "掃", 扬: "揚", 护: "護",
    报: "報", 担: "擔", 拟: "擬", 拥: "擁", 择: "擇", 挂: "掛", 挡: "擋", 挤: "擠",
    挥: "揮", 损: "損", 换: "換", 据: "據", 授: "授", 掉: "掉", 排: "排", 探: "探",
    接: "接", 控: "控", 推: "推", 掩: "掩", 掷: "擲", 提: "提", 插: "插", 握: "握",
    摄: "攝", 摆: "擺", 摊: "攤", 敌: "敵", 数: "數", 断: "斷", 无: "無", 旧: "舊",
    旷: "曠", 显: "顯", 晓: "曉", 暂: "暫", 术: "術", 机: "機", 杀: "殺", 杂: "雜",
    权: "權", 条: "條", 来: "來", 杰: "傑", 极: "極", 构: "構", 枢: "樞", 枪: "槍",
    栏: "欄", 树: "樹", 样: "樣", 核: "核", 档: "檔", 桥: "橋", 梦: "夢", 检: "檢",
    楼: "樓", 标: "標", 栈: "棧", 荣: "榮", 栖: "棲", 样: "樣", 档: "檔",
  };
  return [...text].map(ch => map[ch] ?? ch).join("");
}

/** { faction, subculture } -> type -> { en, zh, tw } name lists. [male] or [male, female] when they differ. */
export function collectAgentNames(enRows, zhRows) {
  const buckets = { faction: {}, subculture: {} };
  const take = (rows, lang) => {
    for (const [key, text] of rows) {
      const parsed = parseAgentNameKey(key, AGENT_FAC_PREFIX) ?? parseAgentNameKey(key, AGENT_SUB_PREFIX);
      if (!parsed || !text) continue;
      const group = key.startsWith(AGENT_FAC_PREFIX) ? "faction" : "subculture";
      const slot = (((buckets[group][parsed.owner] ??= {})[parsed.type] ??= {})[lang] ??= {});
      slot[parsed.gender] = text.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1").trim();
    }
  };
  take(enRows, "en");
  take(zhRows, "zh");
  const pack = (group) => {
    const out = {};
    for (const [owner, types] of Object.entries(group)) {
      const packed = {};
      for (const [type, langs] of Object.entries(types)) {
        const names = {};
        for (const lang of ["en", "zh"]) {
          const g = langs[lang];
          if (!g) continue;
          const male = g.m || g.f;
          const female = g.f || g.m;
          if (!male) continue;
          names[lang] = female && female !== male ? [male, female] : [male];
        }
        if (names.zh) names.tw = names.zh.map(toTraditionalAgentTitle);
        if (names.en || names.zh) packed[type] = names;
      }
      if (Object.keys(packed).length) out[owner] = packed;
    }
    return out;
  };
  return { faction: pack(buckets.faction), subculture: pack(buckets.subculture) };
}

function locRows(packPath, pred) {
  if (!packPath || !fs.existsSync(packPath)) return [];
  const index = readPackIndex(packPath);
  const rows = [];
  for (const e of index.entries) {
    if (!e.path.toLowerCase().endsWith(".loc")) continue;
    for (const pair of parseLoc(readEntry(packPath, e))) if (!pred || pred(pair[0])) rows.push(pair);
  }
  return rows;
}

export function writeAgentNames(game, modPacks, outFile) {
  const enPack = path.join(game, "data", "local_en.pack");
  const chinese = modPacks.filter(p => /(^|[^a-z])cn([^a-z]|$)|chinese|zh/i.test(path.basename(p)) || /[\u4e00-\u9fff]/.test(path.basename(p)));
  // Base-game titles. A DEI language pack renames some of them and must not replace the vanilla list.
  const vanillaZh = chinese.filter(p => !/dei/i.test(path.basename(p)));
  const zhPacks = vanillaZh.length ? vanillaZh : chinese;
  const want = (key) => key.startsWith(AGENT_FAC_PREFIX) || key.startsWith(AGENT_SUB_PREFIX);
  const enRows = locRows(enPack, want);
  const zhRows = [];
  for (const p of zhPacks) zhRows.push(...locRows(p, want));
  const table = collectAgentNames(enRows, zhRows);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(table));
  const n = (g) => Object.keys(g).length;
  console.log(`agents: ${n(table.faction)} faction overrides, ${n(table.subculture)} subcultures -> ${outFile}`);
  return table;
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
  // "base game only" in vanilla (mod unit keys do not exist there) and DEI's own units in DEI.
  const unitPrefix = "land_units_onscreen_name_";
  const gameUnits = locEntries(path.join(game, "data", "local_en.pack"));
  const deiUnits = deiUnitKeys(modPacks);
  const units = {};
  const collect = (packs, lang) => {
    for (const p of packs) {
      if (!fs.existsSync(p)) continue;
      for (const [k, v] of locEntries(p)) {
        if (!k.startsWith(unitPrefix)) continue;
        const key = k.slice(unitPrefix.length);
        units[key] ??= { game: gameUnits.has(k), ...(deiUnits.has(key) ? { dei: true } : {}) };
        units[key][lang] = v;
      }
    }
  };
  collect(enPacks, "en");
  collect(zhPacks.filter(isChinese), "zh");
  fs.writeFileSync(path.join(outDir, "units.json"), JSON.stringify(units));
  const count = (flag) => Object.values(units).filter(u => u[flag]).length;
  console.log(`units: ${Object.keys(units).length} (${count("game")} base game, ${count("dei")} DEI)`);

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
  writeAgentNames(game, modPacks, path.join(outDir, "agents.json"));
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) main();
