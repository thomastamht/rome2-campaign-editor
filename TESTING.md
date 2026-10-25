# 游戏内测试指南 / In-game test guide

目标：确认桥接在原版和 DEI 两条脚本路径上都能启动，并逐条确认命令在 Rome II 上的真实行为，然后回填
`mod/lua_scripts/rome2_web_editor.lua` 里的 `M.capabilities`。

两条路径的区别：原版 Grand Campaign 的 `scripting.lua` 只用 `EpisodicScripting`（没有 `cm`）；DEI 和
Imperator Augustus 用 `campaign_manager`。桥接不依赖 `cm`，但两边都要跑一遍才算验证。

## 0. 准备（一次性）

```powershell
# 1) 桥接文件夹（WH2 的做法一样）
mkdir $env:USERPROFILE\rome2_web_editor_mod

# 2) 备份当前模组列表和存档，测完方便恢复
Copy-Item "D:\Steam\steamapps\common\Total War Rome II\used_mods.txt" "$env:USERPROFILE\Desktop\used_mods.backup.txt"
Copy-Item "$env:APPDATA\The Creative Assembly\Rome2\save_games" "$env:USERPROFILE\Desktop\rome2_saves_backup" -Recurse

# 3) 安装 pack（与预览图同名放一起）
Copy-Item release\rome2_web_editor.pack, release\rome2_web_editor.png "D:\Steam\steamapps\common\Total War Rome II\data\"

# 4) 诊断用：万一 os.getenv 不可用，桥接会退回到这个相对目录
mkdir "D:\Steam\steamapps\common\Total War Rome II\data\campaigns\main_rome\rome2_web_editor_mod"
```

网页端：项目目录里 `npm run dev`，用 **Chrome 或 Edge** 打开 http://127.0.0.1:5173（Cursor 内置浏览器不行，
它没有 `showDirectoryPicker`）。

测试用一局**新开的**战役或存档副本，别在主存档上做。编辑结果只有在你手动存档时才会写进存档。

## 1. 第一轮：原版（所有其他 Mod 关掉）

1. 启动器 → Mod Manager：取消勾选全部 Workshop 模组，只勾 `rome2_web_editor.pack`。
2. 新开 Grand Campaign（任意势力，任意难度），等地图可以操作。
3. 检查 ready 标记：
   ```powershell
   Get-Content $env:USERPROFILE\rome2_web_editor_mod\response.json
   ```
   期望：`{"request_id":0,"result":{"status":"ready","game":"rome2","campaign":"main_rome","turn":1,"folder_kind":"userprofile",...}}`
   - 没有文件 → 看第 5 节排查。
   - `folder_kind` 是 `relative` → `os.getenv` 不可用，文件会在 `data\campaigns\main_rome\rome2_web_editor_mod\`，网页端就选那个文件夹。
4. 网页端 → **连接文件夹** → 选 `C:\Users\35705\rome2_web_editor_mod` → 允许读写。顶部应变为「已连接」，战役栏显示 main_rome / 回合 / 玩家势力。

## 2. 命令清单（原版先过一遍，DEI 再过一遍）

按顺序做，每一步在游戏里对照。记录「通过 / 失败 + 控制台里的错误文字」。

### A. 读取（出错说明接口名不对）

| 操作 | 在哪里 | 游戏里对照 |
|---|---|---|
| 控制台 → `heartbeat` 发送 | 控制台 | 回复 `ok:true`，turn 正确 |
| 势力表 | 外交 | 数量 ≈ 游戏外交界面势力数；玩家金库数值与右上角一致 |
| 地图上的城市标记 | 地图 | 原版 GC 173 座城都有标记，落在正确的地理位置；点一座城，面板 Logical position 有数 |
| 地图上的军队 / 特工 / 舰队 | 地图 | 将军、舰队和特工都在，走进城市的军队也在（城市自带驻军不单独画）；默认视图铺满窗口，拖到边缘不会露出底色；工具栏「城市 / 军队 / 舰队 / 特工」四个开关各自只隐藏对应标记 |
| 未连接时 | 地图 | 只有底图，没有任何标记，顶部没有回合信息；连接文件夹后数据才出现 |
| 控制台 → `get_force_units {"cqi": <你的某个将军 cqi>}` | 控制台 | 单位 key 列表；**记下第 0 个是否为将军卫队**（决定「跳过第一个单位」默认值） |

### B. 低风险写入

| 操作 | 期望 | 失败时的含义 |
|---|---|---|
| 外交 → 点玩家势力 → 增减 +1000 | 右上角金库立刻 +1000（最多等一帧） | `treasury_mod` 签名不对（不太可能，CA 脚本原样） |
| 点地图上一座叛军/小势力城市 → 「转移地区」→ 弹窗选玩家势力 → 确认 | 地图上该城变色，进入你的省份 | `transfer_region_to_faction` 问题 |
| 城市面板 → 「治安」→ 弹窗填 5 → 确认 | 该省治安面板变化 | `set_public_order_of_province_for_region` 参数不对 |
| 外交 → 点势力 → 揭示整张地图 | 迷雾消失 | shroud 接口问题 |
| 控制台 → `show_shroud {"visible": false}` / `{"visible": true}` | 全图迷雾开关 | `show_shroud` |

### C. 角色面板（点地图上的将领，右侧最多 4 个操作）

| 操作 | 期望 |
|---|---|
| 清空行动力 → 补满行动力（对自己将军） | 移动范围先消失再恢复（已验证） |
| 将军经验（填 100） | 将军经验条 / 等级立即变化；失败 → `add_agent_experience` |
| 士兵经验（填 1） | 全军每个单位立即 +1 个 V 字章；失败 → `award_experience_level` 参数顺序 |
| 右键地图空地 → 创建军队（弹窗里从单位列表点选，或直接填 `Rom_Hastati,Rom_Hastati,Rom_Principes`） | 目标地区附近出现新军队。失败且提示坐标 → 看逻辑坐标是否离谱（应与同地区角色的 logical 接近） |

单位列表默认「仅本体兵种」（1 500 多个原版 / DLC 单位，含中文名）；取消勾选可看到已装 Mod（如 DEI）的全部单位。

经验的原理：将军 / 特工自身经验用 `add_agent_experience(角色, 点数)`（CA 序章就用它给将军 Silanus 升级）；
士兵经验用 `award_experience_level(将军, 级数)`，立即给这位将军军队里的每个单位升军衔（最高 9 级）——这也是最早那版「增加经验」用的调用。

### D. 地图不支持拖拽

Rome II 脚本接口没有战锤 II 的 `teleport_to`，所以地图上的标记**不能拖动**：按住只会平移地图。要挪军队就在游戏里走，
走到一半行动力没了，就点将领 → 「补满行动力」再走。
`move_force` / `relocate_force` 仍留在桥接里，只能从「控制台 → 原始命令」手动发；`relocate_force`
会杀原将军重建，派系领袖与玩家军队被拒绝，**不建议在存档上用**。

### D2. 设定

右上角语言按钮显示当前语言，每点一次按 English → 简体中文 → 繁體中文 循环切换（记住上次选择）。切换语言后势力 / 地区 / 单位
名随之切换（繁体界面用的是游戏的简中文本）。

### E. 外交

入口：顶部 **外交** 标签 → 势力表 → 点一个 AI 势力（例如迦太基）→ 右侧侧栏底部的「外交」区。
侧栏里的「势力 B」下拉默认是玩家势力（选中的是玩家势力时则是第一个其他势力），所有操作都作用于「选中势力 (A) ↔ B」。

| 操作 | 期望 |
|---|---|
| 强制宣战 | 游戏外交界面显示 A 与 B 交战 |
| 强制和平 | 恢复和平 |
| 强制贸易协定 | 外交界面出现贸易协定 |
| 强制附庸（B 成为选中势力的附庸） | 未在游戏里验证过的调用：成了说明参数顺序对；没成就把 B 选成原来的 A、再选 A 为 B 反过来试一次（或在控制台对调 a、b） |
| 选项下拉（如 `non aggression pact`）→ 勾 / 取消「A 可提出」「B 可接受」→ 应用 | 只是允许 / 禁止该选项，不会签约 |

Rome II 脚本接口只能强制宣战、和平、贸易协定和附庸；互不侵犯、军事通行、防御 / 军事同盟没有强制调用，侧栏下方的灰字提示就是说这个。
战争迷雾开关和结束回合没有按钮，需要时在控制台手动发 `show_shroud` / `end_turn`。

### F. 生命周期

| 操作 | 期望 |
|---|---|
| 游戏里手动存档 → 回主菜单 → 读档 | `response.json` 被重新写入 ready 标记（看 turn） |
| 打一场战斗（自动解决也行）→ 回到战役 | 网页端刷新仍然有回复（UIDestroyed/UICreated 重启轮询） |
| 网页端 → 结束回合 | 回合推进 |
| 网页端开着、玩两回合，期间点几次「刷新」 | 游戏不卡顿、不弹脚本错误 |

## 3. 第二轮：DEI

1. 启动器恢复你平时的 DEI 模组组合（参考桌面上的 `used_mods.backup.txt`），**保持** `rome2_web_editor.pack` 勾选。`DEI综合调整.pack` 自带一份 `episodicscripting.lua`，会盖掉本 Mod 的挂钩，所以还要勾选 `!rome2_web_editor_dei_patch.pack`（`npm run build:dei-patch` 生成），并把它排在 `DEI综合调整.pack` **上面**。不勾这个补丁，桥接日志里不会出现 `[hook:episodic] attached`。
2. 新开或读一局 DEI 战役，重复第 1 节第 3–4 步和第 2 节全部。
3. 额外确认 DEI 自己的东西没坏：人口界面、补给、改革弹窗、第一回合事件都正常。它们和桥接共用 `episodicscripting.lua`，理论上互不影响，但要看一眼。
4. 创建军队时用 DEI 的单位 key：先对任意 DEI 军队跑 `get_force_units`，复制里面的 key。

## 4. 测完要给我的东西

1. 两轮各自的 ready 标记原文（`response.json` 第一行）。
2. 第 2 节每一项的通过 / 失败；失败的把网页端「控制台 → 通信日志」里对应条目展开，复制 `error` 文字。
3. `get_force_units` 第 0 个单位是不是将军卫队。
4. 地图上城市和军队的位置是否与游戏一致。
5. 任何游戏内弹出的脚本错误截图。

我据此改 `M.capabilities` 和默认值，然后重新 `npm run build:pack` 上传。

## 5. ready 标记没出现时

桥接会写一个诊断日志 `bridge.log`，先看它：

- `%USERPROFILE%\rome2_web_editor_mod\bridge.log`，以及游戏根目录 `D:\Steam\steamapps\common\Total War Rome II\rome2_web_editor_bridge.log`
- 正常内容依次是：`[hook:episodic] attached` → `module loaded; USERPROFILE=...` → `attached v0.1.0 (Lua 5.1)` → `event NewSession` → `event UICreated Campaign UI` → `event FirstTickAfterWorldCreated` → `start(...) folder=... writable=true` → `ready marker written` → `polling started`
- 日志在哪一行停住，问题就在哪一步。连 `[hook:episodic]` 都没有 → 游戏没有加载 pack 里的 `episodicscripting.lua`。

其他检查：

1. `used_mods.txt` 里有没有 `mod "rome2_web_editor.pack";`？没有 → 启动器没勾上。
2. `%APPDATA%\The Creative Assembly\Rome2\logs\mods.log.txt` 里 `rome2_web_editor.pack` 是否 `accepting it`？
3. 用户目录写不进时，桥接会退回到游戏根目录：`response.json` 直接出现在 `Total War Rome II\` 下，网页端就选那个文件夹。
4. 确认是在**战役地图**可操作之后看的；主菜单和加载画面不会写。
5. 都没有 → 把 `bridge.log`、`mods.log.txt` 和你用的战役名发给我。

## 7. 地图对齐

地图按**逻辑坐标**绘制（与战锤 II 编辑器相同做法）：底图覆盖整张逻辑网格。Grand Campaign 的网格是 **1016×720**（和战锤 II
Mortal Empires 一样的 720 行约定）：用真实战役的 173 座城市套 `main_rome_lookup.tga`，只有这个尺寸能让每座城都落在自己的地区里。
之前用的 832 是错的，所以整体偏南。网页只支持 Grand Campaign（`main_rome`），DLC 战役不提供地图。

## 6. 测完恢复

- 不想留着：启动器取消勾选即可；彻底删除就从 `data\` 删掉 pack 和 png。
- 存档备份在桌面 `rome2_saves_backup`。
