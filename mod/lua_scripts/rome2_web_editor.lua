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
M.poll_id       = "rome2_web_editor_poll"
M.handlers      = M.handlers or {}
M.request_id    = M.request_id or -1
M.active        = false
M.timer_pending = false

-- How each handler was validated before any in-game test:
--   verified     exact call seen in CA or DEI Rome II campaign scripts
--   engine       method name present in Rome II's GAME binding table, signature from Attila-era docs
--   composed     built from several of the above
--   experimental method presence not confirmed for Rome II; call is pcall-guarded
M.capabilities = {
  heartbeat = "verified", get_game_info = "verified", get_factions = "verified",
  get_regions = "verified", get_regions_detailed = "verified", get_active_characters = "verified",
  get_force_units = "verified", reveal_all_regions = "verified", get_snapshot = "verified",
  treasury_mod = "verified", transfer_region_to_faction = "verified",
  set_public_order = "verified", replenish_action_points = "verified", zero_action_points = "verified",
  create_force = "verified", force_declare_war = "verified", force_make_peace = "verified",
  force_make_trade_agreement = "verified", force_diplomacy = "verified",
  apply_effect_bundle = "verified", remove_effect_bundle = "verified",
  make_region_visible_in_shroud = "verified", show_shroud = "verified", scroll_camera = "verified",
  force_rebellion_in_region = "verified",
  force_make_vassal = "engine", force_add_trait = "engine",
  force_add_ancillary = "engine", add_development_points_to_region = "engine",
  set_tax_rate = "engine", hide_character = "engine", unhide_character = "engine", award_experience_level = "engine",
  add_agent_experience = "verified", add_force_experience = "engine",
  instantly_repair_building = "engine", end_turn = "engine",
  get_settlement_slots = "verified", repair_building = "verified",
  relocate_force = "composed", relocate_status = "verified",
  move_force = "engine", move_status = "verified",
  debit_treasury = "experimental",
}

-- Reported only while DEI's population script is loaded (see dei_population).
M.dei_capabilities = { get_region_population = "verified", set_region_population = "verified" }

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

-- Every request is held back for a while after relocate_force kills the original general, so
-- nothing reads the model while the game processes the death.
M.hold_until = nil
M.removed = { characters = {} }
-- cqi -> true when the character is an agent. Filled while describing characters, so a
-- later positions-only poll does not re-test every politician's type.
M.agent_cqis = M.agent_cqis or {}
local HOLD_SECONDS = 5
local function hold_model_reads(seconds)
  M.hold_until = os.clock() + (seconds or HOLD_SECONDS)
end

function M.handle_request()
  local text = read_all(M.request_file)
  if not text or text == "" then return end
  local ok, data = pcall(JSON.decode, text)
  if not ok or type(data) ~= "table" then return end          -- partial write; retry next tick
  if data.request_id == nil or data.request_id == M.request_id then return end
  if M.hold_until then
    if os.clock() < M.hold_until then return end               -- leave the request for a later tick
    M.hold_until = nil
  end
  M.request_id = data.request_id
  local fn = M.handlers[data.type]
  if not fn then
    M.handle_response({ ok = false, error = "unknown request type: " .. tostring(data.type) })
    return
  end
  if data.cqi ~= nil and M.removed.characters[tostring(data.cqi)] then
    M.handle_response({ ok = false, error = "character was killed: cqi " .. tostring(data.cqi) })
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

-- world():faction_list() leaves out the rebel factions, yet a rebellion's armies stand on the map.
-- Each campaign has its own set; only the set whose prefix matches the player's faction is looked up.
-- A rebel faction is also learnt when one of its characters is created or its turn starts.
local REBEL_FACTIONS = {
  "rom_rebel_african", "rom_rebel_arabian", "rom_rebel_briton", "rom_rebel_celt", "rom_rebel_dacian",
  "rom_rebel_eastern", "rom_rebel_egyptian", "rom_rebel_german", "rom_rebel_hellenic", "rom_rebel_iberian",
  "rom_rebel_illyrian", "rom_rebel_latin", "rom_rebel_nomadic", "rom_rebel_punic", "rom_rebel_spartan",
  "rom_rebel_thracian",
  "emp_rebel_african", "emp_rebel_arabian", "emp_rebel_briton", "emp_rebel_celt", "emp_rebel_dacian",
  "emp_rebel_eastern", "emp_rebel_egyptian", "emp_rebel_german", "emp_rebel_hellenic", "emp_rebel_iberian",
  "emp_rebel_illyrian", "emp_rebel_latin", "emp_rebel_nomadic", "emp_rebel_punic", "emp_rebel_spartan",
  "emp_rebel_thracian",
  "3c_rebel_african", "3c_rebel_arabian", "3c_rebel_celtic", "3c_rebel_eastern", "3c_rebel_germanic",
  "3c_rebel_latin", "3c_rebel_nomadic",
  "gaul_rebel_briton", "gaul_rebel_celt", "gaul_rebel_gaul", "gaul_rebel_german", "gaul_rebel_latin",
  "inv_rebel_carthage", "inv_rebel_etruscan", "inv_rebel_gaul", "inv_rebel_greek", "inv_rebel_iapygian",
  "inv_rebel_italic", "inv_rebel_nuragic", "inv_rebels_greek",
  "pel_rebels_aiolian", "pel_rebels_akaian", "pel_rebels_barbarian", "pel_rebels_dorian", "pel_rebels_ionian",
  "pel_rebels_makedonian", "pel_rebels_other_greeks", "pel_rebels_persian",
  "pun_rebel_african", "pun_rebel_celt", "pun_rebel_celtiberian", "pun_rebel_hellenic", "pun_rebel_latin",
  "pun_rebel_punic",
  "pro_rebels",
}

local function player_faction_key()
  local list = world():faction_list()
  for i = 0, list:num_items() - 1 do
    local key = list:item_at(i):name()
    if model():faction_is_local(key) then return key end
  end
  return nil
end

-- Rebel factions by key: true when faction_by_key finds them, else the object an event handed over.
-- Reset when a campaign loads.
local function forget_rebels() M.rebels = nil end

local function rebels()
  if M.rebels then return M.rebels end
  M.rebels = {}
  local player = safe(player_faction_key)
  local prefix = type(player) == "string" and player:match("^([^_]+_)") or nil
  if prefix then
    for _, key in ipairs(REBEL_FACTIONS) do
      if key:sub(1, #prefix) == prefix and faction_by_key(key) then M.rebels[key] = true end
    end
  end
  local found = {}
  for key in pairs(M.rebels) do found[#found + 1] = key end
  log("rebel factions found by key: " .. (#found > 0 and table.concat(found, ", ") or "none"))
  return M.rebels
end

function M.learn_rebel(f)
  local key = safe(function() return f:name() end)
  if type(key) ~= "string" or rebels()[key] ~= nil then return end
  if not (safe(function() return f:is_rebel() end) == true or key:find("rebel", 1, true)) then return end
  if faction_by_key(key) then M.rebels[key] = true else M.rebels[key] = f end
  log("rebel faction learnt: " .. key .. (M.rebels[key] == true and "" or " (not found by key)"))
end

-- Every faction that can have characters on the map: the faction list plus the rebels.
local function map_factions()
  local out, seen = {}, {}
  local list = world():faction_list()
  for i = 0, list:num_items() - 1 do
    local f = list:item_at(i)
    out[#out + 1] = f
    seen[f:name()] = true
  end
  for key, held in pairs(rebels()) do
    local f = held == true and faction_by_key(key) or held
    if not seen[key] and f and safe(function() return f:name() end) == key then out[#out + 1] = f end
  end
  return out
end

local function find_region(key)
  local r = world():region_manager():region_by_key(key)
  if is_null(r) then error("region not found: " .. tostring(key)) end
  return r
end

-- A general killed by relocate_force stays in its faction's character_list for the rest of the
-- session; it is hidden from every list and refused as a target. Reset when a campaign loads.
local function forget_removed() M.removed = { characters = {} } end
local function is_removed_character(cqi) return M.removed.characters[tostring(cqi)] == true end

local function find_character(cqi)
  local wanted = tostring(cqi)
  if is_removed_character(wanted) then error("character was killed: cqi " .. wanted) end
  for _, f in ipairs(map_factions()) do
    local chars = f:character_list()
    for j = 0, chars:num_items() - 1 do
      local c = chars:item_at(j)
      if tostring(c:cqi()) == wanted then return c end
    end
  end
  error("character not found: cqi " .. wanted)
end

local function ok(extra)
  extra = extra or {}
  extra.ok = true
  return extra
end

-------------------------------------------------------------------------------
-- read handlers
-------------------------------------------------------------------------------

-- DEI's lua_scripts\population.lua is a module(); its region table is local to it, so the only way
-- in is the functions it exports. It is never required here: in vanilla it does not exist.
local function dei_population()
  local pop = package.loaded["lua_scripts.population"]
  if type(pop) == "table" and type(pop.GetRegionPop) == "function" and type(pop.SetRegionPop) == "function" then return pop end
  return nil
end

local function current_capabilities()
  if not dei_population() then return M.capabilities end
  local all = {}
  for k, v in pairs(M.capabilities) do all[k] = v end
  for k, v in pairs(M.dei_capabilities) do all[k] = v end
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
    dei = dei_population() ~= nil,
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
    is_dead = safe(function() return f:is_dead() end, false),
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
  for _, f in ipairs(map_factions()) do
    local chars = f:character_list()
    for j = 0, chars:num_items() - 1 do
      local c = chars:item_at(j)
      local cqi = safe(function() return c:cqi() end)
      if cqi and not is_removed_character(cqi) and character_on_map(c, cqi) then
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
  for _, f in ipairs(map_factions()) do
    local fkey = f:name()
    local chars = f:character_list()
    for j = 0, chars:num_items() - 1 do
      local c = chars:item_at(j)
      if not is_removed_character(c:cqi()) then
        local entry = describe_character(c, fkey)
        if include_all or entry.has_force or entry.is_agent then
          table.insert(out_list, entry)
        end
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

M.handlers.get_force_units = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local c = find_character(cqi)
  if not c:has_military_force() then error("character has no military force") end
  local units = {}
  local list = c:military_force():unit_list()
  for i = 0, list:num_items() - 1 do
    local u = list:item_at(i)
    table.insert(units, {
      key = safe(function() return u:unit_key() end),
      strength = safe(function() return u:percentage_proportion_of_full_strength() end),
    })
  end
  return ok({ cqi = cqi, units = units })
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

-- The only debit Rome II scripts can make is a "money -N" dilemma payload (DEI changeCapital
-- uses it). Both choices carry the payload, so the money goes whichever one is picked.
-- The engine resolves the dilemma later, so the returned treasury is the value before it.
M.handlers.debit_treasury = function(data)
  local faction = require_arg(data, "faction", "string")
  local amount = math.floor(require_arg(data, "amount", "number"))
  if amount <= 0 then error("amount must be a positive number") end
  local f = find_faction(faction)
  local payload = "payload { money -" .. amount .. "; }"
  gi():trigger_custom_dilemma(faction, "move_capital_rome", payload, payload, true)
  return ok({ faction = faction, amount = amount, treasury = safe(function() return f:treasury() end) })
end

M.handlers.transfer_region_to_faction = function(data)
  local region = require_arg(data, "region", "string")
  local faction = require_arg(data, "faction", "string")
  find_region(region)
  find_faction(faction)
  gi():transfer_region_to_faction(region, faction)
  return ok({ region = region, owner = safe(function() return find_region(region):owning_faction():name() end) })
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

-- DEI population classes, in DEI's order: nobles, citizens, poor, foreigners.
local POPULATION_CLASSES = { "upper", "middle", "lower", "foreign" }

local function region_population(pop, region)
  local values = pop.GetRegionPop(region)
  if type(values) ~= "table" then error("no DEI population for region " .. region:name()) end
  local out_t = {}
  for i, class in ipairs(POPULATION_CLASSES) do out_t[class] = values[i] end
  return out_t
end

M.handlers.get_region_population = function(data)
  local key = require_arg(data, "region", "string")
  local pop = dei_population() or error("the DEI population script is not loaded")
  return ok({ region = key, population = region_population(pop, find_region(key)) })
end

-- Classes left out of the request keep their value. SetRegionPop clamps to DEI's limits; like DEI's
-- own scripts, the UIPopulation copy that DEI's panels read is updated alongside.
M.handlers.set_region_population = function(data)
  local key = require_arg(data, "region", "string")
  local pop = dei_population() or error("the DEI population script is not loaded")
  local region = find_region(key)
  local current = region_population(pop, region)
  local values = {}
  for i, class in ipairs(POPULATION_CLASSES) do
    local v = data[class]
    if v ~= nil and type(v) ~= "number" then error(class .. " must be a number") end
    values[i] = v or current[class]
  end
  pop.SetRegionPop(key, values[1], values[2], values[3], values[4])
  local after = region_population(pop, region)
  local ui = type(pop.UIPopulation) == "table" and pop.UIPopulation[key]
  if type(ui) == "table" then
    for i, class in ipairs(POPULATION_CLASSES) do ui[i] = after[class] end
  end
  return ok({ region = key, population = after })
end

M.handlers.set_tax_rate = function(data)
  local faction = require_arg(data, "faction", "string")
  local rate = require_arg(data, "rate", "number")
  gi():set_tax_rate(faction, rate)
  return ok({ faction = faction })
end

M.handlers.apply_effect_bundle = function(data)
  local bundle = require_arg(data, "bundle", "string")
  local faction = require_arg(data, "faction", "string")
  local turns = tonumber(data.turns) or 0
  gi():apply_effect_bundle(bundle, faction, turns)
  return ok({ bundle = bundle, faction = faction })
end

M.handlers.remove_effect_bundle = function(data)
  local bundle = require_arg(data, "bundle", "string")
  local faction = require_arg(data, "faction", "string")
  gi():remove_effect_bundle(bundle, faction)
  return ok({ bundle = bundle, faction = faction })
end

M.handlers.force_rebellion_in_region = function(data)
  local region = require_arg(data, "region", "string")
  local units = tonumber(data.units) or 4
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  gi():force_rebellion_in_region(region, units, "", x, y, false)
  return ok({ region = region })
end

M.handlers.instantly_repair_building = function(data)
  local region = require_arg(data, "region", "string")
  gi():instantly_repair_building(region)
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

-- Enables/disables a diplomatic option between two factions; it does not sign the treaty.
M.handlers.force_diplomacy = function(data)
  local a, b = two_factions(data)
  local kind = require_arg(data, "kind", "string")
  local offer = require_arg(data, "offer", "boolean")
  local accept = require_arg(data, "accept", "boolean")
  gi():force_diplomacy(a, b, kind, offer, accept)
  return ok({ a = a, b = b, kind = kind })
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
-- `award_experience_level` on an agent routes to add_agent_experience (agents have no army).
local function experience_method_for(c)
  local ctype = character_type_of(c)
  if AGENT_TYPES[ctype or ""] then return "add_agent_experience", ctype end
  return "award_experience_level", ctype
end

M.handlers.award_experience_level = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local c = find_character(cqi)
  local method, ctype = experience_method_for(c)
  if method == "add_agent_experience" then
    local points = tonumber(data.points) or (tonumber(data.levels) or 1) * 100
    gi():add_agent_experience(char_str(cqi), points)
    return ok({ cqi = cqi, type = ctype, method = method, points = points })
  end
  local levels = tonumber(data.levels) or 1
  gi():award_experience_level(char_str(cqi), levels)
  return ok({ cqi = cqi, type = ctype, method = method, levels = levels })
end

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

M.handlers.hide_character = function(data)
  local cqi = require_arg(data, "cqi", "number")
  gi():hide_character(char_str(cqi))
  return ok({ cqi = cqi })
end

M.handlers.unhide_character = function(data)
  local cqi = require_arg(data, "cqi", "number")
  gi():unhide_character(char_str(cqi))
  return ok({ cqi = cqi })
end

M.handlers.force_add_trait = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local trait = require_arg(data, "trait", "string")
  find_character(cqi)
  gi():force_add_trait(char_str(cqi), trait, data.show_message == true)
  return ok({ cqi = cqi, trait = trait })
end

M.handlers.force_add_ancillary = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local ancillary = require_arg(data, "ancillary", "string")
  find_character(cqi)
  gi():force_add_ancillary(char_str(cqi), ancillary)
  return ok({ cqi = cqi, ancillary = ancillary })
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
  find_faction(faction)
  find_region(region)
  local id = "rome2_web_editor_" .. tostring(M.request_id) .. "_" .. tostring(os.time())
  gi():create_force(faction, units, region, x, y, id, true)
  return ok({ faction = faction, region = region, id = id, queued = true })
end

-- Movement order through the game's own pathfinding (respects impassable terrain, embarks armies
-- at sea, keeps fleets at sea). Same call as CA's Move_NPC_Army in lib_misc_campaign.lua:
--   game_interface:move_to(char_str, x, y, true)
-- Logical x/y. Movement points apply; pass replenish=true to top them up first.
local function issue_move(cqi, x, y, replenish)
  local g = gi()
  pcall(function() g:enable_movement_for_character(char_str(cqi)) end)
  if replenish then pcall(function() g:replenish_action_points(char_str(cqi)) end) end
  local ok_move, err_move = pcall(function() g:move_to(char_str(cqi), x, y, true) end)
  if not ok_move then error("move_to failed: " .. tostring(err_move)) end
end

-- chain=true (default) keeps the order alive: whenever the army stops short of the target it is
-- replenished and re-ordered, so a drag can cross the whole map in one turn. Gives up after
-- several stalls without progress (unreachable / blocked).
M.escorts = M.escorts or {}
M.handlers.move_force = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  local c = find_character(cqi)
  issue_move(cqi, x, y, data.replenish ~= false)
  if data.chain ~= false then
    M.escorts[cqi] = { x = x, y = y, last_lx = c:logical_position_x(), last_ly = c:logical_position_y(),
                       stalls = 0, reissues = 0, ticks = 0, status = "moving" }
  end
  log("move_force: cqi " .. tostring(cqi) .. " -> " .. x .. "," .. y .. (data.chain ~= false and " (chained)" or ""))
  return ok({ cqi = cqi, x = x, y = y, chained = data.chain ~= false })
end

M.handlers.move_status = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local e = M.escorts[cqi]
  if not e then return ok({ cqi = cqi, status = "idle" }) end
  return ok({ cqi = cqi, status = e.status, reissues = e.reissues, target = { x = e.x, y = e.y } })
end

-- Called every poll tick (0.1 s); acts every 5th tick.
local function tick_escorts()
  for cqi, e in pairs(M.escorts) do
    e.ticks = e.ticks + 1
    if e.ticks % 5 == 0 then
      local ok_c, c = pcall(find_character, cqi)
      if not ok_c then
        M.escorts[cqi] = nil
      else
        local lx, ly = c:logical_position_x(), c:logical_position_y()
        if math.max(math.abs(lx - e.x), math.abs(ly - e.y)) <= 1 then
          e.status = "arrived"
          log("move_force: cqi " .. tostring(cqi) .. " arrived at " .. lx .. "," .. ly)
          M.escorts[cqi] = nil
        elseif lx == e.last_lx and ly == e.last_ly then
          e.stalls = e.stalls + 1
          if e.stalls >= 2 then
            e.stalls = 0
            e.reissues = e.reissues + 1
            if e.reissues > 8 then
              e.status = "stuck"
              log("move_force: cqi " .. tostring(cqi) .. " stuck at " .. lx .. "," .. ly .. "; giving up")
              M.escorts[cqi] = nil
            else
              pcall(issue_move, cqi, e.x, e.y, true)
            end
          end
        else
          e.stalls = 0
          e.last_lx, e.last_ly = lx, ly
        end
      end
    end
  end
end

-- Rome II has no campaign teleport. "Relocate" recreates the force at the target (same faction,
-- same unit roster) and then kills the original general; the new force gets a freshly generated
-- general, so rank/traits of the old one are lost.
--
-- Sequence (asynchronous, mirrors campaign_manager:create_force):
--   1. create_force(..., id, true) goes through the command queue
--   2. ScriptedForceCreated fires -> the new general is located near (x, y)
--   3. a short time trigger later the original character is killed (never in the same tick)
--   4. a 6 s timeout abandons the relocation (original kept) if the force never appears
M.pending = M.pending or {}
local KILL_PREFIX, TIMEOUT_PREFIX = "rome2_web_editor_kill:", "rome2_web_editor_timeout:"

local function general_near(faction_key, x, y, exclude_cqi)
  local best, best_d = nil, 9
  local chars = find_faction(faction_key):character_list()
  for i = 0, chars:num_items() - 1 do
    local c = chars:item_at(i)
    local cqi = c:cqi()
    if cqi ~= exclude_cqi and not is_removed_character(cqi) and safe(function() return c:has_military_force() end, false) then
      local d = (c:logical_position_x() - x) ^ 2 + (c:logical_position_y() - y) ^ 2
      if d < best_d then best, best_d = cqi, d end
    end
  end
  return best
end

M.relocation_counter = M.relocation_counter or 0

-- Destructive by nature (the original general dies). Refused for faction leaders and for human
-- factions unless the caller passes allow_leader / allow_player: killing the player's leader on
-- turn 1 and then opening the army panel crashed the game (2026-10-21 00:38).
M.handlers.relocate_force = function(data)
  local cqi = require_arg(data, "cqi", "number")
  local region = require_arg(data, "region", "string")
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  local skip_first = data.skip_first_unit ~= false   -- item 0 is normally the general's own unit
  for id, p in pairs(M.pending) do
    if p.cqi == cqi then error("a relocation of this character is already pending (" .. id .. ")") end
  end
  local c = find_character(cqi)
  if not c:has_military_force() then error("character has no military force") end
  local is_leader = safe(function() return c:is_faction_leader() end, false)
  local is_human = safe(function() return c:faction():is_human() end, false)
  if is_leader and not data.allow_leader then error("refusing to recreate a faction leader's army (kills the leader); use a move order instead") end
  if is_human and not data.allow_player then error("refusing to recreate a player army (scripted generals break the politics UI); use a move order instead") end
  find_region(region)
  local faction = c:faction():name()
  local list = c:military_force():unit_list()
  local keys = {}
  for i = (skip_first and 1 or 0), list:num_items() - 1 do
    table.insert(keys, list:item_at(i):unit_key())
  end
  if #keys == 0 then error("no units to recreate (force has only the general's unit)") end
  M.relocation_counter = M.relocation_counter + 1
  local id = "rome2_web_editor_reloc_" .. tostring(cqi) .. "_" .. tostring(os.time()) .. "_" .. tostring(M.relocation_counter)
  M.pending[id] = { cqi = cqi, faction = faction, x = x, y = y, units = #keys, kill = data.kill_original ~= false,
                    leader = is_leader, status = "queued" }
  gi():create_force(faction, table.concat(keys, ","), region, x, y, id, true)
  gi():add_time_trigger(TIMEOUT_PREFIX .. id, 6)
  log("relocate " .. id .. ": queued create_force for " .. faction .. " at " .. x .. "," .. y .. " (" .. #keys .. " units)")
  return ok({ faction = faction, region = region, id = id, units = #keys, original_cqi = cqi, pending = true })
end

M.handlers.relocate_status = function(data)
  local id = require_arg(data, "id", "string")
  local p = M.pending[id] or M.finished and M.finished[id]
  if not p then return ok({ id = id, status = "unknown" }) end
  return ok({ id = id, status = p.status, new_cqi = p.new_cqi, original_cqi = p.cqi })
end

function M.on_force_created()
  for id, p in pairs(M.pending) do
    if p.status == "queued" then
      local new_cqi = safe(function() return general_near(p.faction, p.x, p.y, p.cqi) end)
      if new_cqi then
        p.new_cqi = new_cqi
        p.status = p.kill and "created" or "done"
        log("relocate " .. id .. ": force created, new general cqi " .. tostring(new_cqi))
        if p.kill then gi():add_time_trigger(KILL_PREFIX .. id, 0.5) else M.finish(id) end
      end
    end
  end
end

M.finished = M.finished or {}
function M.finish(id)
  local p = M.pending[id]
  if not p then return end
  M.pending[id] = nil
  M.finished[id] = p
end

local function run_kill(id)
  local p = M.pending[id]
  if not p or p.status ~= "created" then return end
  local ok_find = pcall(find_character, p.cqi)
  if not ok_find then p.status = "done"; log("relocate " .. id .. ": original already gone"); M.finish(id); return end
  local ok_kill, err = pcall(function() gi():kill_character(char_str(p.cqi), true) end)
  if ok_kill then M.removed.characters[tostring(p.cqi)] = true; hold_model_reads() end
  p.status = ok_kill and "done" or "kill_failed"
  log("relocate " .. id .. ": kill original cqi " .. tostring(p.cqi) .. (ok_kill and " ok" or (" failed: " .. tostring(err))))
  M.finish(id)
end

local function run_timeout(id)
  local p = M.pending[id]
  if p and p.status == "queued" then
    p.status = "create_failed"
    log("relocate " .. id .. ": force never appeared; original kept")
    M.finish(id)
  end
end

-------------------------------------------------------------------------------
-- shroud / camera / turn
-------------------------------------------------------------------------------

M.handlers.show_shroud = function(data)
  local visible = require_arg(data, "visible", "boolean")
  gi():show_shroud(visible)
  return ok({ visible = visible })
end

M.handlers.make_region_visible_in_shroud = function(data)
  local faction = require_arg(data, "faction", "string")
  local region = require_arg(data, "region", "string")
  gi():make_region_visible_in_shroud(faction, region)
  return ok({ faction = faction, region = region })
end

M.handlers.reveal_all_regions = function(data)
  local faction = data.faction or player_faction_key()
  if not faction then error("no player faction") end
  local list = world():region_manager():region_list()
  local n = 0
  for i = 0, list:num_items() - 1 do
    gi():make_region_visible_in_shroud(faction, list:item_at(i):name())
    n = n + 1
  end
  return ok({ faction = faction, regions = n })
end

-- x/y are DISPLAY coordinates; z is camera height (CA scripts use ~0.95 for close, larger for far).
M.handlers.scroll_camera = function(data)
  local x = require_arg(data, "x", "number")
  local y = require_arg(data, "y", "number")
  local z = tonumber(data.z) or 6
  local t = tonumber(data.duration) or 0.5
  gi():scroll_camera(t, { x, y, z }, { x, y, z })
  return ok({ x = x, y = y })
end

M.handlers.end_turn = function()
  gi():end_turn()
  return ok({})
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

local function schedule_poll()
  if M.timer_pending or not M.active then return end
  local ok_add = pcall(function() M.gi:add_time_trigger(M.poll_id, M.poll_interval) end)
  M.timer_pending = ok_add
  if not ok_add then log("add_time_trigger failed; bridge inactive") end
end

function M.on_time_trigger(context)
  local id = context and context.string
  if type(id) ~= "string" then return end
  if id:sub(1, #KILL_PREFIX) == KILL_PREFIX then run_kill(id:sub(#KILL_PREFIX + 1)) return end
  if id:sub(1, #TIMEOUT_PREFIX) == TIMEOUT_PREFIX then run_timeout(id:sub(#TIMEOUT_PREFIX + 1)) return end
  if id ~= M.poll_id then return end
  M.timer_pending = false
  if not M.active then return end
  if not M.polled_once then M.polled_once = true log("polling started") end
  local ok_poll, err = pcall(M.handle_request)
  if not ok_poll then log("poll error: " .. tostring(err)) end
  local ok_escort, err_escort = pcall(tick_escorts)
  if not ok_escort then log("escort error: " .. tostring(err_escort)) end
  schedule_poll()
end

function M.start(game_interface, reason)
  if not game_interface then log("start(" .. tostring(reason) .. "): no game_interface yet") return end
  M.gi = game_interface
  if M.active then return end
  local writable = M.select_folder()
  log("start(" .. tostring(reason) .. "): folder=" .. tostring(M.folder) .. " kind=" .. tostring(M.folder_kind) .. " writable=" .. tostring(writable))
  M.active = true
  M.request_id = -1
  forget_removed()
  forget_rebels()
  local ok_marker, err = pcall(write_ready_marker)
  if not ok_marker then log("ready marker failed: " .. tostring(err)) else log("ready marker written") end
  schedule_poll()
end

function M.stop()
  M.active = false
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
  scripting.AddEventCallBack("ScriptedForceCreated", function() pcall(M.on_force_created) end, false)
  scripting.AddEventCallBack("CharacterCreated", function(context)
    if M.active then pcall(function() M.learn_rebel(context:character():faction()) end) end
  end, false)
  scripting.AddEventCallBack("FactionTurnStart", function(context)
    if M.active then pcall(function() M.learn_rebel(context:faction()) end) end
  end, false)
  scripting.AddEventCallBack("UIDestroyed", function() M.stop() end, false)
  log("attached v" .. M.version .. " (" .. tostring(_VERSION) .. ")")
end

log("module loaded; USERPROFILE=" .. tostring(user_home()))

return M
