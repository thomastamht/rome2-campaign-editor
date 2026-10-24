// Synthetic demo campaign in the exact shapes the Lua bridge returns. Not game data.
import { assertOk } from "./protocol.js";

const factions = [
  { key: "rom_rome", treasury: 12450, is_human: true, is_dead: false, is_rebel: false, regions: 4, characters: 4, forces: 3, culture: "rom_Roman", subculture: "sc_rom_roman", leader_cqi: 101 },
  { key: "rom_carthage", treasury: 9800, is_human: false, is_dead: false, is_rebel: false, regions: 3, characters: 3, forces: 2, culture: "rom_Punic", subculture: "sc_rom_carthaginian", leader_cqi: 201 },
  { key: "rom_macedon", treasury: 6100, is_human: false, is_dead: false, is_rebel: false, regions: 2, characters: 2, forces: 2, culture: "rom_Hellenistic", subculture: "sc_rom_greek", leader_cqi: 301 },
  { key: "rom_arverni", treasury: 2300, is_human: false, is_dead: false, is_rebel: false, regions: 2, characters: 2, forces: 1, culture: "rom_Barbarian", subculture: "sc_rom_celtic", leader_cqi: 401 },
  { key: "rom_ptolemaics", treasury: 15200, is_human: false, is_dead: false, is_rebel: false, regions: 1, characters: 1, forces: 1, culture: "rom_Hellenistic", subculture: "sc_rom_egyptian", leader_cqi: 501 },
];

// Logical positions copied from a live main_rome snapshot so markers land on the right cities.
const regions = [
  ["rom_italia_latium", "Latium", "rom_rome", "rome_main_italia", 313, 379],
  ["rom_italia_samnium", "Samnium", "rom_rome", "rome_main_italia", 325, 366],
  ["rom_cisalpina_insubria", "Insubria", "rom_rome", "rome_main_cisalpina", 277, 443],
  ["rom_magna_graecia_sirako", "Syracuse", "rom_rome", "rome_main_magna_graecia", 336, 287],
  ["rom_africa_zeugitana", "Carthago", "rom_carthage", "rome_main_africa", 277, 275],
  ["rom_africa_byzacium", "Thapsus", "rom_carthage", "rome_main_africa", 290, 251],
  ["rom_corsica_et_sardinia_sardinia", "Karalis", "rom_carthage", "rome_main_corsica_et_sardinia", 259, 322],
  ["rom_macedonia_makedonia", "Pella", "rom_macedon", "rome_main_macedonia", 451, 367],
  ["rom_thracia_thracia", "Byzantion", "rom_macedon", "rome_main_thracia", 481, 390],
  ["rom_aquitania_gergovia", "Gergovia", "rom_arverni", "rome_main_aquitania", 193, 444],
  ["rom_celtica_lugdunensis", "Lugdunum", "rom_arverni", "rome_main_celtica", 214, 470],
  ["rom_aegyptos_ta_mehu", "Alexandria", "rom_ptolemaics", "rome_main_aegyptos", 534, 204],
].map(([key, , owner, province, lx, ly]) => ({ key, name: key, owner, province, public_order: 2, x: lx, y: ly, lx, ly }));

const characters = [
  [101, "rom_rome", "general", "Gaius", "Julius", 313, 379, "rom_italia_latium", true, 16, true, false],
  [102, "rom_rome", "general", "Marcus", "Valerius", 329, 360, "rom_italia_samnium", false, 12, true, false],
  [103, "rom_rome", "admiral", "Lucius", "Aemilius", 330, 297, "rom_magna_graecia_sirako", false, 8, false, true],
  [104, "rom_rome", "spy", "Titus", "Pomponius", 318, 386, null, false, null, false, false],
  [201, "rom_carthage", "general", "Hanno", "", 277, 275, "rom_africa_zeugitana", true, 18, true, false],
  [202, "rom_carthage", "admiral", "Himilco", "", 252, 332, "rom_corsica_et_sardinia_sardinia", false, 10, false, true],
  [203, "rom_carthage", "dignitary", "Mago", "", 284, 266, null, false, null, false, false],
  [301, "rom_macedon", "general", "Antigonos", "", 451, 367, "rom_macedonia_makedonia", true, 14, true, false],
  [302, "rom_macedon", "general", "Demetrios", "", 474, 384, "rom_thracia_thracia", false, 9, true, false],
  [401, "rom_arverni", "general", "Vercingetorix", "", 193, 444, "rom_aquitania_gergovia", true, 15, true, false],
  [402, "rom_arverni", "champion", "Litaviccos", "", 205, 456, null, false, null, false, false],
  [501, "rom_ptolemaics", "general", "Ptolemaios", "", 534, 204, "rom_aegyptos_ta_mehu", true, 20, true, false],
].map(([cqi, faction, type, forename, surname, lx, ly, region, faction_leader, units, is_army, is_navy]) => ({
  cqi, faction, type, forename, surname, x: lx, y: ly, lx, ly, region,
  in_settlement: Boolean(region) && units !== null && cqi % 2 === 1, embedded: false, faction_leader, age: 30 + (cqi % 20),
  has_force: units !== null, is_agent: ["spy", "dignitary", "champion"].includes(type),
  units, is_army, is_navy, upkeep: units ? units * 110 : undefined, strength: units ? 100 : undefined, is_general: units !== null,
}));

export const demoInfo = {
  ok: true, game: "rome2", version: "demo", protocol: 1, folder: "(demo - no folder selected)", folder_kind: "demo",
  campaign: "main_rome", turn: 42, player_faction: "rom_rome", is_multiplayer: false,
  capabilities: {
    heartbeat: "verified", get_game_info: "verified", get_factions: "verified", get_regions: "verified", get_regions_detailed: "verified",
    get_active_characters: "verified", get_force_units: "verified", reveal_all_regions: "verified", get_snapshot: "verified", treasury_mod: "verified", transfer_region_to_faction: "verified", set_public_order: "verified",
    replenish_action_points: "verified", zero_action_points: "verified", create_force: "verified", force_declare_war: "verified",
    force_make_peace: "verified", force_make_trade_agreement: "verified", force_diplomacy: "verified", apply_effect_bundle: "verified",
    remove_effect_bundle: "verified", make_region_visible_in_shroud: "verified", show_shroud: "verified", scroll_camera: "verified",
    force_rebellion_in_region: "verified", force_make_vassal: "engine", force_add_trait: "engine",
    force_add_ancillary: "engine", grant_unit: "engine", add_development_points_to_region: "engine", set_tax_rate: "engine",
    hide_character: "engine", unhide_character: "engine", award_experience_level: "engine", add_agent_experience: "verified", add_force_experience: "engine",
    instantly_repair_building: "engine", get_settlement_slots: "verified", repair_building: "verified",
    end_turn: "engine", relocate_force: "composed", relocate_status: "verified", move_force: "engine", move_status: "verified", join_garrison: "engine", leave_garrison: "engine",
  },
};

/** Stand-in for FileBridge: answers the same request types from in-memory demo data. */
export class DemoBridge {
  constructor() {
    this.info = structuredClone(demoInfo);
    this.factions = structuredClone(factions);
    this.regions = structuredClone(regions);
    this.characters = structuredClone(characters);
    this.nextCqi = 900;
    this.lastError = null;
  }

  async readReadyMarker() { return { ...this.info, status: "ready" }; }

  async request(type, args = {}) {
    await new Promise(r => setTimeout(r, 60));
    const handler = this[`h_${type}`];
    if (!handler) return { ok: false, error: `demo: unknown request type ${type}` };
    try { return handler.call(this, args); } catch (e) { return { ok: false, error: `demo: ${e.message}` }; }
  }

  faction(key) { const f = this.factions.find(f => f.key === key); if (!f) throw new Error(`faction not found: ${key}`); return f; }
  region(key) { const r = this.regions.find(r => r.key === key); if (!r) throw new Error(`region not found: ${key}`); return r; }
  character(cqi) { const c = this.characters.find(c => c.cqi === Number(cqi)); if (!c) throw new Error(`character not found: cqi ${cqi}`); return c; }
  recount() {
    for (const f of this.factions) {
      f.regions = this.regions.filter(r => r.owner === f.key).length;
      f.characters = this.characters.filter(c => c.faction === f.key).length;
      f.forces = this.characters.filter(c => c.faction === f.key && c.has_force).length;
    }
  }

  h_heartbeat() { return { ok: true, game: "rome2", version: "demo", turn: this.info.turn }; }
  h_get_game_info() { return structuredClone(this.info); }
  h_get_factions() { this.recount(); return structuredClone(this.factions); }
  h_get_regions() { return Object.fromEntries(this.regions.map(r => [r.key, r.owner])); }
  h_get_regions_detailed() { return structuredClone(this.regions); }
  h_get_active_characters() { return structuredClone(this.characters); }
  h_get_snapshot() { return { info: this.h_get_game_info(), factions: this.h_get_factions(), regions: this.h_get_regions_detailed(), characters: this.h_get_active_characters() }; }
  h_get_force_units({ cqi }) { const c = this.character(cqi); return { ok: true, cqi: c.cqi, units: Array.from({ length: c.units ?? 0 }, (_, i) => ({ key: i === 0 ? "Rom_Gen_Bodyguard" : "Rom_Hastati", strength: 100 })) }; }
  h_treasury_mod({ faction, amount }) { const f = this.faction(faction); f.treasury += Number(amount); return { ok: true, faction, treasury: f.treasury }; }
  h_transfer_region_to_faction({ region, faction }) { this.faction(faction); const r = this.region(region); r.owner = faction; return { ok: true, region, owner: faction }; }
  h_set_public_order({ region, value }) { this.region(region).public_order = Number(value); return { ok: true, region }; }
  h_replenish_action_points({ cqi }) { this.character(cqi); return { ok: true, cqi }; }
  h_zero_action_points({ cqi }) { this.character(cqi); return { ok: true, cqi }; }
  h_force_declare_war({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_make_peace({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_make_trade_agreement({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_make_vassal({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_diplomacy({ a, b, kind }) { this.faction(a); this.faction(b); return { ok: true, a, b, kind }; }
  h_force_add_trait({ cqi, trait }) { this.character(cqi); return { ok: true, cqi, trait }; }
  h_award_experience_level({ cqi, levels, points }) {
    const c = this.character(cqi);
    if (c.is_agent) return { ok: true, cqi, type: c.type, method: "add_agent_experience", points: points ?? (levels ?? 1) * 100 };
    return { ok: true, cqi, type: c.type, method: "award_experience_level", levels: levels ?? 1 };
  }
  h_add_agent_experience({ cqi, points = 100 }) { this.character(cqi); return { ok: true, cqi, points }; }
  h_add_force_experience({ cqi, levels = 1 }) {
    const c = this.character(cqi);
    levels = Math.floor(levels);
    if (!(levels >= 1 && levels <= 9)) throw new Error("levels must be 1-9 (unit ranks)");
    if (!c.has_force) throw new Error(`character ${cqi} has no military force`);
    return { ok: true, cqi, levels, method: "award_experience_level" };
  }
  h_hide_character({ cqi }) { this.character(cqi); return { ok: true, cqi }; }
  h_unhide_character({ cqi }) { this.character(cqi); return { ok: true, cqi }; }
  h_add_development_points_to_region({ region, points }) { this.region(region); return { ok: true, region, points }; }
  h_instantly_repair_building({ region }) { this.region(region); return { ok: true, region }; }
  slots(region) {
    const r = this.region(region);
    r.slots ??= [...["rom_ROMAN_city_major_2", "rom_ROMAN_military_main_heavy_2", "rom_ROMAN_city_major_fort_3"].map((building, index) => ({ index, building })), { index: 3 }];
    return r.slots;
  }
  slot(region, index) { const s = this.slots(region)[Number(index)]; if (!s) throw new Error(`slot ${index} out of range`); return s; }
  h_get_settlement_slots({ region }) { return { ok: true, region, owner: this.region(region).owner, slots: structuredClone(this.slots(region)) }; }
  h_repair_building({ region, slot }) {
    const s = this.slot(region, slot);
    if (!s.building) throw new Error(`slot ${slot} has no building`);
    return { ok: true, region, slot, building: s.building, percent: 100 };
  }
  h_force_rebellion_in_region({ region }) { this.region(region); return { ok: true, region }; }
  h_set_tax_rate({ faction, rate }) { this.faction(faction); return { ok: true, faction, rate }; }
  h_force_add_ancillary({ cqi, ancillary }) { this.character(cqi); return { ok: true, cqi, ancillary }; }
  h_grant_unit({ cqi, region, unit }) {
    if (cqi != null) throw new Error("Rome II cannot add units to an existing army by script; grant_unit only works on a settlement garrison ({region=key})");
    this.region(region);
    return { ok: true, target: `settlement:${region}`, unit };
  }
  h_apply_effect_bundle({ bundle, faction }) { this.faction(faction); return { ok: true, bundle, faction }; }
  h_remove_effect_bundle({ bundle, faction }) { this.faction(faction); return { ok: true, bundle, faction }; }
  h_show_shroud({ visible }) { return { ok: true, visible }; }
  h_make_region_visible_in_shroud({ faction, region }) { this.faction(faction); this.region(region); return { ok: true }; }
  h_reveal_all_regions({ faction }) { return { ok: true, faction: faction ?? this.info.player_faction, regions: this.regions.length }; }
  h_scroll_camera({ x, y }) { return { ok: true, x, y }; }
  h_end_turn() { this.info.turn += 1; return { ok: true }; }
  h_create_force({ faction, units, region, x, y }) {
    this.faction(faction); this.region(region);
    const list = String(units).split(",").filter(Boolean);
    const cqi = this.nextCqi++;
    this.characters.push({ cqi, faction, type: "general", forename: "Novus", surname: `#${cqi}`, x: x * 10, y: y * 10, lx: x, ly: y, region,
      in_settlement: false, embedded: false, faction_leader: false, age: 30, has_force: true, is_agent: false, units: list.length + 1, is_army: true, is_navy: false, upkeep: 0, strength: 100, is_general: true });
    return { ok: true, faction, region, id: `demo_${cqi}` };
  }
  h_relocate_force({ cqi, region, x, y, skip_first_unit = true }) {
    const c = this.character(cqi);
    if (!c.has_force) throw new Error("character has no military force");
    const units = Math.max((c.units ?? 1) - (skip_first_unit ? 1 : 0), 0);
    assertOk(this.h_create_force({ faction: c.faction, units: Array(units).fill("Rom_Hastati").join(","), region, x, y }), "create_force");
    this.characters = this.characters.filter(x => x.cqi !== c.cqi);
    return { ok: true, faction: c.faction, region, units, killed_cqi: c.cqi };
  }
  h_join_garrison({ cqi, region }) { const c = this.character(cqi); const r = this.region(region); c.lx = r.lx; c.ly = r.ly; c.x = r.x; c.y = r.y; c.region = region; c.in_settlement = true; return { ok: true, cqi, region }; }
  h_leave_garrison({ cqi }) { const c = this.character(cqi); c.in_settlement = false; return { ok: true, cqi }; }
  h_move_status({ cqi }) { return { ok: true, cqi, status: "idle" }; }
  h_relocate_status({ id }) { return { ok: true, id, status: "done" }; }
  h_move_force({ cqi, x, y }) { const c = this.character(cqi); c.lx = x; c.ly = y; c.x = x * 10; c.y = y * 10; return { ok: true, cqi, x, y }; }
}
