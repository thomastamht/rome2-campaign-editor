// Runs the real Lua bridge inside fengari against a mocked Rome II scripting surface.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fengari from "fengari";
import { hookBlock } from "../tools/build-pack.mjs";

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function newVm({ deiPatch = false } = {}) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const setGlobal = (name, value) => { lua.lua_pushstring(L, to_luastring(value)); lua.lua_setglobal(L, to_luastring(name)); };
  setGlobal("SRC_JSON", read("mod/lua_scripts/rome2_web_editor_json.lua"));
  setGlobal("SRC_BRIDGE", read("mod/lua_scripts/rome2_web_editor.lua"));
  if (deiPatch) {
    setGlobal("SRC_DEI", read("mod/lua_scripts/rome2_web_editor_dei.lua"));
    lua.lua_pushboolean(L, true);
    lua.lua_setglobal(L, to_luastring("WITH_DEI_PATCH"));
  }
  const run = (code) => {
    if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) {
      throw new Error(`lua: ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
  };
  // Evaluate a Lua expression and bring it back through the bridge's own JSON encoder.
  const evalJson = (expr) => {
    run(`__RESULT = JSON.encode(${expr})`);
    lua.lua_getglobal(L, to_luastring("__RESULT"));
    const text = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return JSON.parse(text);
  };
  run(read("test/lua/harness.lua"));
  run(`M = require("lua_scripts.rome2_web_editor"); M.attach(SCRIPTING)`);
  const response = () => { const v = evalJson(`{ text = RESPONSE() }`).text; return v == null ? null : JSON.parse(v); };
  // sent_at matches the harness's os.time(), i.e. a request the browser is still waiting on.
  const request = (obj) => run(`REQUEST(${JSON.stringify(JSON.stringify({ sent_at: 1700000000, ...obj }))})`);
  return { run, evalJson, response, request };
}

test("json: round-trips nested values, unicode and escapes", () => {
  const vm = newVm();
  // JSON null becomes Lua nil, so it cannot survive inside an array; empty tables encode as [].
  const sample = { a: [1, 2.5, -3, "x\"y\\z\n", true, false], o: { k: "罗马 → Roma", n: 0, gone: null }, e: {} };
  const out = vm.evalJson(`JSON.decode(${JSON.stringify(JSON.stringify(sample))})`);
  assert.deepEqual(out, { a: [1, 2.5, -3, "x\"y\\z\n", true, false], o: { k: "罗马 → Roma", n: 0 }, e: [] });
});

test("attach registers persistent listeners; start picks the user-profile folder", () => {
  const vm = newVm();
  const events = vm.evalJson(`(function() local t = {} for k, v in pairs(EVENTS) do t[k] = { n = #v, user_defined = v[1].user_defined } end return t end)()`);
  for (const name of ["NewSession", "FirstTickAfterWorldCreated", "UICreated", "TimeTrigger", "UIDestroyed"]) {
    assert.equal(events[name].n, 1, name);
    assert.equal(events[name].user_defined, false, `${name} must survive ClearEventCallbacks`);
  }
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  assert.deepEqual(vm.evalJson(`{ folder = M.folder, kind = M.folder_kind, request = M.request_file }`), {
    folder: "C:\\Users\\test\\rome2_web_editor_mod",
    kind: "userprofile",
    request: "C:\\Users\\test\\rome2_web_editor_mod\\request.json",
  });
  vm.run(`M.attach(SCRIPTING)`);
  assert.equal(vm.evalJson(`{ n = #EVENTS.TimeTrigger }`).n, 1, "second attach must not duplicate listeners");
  vm.run(`POLL()`);
  const log = vm.evalJson(`{ text = FS["C:\\\\Users\\\\test\\\\rome2_web_editor_mod\\\\bridge.log"] }`).text;
  assert.match(log, /module loaded; USERPROFILE=C:\\Users\\test/);
  assert.match(log, /attached v0\.1\.0/);
  assert.match(log, /ready marker written/);
});

test("the embedded hook block (as built into episodicscripting.lua) compiles and attaches", () => {
  const vm = newVm();
  vm.run(`EVENTS = {}; package.loaded["lua_scripts.rome2_web_editor"] = nil; package.loaded["lua_scripts.rome2_web_editor_json"] = nil; package.preload["lua_scripts.rome2_web_editor"] = nil; package.preload["lua_scripts.rome2_web_editor_json"] = nil; ROME2_WEB_EDITOR = nil`);
  vm.run(hookBlock("SCRIPTING", "test"));
  assert.equal(vm.evalJson(`{ n = #EVENTS.FirstTickAfterWorldCreated }`).n, 1);
  assert.match(vm.evalJson(`{ text = FS["rome2_web_editor_bridge.log"] }`).text, /\[hook:test\] attached/);
});

test("start arms a 0.1s poll; the ready marker waits for the first poll tick", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  assert.deepEqual(vm.evalJson(`TIMERS`), [{ id: "rome2_web_editor_poll:1", t: 0.1 }]);
  assert.equal(vm.evalJson(`{ text = RESPONSE() }`).text, "", "no marker before the campaign clock runs");
  vm.run(`POLL()`);
  const ready = vm.response();
  assert.equal(ready.request_id, 0);
  assert.equal(ready.result.status, "ready");
  assert.equal(ready.result.game, "rome2");
  assert.equal(ready.result.campaign, "main_rome");
  assert.equal(ready.result.turn, 12);
  assert.equal(ready.result.capabilities.treasury_mod, "verified");
  assert.equal(ready.result.capabilities.reveal_all_regions, "verified");
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 2, "the marker tick re-arms the poll");
});

test("a request waiting at the first tick is answered in the same tick as the marker", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "heartbeat", request_id: 7 });
  assert.equal(vm.response().request_id, 7);
  assert.match(vm.evalJson(`{ text = FS["C:\\\\Users\\\\test\\\\rome2_web_editor_mod\\\\bridge.log"] }`).text, /ready marker written/);
});

test("get_regions answers in the WH2 shape and the poll re-arms; duplicate ids are ignored", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_regions", request_id: 1 });
  const r = vm.response();
  assert.equal(r.request_id, 1);
  assert.deepEqual(r.result, { rom_italia_latium: "rom_rome", rom_italia_campania: "rom_rome", rom_africa_zeugitana: "rom_carthage" });
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 2);
  vm.run(`FS["C:\\\\Users\\\\test\\\\rome2_web_editor_mod\\\\response.json"] = "stale"`);
  vm.request({ type: "get_regions", request_id: 1 });
  assert.equal(vm.evalJson(`{ text = RESPONSE() }`).text, "stale", "same request_id must not be re-executed");
});

test("treasury_mod mutates through game_interface and reports the new value", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "treasury_mod", request_id: 2, faction: "rom_rome", amount: 1500 });
  const r = vm.response();
  assert.equal(r.request_id, 2);
  assert.deepEqual(r.result, { ok: true, faction: "rom_rome", treasury: 6500 });
  assert.deepEqual(vm.evalJson(`CALLS[1]`), { name: "treasury_mod", args: ["rom_rome", 1500] });
});

test("transfer_region_to_faction refuses a dead faction and does not call the game", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.run(`FACTIONS.rom_carthage.is_dead = function() return true end`);
  vm.request({ type: "transfer_region_to_faction", request_id: 9, region: "rom_italia_latium", faction: "rom_carthage" });
  assert.match(vm.response().result.error, /dead faction/);
  assert.equal(vm.evalJson(`{ n = #CALLS }`).n, 0);
  assert.equal(vm.evalJson(`REGIONS.rom_italia_latium.owner`), "rom_rome");
});

test("a faction with no region and no army is reported dead even when is_dead() says false", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.run(`FACTIONS.rom_carthage.regions = {}`);
  vm.request({ type: "get_factions", request_id: 10 });
  const byKey = Object.fromEntries(vm.response().result.map(f => [f.key, f]));
  assert.equal(byKey.rom_carthage.is_dead, true);
  assert.equal(byKey.rom_rome.is_dead, false);
});

test("create_force refuses a dead faction and does not call the game", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.run(`FACTIONS.rom_carthage.regions = {}`);
  vm.request({ type: "create_force", request_id: 11, faction: "rom_carthage", units: "Car_Hoplites", region: "rom_italia_latium", x: 42, y: 31 });
  assert.match(vm.response().result.error, /dead faction/);
  assert.equal(vm.evalJson(`{ n = #CALLS }`).n, 0);
});

test("treasury_mod refuses a negative amount, which Rome II silently ignores", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "treasury_mod", request_id: 3, faction: "rom_carthage", amount: -1000 });
  assert.match(vm.response().result.error, /cannot lower a treasury/);
  assert.equal(vm.evalJson(`{ n = #CALLS }`).n, 0);
});

test("unknown faction / unknown type / partial JSON are reported or skipped without crashing", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "treasury_mod", request_id: 3, faction: "rom_nope", amount: 1 });
  assert.equal(vm.response().result.ok, false);
  assert.match(vm.response().result.error, /faction not found: rom_nope/);
  vm.request({ type: "does_not_exist", request_id: 4 });
  assert.match(vm.response().result.error, /unknown request type/);
  vm.run(`REQUEST('{"type":"get_regions","request_id":5')`); // truncated write in progress
  assert.equal(vm.response().request_id, 4, "partial request must be ignored until complete");
  vm.run(`REQUEST('{"type":"get_regions","request_id":5}')`);
  assert.equal(vm.response().request_id, 5);
  assert.equal(vm.evalJson(`{ active = M.active, pending = M.timer_pending }`).active, true);
});

test("get_active_characters lists map characters with both coordinate systems", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_active_characters", request_id: 6 });
  const chars = vm.response().result;
  assert.equal(chars.length, 3, "politician without a force is off-map");
  const general = chars.find(c => c.cqi === 101);
  assert.equal(general.faction, "rom_rome");
  assert.equal(general.forename, "Gaius");
  assert.equal(general.units, 3);
  assert.equal(general.is_general, true);
  assert.equal(general.region, "rom_italia_latium");
  assert.deepEqual([general.x, general.y, general.lx, general.ly], [421.5, 312.25, 42, 31]);
  assert.equal(chars.find(c => c.cqi === 102).is_agent, true);
  assert.equal(chars.find(c => c.cqi === 102).male, true);
});

test("positions_only follows the same characters and leaves out names and forces", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_active_characters", request_id: 6, positions_only: true });
  const chars = vm.response().result;
  assert.equal(chars.length, 3, "politician without a force is off-map");
  const general = chars.find(c => c.cqi === 101);
  assert.equal(general.faction, undefined);
  assert.equal(general.forename, undefined);
  assert.equal(general.units, undefined);
  assert.equal(general.in_settlement, false);
  assert.deepEqual([general.x, general.y, general.lx, general.ly], [421.5, 312.25, 42, 31]);
  assert.equal(general.region, "rom_italia_latium", "region follows a walking army");
  assert.ok(chars.some(c => c.cqi === 102));
  assert.ok(!chars.some(c => c.cqi === 103));
});

test("get_snapshot bundles info, factions, regions and characters in one reply", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_snapshot", request_id: 20 });
  const snap = vm.response().result;
  assert.equal(snap.info.campaign, "main_rome");
  assert.equal(snap.factions.length, 2);
  assert.equal(snap.regions.length, 3);
  assert.equal(snap.characters.length, 3);
});

test("get_factions and get_regions_detailed use localised names when available", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_factions", request_id: 7 });
  const factions = vm.response().result;
  assert.deepEqual(factions.map(f => [f.key, f.name, f.treasury, f.is_human, f.regions]), [
    ["rom_rome", "Rome", 5000, true, 2],
    ["rom_carthage", "Carthage", 3000, false, 1],
  ]);
  vm.request({ type: "get_regions_detailed", request_id: 8 });
  const latium = vm.response().result.find(r => r.key === "rom_italia_latium");
  assert.equal(latium.name, "Latium");
  assert.equal(latium.owner, "rom_rome");
  assert.deepEqual([latium.x, latium.y, latium.lx, latium.ly], [420, 310, 42, 31]);
  const campania = vm.response().result.find(r => r.key === "rom_italia_campania");
  assert.equal(campania.name, "rom_italia_campania", "falls back to the key without a localisation entry");
});

test("create_agent queues a spy, dignitary or champion at logical coordinates", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "create_agent", request_id: 30, faction: "rom_rome", agent_type: "spy", region: "rom_italia_latium", x: 42, y: 31 });
  const result = vm.response().result;
  assert.equal(result.ok, true);
  assert.equal(result.queued, true);
  assert.equal(result.agent_type, "spy");
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), {
    name: "create_agent",
    args: ["rom_rome", "spy", "", 42, 31, result.id, true],
  });
  vm.request({ type: "create_agent", request_id: 31, faction: "rom_rome", agent_type: "general", region: "rom_italia_latium", x: 42, y: 31 });
  assert.match(vm.response().result.error, /unknown agent type/);
  assert.equal(vm.evalJson(`CALLS`).length, 1, "a rejected type must not reach the game");
});

test("reveal_all_regions lifts the shroud over every region for the player, or a given faction", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "reveal_all_regions", request_id: 40 });
  assert.deepEqual(vm.response().result, { ok: true, faction: "rom_rome", regions: 3 });
  assert.deepEqual(vm.evalJson(`CALLS`).map(c => c.args), [
    ["rom_rome", "rom_italia_latium"], ["rom_rome", "rom_italia_campania"], ["rom_rome", "rom_africa_zeugitana"],
  ]);
  vm.request({ type: "reveal_all_regions", request_id: 41, faction: "rom_ghost" });
  assert.match(vm.response().result.error, /faction not found: rom_ghost/);
});

test("character lookups use character_cqi strings; diplomacy validates both factions", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "replenish_action_points", request_id: 13, cqi: 201 });
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "replenish_action_points", args: ["character_cqi:201"] });
  vm.request({ type: "force_declare_war", request_id: 14, a: "rom_rome", b: "rom_carthage" });
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "force_declare_war", args: ["rom_rome", "rom_carthage"] });
  vm.request({ type: "force_make_peace", request_id: 15, a: "rom_rome", b: "rom_ghost" });
  assert.match(vm.response().result.error, /faction not found: rom_ghost/);
});

test("experience: characters get add_agent_experience points, an army's units get instant award_experience_level ranks", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "add_agent_experience", request_id: 22, cqi: 102, points: 50 });
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "add_agent_experience", args: ["character_cqi:102", 50] });
  vm.request({ type: "add_agent_experience", request_id: 26, cqi: 101, points: 300 });          // general's own XP
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "add_agent_experience", args: ["character_cqi:101", 300] });
  vm.request({ type: "add_force_experience", request_id: 23, cqi: 101, levels: 3 });
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "award_experience_level", args: ["character_cqi:101", 3] });
  assert.equal(vm.response().result.levels, 3);
  vm.request({ type: "add_force_experience", request_id: 24, cqi: 101, levels: 12 });
  assert.match(vm.response().result.error, /levels must be 1-9/);
  vm.request({ type: "add_force_experience", request_id: 25, cqi: 102, levels: 1 });          // spy has no force
  assert.match(vm.response().result.error, /no military force/);
});

test("UIDestroyed stops polling; a later campaign UI restarts it", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.run(`FIRE("UIDestroyed", {})`);
  assert.deepEqual(vm.response(), { request_id: 0, result: { status: "stopped", game: "rome2", version: "0.1.0" } });
  vm.run(`POLL()`);
  assert.equal(vm.evalJson(`{ n = #TIMERS, active = M.active }`).active, false);
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 1, "no re-arm after stop");
  vm.run(`FIRE("UICreated", { string = "Campaign UI" })`);
  assert.equal(vm.evalJson(`{ active = M.active }`).active, true);
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 2);
  assert.equal(vm.response().result.status, "stopped", "stopped marker stays until polling resumes");
  vm.run(`POLL()`);
  assert.equal(vm.response().result.status, "ready");
});

test("a new session re-arms its own poll even if the old timer never fired, and ignores the old timer", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);           // session 1 timer pending
  vm.run(`FIRE("UIDestroyed", {})`);                           // battle: engine drops that timer
  vm.run(`FIRE("UICreated", { string = "Campaign UI" })`);
  assert.deepEqual(vm.evalJson(`TIMERS`).map(t => t.id), ["rome2_web_editor_poll:1", "rome2_web_editor_poll:2"]);
  vm.run(`FIRE("TimeTrigger", { string = "rome2_web_editor_poll:1" })`);
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 2, "a session-1 timer must not start a second poll chain");
  vm.run(`POLL()`);
  assert.equal(vm.response().result.status, "ready");
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 3);
});

test("a request left over from an earlier session is not run again at the first tick", () => {
  const vm = newVm();
  vm.run(`FS["C:\\\\Users\\\\test\\\\rome2_web_editor_mod\\\\request.json"] = '{"type":"treasury_mod","request_id":9,"faction":"rom_rome","amount":5000,"sent_at":1699990000}'`);
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.run(`POLL()`);
  vm.run(`POLL()`);
  assert.equal(vm.evalJson(`{ n = #CALLS }`).n, 0, "stale treasury_mod must not be replayed");
  assert.equal(vm.response().result.status, "ready");
  assert.match(vm.evalJson(`{ text = FS["C:\\\\Users\\\\test\\\\rome2_web_editor_mod\\\\bridge.log"] }`).text, /skipped request #9 treasury_mod/);
  vm.request({ type: "treasury_mod", request_id: 10, faction: "rom_rome", amount: 100 });
  assert.equal(vm.response().result.ok, true, "the next request is served normally");
});

test("a request without sent_at at the first tick is treated as stale", () => {
  const vm = newVm();
  vm.run(`FS["C:\\\\Users\\\\test\\\\rome2_web_editor_mod\\\\request.json"] = '{"type":"treasury_mod","request_id":9,"faction":"rom_rome","amount":5000}'`);
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.run(`POLL()`);
  assert.equal(vm.evalJson(`{ n = #CALLS }`).n, 0);
});

test("settlement slots list buildings", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_settlement_slots", request_id: 60, region: "rom_italia_latium" });
  assert.deepEqual(vm.response().result, {
    ok: true, region: "rom_italia_latium", owner: "rom_rome",
    slots: [{ index: 0, building: "rom_ROMAN_city_major_1", chain: "rom_ROMAN_city_major", superchain: "rom_ROMAN_city" }, { index: 1 }],
  });
});

test("per-slot repair sets health to 100 with the verified 3-argument call", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "repair_building", request_id: 70, region: "rom_italia_latium", slot: 0 });
  assert.equal(vm.response().result.building, "rom_ROMAN_city_major_1");
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "instant_set_building_health_percent", args: ["rom_italia_latium", "rom_ROMAN_city_major_1", 100] });
  vm.request({ type: "repair_building", request_id: 71, region: "rom_italia_latium", slot: 1 });
  assert.match(vm.response().result.error, /slot 1 has no building/);
});
const FAKE_DEI_POPULATION = `
    local regions = { rom_italia_latium = { 100, 2000, 30000, 400 } }
    package.loaded["lua_scripts.population"] = {
      UIPopulation = { rom_italia_latium = { 100, 2000, 30000, 400 } },
      GetRegionPop = function(region) return regions[region:name()] end,
      SetRegionPop = function(name, up, mid, low, foreign) regions[name] = { up, mid, low, foreign } end,
    }`;

test("without the DEI patch a DEI campaign is treated as vanilla", () => {
  const vm = newVm();
  vm.run(FAKE_DEI_POPULATION);
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_game_info", request_id: 90 });
  const info = vm.response().result;
  assert.equal(info.dei, false);
  assert.equal(info.capabilities.set_region_population, undefined);
  vm.request({ type: "get_region_population", request_id: 91, region: "rom_italia_latium" });
  assert.match(vm.response().result.error, /unknown request type/);
});

test("DEI patch: population offered only with DEI's script, edited through its SetRegionPop", () => {
  const vm = newVm({ deiPatch: true });
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "get_game_info", request_id: 80 });
  let info = vm.response().result;
  assert.equal(info.dei, false);
  assert.equal(info.capabilities.set_region_population, undefined);
  vm.request({ type: "get_region_population", request_id: 81, region: "rom_italia_latium" });
  assert.match(vm.response().result.error, /DEI population script is not loaded/);

  vm.run(FAKE_DEI_POPULATION);
  vm.request({ type: "get_game_info", request_id: 82 });
  info = vm.response().result;
  assert.equal(info.dei, true);
  assert.equal(info.capabilities.set_region_population, "verified");
  vm.request({ type: "get_region_population", request_id: 83, region: "rom_italia_latium" });
  assert.deepEqual(vm.response().result.population, { upper: 100, middle: 2000, lower: 30000, foreign: 400 });
  vm.request({ type: "set_region_population", request_id: 84, region: "rom_italia_latium", lower: 45000 });
  assert.deepEqual(vm.response().result.population, { upper: 100, middle: 2000, lower: 45000, foreign: 400 });
  assert.deepEqual(vm.evalJson(`package.loaded["lua_scripts.population"].UIPopulation.rom_italia_latium`), [100, 2000, 45000, 400],
    "DEI's panels read UIPopulation");
  vm.request({ type: "get_region_population", request_id: 85, region: "rom_italia_campania" });
  assert.match(vm.response().result.error, /no DEI population/);
});

test("removed handlers are gone, and every handler is listed in capabilities and vice versa", () => {
  const vm = newVm();
  const gone = ["construction_options", "construct_building", "construction_status", "set_building_health", "ui_tree", "ui_find", "ui_click", "ui_key", "ui_panels",
    "kill_character", "dismantle_building", "instantly_dismantle_building", "grant_unit", "join_garrison", "leave_garrison",
    "relocate_force", "relocate_status", "move_force", "move_status", "get_force_units", "award_experience_level", "force_diplomacy",
    "hide_character", "unhide_character", "force_add_trait", "force_add_ancillary", "set_tax_rate", "apply_effect_bundle",
    "remove_effect_bundle", "instantly_repair_building", "show_shroud", "make_region_visible_in_shroud", "scroll_camera", "end_turn"];
  const left = vm.evalJson(`(function() local t = {} for _, k in ipairs(${JSON.stringify(gone).replace("[", "{").replace("]", "}")}) do if M.handlers[k] or M.capabilities[k] then table.insert(t, k) end end return { left = t } end)()`);
  assert.deepEqual(left.left ?? [], []);
  const keys = vm.evalJson(`(function() local h, c = {}, {} for k in pairs(M.handlers) do table.insert(h, k) end for k in pairs(M.capabilities) do table.insert(c, k) end return { h = h, c = c } end)()`);
  assert.deepEqual([...keys.h].sort(), [...keys.c].sort());
});

test("a missing user-profile folder falls back to the game root and says so", () => {
  const vm = newVm();
  vm.run(`FS_DIRS = {}`);
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  assert.equal(vm.response(), null, "nothing written to the unwritable user folder");
  assert.deepEqual(vm.evalJson(`{ folder = M.folder, kind = M.folder_kind, active = M.active }`), { folder: ".", kind: "gameroot", active: true });
  vm.run(`POLL()`);
  const ready = JSON.parse(vm.evalJson(`{ text = FS[".\\\\response.json"] }`).text);
  assert.equal(ready.result.status, "ready");
  assert.equal(ready.result.folder_kind, "gameroot");
  assert.match(vm.evalJson(`{ text = FS["rome2_web_editor_bridge.log"] }`).text, /kind=gameroot writable=true/);
});
