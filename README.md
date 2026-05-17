# Obsidian Annotation Marker / Obsidian 标注插件

为 Obsidian 笔记添加文本标注、高亮、批注和注音功能。
Add text annotations, highlights, notes, and ruby characters to Obsidian notes.

标注数据存储在独立的标注文件中，不修改原始 Markdown 文件。支持阅读模式和实时预览编辑模式（支持在标注模式中修改笔记）。
Annotation data is stored in separate annotation files without modifying the original Markdown files. Supports both reading mode and live preview editing mode (including editing notes in annotation mode).

## Features / 功能特性

### Annotation Types / 标注类型

- **彩色标注** — 5 种颜色高亮（红、蓝、黄、绿、紫），可自定义颜色

  **Color highlights** — 5 highlight colors (red, blue, yellow, green, purple), fully customizable

- **批注** — 为标注添加详细笔记，悬浮即可查看

  **Notes** — add detailed notes to annotations, viewable on hover

- **注音** — 为选中文本添加注音（ruby 标签），支持多个注音

  **Ruby** — add ruby characters to selected text, supports multiple ruby annotations

- **全文标注** — 一键标注文件中所有相同文本

  **Full-text annotation** — annotate all occurrences of the selected text in one click

- **跨段标注** — 支持跨越段落和文本块的标注

  **Cross-block annotation** — annotate text spanning multiple paragraphs or blocks

- **嵌套/重叠标注** — 自动处理标注重叠区域的渲染

  **Nested/overlapping annotations** — automatic rendering of overlapping annotation regions

### Interactions / 交互操作

- 选中文字后直接选择颜色添加标注

  Select text and pick a color to instantly add an annotation

- 点击标注弹出操作菜单（编辑颜色、批注、注音、删除）

  Click an annotation to open the action menu (edit color, note, ruby, delete)

- 鼠标悬浮显示批注内容气泡

  Hover over annotations to see note content in a popup

- 标注列表面板 — 浮动显示当前文件所有标注，点击可跳转

  Annotation list panel — floating panel showing all annotations in the current file, click to navigate

- 侧边栏标注管理视图 — 按文件浏览全部标注，支持搜索和颜色筛选

  Sidebar annotation management view — browse all annotations by file, with search and color filtering

### Dual Mode Support / 双模式支持

- **阅读模式** — 标注以彩色 `<mark>` 标签渲染

  **Reading mode** — annotations rendered as colored `<mark>` tags

- **实时预览编辑模式** — 通过 CodeMirror 6 扩展显示标注高亮和注音

  **Live preview editing mode** — annotation highlights and ruby displayed via CodeMirror 6 extensions

### File Management / 文件管理

- 标注数据独立存储，原始文件零侵入

  Annotation data stored independently, zero intrusion on original files

- 原文件修改后自动同步到标注文件（基于 diff 算法）

  Auto-sync to annotation files when original files are modified (diff-based algorithm)

- 原文件重命名/删除时自动迁移/清理标注数据

  Auto-migrate/clean annotation data when original files are renamed or deleted

- 支持从旧版插件导入标注数据

  Support importing annotation data from older plugin versions

### Configurable Options / 可配置项

- 默认标注颜色

  Default annotation color

- 5 种标注颜色的自定义（支持十六进制色值）

  Customize 5 annotation colors (hex color values supported)

- 颜色标签名称

  Color label names

- 批注最大长度

  Max note length

- 批注视觉效果（无/粗线/虚线/波浪线/双线）

  Note visual effect (none/thick/dashed/wavy/double underline)

- 注音字体大小和颜色

  Ruby font size and color

## Installation / 安装

### Manual Installation / 手动安装

1. 从 [Releases](https://github.com/uuq007/obsidian-annotation-marker/releases) 下载最新版本

   Download the latest version from [Releases](https://github.com/uuq007/obsidian-annotation-marker/releases)

2. 将 `main.js`、`manifest.json`、`styles.css` 复制到 vault 的 `.obsidian/plugins/obsidian-annotation-marker/` 目录

   Copy `main.js`, `manifest.json`, `styles.css` to your vault's `.obsidian/plugins/obsidian-annotation-marker/` directory

3. 在 Obsidian 设置中启用插件

   Enable the plugin in Obsidian settings

### Build from Source / 从源码构建

```bash
git clone https://github.com/uuq007/obsidian-annotation-marker.git
cd obsidian-annotation-marker
npm install
npm run build
```

## Usage / 使用方法

1. 点击左侧边栏的标注图标进入标注视图

   Click the annotation icon in the left sidebar to enter annotation view

2. 选中文字后弹出颜色选择菜单

   Select text to bring up the color picker menu

3. 点击已有标注可编辑或删除

   Click an existing annotation to edit or delete it

4. 通过命令面板可执行：

   Available commands via the command palette:
   - `切换标注视图` — 在普通视图和标注视图间切换

     `Toggle annotation view` — switch between normal and annotation views

   - `标注管理侧边栏` — 打开标注管理面板

     `Annotation management sidebar` — open the annotation management panel

   - `导入旧标注插件数据` — 从旧版插件迁移数据

     `Import legacy annotation data` — migrate data from older plugin versions

## Differences from Legacy Versions / 与旧版的区别

v3.0.0 后续版本是完全重写的版本，主要变化：
v3.0.0 and later are complete rewrites. Key changes:

- 标注数据不再使用 JSON 文件存储，改为嵌入到插件目录下独立的 Markdown 标注文件中，不影响 Obsidian 仓库

  Annotation data is no longer stored as JSON files; instead embedded in separate Markdown annotation files under the plugin directory, leaving the Obsidian vault untouched

- 支持编辑模式（CodeMirror 6）

  Support for editing mode (CodeMirror 6)

- 新增侧边栏标注管理视图

  New sidebar annotation management view

- 新增全文标注、跨段标注、注音功能

  New full-text annotation, cross-block annotation, and ruby features

- 更好的标注重叠处理

  Better handling of overlapping annotations

- 提供旧版数据导入命令，可从旧版平滑迁移

  Legacy data import command for smooth migration from older versions

## Roadmap / 后续功能

- 导出标注到仓库笔记中

  Export annotations into vault notes

- ……

## License / 许可证

MIT
