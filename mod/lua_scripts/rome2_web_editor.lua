-------------------------------------------------------------------------------
--  Rome II Web Campaign Editor - in-game bridge
--
--  Port of the Total War: WARHAMMER II "Web campaign editor (experimental)"
--  bridge (IMRZ) to Total War: ROME II.
--
--  Transport: the browser (File System Access API) writes request.json and
--  polls response.json in %USERPROFILE%\rome2_web_editor_mod. This script is
--  attached from lua_scripts/episodicscripting.lua (which every Rome II
--  campaign, vanilla or DEI, requires) and polls request.json every 0.1 s via
--  game_interface:add_time_trigger + the TimeTrigger event.
--
--  Envelope (identical to the WH2 editor):
--    request.json  : {"type":"<handler>","request_id":N, ...args}
--    response.json : {"request_id":N,"result":<handler result>}
--
--  Lua here is 5.1 (CA embedded). No goto, no integer division, no bit ops.
-------------------------------------------------------------------------------

local JSON = require("lua_scripts.rome2_web_editor_json")

ROME2_WEB_EDITOR = ROME2_WEB_EDITOR or {}
local M = ROME2_WEB_EDITOR

M.version       = "0.1.0"
M.protocol      = 1
M.folder_name   = "rome2_web_editor_mod"
M.poll_interval = 0.1
M.poll_prefix   = "rome2_web_editor_poll:"
M.session       = M.session or 0
M.handlers      = M.handlers or {}
M.request_id    = M.request_id or -1
M.active        = false
M.timer_pending = false

-- How each handler was validated before any in-game test:
--   verified     exact call seen in CA or DEI Rome II campaign scripts
--   engine       method name present in Rome II's GAME binding table, signature from Attila-era docs
M.capabilities = {
  heartbeat = "verified", get_game_info = "verified", get_factions = "verified",
  get_regions = "verified", get_regions_detailed = "verified", get_active_characters = "verified",
  get_snapshot = "verified", reveal_all_regions = "verified",
  treasury_mod = "verified", transfer_region_to_faction = "verified",
  set_public_order = "verified", replenish_action_points = "verified", zero_action_points = "verified",
  create_force = "verified", create_agent = "engine", force_declare_war = "verified", force_make_peace = "verified",
  force_make_trade_agreement = "verified", force_make_vassal = "engine",
  force_rebellion_in_region = "verified", add_development_points_to_region = "engine",
  add_agent_experience = "verified", add_force_experience = "engine",
  get_settlement_slots = "verified", repair_building = "verified",
}

-------------------------------------------------------------------------------
-- logging / paths
-------------------------------------------------------------------------------

local function user_home()
  if not (os and os.getenv) then return nil end
  local ok, v = pcall(os.getenv, "USERPROFILE")
  if ok and type(v) == "string" and v ~= "" then return v end
  return nil
end

-- Relative paths resolve against the game root (Rome2.exe folder): mods write
-- "data/campaigns/main_rome/EmpiresLog.txt" and the file appears exactly there.
local function folder_candidates()
  local list = {}
  local home = user_home()
  if home then table.insert(list, { path = home .. "\\" .. M.folder_name, kind = "userprofile" }) end
  table.insert(list, { path = M.folder_name, kind = "relative" })
  table.insert(list, { path = ".", kind = "gameroot" })
  return list
end

local function try_write(path, text, mode)
  local file = io.open(path, mode or "w+")
  if not file then return false end
  local ok = pcall(function() file:write(text) end)
  file:close()
  return ok
end

-- Append-only diagnostics (bridge.log). Written to every location that accepts it so
-- the file can be found even when the user-profile folder is not writable.
local log_targets
function M.debug(msg)
  local line = os.date and os.date("%H:%M:%S") or "?"
  line = line .. " " .. tostring(msg) .. "\n"
  if not log_targets then
    log_targets = {}
    for _, c in ipairs(folder_candidates()) do
      local p = (c.path == ".") and "rome2_web_editor_bridge.log" or (c.path .. "\\bridge.log")
      if try_write(p, "", "a") then table.insert(log_targets, p) end
    end
  end
  for _, p in ipairs(log_targets) do try_write(p, line, "a") end
  if out and out.ting then out.ting("[rome2_web_editor] " .. tostring(msg)) end
end
local log = M.debug
function M.configure(folder, kind)
  M.folder        = folder
  M.folder_kind   = kind
  M.request_file  = folder .. "\\request.json"
  M.response_file = folder .. "\\response.json"
end

-- Picks the first candidate folder where response.json can actually be created.
function M.select_folder()
  for _, c in ipairs(folder_candidates()) do
    if try_write(c.path .. "\\response.json", "", "a") then
      M.configure(c.path, c.kind)
      return true
    end
  end
  local first = folder_candidates()[1]
  M.configure(first.path, first.kind .. "-unwritable")
  return false
end

-------------------------------------------------------------------------------
-- file transport
-------------------------------------------------------------------------------

local function read_all(path)
  local file = io.open(path, "r")
  if not file then return nil end
  local ok, text = pcall(function() return file:read("*a") end)
  file:close()
  if ok then return text end
  return nil
end

local function write_all(path, text)
  local file = io.open(path, "w+")
  if not file then return false end
  local ok = pcall(function() file:write(text) end)
  file:close()
  return ok
end

function M.handle_response(result)
  local ok, encoded = pcall(JSON.encode, { request_id = M.request_id, result = result })
  if not ok then
    -- Hand-built so an encoder fault still reaches the browser instead of leaving a stale file.
    local msg = tostring(encoded):gsub("[\\\"]", " "):gsub("[%c]", " ")
    encoded = '{"request_id":' .. tostring(tonumber(M.request_id) or 0) .. ',"result":{"ok":false,"error":"encode failed: ' .. msg .. '"}}'
    log("encode failed: " .. tostring(msg))
  end
  if not write_all(M.response_file, encoded) then
    log("cannot write " .. tostring(M.response_file))
  end
end

local function run_handler(fn, data)
  local ok, result = pcall(fn, data)
  if ok then return result end
  return { ok = false, error = tostring(result) }
end

-- cqi -> true when the character is an agent. Filled while describing characters, so a
-- later positions-only poll does not re-test every politician's type.
M.agent_cqis = M.agent_cqis or {}

function M.handle_request()
  local text = read_all(M.request_file)
  if not text or text == "" then return end
  local ok, data = pcall(JSON.decode, text)
  if not ok or type(data) ~= "table" then return end          -- partial write; retry next tick
  if data.request_id == nil or data.request_id == M.request_id then return end
  M.request_id = data.request_id
  local fn = M.handlers[data.type]
  if not fn then
    M.handle_response({ ok = false, error = "unknown request type: " .. tostring(data.type) })
    return
  end
  local result = run_handler(fn, data)
  if type(result) == "table" and result.ok == false then
    log("request #" .. tostring(data.request_id) .. " " .. tostring(data.type) .. " failed: " .. tostring(result.error))
  end
  M.handle_response(result)
end

-------------------------------------------------------------------------------
-- model helpers
-------------------------------------------------------------------------------

local function gi()
  if not M.gi then error("game interface not available yet") end
  return M.gi
end

local function model() return gi():model() end
local function world() return model():world() end

local function char_str(cqi) return "character_cqi:" .. tostring(cqi) end

local function require_arg(data, name, kind)
  local v = data[name]
  if v == nil then error("missing argument '" .. name .. "'") end
  if kind == "number" then
    v = tonumber(v)
    if v == nil then error("argument '" .. name .. "' must be a number") end
  elseif kind == "string" then
    if type(v) ~= "string" or v == "" then error("argument '" .. name .. "' must be a non-empty string") end
  elseif kind == "boolean" then
    v = (v == true or v == "true" or v == 1)
  end
  return v
end

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok then return v end
  return default
end

local function is_null(obj)
  if obj == nil then return true end
  local ok, v = pcall(function() return obj:is_null_interface() end)
  if ok and v == true then return true end
  return false
end

local function localised(obj, prefix, key)
  local v = safe(function() return obj:localised_name() end)
  if type(v) == "string" and v ~= "" then return v end
  if common and common.get_localised_string then
    v = safe(function() return common.get_localised_string(prefix .. key) end)
    if type(v) == "string" and v ~= "" then return v end
  end
  return key
end

local function localise_key(key)
  if type(key) ~= "string" or key == "" then return key end
  if common and common.get_localised_string then
    local v = safe(function() return common.get_localised_string(key) end)
    if type(v) == "string" and v ~= "" then return v end
  end
  return key
end

-- faction_by_key answers an unknown key with an object that has no methods (not even
-- is_null_interface), so a faction only counts when it reports its own key.
local function faction_by_key(key)
  local f = safe(function() return world():faction_by_key(key) end)
  if f and safe(function() return f:name() end) == key then return f end
  return nil
end

local function find_faction(key)
  local f = faction_by_key(key)
  if f then return f end
  local list = world():faction_list()
  for i = 0, list:num_items() - 1 do
    local item = list:item_at(i)
    if item:name() == key then return item end
  end
  error("faction not found: " .. tostring(key))
end

-- Rome II's is_dead() can answer false for a destroyed faction that faction_list() still returns,
-- so a faction with no region and no army also counts as dead.
local function faction_is_dead(f)
  if safe(function() return f:is_dead() end, false) == true then return true end
  local regions = safe(function() return f:region_list():num_items() end)
  local forces = safe(function() return f:military_force_list():num_items() end)
  return regions == 0 and forces == 0
end

local function find_region(key)
  local r = world():region_manager():region_by_key(key)
  if is_null(r) then error("region not found: " .. tostring(key)) end
  return r
end

local function find_character(cqi)
  local wanted = tostring(cqi)
  local factions = world():faction_list()
  for i = 0, factions:num_items() - 1 do
    local chars = factions:item_at(i):character_list()
    for j = 0, chars:num_items() - 1 do
      local c = chars:item_at(j)
      if tostring(c:cqi()) == wanted then return c end
    end
  end
  error("character not found: cqi " .. wanted)
end

local function player_faction_key()
  local list = world():faction_list()
  for i = 0, list:num_items() - 1 do
    local key = list:item_at(i):name()
    if model():faction_is_local(key) then return key end
  end
  return nil
end

local function ok(extra)
  extra = extra or {}
  extra.ok = true
  return extra
end

-------------------------------------------------------------------------------
-- read handlers
-------------------------------------------------------------------------------

local function load_dei_extension()
  local found, ext = pcall(require, "lua_scripts.rome2_web_editor_dei")
  if not found or type(ext) ~= "table" then return nil end
  ext.install(M.handlers, { ok = ok, require_arg = require_arg, find_region = find_region })
  return ext
end

local dei = load_dei_extension()

local function dei_active() return dei ~= nil and dei.active() end

local function current_capabilities()
  if not dei_active() then return M.capabilities end
  local all = {}
  for k, v in pairs(M.capabilities) do all[k] = v end
  for k, v in pairs(dei.capabilities) do all[k] = v end
  return all
end

M.handlers.heartbeat = function()
  return ok({ game = "rome2", version = M.version, turn = safe(function() return model():turn_number() end) })
end

M.handlers.get_game_info = function()
  return ok({
    game = "rome2",
    version = M.version,
    protocol = M.protocol,
    folder = M.folder,
    folder_kind = M.folder_kind,
    campaign = safe(function() return model():campaign_name() end),
    turn = safe(function() return model():turn_number() end),
    player_faction = safe(player_faction_key),
    is_multiplayer = safe(function() return model():is_multiplayer() end, false),
    dei = dei_active(),
    capabilities = current_capabilities(),
  })
end

local function describe_faction(f)
  local key = f:name()
  return {
    key = key,
    name = localised(f, "factions_screen_name_", key),
    treasury = safe(function() return f:treasury() end),
    is_human = safe(function() return f:is_human() end, false),
    is_dead = faction_is_dead(f),
    is_rebel = safe(function() return f:is_rebel() end, false),
    regions = safe(function() return f:region_list():num_items() end, 0),
    characters = safe(function() return f:character_list():num_items() end, 0),
    forces = safe(function() return f:military_force_list():num_items() end, 0),
    culture = safe(function() return f:culture() end),
    subculture = safe(function() return f:subculture() end),
    leader_cqi = safe(function() return f:faction_leader():cqi() end),
  }
end

M.handlers.get_factions = function()
  local out_list = {}
  local list = world():faction_list()
  for i = 0, list:num_items() - 1 do
    table.insert(out_list, describe_faction(list:item_at(i)))
  end
  return out_list
end

-- WH2-compatible shape: { [region_key] = owner_faction_key }
M.handlers.get_regions = function()
  local regions = {}
  local list = world():region_manager():region_list()
  for i = 0, list:num_items() - 1 do
    local r = list:item_at(i)
    regions[r:name()] = safe(function() return r:owning_faction():name() end, "")
  end
  return regions
end

M.handlers.get_regions_detailed = function()
  local out_list = {}
  local list = world():region_manager():region_list()
  for i = 0, list:num_items() - 1 do
    local r = list:item_at(i)
    local key = r:name()
    local settlement = safe(function() return r:settlement() end)
    table.insert(out_list, {
      key = key,
      name = localised(r, "regions_onscreen_", key),
      owner = safe(function() return r:owning_faction():name() end, ""),
      province = safe(function() return r:province_name() end),
      public_order = safe(function() return r:public_order() end),
      -- Settlement positions are not in the DEI-observed API surface; probe defensively.
      x = settlement and safe(function() return settlement:display_position_x() end) or nil,
      y = settlement and safe(function() return settlement:display_position_y() end) or nil,
      lx = settlement and safe(function() return settlement:logical_position_x() end) or nil,
      ly = settlement and safe(function() return settlement:logical_position_y() end) or nil,
    })
  end
  return out_list
end

local AGENT_TYPES = { spy = true, dignitary = true, champion = true }

-- Rome II's character_type(key) is a predicate (it returned `false` in a live campaign when called
-- without a key), so the type is found by asking for each known key.
local CHARACTER_TYPE_KEYS = { "general", "admiral", "spy", "dignitary", "champion", "colonel", "politician" }
local function character_type_of(c)
  for _, key in ipairs(CHARACTER_TYPE_KEYS) do
    local ok_q, v = pcall(function() return c:character_type(key) end)
    if ok_q and v == true then return key end
  end
  return nil
end

local function character_region(c)
  return safe(function() local r = c:region(); if is_null(r) then return nil end; return r:name() end)
end

local function describe_character(c, faction_key)
  local has_force = safe(function() return c:has_military_force() end, false)
  local ctype = character_type_of(c)
  local force
  if has_force then force = safe(function() return c:military_force() end) end
  local entry = {
    cqi = safe(function() return c:cqi() end),
    faction = faction_key,
    type = ctype,
    forename = localise_key(safe(function() return c:get_forename() end)),
    surname = localise_key(safe(function() return c:get_surname() end)),
    x = safe(function() return c:display_position_x() end),
    y = safe(function() return c:display_position_y() end),
    lx = safe(function() return c:logical_position_x() end),
    ly = safe(function() return c:logical_position_y() end),
    in_settlement = safe(function() return c:in_settlement() end, false),
    embedded = safe(function() return c:is_embedded_in_military_force() end, false),
    faction_leader = safe(function() return c:is_faction_leader() end, false),
    male = safe(function() return c:is_male() end),
    age = safe(function() return c:age() end),
    region = character_region(c),
    has_force = has_force,
    is_agent = AGENT_TYPES[ctype or ""] == true,
  }
  if force and not is_null(force) then
    entry.units = safe(function() return force:unit_list():num_items() end)
    entry.is_army = safe(function() return force:is_army() end, false)
    entry.is_navy = safe(function() return force:is_navy() end, false)
    entry.upkeep = safe(function() return force:upkeep() end)
    entry.strength = safe(function() return force:percentage_proportion_of_full_strength() end)
    entry.is_general = safe(function() return force:has_general() and force:general_character():cqi() == c:cqi() end, false)
  end
  if entry.cqi ~= nil then M.agent_cqis[entry.cqi] = entry.is_agent == true end
  return entry
end

-- A force is on the map; an agent is too. Anyone else (a politician) is not.
local function character_on_map(c, cqi)
  if safe(function() return c:has_military_force() end, false) then return true end
  local known = M.agent_cqis[cqi]
  if known ~= nil then return known end
  local is_agent = AGENT_TYPES[character_type_of(c) or ""] == true
  M.agent_cqis[cqi] = is_agent
  return is_agent
end

-- Coordinates and region only. The browser already has names and forces and merges these in.
local function character_positions()
  local out_list = {}
  local factions = world():faction_list()
  for i = 0, factions:num_items() - 1 do
    local f = factions:item_at(i)
    local chars = f:character_list()
    for j = 0, chars:num_items() - 1 do
      local c = chars:item_at(j)
      local cqi = safe(function() return c:cqi() end)
      if cqi and character_on_map(c, cqi) then
        table.insert(out_list, {
          cqi = cqi,
          x = safe(function() return c:display_position_x() end),
          y = safe(function() return c:display_position_y() end),
          lx = safe(function() return c:logical_position_x() end),
          ly = safe(function() return c:logical_position_y() end),
          in_settlement = safe(function() return c:in_settlement() end, false),
          region = character_region(c),
        })
      end
    end
  end
  return out_list
end

-- Characters that exist on the campaign map: generals with a force, and agents.
M.handlers.get_active_characters = function(data)
  if data and data.positions_only == true then return character_positions() end
  local include_all = data and data.include_all == true
  local out_list = {}
  local factions = world():faction_list()
  for i = 0, factions:num_items() - 1 do
    local f = factions:item_at(i)
    local fkey = f:name()
    local chars = f:character_list()
    for j = 0, chars:num_items() - 1 do
      local entry = describe_character(chars:item_at(j), fkey)
      if include_all or entry.has_force or entry.is_agent then
        table.insert(out_list, entry)
      end
    end
  end
  return out_list
end

-- Everything the map needs in one round trip (the browser otherwise pays the poll latency four times).
M.handlers.get_snapshot = function(data)
  return {
    info = M.handlers.get_game_info(data),
    factions = M.handlers.get_factions(data),
    regions = M.handlers.get_regions_detailed(data),
    characters = M.handlers.get_active_characters(data),
  }
end

-------------------------------------------------------------------------------
-- faction / region mutations
-------------------------------------------------------------------------------

M.handlers.treasury_mod = function(data)
  local faction = require_arg(data, "faction", "string")
  local amount = require_arg(data, "amount", "number")
  -- Rome II ignores a negative treasury_mod for every faction (tested in game, 2026-10-25).
  if amount < 0 then error("Rome II cannot lower a treasury; only positive amounts are applied") end
  find_faction(faction)
  gi():treasury_mod(faction, amount)
  return ok({ faction = faction, treasury = safe(function() return find_faction(faction):treasury() end) })
end

M.handlers.transfer_region_to_faction = function(data)
  local region = require_arg(data, "region", "string")
  local faction_key = require_arg(data, "faction", "string")
  find_region(region)
  local faction = find_faction(faction_key)
  if faction_is_dead(faction) then
    error("Rome II will not give a region to a dead faction")
  end
  gi():transfer_region_to_faction(region, faction_key)
  local owner = safe(function() return find_region(region):owning_faction():name() end)
  if owner ~= faction_key then error("Rome II left " .. region .. " with " .. tostring(owner)) end
  return ok({ region = region, owner = owner })
end

M.handlers.set_public_order = function(data)
  local region = require_arg(data, "region", "string")
  local value = require_arg(data, "value", "number")
  find_region(region)
  gi():set_public_order_of_province_for_region(region, value)
  return ok({ region = region })
end

M.handlers.add_development_points_to_region = function(data)
  local region = require_arg(data, "region", "string")
  local points = require_arg(data, "points", "number")
  find_region(region)
  gi():add_development_points_to_region(region, points)
  return ok({ region = region })
end

M.handlers.force_rebellion_in_region = function(data)
  local region = require_arg(data, "region", "string")
  local units = tonumber(data.units) or 4
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  gi():force_rebellion_in_region(region, units, "", x, y, false)
  return ok({ region = region })
end

-- Same calls as CA's garrison_has_building (lua_scripts\lib_export_triggers.lua). Rome II has no
-- script call that places or upgrades a building (no region_slot_instantly_upgrade_building).
M.handlers.get_settlement_slots = function(data)
  local key = require_arg(data, "region", "string")
  local region = find_region(key)
  local list = region:slot_list()
  local slots = {}
  for i = 0, list:num_items() - 1 do
    local slot = list:item_at(i)
    local entry = { index = i, type = safe(function() return slot:type() end), name = safe(function() return slot:name() end) }
    if safe(function() return slot:has_building() end, false) then
      local b = slot:building()
      entry.building = safe(function() return b:name() end)
      entry.chain = safe(function() return b:chain() end)
      entry.superchain = safe(function() return b:superchain() end)
    end
    table.insert(slots, entry)
  end
  return ok({ region = key, owner = safe(function() return region:owning_faction():name() end), slots = slots })
end

local function slot_at(region_key, index)
  local list = find_region(region_key):slot_list()
  if index < 0 or index >= list:num_items() then error("slot " .. tostring(index) .. " out of range (0-" .. (list:num_items() - 1) .. ")") end
  return list:item_at(index)
end

local function require_building(region_key, index)
  local slot = slot_at(region_key, index)
  if not safe(function() return slot:has_building() end, false) then error("slot " .. index .. " has no building") end
  return slot, slot:building():name()
end

-- Same call as CA's prologue (campaigns\prologue_01\p1_start.lua) and DEI's supply system:
-- instant_set_building_health_percent(region_key, building_level_key, percent); 100 repairs.
M.handlers.repair_building = function(data)
  local region = require_arg(data, "region", "string")
  local index = require_arg(data, "slot", "number")
  local _, building = require_building(region, index)
  gi():instant_set_building_health_percent(region, building, 100)
  return ok({ region = region, slot = index, building = building, percent = 100 })
end
-------------------------------------------------------------------------------
-- diplomacy
-------------------------------------------------------------------------------

local function two_factions(data)
  local a = require_arg(data, "a", "string")
  local b = require_arg(data, "b", "string")
  find_faction(a)
  find_faction(b)
  return a, b
end

M.handlers.force_declare_war = function(data)
  local a, b = two_factions(data)
  gi():force_declare_war(a, b)
  return ok({ a = a, b = b })
end

M.handlers.force_make_peace = function(data)
  local a, b = two_factions(data)
  gi():force_make_peace(a, b)
  return ok({ a = a, b = b })
end

M.handlers.force_make_trade_agreement = function(data)
  local a, b = two_factions(data)
  gi():force_make_trade_agreement(a, b)
  return ok({ a = a, b = b })
end

M.handlers.force_make_vassal = function(data)
  local a, b = two_factions(data)       -- a = overlord, b = vassal (Attila-era order; verify in game)
  gi():force_make_vassal(a, b)
  return ok({ a = a, b = b })
end

-------------------------------------------------------------------------------
-- characters / forces
-------------------------------------------------------------------------------

M.handlers.replenish_action_points = function(data)
  local cqi = require_arg(data, "cqi", "number")
  find_character(cqi)
  gi():replenish_action_points(char_str(cqi))
  return ok({ cqi = cqi })
end

M.handlers.zero_action_points = function(data)
  local cqi = require_arg(data, "cqi", "number")
  find_character(cqi)
  gi():zero_action_points(char_str(cqi))
  return ok({ cqi = cqi })
end

-- Experience comes in two engine flavours:
--   add_agent_experience(lookup, points): the character's own experience. CA's prologue levels the
--     general Silanus with add_agent_experience(Rom_Army_01, 20), and it is the only call that does
--     anything on spies / dignitaries / champions.
--   award_experience_level(lookup, levels): instant rank (chevrons) for the units of the general's
--     army; this is what add_force_experience uses.
M.handlers.add_agent_experience = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local points = tonumber(data.points) or 100
  find_character(cqi)
  gi():add_agent_experience(char_str(cqi), points)
  return ok({ cqi = cqi, points = points })
end

-- Soldier (unit) experience, instant: award_experience_level on the army's general ranks up its units.
-- Unit ranks top out at 9 chevrons.
M.handlers.add_force_experience = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local levels = math.floor(tonumber(data.levels) or 1)
  if levels < 1 or levels > 9 then error("levels must be 1-9 (unit ranks)") end
  local c = find_character(cqi)
  if not safe(function() return c:has_military_force() end, false) then error("character " .. cqi .. " has no military force") end
  gi():award_experience_level(char_str(cqi), levels)
  return ok({ cqi = cqi, levels = levels, method = "award_experience_level" })
end

-- x/y are LOGICAL map coordinates (campaign_manager:create_force compares them with logical_position_x/y).
-- command_queue is always true: every CA and DEI call site uses it, and running the spawn synchronously
-- from a TimeTrigger callback crashed the game in testing.
M.handlers.create_force = function(data)
  local faction = require_arg(data, "faction", "string")
  local units = require_arg(data, "units", "string")
  local region = require_arg(data, "region", "string")
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  if faction_is_dead(find_faction(faction)) then error("Rome II will not spawn an army for a dead faction") end
  find_region(region)
  local id = "rome2_web_editor_" .. tostring(M.request_id) .. "_" .. tostring(os.time())
  gi():create_force(faction, units, region, x, y, id, true)
  return ok({ faction = faction, region = region, id = id, queued = true })
end

-- game_interface:create_agent is in Rome II's GAME table. The argument order is the one Attila and
-- Warhammer II's campaign_manager document for this call: faction, agent type, subtype, logical x,
-- logical y, id, command_queue. agent_culture_details gives spy, dignitary and champion no subtype
-- key (only generals use Rom_General), so the subtype is empty. command_queue stays true, same as
-- create_force: a synchronous spawn from the poll callback crashed the game in testing.
local SPAWN_AGENT_TYPES = { spy = true, dignitary = true, champion = true }
M.handlers.create_agent = function(data)
  local faction = require_arg(data, "faction", "string")
  local agent_type = require_arg(data, "agent_type", "string")
  local region = require_arg(data, "region", "string")
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  if not SPAWN_AGENT_TYPES[agent_type] then error("unknown agent type '" .. agent_type .. "'") end
  find_faction(faction)
  find_region(region)
  local id = "rome2_web_editor_agent_" .. tostring(M.request_id) .. "_" .. tostring(os.time())
  gi():create_agent(faction, agent_type, "", x, y, id, true)
  return ok({ faction = faction, agent_type = agent_type, region = region, id = id, queued = true })
end

-------------------------------------------------------------------------------
-- shroud
-------------------------------------------------------------------------------

-- Lifts the fog of war over every region for one faction (the player's unless given).
M.handlers.reveal_all_regions = function(data)
  local faction = data.faction or player_faction_key()
  if not faction then error("no player faction") end
  find_faction(faction)
  local list = world():region_manager():region_list()
  local n = 0
  for i = 0, list:num_items() - 1 do
    gi():make_region_visible_in_shroud(faction, list:item_at(i):name())
    n = n + 1
  end
  return ok({ faction = faction, regions = n })
end

-------------------------------------------------------------------------------
-- lifecycle
-------------------------------------------------------------------------------

local function write_ready_marker()
  M.request_id = 0
  M.handle_response({
    status = "ready",
    game = "rome2",
    version = M.version,
    protocol = M.protocol,
    folder = M.folder,
    folder_kind = M.folder_kind,
    campaign = safe(function() return model():campaign_name() end),
    turn = safe(function() return model():turn_number() end),
    capabilities = current_capabilities(),
  })
end

-- request.json outlives the session that wrote it. Anything older than the browser's 12 s wait has
-- nobody waiting on it, so it is marked as handled instead of being run again (a second
-- treasury_mod or create_force on load). Requests without sent_at come from an older page.
local STALE_REQUEST_SECONDS = 15
local function skip_stale_request()
  local text = read_all(M.request_file)
  if not text or text == "" then return end
  local ok_decode, data = pcall(JSON.decode, text)
  if not ok_decode or type(data) ~= "table" or data.request_id == nil then return end
  local sent = tonumber(data.sent_at)
  if sent and math.abs(os.time() - sent) <= STALE_REQUEST_SECONDS then return end
  M.request_id = data.request_id
  log("skipped request #" .. tostring(data.request_id) .. " " .. tostring(data.type) .. " left from an earlier session")
end

local function schedule_poll()
  if M.timer_pending or not M.active then return end
  local ok_add = pcall(function() M.gi:add_time_trigger(M.poll_id, M.poll_interval) end)
  M.timer_pending = ok_add
  if not ok_add then log("add_time_trigger failed; bridge inactive") end
end

function M.on_time_trigger(context)
  local id = context and context.string
  if id ~= M.poll_id then return end                            -- also drops timers of an earlier session
  M.timer_pending = false
  if not M.active then return end
  -- The marker waits for the first tick: before it the campaign clock is not running (loading,
  -- intro, pause), and a browser that saw the marker would time out on its first request.
  if M.ready_pending then
    M.ready_pending = false
    log("polling started (session " .. M.session .. ")")
    local ok_marker, err_marker = pcall(write_ready_marker)
    if not ok_marker then log("ready marker failed: " .. tostring(err_marker)) else log("ready marker written") end
    local ok_skip, err_skip = pcall(skip_stale_request)
    if not ok_skip then log("stale request check failed: " .. tostring(err_skip)) end
  end
  local ok_poll, err = pcall(M.handle_request)
  if not ok_poll then log("poll error: " .. tostring(err)) end
  schedule_poll()
end

-- Every campaign UI (load, return from battle) starts a new session from a clean state. The poll
-- timer name carries the session, so a timer armed before the UI went away cannot block or
-- double the new poll.
function M.start(game_interface, reason)
  if not game_interface then log("start(" .. tostring(reason) .. "): no game_interface yet") return end
  M.gi = game_interface
  if M.active then return end
  local writable = M.select_folder()
  M.session = M.session + 1
  log("start(" .. tostring(reason) .. ") session " .. M.session .. ": folder=" .. tostring(M.folder) .. " kind=" .. tostring(M.folder_kind) .. " writable=" .. tostring(writable))
  M.poll_id = M.poll_prefix .. M.session
  M.timer_pending = false
  M.active = true
  M.request_id = -1
  M.ready_pending = true
  schedule_poll()
end

-- Polling ends with the campaign UI; the marker tells the browser at once instead of after a timeout.
function M.stop()
  M.active = false
  M.ready_pending = false
  if M.response_file then
    M.request_id = 0
    local ok_marker, err = pcall(M.handle_response, { status = "stopped", game = "rome2", version = M.version })
    if not ok_marker then log("stopped marker failed: " .. tostring(err)) end
  end
  log("bridge stopped")
end

-- Called from the hook appended to lua_scripts/episodicscripting.lua with that module table.
function M.attach(scripting)
  if M.attached then log("attach: already attached") return end
  if not scripting or type(scripting.AddEventCallBack) ~= "function" then
    log("attach: invalid scripting module")
    return
  end
  M.attached = true
  M.scripting = scripting
  -- `false` keeps these callbacks out of the user-defined list that ClearEventCallbacks() wipes.
  scripting.AddEventCallBack("NewSession", function() log("event NewSession") end, false)
  scripting.AddEventCallBack("FirstTickAfterWorldCreated", function() log("event FirstTickAfterWorldCreated") M.start(scripting.game_interface, "first_tick") end, false)
  scripting.AddEventCallBack("UICreated", function(context)
    local which = context and context.string or "?"
    log("event UICreated " .. tostring(which))
    if which == "Campaign UI" and not M.active and scripting.game_interface then
      M.start(scripting.game_interface, "ui_created")
    end
  end, false)
  scripting.AddEventCallBack("TimeTrigger", function(context) M.on_time_trigger(context) end, false)
  scripting.AddEventCallBack("UIDestroyed", function() M.stop() end, false)
  log("attached v" .. M.version .. " (" .. tostring(_VERSION) .. ")")
end

log("module loaded; USERPROFILE=" .. tostring(user_home()))

return M
