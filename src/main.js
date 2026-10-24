import "./style.css";
import { FileBridge, assertOk, chooseDirectory, reusableDirectory, supportsFileSystemAccess } from "./protocol.js";
import { DemoBridge } from "./sample.js";
import { MapView, coordinateModel, factionColor, inferRegionPositions, nearest } from "./map.js";
import { LANGUAGES, createI18n, detectLanguage } from "./strings.js";
import { RegionLookup } from "./regionLookup.js";
import { flagImage, flagInfo, loadFlagIndex, setFlagReadyCallback } from "./flags.js";
import { buildingDisplayName, cultureDisplayName, factionDisplayName, loadLoc, personName, provinceDisplayName, regionDisplayName, subcultureDisplayName, unitCatalogue } from "./loc.js";

const i18n = createI18n(localStorage.getItem("r2we.lang") || detectLanguage(navigator.language ?? ""));
const t = i18n.t;

// The app starts disconnected: no bridge, no data, only the campaign map image. `?demo=1` is a
// development hook that answers from src/sample.js instead of a real bridge folder.
const state = {
  mode: "disconnected",   // disconnected | live | demo
  bridge: null,
  info: null,
  factions: [],
  regions: [],
  characters: [],
  coords: null,
  sheet: null,            // diplomacy | console | null
  selected: null,         // { kind: character|region|faction, item }
  diploB: null,           // counterpart faction chosen in the faction drawer's diplomacy section
  factionFilter: "all",
  showSettlements: true,
  showArmies: true,
  showNavies: true,
  showAgents: true,
  search: "",
  log: [],
  busy: 0,
};

const root = document.querySelector("#root");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (Number.isFinite(n) ? Number(n).toLocaleString() : "—");
const factionName = (key) => state.factions.find(f => f.key === key)?.name ?? factionDisplayName(key) ?? flagInfo(key)?.name ?? key ?? "—";
const regionName = (key) => state.regions.find(r => r.key === key)?.name ?? regionDisplayName(key) ?? key ?? "—";
const charName = (c) => [c.forename, c.surname].filter(Boolean).join(" ") || `cqi ${c.cqi}`;

// The game's Lua hands back keys (rom_rome, names_name_123) instead of display text; resolve them
// once from the extracted loc tables so every view can use .name / .forename directly.
// Raw values from the game are kept in *_key fields so a language switch can re-localise from them.
function localiseData() {
  const fromGame = (raw, key) => raw && raw !== key;   // the game already sent display text
  for (const f of state.factions) {
    f.name_key ??= f.name;
    f.name = fromGame(f.name_key, f.key) ? f.name_key : (factionDisplayName(f.key) ?? flagInfo(f.key)?.name ?? f.key);
    // Culture group first ("Roman"), the subculture when the group has no loc (mod cultures), the raw key last.
    f.subculture_name = subcultureDisplayName(f.subculture) ?? "";
    f.culture_name = cultureDisplayName(f.culture) ?? (f.subculture_name || f.culture || "—");
  }
  for (const r of state.regions) {
    r.name_key ??= r.name;
    r.name = fromGame(r.name_key, r.key) ? r.name_key : (regionDisplayName(r.key) ?? r.key);
    r.province_name = provinceDisplayName(r.province) ?? r.province;
  }
  for (const c of state.characters) {
    c.forename_key ??= c.forename;
    c.surname_key ??= c.surname;
    c.forename = personName(c.forename_key);
    c.surname = personName(c.surname_key);
  }
}

/** Localised character type ("general", "spy", …). */
const typeLabel = (c) => t(`types.${c.type}`) === `types.${c.type}` ? (c.type ?? "—") : t(`types.${c.type}`);
/** A request type is usable when the connected bridge lists a handler for it. */
const can = (type) => Boolean(state.info?.capabilities?.[type]);

// ---------------------------------------------------------------- shell

function shell() {
  root.innerHTML = `
    <header>
      <div class="brand"><span class="crest">R2</span><h1>${t("title")}</h1></div>
      <div class="status">
        <span class="campaign-info" id="campaignInfo"></span>        <button id="connect"></button>
        <button id="refresh">${t("refresh")}</button>
        <button id="langBtn" class="ghost">${LANGUAGES.find(l => l.code === i18n.lang)?.label ?? i18n.lang}</button>
      </div>
    </header>
    <div class="stage">
      <canvas id="mapCanvas"></canvas>
      <div class="map-tools">
        ${["diplomacy", "console"].map(k => `<button data-sheet="${k}">${t(`tabs.${k}`)}</button>`).join("")}
        <span class="sep"></span>
        <label class="toggle"><input type="checkbox" id="showSettlements" ${state.showSettlements ? "checked" : ""}> ${t("settlements")}</label>
        <label class="toggle"><input type="checkbox" id="showArmies" ${state.showArmies ? "checked" : ""}> ${t("showArmies")}</label>
        <label class="toggle"><input type="checkbox" id="showNavies" ${state.showNavies ? "checked" : ""}> ${t("showNavies")}</label>
        <label class="toggle"><input type="checkbox" id="showAgents" ${state.showAgents ? "checked" : ""}> ${t("showAgents")}</label>
        <select id="mapFactionFilter"></select>
        <button id="resetView" class="ghost">${t("resetView")}</button>
      </div>
      <div id="tooltip" class="tooltip" hidden></div>
      <aside id="drawer" class="drawer" hidden></aside>
      <section id="sheet" class="sheet" hidden></section>
      <p class="hint">${t("mapHint")}</p>
    </div>
    <div id="toast" class="toast"></div>
    <dialog id="dialog"></dialog>`;
  document.querySelector("#connect").onclick = connect;
  document.querySelector("#refresh").onclick = () => loadAll();
  document.querySelector("#langBtn").onclick = cycleLanguage;  document.querySelectorAll("[data-sheet]").forEach(b => b.onclick = () => { state.sheet = state.sheet === b.dataset.sheet ? null : b.dataset.sheet; renderSheet(); });
  for (const id of ["showSettlements", "showArmies", "showNavies", "showAgents"]) {
    document.querySelector(`#${id}`).onchange = e => { state[id] = e.target.checked; feedMap(); };
  }
  document.querySelector("#mapFactionFilter").onchange = e => { state.factionFilter = e.target.value; feedMap(); };
  document.querySelector("#resetView").onclick = () => map?.resetView();
  mountMap();
  updateHeader();
}

function updateHeader() {
  document.querySelector("#connect").textContent = state.mode === "live" ? t("change") : t("connect");
  const info = state.info;
  document.querySelector("#campaignInfo").textContent = info
    ? `${factionName(info.player_faction)} · ${t("turn")} ${info.turn ?? "?"}`
    : "";
  const sel = document.querySelector("#mapFactionFilter");
  sel.innerHTML = `<option value="all">${t("filterAll")}</option>${state.factions.filter(f => !f.is_dead).map(f => `<option value="${esc(f.key)}" ${state.factionFilter === f.key ? "selected" : ""}>${esc(f.name)}</option>`).join("")}`;
  document.querySelectorAll("[data-sheet]").forEach(b => b.classList.toggle("active", b.dataset.sheet === state.sheet));
}

function renderAll() { updateHeader(); feedMap(); renderDrawer(); renderSheet(); }

// ---------------------------------------------------------------- map

let map = null;
function mountMap() {
  const canvas = document.querySelector("#mapCanvas");
  if (!canvas) return;
  map = new MapView(canvas, {
    onHover: (hit, e) => tooltip(hit, e),
    onSelect: (hit) => onMarkerClick(hit),
    onEmptyClick: (world, fraction) => onEmptyClick(world, fraction),
    onContextMenu: (world, hit) => createForceDialog(world, hit),
  });
  setFlagReadyCallback(() => map?.draw());
  feedMap();
  loadBackground();
}

const isLandArmy = (c) => Boolean(c.has_force && !c.is_navy && !c.is_agent);

// Forces inside a settlement (the garrison, including a docked navy) are not drawn and have no panel.
function visibleCharacters() {
  return state.characters.filter(c =>
    (state.factionFilter === "all" || c.faction === state.factionFilter) &&
    (state.showArmies || !isLandArmy(c)) &&
    (state.showNavies || !c.is_navy) &&
    (state.showAgents || !c.is_agent) &&
    !c.in_settlement);
}

function feedMap() {
  if (!map) return;
  const regions = state.showSettlements
    ? state.regions.filter(r => state.factionFilter === "all" || r.owner === state.factionFilter)
    : [];
  map.setData({ characters: visibleCharacters(), regions, colors: factionColor, flag: flagImage, pos: mapPos });
  if (state.selected?.kind === "character") map.select(`character:${state.selected.item.cqi}`);
  else if (state.selected?.kind === "region") map.select(`region:${state.selected.item.key}`);
  else map.select(null);
}

function tooltip(hit, e) {
  const el = document.querySelector("#tooltip");
  if (!el) return;
  if (!hit) { el.hidden = true; return; }
  const item = hit.item;
  el.hidden = false;
  el.innerHTML = hit.kind === "character"
    ? `<b>${esc(charName(item))}</b><br>${esc(factionName(item.faction))} · ${esc(typeLabel(item))}${item.has_force ? ` · ${item.units ?? "?"} ${t("units")}` : ""}<br><small>${item.lx}, ${item.ly}</small>`
    : `<b>${esc(item.name)}</b><br>${esc(factionName(item.owner))}<br><small>${esc(item.province_name ?? "")}</small>`;
  const wrap = el.parentElement.getBoundingClientRect();
  el.style.left = `${Math.min(e.clientX - wrap.left + 14, wrap.width - 240)}px`;
  el.style.top = `${e.clientY - wrap.top + 14}px`;
}

function onMarkerClick(hit) {
  state.selected = hit;
  state.sheet = null;
  renderSheet();
  renderDrawer();
  feedMap();
}

function onEmptyClick() {
  state.selected = null;
  renderDrawer();
  feedMap();
}

// Only the Grand Campaign (main_rome) is supported. The map is plotted in LOGICAL tiles, like the WH2
// editor: the terrain image (public/maps, from the game's packs) spans the whole logical grid.
// 1016x720 is exact: all 173 live settlements fall inside their own region of
// campaign_maps\main_rome_map\main_rome_lookup.tga only for this grid.
const CAMPAIGN = "main_rome";
const MAP_BOUNDS = { minX: 0, maxX: 1016, minY: 0, maxY: 720 };

/** Map position of any entity: logical tiles, falling back to the fitted display->logical model. */
function mapPos(item) {
  if (Number.isFinite(item.lx) && Number.isFinite(item.ly)) return { x: item.lx, y: item.ly };
  if (state.coords && Number.isFinite(item.x)) return state.coords.toLogical(item.x, item.y);
  return { x: NaN, y: NaN };
}

let mapImage;   // undefined = not loaded yet, null = failed
const lookup = new RegionLookup();
async function loadBackground() {
  if (mapImage === undefined) {
    // language-neutral terrain map first (no baked labels), the small PNG minimap as fallback
    mapImage = null;
    for (const file of [`${CAMPAIGN}_terrain.jpg`, `${CAMPAIGN}.png`]) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}maps/${file}`;
      try { await img.decode(); mapImage = img; break; } catch { /* try next */ }
    }
  }
  map?.setBackground(mapImage, MAP_BOUNDS);
  if (await lookup.load(CAMPAIGN)) lookup.learn(state.regions, MAP_BOUNDS);
}

/**
 * Region under a logical tile. With the lookup raster loaded, any index that no settlement taught us
 * (sea regions, wilderness) is treated as not droppable; without a raster, fall back to the nearest settlement.
 */
function regionUnder(lx, ly) {
  if (lookup.indices && lookup.keys.size) {
    const key = lookup.regionAt(lx, ly, MAP_BOUNDS);
    return key ? { key, source: "lookup" } : { key: null, source: "sea" };
  }
  const near = nearest(state.regions, lx, ly, mapPos);
  return { key: near?.item.key ?? null, source: "nearest" };
}

// ---------------------------------------------------------------- data

const DIR_DB = "r2we";
const DIR_KEY = "bridge-dir";

function dirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DIR_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savedDirectory() {
  try {
    const db = await dirDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(DIR_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function rememberDirectory(dir) {
  const db = await dirDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(dir, DIR_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function useDirectory(dir, { quiet = false } = {}) {
  const bridge = new FileBridge(dir);
  const ready = await bridge.isAlive();
  state.bridge = bridge;
  state.mode = "live";
  state.selected = null;
  if (!quiet || !ready) toast(ready ? t("connected") : t("notReady"));
  updateHeader();
  await loadAll();
}

async function connect() {
  if (!supportsFileSystemAccess()) { toast(t("needsChromium")); return; }
  let dir;
  try {
    dir = await chooseDirectory({
      saved: state.mode === "live" ? null : await savedDirectory(),
      requestPermission: (handle) => handle.requestPermission({ mode: "readwrite" }),
      pick: () => window.showDirectoryPicker({ id: "rome2-web-editor", mode: "readwrite" }),
      forcePick: state.mode === "live",
    });
  } catch (e) {
    if (e.name !== "AbortError") toast(e.message);
    return;
  }
  try { await rememberDirectory(dir); } catch { /* connecting still works this session */ }
  await useDirectory(dir);
}

async function restoreDirectory() {
  if (!supportsFileSystemAccess()) return;
  const dir = await reusableDirectory(await savedDirectory(), (handle) => handle.queryPermission({ mode: "readwrite" }));
  if (dir) await useDirectory(dir, { quiet: true });
}

let loading = null;
function loadAll() {
  if (!state.bridge) return Promise.resolve();
  if (!loading) loading = loadAllNow().finally(() => { loading = null; });
  return loading;
}

async function fetchSnapshot() {
  // One request when the bridge supports it; the four-call fallback keeps older packs working.
  const snap = await state.bridge.request("get_snapshot");
  if (snap && snap.ok !== false && snap.info) return snap;
  const info = await state.bridge.request("get_game_info");
  const [factions, regions, characters] = await Promise.all([
    state.bridge.request("get_factions"),
    state.bridge.request("get_regions_detailed"),
    state.bridge.request("get_active_characters"),
  ]);
  return { info, factions, regions, characters };
}

async function loadAllNow() {
  busy(1);
  try {
    const { info, factions, regions, characters } = await fetchSnapshot();
    slotCache.clear();    state.info = info;
    state.factions = Array.isArray(factions) ? factions : [];
    state.characters = Array.isArray(characters) ? characters : [];
    state.coords = coordinateModel([...state.characters, ...(Array.isArray(regions) ? regions : [])]);
    state.regions = inferRegionPositions(Array.isArray(regions) ? regions : [], state.characters).map(r => {
      if (Number.isFinite(r.x) || !state.coords || !Number.isFinite(r.lx)) return r;
      return { ...r, ...state.coords.toDisplay(r.lx, r.ly), position_source: "logical" };
    });
    localiseData();
    if (state.selected?.kind === "character") {
      const fresh = state.characters.find(c => c.cqi === state.selected.item.cqi);
      state.selected = fresh && !fresh.in_settlement ? { kind: "character", item: fresh } : null;
    } else if (state.selected?.kind === "region") {
      const fresh = state.regions.find(r => r.key === state.selected.item.key);
      state.selected = fresh ? { kind: "region", item: fresh } : null;
    } else if (state.selected?.kind === "faction") {
      const fresh = state.factions.find(f => f.key === state.selected.item.key);
      state.selected = fresh ? { kind: "faction", item: fresh } : null;
    }
    pushLog("refresh", {}, { factions: state.factions.length, regions: state.regions.length, characters: state.characters.length });
  } catch (e) {
    toast(e.message);
    pushLog("refresh", {}, null, e.message);
  } finally {
    busy(-1);
  }
  loadBackground();
  renderAll();
}

async function run(type, args = {}, { refresh = true, label } = {}) {
  if (!state.bridge) { toast(t("notConnected")); return null; }
  busy(1);
  try {
    const result = assertOk(await state.bridge.request(type, args), label ?? type);
    pushLog(type, args, result);
    toast(`${label ?? type}: OK`);
    if (refresh) await loadAll(); else renderAll();
    return result;
  } catch (e) {
    pushLog(type, args, null, e.message);
    toast(e.message);
    renderAll();
    return null;
  } finally {
    busy(-1);
  }
}

function pushLog(type, args, result, error) {
  state.log.unshift({ time: new Date().toLocaleTimeString(), type, args, result, error });
  state.log.length = Math.min(state.log.length, 100);
}

function busy(delta) {
  state.busy = Math.max(0, state.busy + delta);
  document.body.classList.toggle("busy", state.busy > 0);
}

let toastTimer = null;
function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

// ---------------------------------------------------------------- drawer (selection panel)

function action(icon, label, type, attrs = "") {
  return `<button class="action" data-run="${type}" ${attrs} ${can(type) ? "" : "disabled"}><i>${icon}</i><span>${label}</span></button>`;
}

function dialogAction(icon, label, dialog, type, extra = "") {
  return `<button class="action" data-dialog="${dialog}" ${extra} ${can(type) ? "" : "disabled"}><i>${icon}</i><span>${label}</span></button>`;
}

function field(label, value) { return `<div class="field"><small>${label}</small><div>${value}</div></div>`; }

function flagImg(key, size = 28) {
  const info = flagInfo(key);
  return info ? `<img class="flag" src="${import.meta.env.BASE_URL}flags/${encodeURIComponent(info.flag)}/mon_64.png" width="${size}" height="${size}" alt="">` : `<i class="dot" style="background:${factionColor(key)}"></i>`;
}

function factionSelect(id, value, extra = "") {
  return `<select id="${id}" ${extra}>${state.factions.filter(f => !f.is_dead).map(f => `<option value="${esc(f.key)}" ${f.key === value ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>`;
}

function regionSelect(id, value) {
  const sorted = [...state.regions].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return `<select id="${id}">${sorted.map(r => `<option value="${esc(r.key)}" ${r.key === value ? "selected" : ""}>${esc(r.name)} — ${esc(factionName(r.owner))}</option>`).join("")}</select>`;
}

function renderDrawer() {
  const drawer = document.querySelector("#drawer");
  if (!drawer) return;
  const sel = state.selected;
  drawer.hidden = !sel;
  if (!sel) return;
  const body = sel.kind === "character" ? characterDrawer(sel.item) : sel.kind === "region" ? regionDrawer(sel.item) : factionDrawer(sel.item);
  drawer.innerHTML = `<div class="drawer-head"><span>${body.title}</span><button id="drawerClose" class="ghost" title="${t("cancel")}">✕</button></div>${body.html}`;
  drawer.querySelector("#drawerClose").onclick = () => { state.selected = null; renderDrawer(); feedMap(); };
  bindActions(drawer);
}

function characterDrawer(c) {
  const title = c.is_agent ? t("agent") : c.is_navy ? t("admiral") : c.has_force ? t("lord") : t("character");
  const html = `
    <div class="drawer-body">
      <div class="identity">${flagImg(c.faction, 40)}<div><b>${esc(charName(c))}</b><small>${esc(factionName(c.faction))}</small></div></div>
      ${field(t("name"), esc(charName(c)))}
      ${field(t("faction"), esc(factionName(c.faction)))}
      ${field(t("typeSubtype"), `${esc(typeLabel(c))}${c.faction_leader ? ` · ${t("leader")}` : ""}${c.has_force ? ` · ${c.is_navy ? t("navy") : t("army")} · ${c.units ?? "?"} ${t("units")}` : ""}`)}
      ${field(t("logicalPos"), `${c.lx}, ${c.ly}`)}
      ${field("CQI", c.cqi)}
      ${field(t("region"), esc(regionName(c.region)))}
      <h4>${t("actions")}</h4>
      <div class="action-list">
        ${dialogAction("▲", t(c.is_agent ? "agentExperience" : "generalExperience"), "experience", "add_agent_experience", `data-cqi="${c.cqi}"`)}
        ${c.has_force ? dialogAction("▲", t("unitExperience"), "unitExperience", "add_force_experience", `data-cqi="${c.cqi}"`) : ""}
        ${action("↻", t("replenish"), "replenish_action_points", `data-args='{"cqi":${c.cqi}}' data-norefresh="1"`)}
        ${action("∅", t("zeroAp"), "zero_action_points", `data-args='{"cqi":${c.cqi}}' data-norefresh="1"`)}
      </div>
    </div>`;
  return { title, html };
}

function regionDrawer(r) {
  const html = `
    <div class="drawer-body">
      <div class="identity">${flagImg(r.owner, 40)}<div><b>${esc(r.name)}</b><small>${esc(factionName(r.owner))}</small></div></div>
      ${field(t("name"), `${esc(r.name)}, ${esc(r.province_name ?? r.province ?? "—")}`)}
      ${field(t("faction"), esc(factionName(r.owner)))}
      ${field(t("logicalPosSettlement"), Number.isFinite(r.lx) ? `${r.lx}, ${r.ly}` : "—")}
      ${field(t("publicOrder"), esc(r.public_order ?? "—"))}
      ${can("get_settlement_slots") ? `<h4>${t("buildings")}</h4><div class="slot-list" id="slotList">${slotsHtml(r)}</div>` : ""}
      <h4>${t("actions")}</h4>
      <div class="action-list">
        ${dialogAction("⇄", t("transfer"), "transfer", "transfer_region_to_faction", `data-region="${esc(r.key)}"`)}
        ${dialogAction("☺", t("publicOrder"), "publicOrder", "set_public_order", `data-region="${esc(r.key)}"`)}
        ${dialogAction("▲", t("develop"), "develop", "add_development_points_to_region", `data-region="${esc(r.key)}"`)}
        ${action("⚒", t("repair"), "instantly_repair_building", `data-args='${esc(JSON.stringify({ region: r.key }))}' data-norefresh="1"`)}
        ${Number.isFinite(r.lx) ? action("⚑", t("rebellion"), "force_rebellion_in_region", `data-args='${esc(JSON.stringify({ region: r.key, units: 4, x: r.lx, y: r.ly }))}'`) : ""}
      </div>
    </div>`;
  return { title: t("settlement"), html };
}

// Settlement slots are fetched when a settlement is opened and dropped on every refresh.
const slotCache = new Map();   // region key -> slots[] | "loading" | Error message
function slotsHtml(r) {
  const slots = slotCache.get(r.key);
  if (slots === undefined) { loadSlots(r.key); return `<small>…</small>`; }
  if (slots === "loading") return `<small>…</small>`;
  if (typeof slots === "string") return `<small>${esc(slots)}</small>`;
  const owner = state.factions.find(f => f.key === r.owner);
  const button = (s, kind, icon, label, show) => show ? `<button class="ghost slot-btn" data-slot="${kind}" data-index="${s.index}" title="${esc(label)}">${icon}</button>` : "";
  // The script API cannot read a building's health, so repair is offered on every building.
  return slots.map(s => `<div class="slot-row"><span class="slot-index">${s.index + 1}</span>${s.building
    ? `<span title="${esc(s.building)}">${esc(buildingName(s.building, owner))}</span>`
    : `<span class="muted">${t("emptySlot")}</span>`}<span class="slot-actions">${
    button(s, "repair", "⚒", t("repairBuilding"), s.building && can("repair_building"))}</span></div>`).join("");
}

const buildingName = (key, owner) => buildingDisplayName(key, owner?.culture, owner?.subculture) ?? key;

async function repairSlot(r, index) {
  const type = "repair_building";
  const args = { region: r.key, slot: index };
  busy(1);
  try {
    const res = assertOk(await state.bridge.request(type, args), type);
    pushLog(type, args, res);
    toast(`${t("repairBuilding")}: OK`);
  } catch (e) {
    pushLog(type, args, null, e.message);
    toast(e.message);
  } finally { busy(-1); }
}

async function loadSlots(regionKey) {
  slotCache.set(regionKey, "loading");
  try {
    const res = assertOk(await state.bridge.request("get_settlement_slots", { region: regionKey }), "get_settlement_slots");
    slotCache.set(regionKey, Array.isArray(res.slots) ? res.slots : []);
  } catch (e) {
    slotCache.set(regionKey, e.message);
  }
  const el = document.querySelector("#slotList");
  const r = state.selected?.kind === "region" ? state.selected.item : null;
  if (el && r?.key === regionKey) { el.innerHTML = slotsHtml(r); bindActions(el); }
}

function factionDrawer(f) {
  const html = `
    <div class="drawer-body">
      <div class="identity">${flagImg(f.key, 40)}<div><b>${esc(f.name)}</b><small>${esc(f.culture_name)}</small></div></div>
      ${field(t("culture"), `${esc(f.culture_name)}${f.subculture_name && f.subculture_name !== f.culture_name ? ` · ${esc(f.subculture_name)}` : ""}`)}
      ${field(t("treasury"), fmt(f.treasury))}
      ${field(t("regionsCol"), `${f.regions} · ${t("forcesCol")} ${f.forces} · ${f.is_human ? t("human") : "AI"}${f.is_dead ? " · ✝" : ""}`)}
      <h4>${t("nationalTreasury")}</h4>
      <div class="action-list">
        <div class="action-row"><input type="number" id="setTo" value="${esc(f.treasury ?? 0)}" step="500">${action("=", t("setTo"), "treasury_mod", 'data-treasury="set"')}</div>
      </div>
      ${diplomacySection(f)}
    </div>`;
  return { title: t("faction"), html };
}

/** Faction drawer: forced diplomacy between the selected faction (A) and a chosen counterpart (B). */
function diplomacySection(f) {
  const others = state.factions.filter(x => !x.is_dead && x.key !== f.key);
  const player = state.info?.player_faction;
  const b = others.some(x => x.key === state.diploB) ? state.diploB
    : f.key !== player && others.some(x => x.key === player) ? player
    : others[0]?.key;
  return `
      <h4>${t("diplomacy")}</h4>
      <div class="action-list">
        <div class="action-row"><small>${t("factionB")}</small><select id="diploB">${others.map(x => `<option value="${esc(x.key)}" ${x.key === b ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
        ${action("⚔", t("declareWar"), "force_declare_war", 'data-diplo="force_declare_war"')}
        ${action("☮", t("makePeace"), "force_make_peace", 'data-diplo="force_make_peace"')}
        ${action("⚖", t("trade"), "force_make_trade_agreement", 'data-diplo="force_make_trade_agreement"')}
        ${action("♜", t("vassal"), "force_make_vassal", `data-diplo="force_make_vassal" title="${esc(t("vassalHint"))}"`)}
      </div>`;
}

// ---------------------------------------------------------------- sheets (tables)

function renderSheet() {
  const sheet = document.querySelector("#sheet");
  if (!sheet) return;
  updateHeader();
  sheet.hidden = !state.sheet;
  if (!state.sheet) return;
  const views = { diplomacy: factionsView, console: consoleView };
  sheet.innerHTML = `<div class="sheet-head"><span>${t(`tabs.${state.sheet}`)}</span><button id="sheetClose" class="ghost">✕</button></div><div class="sheet-body">${views[state.sheet]()}</div>`;
  sheet.querySelector("#sheetClose").onclick = () => { state.sheet = null; renderSheet(); };
  bindActions(sheet);
}

function factionsView() {
  const q = state.search.toLowerCase();
  const rows = state.factions.filter(f => `${f.name} ${f.culture_name} ${f.subculture_name}`.toLowerCase().includes(q));
  return `
    <div class="toolbar"><input id="search" placeholder="${t("search")}" value="${esc(state.search)}"><span>${rows.length}</span></div>
    <div class="table">
      <div class="thead cols-f"><span>${t("faction")}</span><span>${t("culture")}</span><span>${t("regionsCol")}</span><span>${t("forcesCol")}</span><span>${t("treasury")}</span><span>${t("human")}</span></div>
      ${rows.map(f => `<button class="tr cols-f" data-select-faction="${esc(f.key)}">
        <span>${flagImg(f.key, 20)}${esc(f.name)}</span><span>${esc(f.culture_name)}</span><span>${f.regions}</span><span>${f.forces}</span><span>${fmt(f.treasury)}</span><span>${f.is_human ? "●" : ""}${f.is_dead ? " ✝" : ""}</span></button>`).join("")}
    </div>`;
}

function consoleView() {
  const caps = Object.keys(state.info?.capabilities ?? {}).sort((a, b) => a.localeCompare(b));
  return `
    <div class="columns">
      <section class="panel">
        <h3>${t("rawTitle")}</h3>
        <div class="row"><label>${t("rawType")} <input id="rawType" value="heartbeat" list="rawTypes"></label><datalist id="rawTypes">${caps.map(k => `<option value="${k}">`).join("")}</datalist></div>
        <label>${t("rawArgs")} <textarea id="rawArgs" rows="4">{}</textarea></label>
        <div class="row"><button id="rawSend">${t("send")}</button></div>
        <h3>${t("installTitle")}</h3>
        <ol class="install">
          <li>${t("install1")} <code>powershell.exe mkdir $env:USERPROFILE\\rome2_web_editor_mod</code></li>
          <li>${t("install2")}</li><li>${t("install3")}</li><li>${t("install4")}</li>
        </ol>
        <h3>${t("capabilities")}</h3>
        <div class="caps">${caps.map(k => `<code>${k}</code>`).join("")}</div>
      </section>
      <section class="panel">
        <h3>${t("log")}</h3>
        ${state.log.length ? state.log.map(l => `<details class="logline ${l.error ? "err" : ""}"><summary><span>${l.time}</span> <code>${esc(l.type)}</code> ${l.error ? `<em>${esc(l.error)}</em>` : "OK"}</summary><pre>${esc(JSON.stringify({ args: l.args, result: l.result }, null, 1))}</pre></details>`).join("") : `<p class="muted">${t("noLog")}</p>`}
      </section>
    </div>`;
}

// ---------------------------------------------------------------- bindings

function selectAndCenter(sel) {
  state.selected = sel;
  state.sheet = null;
  renderSheet();
  renderDrawer();
  feedMap();
  const at = sel ? mapPos(sel.item) : null;
  if (at && Number.isFinite(at.x)) map?.centerOn(at.x, at.y, Math.max(map.view.zoom, 3));
}

function bindActions(scope) {
  scope.querySelector("#search")?.addEventListener("input", e => {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    renderSheet();
    const x = document.querySelector("#search"); x?.focus(); x?.setSelectionRange(pos, pos);
  });
  scope.querySelector("#factionFilter")?.addEventListener("change", e => { state.factionFilter = e.target.value; renderSheet(); feedMap(); updateHeader(); });
  scope.querySelector("#diploB")?.addEventListener("change", e => { state.diploB = e.target.value; });
  scope.querySelectorAll("[data-select-faction]").forEach(b => b.onclick = () => {
    const f = state.factions.find(x => x.key === b.dataset.selectFaction);
    state.selected = f ? { kind: "faction", item: f } : null; renderDrawer();
  });
  scope.querySelectorAll("[data-select-region]").forEach(b => b.onclick = () => {
    const r = state.regions.find(x => x.key === b.dataset.selectRegion);
    if (r) selectAndCenter({ kind: "region", item: r });
  });
  scope.querySelectorAll("[data-run]").forEach(b => b.onclick = async () => {
    const type = b.dataset.run;
    let args = b.dataset.args ? JSON.parse(b.dataset.args) : {};
    if (b.dataset.treasury) {
      const f = state.selected?.item;
      args = { faction: f?.key, amount: Number(scope.querySelector("#setTo").value) - Number(f?.treasury ?? 0) };
    }
    if (b.dataset.diplo) {
      const a = state.selected?.item?.key, bb = scope.querySelector("#diploB").value;
      state.diploB = bb;
      args = { a, b: bb };
    }
    await run(type, args, { refresh: !b.dataset.norefresh });
  });
  scope.querySelectorAll("[data-slot]").forEach(b => b.onclick = () => {
    const r = state.selected?.kind === "region" ? state.selected.item : null;
    if (r) repairSlot(r, Number(b.dataset.index));
  });
  scope.querySelectorAll("[data-dialog]").forEach(b => b.onclick = () => {
    const c = b.dataset.cqi ? state.characters.find(x => x.cqi === Number(b.dataset.cqi)) : null;
    const r = b.dataset.region ? state.regions.find(x => x.key === b.dataset.region) : null;
    const open = {
      transfer: () => r && transferDialog(r),
      publicOrder: () => r && publicOrderDialog(r),
      // The character's own experience (general or agent). award_experience_level would rank up the
      // army's units instead, which is the separate unitExperience action.
      experience: () => c && characterExperienceDialog(c),
      unitExperience: () => c && unitExperienceDialog(c),
      develop: () => r && populationSurplusDialog(r),
    }[b.dataset.dialog];
    open?.();
  });
  scope.querySelector("#rawSend")?.addEventListener("click", async () => {
    let args;
    try { args = JSON.parse(scope.querySelector("#rawArgs").value || "{}"); } catch (e) { toast(`JSON: ${e.message}`); return; }
    await run(scope.querySelector("#rawType").value.trim(), args, { refresh: false });
  });
}

// ---------------------------------------------------------------- dialogs

function openDialog(title, body, onConfirm) {
  const dlg = document.querySelector("#dialog");
  dlg.innerHTML = `<form method="dialog"><h2>${title}</h2>${body}<div class="row end"><button value="cancel" class="ghost">${t("cancel")}</button><button value="ok" id="dlgOk">${t("confirm")}</button></div></form>`;
  dlg.onclose = () => { if (dlg.returnValue === "ok") onConfirm(dlg); };
  dlg.showModal();
  return dlg;
}

/** Cheaper than loadAll: only positions/forces change after a character action. */
async function refreshCharacters() {
  try {
    const characters = await state.bridge.request("get_active_characters");
    if (!Array.isArray(characters)) return;
    state.characters = characters;
    localiseData();
    if (state.selected?.kind === "character") {
      const fresh = state.characters.find(c => c.cqi === state.selected.item.cqi);
      state.selected = fresh && !fresh.in_settlement ? { kind: "character", item: fresh } : null;
    }
    feedMap();
    renderDrawer();
  } catch (e) {
    toast(e.message);
  }
}

// ---------------------------------------------------------------- language

async function setLanguage(code) {
  i18n.set(code);
  localStorage.setItem("r2we.lang", code);
  await loadLoc(code);
  shell();
  localiseData();
  renderAll();
}

/** Header language button: each click moves to the next entry of LANGUAGES. */
function cycleLanguage() {
  const i = LANGUAGES.findIndex(l => l.code === i18n.lang);
  return setLanguage(LANGUAGES[(i + 1) % LANGUAGES.length].code);
}

// ---------------------------------------------------------------- unit picker

/** Searchable list of units (base game by default); onPick(key) is called per chosen unit. */
function unitPickerMarkup() {
  return `
    <div class="row"><input id="unitFilter" placeholder="${t("unitFilter")}" autofocus style="flex:1">
      <label class="toggle"><input type="checkbox" id="unitBase" checked> ${t("baseGameOnly")}</label></div>
    <div id="unitList" class="unit-list"></div>`;
}

function bindUnitPicker(dlg, onPick) {
  const list = dlg.querySelector("#unitList");
  const filter = dlg.querySelector("#unitFilter");
  const base = dlg.querySelector("#unitBase");
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = unitCatalogue({ baseGameOnly: base.checked }).filter(u => !q || u.name.toLowerCase().includes(q) || u.key.toLowerCase().includes(q)).slice(0, 300);
    list.innerHTML = rows.map(u => `<button type="button" class="unit-row" data-unit="${esc(u.key)}"><b>${esc(u.name)}</b><small>${esc(u.key)}${u.game ? "" : " · mod"}</small></button>`).join("")
      || `<p class="muted">—</p>`;
    list.querySelectorAll("[data-unit]").forEach(b => b.onclick = () => onPick(b.dataset.unit, b));
  };
  filter.oninput = render;
  base.onchange = render;
render();
}

function createForceDialog(world, hit) {
  if (!can("create_force")) return;
  const logical = { lx: Math.round(world.x), ly: Math.round(world.y) };
  const under = regionUnder(logical.lx, logical.ly);
  if (!under.key) { toast(t("dropSea")); return; }
  const regionRec = state.regions.find(r => r.key === under.key);
  const faction = hit?.item?.faction ?? hit?.item?.owner ?? regionRec?.owner ?? state.info?.player_faction;
  const body = `
    <label>${t("faction")}${factionSelect("cfFaction", faction)}</label>
    <label>${t("targetRegion")}${regionSelect("cfRegion", under.key)}</label>
    <div class="row"><label>${t("logicalX")} <input type="number" id="lx" value="${esc(logical.lx)}"></label><label>${t("logicalY")} <input type="number" id="ly" value="${esc(logical.ly)}"></label></div>
    <label>${t("unitList")}<textarea id="units" rows="2" placeholder="Rom_Hastati,Rom_Hastati,Rom_Principes"></textarea></label>
    ${unitPickerMarkup()}`;
  const dlg = openDialog(t("createTitle"), body, dlg => {
    const units = dlg.querySelector("#units").value.replace(/\s+/g, "");
    if (!units) { toast(t("unitList")); return; }
    run("create_force", { faction: dlg.querySelector("#cfFaction").value, units, region: dlg.querySelector("#cfRegion").value, x: Number(dlg.querySelector("#lx").value), y: Number(dlg.querySelector("#ly").value) });
  });
  bindUnitPicker(dlg, (key) => {
    const area = dlg.querySelector("#units");
    area.value = [area.value.trim(), key].filter(Boolean).join(",");
  });
}

function characterExperienceDialog(c) {
  const title = t(c.is_agent ? "agentExperience" : "generalExperience");
  const body = `
    <p class="muted">${esc(charName(c))}</p>
    <label>${t("points")}<input type="number" id="xpPoints" value="100" autofocus></label>
    <p class="muted">${t(c.is_agent ? "agentXpHint" : "generalXpHint")}</p>`;
  openDialog(title, body, dlg => {
    const points = Number(dlg.querySelector("#xpPoints").value);
    if (Number.isFinite(points)) run("add_agent_experience", { cqi: c.cqi, points }, { label: title });
  });
}

function unitExperienceDialog(c) {
  const body = `
    <p class="muted">${esc(charName(c))} · ${c.units ?? "?"} ${t("units")}</p>
    <label>${t("unitXpAmount")}<input type="number" id="xpLevels" min="1" max="9" value="1"></label>
    <p class="muted">${t("unitXpHint")}</p>`;
  openDialog(t("unitExperience"), body, dlg => {
    const levels = Math.max(1, Math.min(9, Math.floor(Number(dlg.querySelector("#xpLevels").value) || 1)));
    run("add_force_experience", { cqi: c.cqi, levels }, { label: t("unitExperience") });
  });
}

function transferDialog(r) {
  const body = `
    <p class="muted">${esc(r.name)} · ${esc(factionName(r.owner))}</p>
    <label>${t("owner")}${factionSelect("newOwner", r.owner)}</label>`;
  openDialog(t("transfer"), body, dlg => {
    const faction = dlg.querySelector("#newOwner").value;
    if (faction && faction !== r.owner) run("transfer_region_to_faction", { region: r.key, faction });
  });
}

function publicOrderDialog(r) {
  const body = `
    <p class="muted">${esc(r.name)}</p>
    <label>${t("publicOrder")}<input type="number" id="order" value="${Number.isFinite(r.public_order) ? r.public_order : 0}" autofocus></label>
    <p class="muted">${t("publicOrderHint")}</p>`;
  openDialog(t("publicOrder"), body, dlg => {
    const value = Number(dlg.querySelector("#order").value);
    if (Number.isFinite(value)) run("set_public_order", { region: r.key, value }, { label: t("publicOrder") });
  });
}

function populationSurplusDialog(r) {
  const body = `
    <p class="muted">${esc(r.name)}</p>
    <label>${t("populationSurplus")}<input type="number" id="surplus" value="1" autofocus></label>
    <p class="muted">${t("populationSurplusHint")}</p>`;
  openDialog(t("develop"), body, dlg => {
    const points = Number(dlg.querySelector("#surplus").value);
    if (Number.isFinite(points)) run("add_development_points_to_region", { region: r.key, points }, { label: t("develop") });
  });
}

// ---------------------------------------------------------------- boot

// Debug hook: paste a live snapshot ({info, factions, regions, characters}) from the console.
globalThis.__r2we = {
  state,
  get map() { return map; },
  select: (hit) => onMarkerClick(hit),
  regionUnder: (lx, ly) => regionUnder(lx, ly),
  inject(snapshot) {
    if (snapshot.info) state.info = snapshot.info;
    if (snapshot.factions) state.factions = snapshot.factions;
    if (snapshot.characters) state.characters = snapshot.characters;
    if (snapshot.regions) {
      state.coords = coordinateModel([...state.characters, ...snapshot.regions]);
      state.regions = inferRegionPositions(snapshot.regions, state.characters);
    }
    localiseData();
    loadBackground();
    renderAll();
  },
};

if (new URLSearchParams(location.search).get("demo") === "1") {
  state.bridge = new DemoBridge();
  state.mode = "demo";
}
shell();
const assetsReady = Promise.all([loadFlagIndex(), loadLoc(i18n.lang)]).then(() => { localiseData(); renderAll(); });
if (state.mode === "demo") loadAll();
else assetsReady.then(() => restoreDirectory());
