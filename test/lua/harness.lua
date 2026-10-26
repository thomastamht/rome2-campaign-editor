-- Test harness for mod/lua_scripts/rome2_web_editor.lua, run under fengari (Lua 5.3 in JS).
-- Replaces the engine surface the bridge touches: io, os.getenv, out.ting, common, the
-- EpisodicScripting module (AddEventCallBack + game_interface) and a tiny campaign model.

LOG, CALLS, TIMERS, EVENTS = {}, {}, {}, {}
FS = {}                                            -- path -> content
FS_DIRS = { ["C:\\Users\\test\\rome2_web_editor_mod"] = true }

-- Relative paths behave like the game root; a bare file name is always writable there.
io = {
  open = function(path, mode)
    mode = mode or "r"
    if mode:sub(1, 1) == "r" then
      local content = FS[path]
      if content == nil then return nil, "not found" end
      return { read = function() return content end, close = function() end }
    end
    local dir = path:match("^(.*)\\[^\\]+$")
    if dir and dir ~= "." and not FS_DIRS[dir] then return nil, "no such directory" end
    local buf = {}
    if mode:sub(1, 1) == "a" and FS[path] then table.insert(buf, FS[path]) end
    return {
      write = function(_, s) table.insert(buf, s) end,
      close = function() FS[path] = table.concat(buf) end,
    }
  end,
}

math.huge = nil   -- Rome II's trimmed math library has no math.huge (seen in bridge.log 2026-10-20)
os.getenv = function(name) if name == "USERPROFILE" then return "C:\\Users\\test" end end
os.time = function() return 1700000000 end
os.date = function() return "12:00:00" end
CLOCK = 100
os.clock = function() return CLOCK end   -- tests advance CLOCK to simulate time passing
out = { ting = function(s) table.insert(LOG, s) end }

LOC = {
  factions_screen_name_rom_rome = "Rome",
  factions_screen_name_rom_carthage = "Carthage",
  regions_onscreen_rom_italia_latium = "Latium",
  names_name_1 = "Gaius", names_name_2 = "Julius",
}
common = { get_localised_string = function(k) return LOC[k] end }

local function list(items)
  return {
    num_items = function() return #items end,
    item_at = function(_, i) return items[i + 1] end,
    is_empty = function() return #items == 0 end,
  }
end

local function record(name, fn)
  return function(self, ...)
    table.insert(CALLS, { name = name, args = { ... } })
    if fn then return fn(...) end
  end
end

FACTIONS, REGIONS, CHARS = {}, {}, {}

local function make_unit(key) return { unit_key = function() return key end, percentage_proportion_of_full_strength = function() return 100 end } end

local function make_force(units, general)
  local f = {}
  f.unit_list = function() return list(units) end
  f.is_army = function() return true end
  f.is_navy = function() return false end
  f.upkeep = function() return 500 end
  f.percentage_proportion_of_full_strength = function() return 95 end
  f.has_general = function() return general ~= nil end
  f.general_character = function() return general end
  return f
end

local function make_char(spec)
  local c = {}
  c.cqi = function() return spec.cqi end
  c.faction = function() return FACTIONS[spec.faction] end
  c.character_type = function(_, key) return key == spec.type end   -- predicate, as in the real game
  c.get_forename = function() return spec.forename or "" end
  c.get_surname = function() return spec.surname or "" end
  c.display_position_x = function() return spec.x end
  c.display_position_y = function() return spec.y end
  c.logical_position_x = function() return spec.lx end
  c.logical_position_y = function() return spec.ly end
  c.in_settlement = function() return spec.in_settlement == true end
  c.is_embedded_in_military_force = function() return false end
  c.is_faction_leader = function() return spec.leader == true end
  c.age = function() return 40 end
  c.region = function() return REGIONS[spec.region] end
  c.has_military_force = function() return spec.units ~= nil end
  local force
  if spec.units then
    local units = {}
    for _, k in ipairs(spec.units) do table.insert(units, make_unit(k)) end
    force = make_force(units, c)
  end
  c.military_force = function() return force end
  CHARS[spec.cqi] = c
  return c
end

local function make_region(key, owner, x, y)
  local r = { key = key, owner = owner }
  r.name = function() return key end
  r.owning_faction = function() return FACTIONS[r.owner] end
  r.province_name = function() return "prov_" .. key end
  r.public_order = function() return 3 end
  r.slots = { { building = "rom_ROMAN_city_major_1", chain = "rom_ROMAN_city_major", superchain = "rom_ROMAN_city" }, {} }
  r.slot_list = function()
    local items = {}
    for _, s in ipairs(r.slots) do
      table.insert(items, {
        has_building = function() return s.building ~= nil end,
        building = function() return { name = function() return s.building end, chain = function() return s.chain end, superchain = function() return s.superchain end } end,
      })
    end
    return list(items)
  end
  r.settlement = function()
    return {
      display_position_x = function() return x end,
      display_position_y = function() return y end,
      logical_position_x = function() return math.floor(x / 10) end,
      logical_position_y = function() return math.floor(y / 10) end,
    }
  end
  REGIONS[key] = r
  return r
end

local function make_faction(key, spec)
  local f = { key = key, treasury_value = spec.treasury, chars = {}, regions = {} }
  f.name = function() return key end
  f.treasury = function() return f.treasury_value end
  f.is_human = function() return spec.human == true end
  f.is_dead = function() return false end
  f.is_rebel = function() return false end
  f.culture = function() return spec.culture end
  f.subculture = function() return spec.culture .. "_sub" end
  f.region_list = function() return list(f.regions) end
  f.character_list = function() return list(f.chars) end
  f.military_force_list = function() return list({}) end
  f.faction_leader = function() return f.chars[1] end
  FACTIONS[key] = f
  return f
end

local rome = make_faction("rom_rome", { treasury = 5000, human = true, culture = "rom_Roman" })
local carthage = make_faction("rom_carthage", { treasury = 3000, human = false, culture = "rom_Punic" })
table.insert(rome.regions, make_region("rom_italia_latium", "rom_rome", 420.0, 310.0))
table.insert(rome.regions, make_region("rom_italia_campania", "rom_rome", 440.0, 290.0))
table.insert(carthage.regions, make_region("rom_africa_zeugitana", "rom_carthage", 380.0, 180.0))
table.insert(rome.chars, make_char({ cqi = 101, faction = "rom_rome", type = "general", forename = "names_name_1", surname = "names_name_2",
  x = 421.5, y = 312.25, lx = 42, ly = 31, region = "rom_italia_latium", leader = true,
  units = { "Rom_Gen_Bodyguard", "Rom_Hastati", "Rom_Hastati" } }))
table.insert(rome.chars, make_char({ cqi = 102, faction = "rom_rome", type = "spy", x = 430, y = 300, lx = 43, ly = 30, region = "rom_italia_campania" }))
table.insert(rome.chars, make_char({ cqi = 103, faction = "rom_rome", type = "politician", x = 0, y = 0, lx = 0, ly = 0 }))
table.insert(carthage.chars, make_char({ cqi = 201, faction = "rom_carthage", type = "general", x = 381, y = 182, lx = 38, ly = 18,
  region = "rom_africa_zeugitana", units = { "Car_Gen_Bodyguard", "Car_Hoplites" } }))
MODEL = {
  world = function()
    return {
      faction_list = function() return list({ rome, carthage }) end,
      -- An unknown key answers with an object that has no methods, as in Rome II.
      faction_by_key = function(_, key) return FACTIONS[key] or {} end,
      region_manager = function()
        return {
          region_list = function() return list({ REGIONS.rom_italia_latium, REGIONS.rom_italia_campania, REGIONS.rom_africa_zeugitana }) end,
          region_by_key = function(_, key) return REGIONS[key] end,
        }
      end,
    }
  end,
  turn_number = function() return 12 end,
  campaign_name = function() return "main_rome" end,
  is_multiplayer = function() return false end,
  faction_is_local = function(_, key) return key == "rom_rome" end,
}

GI = {
  model = function() return MODEL end,
  add_time_trigger = function(_, id, t) table.insert(TIMERS, { id = id, t = t }) end,
  treasury_mod = record("treasury_mod", function(f, amt) FACTIONS[f].treasury_value = FACTIONS[f].treasury_value + amt end),
  transfer_region_to_faction = record("transfer_region_to_faction", function(r, f) REGIONS[r].owner = f end),
  create_force = record("create_force"),
  kill_character = record("kill_character"),
  replenish_action_points = record("replenish_action_points"),
  zero_action_points = record("zero_action_points"),
  force_declare_war = record("force_declare_war"),
  force_make_peace = record("force_make_peace"),
  enable_movement_for_character = record("enable_movement_for_character"),
  show_shroud = record("show_shroud"),
  make_region_visible_in_shroud = record("make_region_visible_in_shroud"),
  scroll_camera = record("scroll_camera"),
  award_experience_level = record("award_experience_level"),
  add_agent_experience = record("add_agent_experience"),
  apply_effect_bundle_to_characters_force = record("apply_effect_bundle_to_characters_force"),
  instant_set_building_health_percent = record("instant_set_building_health_percent"),  -- Mock accepts the (region_key, building_key) form only.
  -- move_to deliberately absent: Rome II's GAME table does not list it.
}

SCRIPTING = {
  game_interface = GI,
  AddEventCallBack = function(event, fn, user_defined)
    EVENTS[event] = EVENTS[event] or {}
    table.insert(EVENTS[event], { fn = fn, user_defined = user_defined })
  end,
}

function FIRE(event, context)
  for _, entry in ipairs(EVENTS[event] or {}) do entry.fn(context) end
end

function POLL() FIRE("TimeTrigger", { string = "rome2_web_editor_poll" }) end

function REQUEST(json_text)
  FS["C:\\Users\\test\\rome2_web_editor_mod\\request.json"] = json_text
  POLL()
end

function RESPONSE() return FS["C:\\Users\\test\\rome2_web_editor_mod\\response.json"] end

package.preload["lua_scripts.rome2_web_editor_json"] = assert(load(SRC_JSON, "=rome2_web_editor_json.lua"))
package.preload["lua_scripts.rome2_web_editor"] = assert(load(SRC_BRIDGE, "=rome2_web_editor.lua"))
JSON = require("lua_scripts.rome2_web_editor_json")
