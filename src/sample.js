// Synthetic demo campaign in the exact shapes the Lua bridge returns. Not game data.

const factions = [
  { key: "rom_rome", treasury: 12450, is_human: true, is_dead: false, is_rebel: false, regions: 4, characters: 4, forces: 3, culture: "rom_Roman", subculture: "sc_rom_roman", leader_cqi: 101 },
  { key: "rom_carthage", treasury: 9800, is_human: false, is_dead: false, is_rebel: false, regions: 3, characters: 3, forces: 2, culture: "rom_Punic", subculture: "sc_rom_carthaginian", leader_cqi: 201 },
  { key: "rom_macedon", treasury: 6100, is_human: false, is_dead: false, is_rebel: false, regions: 2, characters: 2, forces: 2, culture: "rom_Hellenistic", subculture: "sc_rom_greek", leader_cqi: 301 },
  { key: "rom_arverni", treasury: 2300, is_human: false, is_dead: false, is_rebel: false, regions: 2, characters: 2, forces: 1, culture: "rom_Barbarian", subculture: "sc_rom_gaul", leader_cqi: 401 },
  { key: "rom_ptolemaics", treasury: 15200, is_human: false, is_dead: false, is_rebel: false, regions: 1, characters: 1, forces: 1, culture: "rom_Hellenistic", subculture: "sc_rom_egyptian", leader_cqi: 501 },
  { key: "rom_epirus", treasury: 0, is_human: false, is_dead: true, is_rebel: false, regions: 0, characters: 0, forces: 0, culture: "rom_Hellenistic", subculture: "sc_rom_greek", leader_cqi: null },
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
  has_force: units !== null, is_agent: ["spy", "dignitary", "champion"].includes(type), male: true,
  units, is_army, is_navy, upkeep: units ? units * 110 : undefined, strength: units ? 100 : undefined, is_general: units !== null,
}));

export const demoInfo = {
  ok: true, game: "rome2", version: "demo", protocol: 1, folder: "(demo - no folder selected)", folder_kind: "demo",
  campaign: "main_rome", turn: 42, player_faction: "rom_rome", is_multiplayer: false,
  capabilities: {
    heartbeat: "verified", get_game_info: "verified", get_factions: "verified", get_regions: "verified", get_regions_detailed: "verified",
    get_active_characters: "verified", get_snapshot: "verified", reveal_all_regions: "verified",
    treasury_mod: "verified", transfer_region_to_faction: "verified", set_public_order: "verified",
    replenish_action_points: "verified", zero_action_points: "verified", create_force: "verified", create_agent: "engine",
    force_declare_war: "verified", force_make_peace: "verified", force_make_trade_agreement: "verified", force_make_vassal: "engine",
    force_rebellion_in_region: "verified", add_development_points_to_region: "engine",
    add_agent_experience: "verified", add_force_experience: "engine",
    get_settlement_slots: "verified", repair_building: "verified",
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
  h_treasury_mod({ faction, amount }) {
    if (Number(amount) < 0) throw new Error("Rome II cannot lower a treasury; only positive amounts are applied");
    const f = this.faction(faction);
    f.treasury += Number(amount);
    return { ok: true, faction, treasury: f.treasury };
  }
  h_transfer_region_to_faction({ region, faction }) {
    const f = this.faction(faction);
    if (f.is_dead) throw new Error("Rome II will not give a region to a dead faction");
    const r = this.region(region);
    r.owner = faction;
    return { ok: true, region, owner: faction };
  }
  h_set_public_order({ region, value }) { this.region(region).public_order = Number(value); return { ok: true, region }; }
  h_replenish_action_points({ cqi }) { this.character(cqi); return { ok: true, cqi }; }
  h_zero_action_points({ cqi }) { this.character(cqi); return { ok: true, cqi }; }
  h_force_declare_war({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_make_peace({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_make_trade_agreement({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_force_make_vassal({ a, b }) { this.faction(a); this.faction(b); return { ok: true, a, b }; }
  h_add_agent_experience({ cqi, points = 100 }) { this.character(cqi); return { ok: true, cqi, points }; }
  h_add_force_experience({ cqi, levels = 1 }) {
    const c = this.character(cqi);
    levels = Math.floor(levels);
    if (!(levels >= 1 && levels <= 9)) throw new Error("levels must be 1-9 (unit ranks)");
    if (!c.has_force) throw new Error(`character ${cqi} has no military force`);
    return { ok: true, cqi, levels, method: "award_experience_level" };
  }
  h_add_development_points_to_region({ region, points }) { this.region(region); return { ok: true, region, points }; }
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
  h_reveal_all_regions({ faction }) { return { ok: true, faction: faction ?? this.info.player_faction, regions: this.regions.length }; }
  h_create_force({ faction, units, region, x, y }) {
    if (this.faction(faction).is_dead) throw new Error("Rome II will not spawn an army for a dead faction");
    this.region(region);
    const list = String(units).split(",").filter(Boolean);
    const cqi = this.nextCqi++;
    this.characters.push({ cqi, faction, type: "general", forename: "Novus", surname: `#${cqi}`, x: x * 10, y: y * 10, lx: x, ly: y, region,
      in_settlement: false, embedded: false, faction_leader: false, age: 30, has_force: true, is_agent: false, units: list.length + 1, is_army: true, is_navy: false, upkeep: 0, strength: 100, is_general: true });
    return { ok: true, faction, region, id: `demo_${cqi}` };
  }
  h_create_agent({ faction, agent_type, region, x, y }) {
    this.faction(faction);
    if (region) this.region(region);
    if (!["spy", "dignitary", "champion"].includes(agent_type)) throw new Error(`unknown agent type '${agent_type}'`);
    const cqi = this.nextCqi++;
    this.characters.push({
      cqi, faction, type: agent_type, forename: "Novus", surname: `#${cqi}`, x, y, lx: x, ly: y, region,
      in_settlement: false, embedded: false, faction_leader: false, age: 30, male: true,
      has_force: false, is_agent: true, is_army: false, is_navy: false,
    });
    return { ok: true, faction, agent_type, region, id: `demo_agent_${cqi}`, queued: true };
  }
}
