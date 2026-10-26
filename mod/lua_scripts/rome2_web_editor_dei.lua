-------------------------------------------------------------------------------
--  Rome II Web Campaign Editor - DEI extension
--
--  Shipped only in !rome2_web_editor_dei_patch.pack. The bridge requires it when
--  present; without it the editor behaves as vanilla even in a DEI campaign.
-------------------------------------------------------------------------------

local DEI = {}

DEI.capabilities = { get_region_population = "verified", set_region_population = "verified" }

-- DEI's population classes, in DEI's order: nobles, citizens, poor, foreigners.
local POPULATION_CLASSES = { "upper", "middle", "lower", "foreign" }

-- DEI's lua_scripts\population.lua is a module(); its region table is local to it, so the only way
-- in is the functions it exports. It is never required here: outside DEI it does not exist.
local function population_script()
  local pop = package.loaded["lua_scripts.population"]
  if type(pop) == "table" and type(pop.GetRegionPop) == "function" and type(pop.SetRegionPop) == "function" then return pop end
  return nil
end

function DEI.active() return population_script() ~= nil end

local function region_population(pop, region)
  local values = pop.GetRegionPop(region)
  if type(values) ~= "table" then error("no DEI population for region " .. region:name()) end
  local out_t = {}
  for i, class in ipairs(POPULATION_CLASSES) do out_t[class] = values[i] end
  return out_t
end

-- api: the bridge's ok, require_arg and find_region helpers.
function DEI.install(handlers, api)
  handlers.get_region_population = function(data)
    local key = api.require_arg(data, "region", "string")
    local pop = population_script() or error("the DEI population script is not loaded")
    return api.ok({ region = key, population = region_population(pop, api.find_region(key)) })
  end

  -- Classes left out of the request keep their value. SetRegionPop clamps to DEI's limits; like DEI's
  -- own scripts, the UIPopulation copy that DEI's panels read is updated alongside.
  handlers.set_region_population = function(data)
    local key = api.require_arg(data, "region", "string")
    local pop = population_script() or error("the DEI population script is not loaded")
    local region = api.find_region(key)
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
    return api.ok({ region = key, population = after })
  end
end

return DEI
