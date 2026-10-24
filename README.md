# Rome II Web Campaign Editor

Browser-based live editor for a running Total War: ROME II campaign — a port of IMRZ's
[Web campaign editor (experimental)](https://steamcommunity.com/sharedfiles/filedetails/?id=2295560801)
for WARHAMMER II. Vanilla and total conversions (Divide et Impera) use the same pack; all factions,
regions and characters are discovered from the live game.

在浏览器中实时编辑正在进行的 ROME II 战役，移植自战锤 II 的 Web campaign editor。原版与 DEI 共用同一个 pack；势力 / 地区 / 角色全部从游戏实时读取。

## How it works / 原理

```
Chrome / Edge  ── File System Access API ──►  %USERPROFILE%\rome2_web_editor_mod\request.json
                                                               │  polled every 0.1 s by Lua
Rome II  ◄── lua_scripts/rome2_web_editor.lua (hooked from lua_scripts/episodicscripting.lua) ──┘
                                                               │
Chrome / Edge  ◄───────────────────────────────  response.json = { request_id, result }
```

- Envelope is identical to the WH2 editor: `request.json = {"type":"get_regions","request_id":N,...}`,
  `response.json = {"request_id":N,"result":...}`.
- Rome II has no `script/campaign/mod/` autoloader. Every campaign's `scripting.lua` (vanilla, DLC, DEI,
  Diplomacy Reforged) does `require "lua_scripts.EpisodicScripting"`, so the pack ships the game's own
  `episodicscripting.lua` plus a 6-line bootstrap at the end. That is the only overridden game file.
- Polling uses `game_interface:add_time_trigger` + the `TimeTrigger` event (the same mechanism CA's
  `add_callback` uses), started on `FirstTickAfterWorldCreated`, stopped on `UIDestroyed`.
- When a campaign finishes loading the bridge writes a ready marker:
  `{"request_id":0,"result":{"status":"ready","game":"rome2","campaign":"main_rome",...}}`.

## Install / 安装

1. Create the bridge folder (Win+R):
   `powershell.exe mkdir $env:USERPROFILE\rome2_web_editor_mod`
2. Build or download the pack: `npm run build:pack` → `release/rome2_web_editor.pack`
   (+ `rome2_web_editor.png`). Copy both into `<Rome II>\data\` and enable the mod in the launcher,
   or subscribe on the Workshop.
3. Load a campaign. Check that `%USERPROFILE%\rome2_web_editor_mod\response.json` now contains `"status":"ready"`.
4. Open https://thomastamht.github.io/rome2-campaign-editor/ in Chrome/Edge. Like the WH2 editor at
   https://imrz.github.io/tww2-campaign-editor/, the page opens whether or not the game is running.
   Click **Connect folder** and pick the folder from step 1. The browser remembers that folder, so
   the next time the page opens it reconnects by itself while the permission lasts.
   To publish a new version: `npm run build`, then push `dist/` to the `gh-pages` branch.

Without a connected folder the app shows only the empty campaign map; factions, armies and settlements
appear once the bridge folder is connected and the game has written its ready marker.

## Features / 功能

| Area | Requests used |
|---|---|
| Live map (armies, navies, agents, settlements) on the game's own terrain image, zoom/pan, click a marker for its panel, right-click to spawn | `get_snapshot` (or `get_active_characters` + `get_regions_detailed`), `create_force` |
| Diplomacy tab: searchable faction table (click a faction for its panel: set treasury) | `get_factions`, `treasury_mod` |
| Regions: owner transfer, public order, population surplus, rebellion (each via a dialog); building list with per-slot repair (⚒). Rome II scripts cannot construct or upgrade buildings, and dismantling crashed the game | `transfer_region_to_faction`, `set_public_order`, `add_development_points_to_region`, `force_rebellion_in_region`, `get_settlement_slots`, `repair_building` |
| Characters: general / agent experience, instant unit ranks for the whole force, replenish / zero AP. Forces inside a settlement are not shown | `award_experience_level`, `add_agent_experience`, `add_force_experience`, `replenish_action_points`, `zero_action_points` |
| Faction panel → diplomacy with a chosen counterpart: force war, peace, trade, vassal | `force_declare_war`, `force_make_peace`, `force_make_trade_agreement`, `force_make_vassal` |
| Settings: language (English / 简体中文 / 繁體中文, remembered) | — |
| Console: any request by hand, exchange log, list of available request types | everything above + `heartbeat`, `get_game_info`, `show_shroud`, `scroll_camera`, `end_turn`, `move_force`, `relocate_force` (console only) |

### Experience / 经验

Rome II has two engine calls, both instant:

| Target | Engine call | Notes |
|---|---|---|
| The character itself (general or agent) | `add_agent_experience(lookup, points)` | CA's prologue levels the general Silanus with it (`p3_roman_turn_one.lua`); `add_agent_experience` request |
| Soldiers (every unit of the general's army) | `award_experience_level(lookup, levels)` | ranks (chevrons) 1–9; `add_force_experience` request. An `award_experience_level` request on an agent is routed to `add_agent_experience` |

### Handler status / 命令状态

Every handler carries a status in `M.capabilities` (`mod/lua_scripts/rome2_web_editor.lua`). The UI only uses it to
enable controls the connected bridge actually supports; the status itself is not shown in the interface — which commands
are still unverified in game is documented in `TESTING.md`:

| Status | Meaning |
|---|---|
| `verified` | exact call found in CA's own Rome II Lua (`treasury_mod`, `transfer_region_to_faction`, `create_force`, `force_declare_war`, `apply_effect_bundle`, `make_region_visible_in_shroud`, `replenish_action_points`, `scroll_camera`, `add_agent_experience`, …) |
| `engine` | method name present in Rome II's `GAME` binding table (`empire.retail.dll`), argument order from Attila-era docs: `award_experience_level` / `add_force_experience`, `force_make_vassal`, `set_tax_rate`, … |
| `composed` | built from several calls: `relocate_force` (`create_force` + deferred `kill_character`; console only, refuses faction leaders and human factions) |
| `experimental` | `move_force` uses `game_interface:move_to` (CA's `lib_misc_campaign.lua` calls it); console only, AI armies ignore it during the player's turn |

### Map image / 底图

`public/maps/<campaign>_terrain.jpg` are the game's label-free terrain maps (`campaign_maps\<campaign>\clickgen_map.jpg`, language-neutral, ~2 px per tile) with the small `<campaign>.png` minimaps as fallback,
`public/flags/` the faction flag icons and `public/loc/` the faction / region / province / culture / unit / character
name strings, all pulled from the installed packs by `tools/extract-assets.mjs` and `tools/extract-loc.mjs`
(`--mods-dir` adds mod packs such as DEI and Chinese localisation patches).

Like the WH2 editor, the map is plotted in **logical tiles**: the minimap spans the whole logical grid.
For the Grand Campaign the grid is 1016×720 (the same 720-row convention as the WH2 editor's Mortal
Empires): it is the only grid for which all 173 live settlements fall inside their own region of
`main_rome_lookup.tga`. The same raster, exported as `public/maps/<campaign>_lookup.png`, tells the app which
region is under a right-clicked tile (sea tiles are refused for army creation). Other campaigns keep the same tile shape and are unverified; adjust `MAP_CONFIG` in `src/main.js` if one is off.
The default view is the smallest zoom that still covers the whole viewport (no bars), and panning stops at the image edges.

**Rome II has no campaign teleport API** (`teleport_to` does not exist; `teleport` / `teleport_to_location`
in the engine are battle-side), so map markers are deliberately **not draggable**: move armies in the game
and use "Replenish action points" from the character panel when they run dry. Coordinates for `create_force`
are *logical* tiles; the UI fits the display→logical transform at runtime from characters that report both (`lx/ly` vs `x/y`).

Unit names for the picker come from `public/loc/units.json` (`{ key: { game, en, zh } }`, written by
`tools/extract-loc.mjs`; `game: true` marks units present in CA's own packs, the default filter).

## Verification status / 验证状态

Done offline:

- 32 automated tests (`npm test`): the real Lua bridge runs under [fengari](https://fengari.io) against a
  mocked `game_interface`/`EpisodicScripting` (ready marker, polling, dedupe, every handler path),
  the browser transport, the coordinate fit and map projection and the demo bridge.
- `episodicscripting.lua` is extracted from your installed `data_rome2.pack` at build time and checked for
  the expected anchor before the hook is appended; the pack is re-parsed after writing.
- Evidence that the runtime pieces exist in Rome II: DEI / Diplomacy Reforged / DEI AI Overhaul all use
  `io.open` (and DEI's `EmpiresLog.txt` is written next to `campaigns\main_rome\scripting.lua`);
  `os.time`/`os.clock`/`os.execute` are used by CA and mod scripts; `add_time_trigger` is used with
  0.01–1.5 s intervals throughout DEI.

Verified in game so far: ready marker, `get_snapshot` / factions / regions / characters, `treasury_mod`, map alignment, `move_force` on player armies.

Still to confirm **in game** (see `TESTING.md`):

1. `add_agent_experience` on a general and on an agent, `add_force_experience` (instant unit chevrons via `award_experience_level`).
2. `os.getenv("USERPROFILE")` availability on other machines (otherwise the bridge falls back to a relative folder and reports it in `get_game_info.folder`).
3. The remaining `engine`-status signatures; adjust `M.capabilities` in `mod/lua_scripts/rome2_web_editor.lua` after testing.

## Development / 开发

```
npm install
npm test            # Lua bridge (fengari), protocol, map, demo
npm run dev         # http://127.0.0.1:5173
npm run build       # dist/ (deployable static site, e.g. GitHub Pages)
npm run build:pack  # release/rome2_web_editor.pack from your installed game files
node tools/read-pack.mjs <file.pack> [--filter regex] [--cat entry]
```

Fallback for a mod that also replaces `lua_scripts\episodicscripting.lua`:
`node tools/build-pack.mjs --scripting-overlay "<that mod>.pack"` writes
`release/!rome2_web_editor_overlay_<mod>.pack`, which hooks every `campaigns\*\scripting.lua` of that mod
instead. It must load before that mod. Not needed for DEI, DEI submods, Diplomacy Reforged or vanilla.

### Layout

```
mod/lua_scripts/rome2_web_editor.lua       bridge: transport, handlers, capabilities
mod/lua_scripts/rome2_web_editor_json.lua  rxi json.lua 0.1.2 (MIT)
tools/build-pack.mjs                       PFH4 pack writer (+ episodicscripting hook, overlay mode)
tools/read-pack.mjs, tools/pack-format.mjs pack inspection / format helpers
src/protocol.js                            FileBridge (File System Access API, request_id polling)
src/map.js                                 canvas map (click to select, right-click to create), coordinate fitting
src/main.js, src/strings.js, src/style.css UI (English / 简体中文 / 繁體中文)
src/loc.js, src/flags.js, src/regionLookup.js  game names, flag icons, region-under-tile raster
src/sample.js                              DemoBridge with synthetic data (tests only)
test/                                      node:test suites, test/lua/harness.lua mocks the engine
workshop/                                  Steam Workshop kit (title, BBCode description, tags, changelog, UPLOAD.md)
release/                                   built pack + preview image
```

## Credits

IMRZ (original WH2 editor and protocol) · rxi (json.lua, MIT) · Creative Assembly (ROME II).
