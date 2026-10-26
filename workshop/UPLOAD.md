# Steam Workshop 上传 / Upload checklist

启动器一次只能上传一个 pack。原版编辑器和 DEI 补丁是两个创意工坊条目。预览图必须与 pack 同名、PNG、小于 1 MB。

The launcher uploads one pack per Workshop item. The vanilla editor and the DEI patch are two items. The preview PNG must share the pack's file name and be under 1 MB.

## 条目 1 — 原版编辑器 / Item 1 — vanilla editor

| 放进 `data\` 的文件 | 来源 |
|---|---|
| `rome2_web_editor.pack` | `release/rome2_web_editor.pack` |
| `rome2_web_editor.png` | `release/rome2_web_editor.png`（512×512，约 323 KB） |

粘贴：

| 栏 | 文件 |
|---|---|
| 标题 | `workshop/base/title.txt` |
| 描述 | `workshop/base/description.bbcode.txt` |
| 标签 | `workshop/base/tags.txt`（Campaign、UI、Gameplay、Cheat、Compilation） |
| 更新日志 | `workshop/base/changelog.txt` |

## 条目 2 — DEI 补丁 / Item 2 — DEI patch

| 放进 `data\` 的文件 | 来源 |
|---|---|
| `!rome2_web_editor_dei_patch.pack` | `release/!rome2_web_editor_dei_patch.pack` |
| `!rome2_web_editor_dei_patch.png` | `release/!rome2_web_editor_dei_patch.png` |

粘贴：

| 栏 | 文件 |
|---|---|
| 标题 | `workshop/dei/title.txt` |
| 描述 | `workshop/dei/description.bbcode.txt` |
| 标签 | `workshop/dei/tags.txt`（Campaign、Gameplay） |
| 更新日志 | `workshop/dei/changelog.txt` |

玩家侧：只玩原版就只订条目 1。玩 DEI 时两个都订，并把 `!rome2_web_editor_dei_patch` 放在 `DEI综合调整` 上面。

## 上传步骤 / Steps

对每个 pack 各做一次：

1. 把该条目的 pack 和同名 png 复制到 `D:\Steam\steamapps\common\Total War Rome II\data\`。
2. 打开罗马2启动器 → Mod Manager。选中这个 pack，点 **Upload**（第一次是 Publish）。启动器会用同名 PNG 当预览图。
3. 填标题，粘贴描述，勾选标签。可见性先选 **Friends only / Unlisted**，自己订阅测过再改成 Public。
4. 更新日志贴到 Change Notes。
5. 记下网址里的 `?id=`。原版条目的描述里目前用标题指代 DEI 补丁；两个都公开后，可以把标题换成工坊链接。

## 更新 / Updating

改的是 Lua 时，两个 pack 都要重新构建再各上传一次。只改网页时，推 `gh-pages` 即可，工坊 pack 不用动。描述用 Steam 页面的 **Edit title & description** 改。
