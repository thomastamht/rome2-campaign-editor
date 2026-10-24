# Steam Workshop 上传 / Upload checklist

## 需要上传的文件 / Files

| 文件 | 来源 | 说明 |
|---|---|---|
| `release/rome2_web_editor.pack` | `npm run build:pack` | PFH4 mod pack，3 个文件（episodicscripting.lua 挂钩 + 桥接 Lua + json.lua） |
| `release/rome2_web_editor.png` | `workshop/base/rome2_web_editor.png` | 预览图，必须与 pack 同名、PNG、小于 1 MB（当前 512×512，约 323 KB） |
| `workshop/base/title.txt` | — | 条目标题 |
| `workshop/base/description.bbcode.txt` | — | 条目描述（Steam BBCode，中英双语）。网页端 https://thomastamht.github.io/rome2-campaign-editor/，源码 https://github.com/thomastamht/rome2-campaign-editor |
| `workshop/base/tags.txt` | — | 建议标签 |
| `workshop/base/changelog.txt` | — | 首次上传与后续更新的更新日志 |

只有**一个** Workshop 条目：挂钩点 `lua_scripts/episodicscripting.lua` 被原版和 DEI 的所有战役脚本共同加载，不需要单独的 DEI 补丁。`tools/build-pack.mjs --scripting-overlay <pack>` 生成的 overlay pack 仅在某个 Mod 也替换了 `episodicscripting.lua` 时才需要，默认不上传。

## 上传步骤（Rome II 启动器）/ Steps

1. 把 `release/rome2_web_editor.pack` 和 `release/rome2_web_editor.png` 复制到
   `D:\Steam\steamapps\common\Total War Rome II\data\`。
2. 打开 Rome II 启动器 → **Mod Manager**。新 pack 会出现在列表中（类型 mod）。
3. 选中 `rome2_web_editor.pack`，点击 **Upload**（首次为 Publish）。启动器会读取同名 PNG 作为预览图。
4. 在弹出的 Steam 页面中填入 `title.txt` 的标题，粘贴 `description.bbcode.txt`，勾选 `tags.txt` 中存在的标签，可见性先选 **Friends only / Unlisted** 做一次自测，再改为 Public。
5. 上传完成后记录 Workshop ID（URL 中的 `?id=`），回填到：
   - `README.md` 的“订阅”链接
   - `description.bbcode.txt` 顶部（可选，方便引用）
6. 更新网页端：`npm run build` 后把 `dist/` 推到 `gh-pages` 分支，地址 https://thomastamht.github.io/rome2-campaign-editor/ 不变；描述改动用 Steam 页面的 **Edit title & description** 更新。

## 更新 / Updating

1. 修改 Lua 或前端后：`npm test && npm run build:all`。
2. 重新复制 `release/*.pack` 到 `data\`，启动器中选中 pack → **Upload**（覆盖已有条目）。
3. 把 `changelog.txt` 的新条目贴到 Steam 的 Change Notes。

## 上传前自检 / Pre-flight

- [ ] `npm test` 全部通过
- [ ] `node tools/read-pack.mjs release/rome2_web_editor.pack` 显示 `OK`、3 个条目
- [ ] 游戏内：载入战役后 `%USERPROFILE%\rome2_web_editor_mod\response.json` 出现 `"status":"ready"`
- [ ] 网页端连接后 `get_factions` / `get_regions` / `treasury_mod` 正常
- [x] 描述中的网页与源码链接已填好
