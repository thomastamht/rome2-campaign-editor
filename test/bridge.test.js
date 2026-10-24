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

function newVm() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const setGlobal = (name, value) => { lua.lua_pushstring(L, to_luastring(value)); lua.lua_setglobal(L, to_luastring(name)); };
  setGlobal("SRC_JSON", read("mod/lua_scripts/rome2_web_editor_json.lua"));
  setGlobal("SRC_BRIDGE", read("mod/lua_scripts/rome2_web_editor.lua"));
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
  const request = (obj) => run(`REQUEST(${JSON.stringify(JSON.stringify(obj))})`);
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

test("first tick writes the ready marker and arms a 0.1s poll", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  const ready = vm.response();
  assert.equal(ready.request_id, 0);
  assert.equal(ready.result.status, "ready");
  assert.equal(ready.result.game, "rome2");
  assert.equal(ready.result.campaign, "main_rome");
  assert.equal(ready.result.turn, 12);
  assert.equal(ready.result.capabilities.treasury_mod, "verified");
  assert.equal(ready.result.capabilities.move_force, "engine");
  assert.equal(ready.result.capabilities.relocate_force, "composed");
  assert.deepEqual(vm.evalJson(`TIMERS`), [{ id: "rome2_web_editor_poll", t: 0.1 }]);
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

test("relocate_force refuses faction leaders and player armies unless explicitly allowed", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "relocate_force", request_id: 9, cqi: 101, region: "rom_africa_zeugitana", x: 38, y: 19 });
  assert.match(vm.response().result.error, /faction leader/);
  vm.request({ type: "relocate_force", request_id: 10, cqi: 101, region: "rom_africa_zeugitana", x: 38, y: 19, allow_leader: true });
  assert.match(vm.response().result.error, /player army/);
  assert.equal(vm.evalJson(`CALLS`).length, 0, "nothing reached the game");
});

test("relocate_force queues create_force, waits for ScriptedForceCreated, then kills the original on a later tick", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "relocate_force", request_id: 9, cqi: 101, region: "rom_africa_zeugitana", x: 38, y: 19, allow_leader: true, allow_player: true });
  const r = vm.response();
  assert.equal(r.result.ok, true);
  assert.equal(r.result.pending, true);
  assert.equal(r.result.units, 2);
  const id = r.result.id;
  const calls = vm.evalJson(`CALLS`);
  assert.equal(calls.length, 1, "nothing but the queued spawn so far");
  assert.equal(calls[0].name, "create_force");
  assert.deepEqual(calls[0].args.slice(0, 5), ["rom_rome", "Rom_Hastati,Rom_Hastati", "rom_africa_zeugitana", 38, 19]);
  assert.equal(calls[0].args[6], true, "must go through the command queue like every CA/DEI call");
  assert.ok(vm.evalJson(`TIMERS`).some(t => t.id === `rome2_web_editor_timeout:${id}` && t.t === 6));
  vm.request({ type: "relocate_status", request_id: 10, id });
  assert.equal(vm.response().result.status, "queued");
  vm.request({ type: "relocate_force", request_id: 13, cqi: 101, region: "rom_africa_zeugitana", x: 40, y: 20, allow_leader: true, allow_player: true });
  assert.match(vm.response().result.error, /already pending/, "a second drop on the same army must not spawn twice");
  // the engine spawns the new general near the target
  vm.run(`table.insert(FACTIONS.rom_rome.chars, (function() local c = {}; c.cqi = function() return 900 end; c.has_military_force = function() return true end; c.logical_position_x = function() return 38 end; c.logical_position_y = function() return 20 end; return c end)())`);
  vm.run(`FIRE("ScriptedForceCreated", {})`);
  const killTimer = vm.evalJson(`TIMERS`).find(t => t.id === `rome2_web_editor_kill:${id}`);
  assert.ok(killTimer && killTimer.t === 0.5, "kill is deferred to its own time trigger");
  assert.equal(vm.evalJson(`CALLS`).some(c => c.name === "kill_character"), false, "no kill in the creation event");
  vm.run(`FIRE("TimeTrigger", { string = "rome2_web_editor_kill:${id}" })`);
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "kill_character", args: ["character_cqi:101", true] });
  vm.request({ type: "heartbeat", request_id: 14 });
  assert.equal(vm.response().request_id, 13, "every request waits while the game processes the death");
  vm.run(`CLOCK = CLOCK + 5`);
  vm.request({ type: "get_active_characters", request_id: 15 });
  assert.equal(vm.response().result.some(c => c.cqi === 101), false, "the killed general lingers in character_list but is hidden");
  vm.request({ type: "replenish_action_points", request_id: 16, cqi: 101 });
  assert.match(vm.response().result.error, /character was killed/);
  vm.request({ type: "relocate_status", request_id: 11, id });
  assert.deepEqual(vm.response().result, { ok: true, id, status: "done", new_cqi: 900, original_cqi: 101 });
  vm.request({ type: "relocate_force", request_id: 12, cqi: 102, region: "rom_africa_zeugitana", x: 1, y: 1, allow_player: true });
  assert.match(vm.response().result.error, /no military force/);
});

test("relocate_force keeps the original when the force never appears", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "relocate_force", request_id: 9, cqi: 201, region: "rom_italia_latium", x: 42, y: 31 });
  const id = vm.response().result.id;
  vm.run(`FIRE("ScriptedForceCreated", {})`);               // some other force, nothing near the target
  vm.run(`FIRE("TimeTrigger", { string = "rome2_web_editor_timeout:${id}" })`);
  assert.equal(vm.evalJson(`CALLS`).some(c => c.name === "kill_character"), false);
  vm.request({ type: "relocate_status", request_id: 10, id });
  assert.equal(vm.response().result.status, "create_failed");
  assert.match(vm.evalJson(`{ text = FS["rome2_web_editor_bridge.log"] }`).text, /force never appeared; original kept/);
});

test("move_force issues a movement order (enable, replenish, move_to) and reports a missing method", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "move_force", request_id: 11, cqi: 101, x: 40, y: 30 });
  assert.equal(vm.response().result.ok, false);
  assert.match(vm.response().result.error, /move_to failed/);
  vm.run(`GI.move_to = function(self, ...) table.insert(CALLS, { name = "move_to", args = { ... } }) end`);
  vm.request({ type: "move_force", request_id: 12, cqi: 101, x: 40, y: 30 });
  assert.equal(vm.response().result.ok, true);
  const names = vm.evalJson(`CALLS`).map(c => c.name);
  assert.deepEqual(names.slice(-3), ["enable_movement_for_character", "replenish_action_points", "move_to"]);
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "move_to", args: ["character_cqi:101", 40, 30, true] });
  // chained escort: no movement for two checks -> replenish + move_to again; arrival clears it
  vm.request({ type: "move_status", request_id: 14, cqi: 101 });
  assert.equal(vm.response().result.status, "moving");
  const before = vm.evalJson(`CALLS`).filter(c => c.name === "move_to").length;
  for (let i = 0; i < 10; i++) vm.run(`POLL()`);
  assert.equal(vm.evalJson(`CALLS`).filter(c => c.name === "move_to").length, before + 1, "re-issued once after two stalled checks");
  vm.run(`CHARS[101].logical_position_x = function() return 40 end; CHARS[101].logical_position_y = function() return 30 end`);
  for (let i = 0; i < 5; i++) vm.run(`POLL()`);
  vm.request({ type: "move_status", request_id: 15, cqi: 101 });
  assert.equal(vm.response().result.status, "idle");
  assert.match(vm.evalJson(`{ text = FS["rome2_web_editor_bridge.log"] }`).text, /arrived at 40,30/);
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
  vm.request({ type: "scroll_camera", request_id: 16, x: 421.5, y: 312.25 });
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS].args`), [0.5, [421.5, 312.25, 6], [421.5, 312.25, 6]]);
});

test("experience: characters get add_agent_experience points, an army's units get instant award_experience_level ranks", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "award_experience_level", request_id: 20, cqi: 101, levels: 2 });          // general
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "award_experience_level", args: ["character_cqi:101", 2] });
  assert.equal(vm.response().result.method, "award_experience_level");
  vm.request({ type: "award_experience_level", request_id: 21, cqi: 102, levels: 2 });          // spy
  assert.deepEqual(vm.evalJson(`CALLS[#CALLS]`), { name: "add_agent_experience", args: ["character_cqi:102", 200] });
  assert.equal(vm.response().result.method, "add_agent_experience");
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
  vm.run(`POLL()`);
  assert.equal(vm.evalJson(`{ n = #TIMERS, active = M.active }`).active, false);
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 1, "no re-arm after stop");
  vm.run(`FIRE("UICreated", { string = "Campaign UI" })`);
  assert.equal(vm.evalJson(`{ active = M.active }`).active, true);
  assert.equal(vm.evalJson(`{ n = #TIMERS }`).n, 2);
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

test("dismantle_building passes the slot and does not read it again", () => {
  const vm = newVm();
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  vm.request({ type: "dismantle_building", request_id: 72, region: "rom_italia_latium", slot: 0 });
  assert.equal(vm.response().result.building, "rom_ROMAN_city_major_1");
  assert.deepEqual(vm.evalJson(`{ name = CALLS[#CALLS].name, same = CALLS[#CALLS].args[1].state == REGIONS.rom_italia_latium.slots[1], gone = REGIONS.rom_italia_latium.slots[1].building == nil }`), { name: "instantly_dismantle_building", same: true, gone: true });
  vm.request({ type: "dismantle_building", request_id: 73, region: "rom_italia_latium", slot: 1 });
  assert.match(vm.response().result.error, /slot 1 has no building/);
});

test("removed handlers are gone: construction, UI probes, kill, dismantle and garrison edits", () => {
  const vm = newVm();
  const gone = ["construction_options", "construct_building", "construction_status", "set_building_health", "ui_tree", "ui_find", "ui_click", "ui_key", "ui_panels",
    "kill_character", "instantly_dismantle_building", "grant_unit", "join_garrison", "leave_garrison"];
  const left = vm.evalJson(`(function() local t = {} for _, k in ipairs(${JSON.stringify(gone).replace("[", "{").replace("]", "}")}) do if M.handlers[k] or M.capabilities[k] then table.insert(t, k) end end return { left = t } end)()`);
  assert.deepEqual(left.left ?? [], []);
});

test("a missing user-profile folder falls back to the game root and says so", () => {
  const vm = newVm();
  vm.run(`FS_DIRS = {}`);
  vm.run(`FIRE("FirstTickAfterWorldCreated", {})`);
  assert.equal(vm.response(), null, "nothing written to the unwritable user folder");
  assert.deepEqual(vm.evalJson(`{ folder = M.folder, kind = M.folder_kind, active = M.active }`), { folder: ".", kind: "gameroot", active: true });
  const ready = JSON.parse(vm.evalJson(`{ text = FS[".\\\\response.json"] }`).text);
  assert.equal(ready.result.status, "ready");
  assert.equal(ready.result.folder_kind, "gameroot");
  assert.match(vm.evalJson(`{ text = FS["rome2_web_editor_bridge.log"] }`).text, /kind=gameroot writable=true/);
});
