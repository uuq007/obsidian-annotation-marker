# Obsidian Annotation Marker

在不改动原始 Markdown 文件的前提下，为 Markdown 文件添加标注、高亮和批注。

## 功能特点

- 不修改原文件 - 所有标注数据独立存储，不影响原始 Markdown 文件
- 多种标注颜色 - 支持红色、蓝色、黄色、绿色、紫色、无色
- 添加批注 - 为标注添加详细的批注说明
- 注音功能 - 为文字添加注音
- 自动同步 - 文件重命名、移动时自动迁移标注数据
- 自动清理 - 文件删除时自动清除相关标注数据
- 智能定位 - 采用渐进式搜索策略，文档内容变化时也能准确定位标注
- 支持分屏-各分屏可以独立打开标注模式，互不干扰

## 安装

### 手动安装

1. 下载最新版本的发布包
2. 将 `main.js`、`manifest.json` 和 `styles.css` 复制到 Obsidian 的插件目录：
   ```
   <Your Vault>/.obsidian/plugins/obsidian-annotation-marker/
   ```
3. 在 Obsidian 的 **设置 → 社区插件** 中启用插件

### 从源码构建

```bash
npm install
npm run build
```

## 使用方法

### 开启标注模式

- 点击左侧边栏的 🖌️ 图标
- 或使用命令面板（`Ctrl/Cmd + P`）执行"切换标注模式"命令

### 添加标注

1. 在标注模式下选中要标注的文本
2. 选择标注颜色
3. （可选）添加批注内容
4. （可选）为文字添加注音
5. 点击"保存"

### 查看批注

- 点击标注文本，会弹出批注菜单显示批注内容

### 管理标注

- 左侧标注列表中可查看所有标注
- 点击标注项可以编辑或删除

### 关闭标注模式

- 再次点击左侧边栏的 🖌️ 图标
- 或使用"切换标注模式"命令

## 标注颜色

| 颜色 | 用途建议 |
|------|---------|
| 红色 | 重要内容、需要关注的点 |
| 蓝色 | 一般性标注、补充说明 |
| 黄色 | 默认颜色、一般标注 |
| 绿色 | 已解决问题、已完成事项 |
| 紫色 | 特殊标注、个人笔记 |
| 无色 | 仅添加批注，不改变文本外观 |

## 数据存储

- 标注数据以 JSON 格式存储在插件目录中
- 每个 Markdown 文件对应一个独立的标注数据文件
- 数据位置：`<Vault>/.obsidian/plugins/obsidian-annotation-marker/annotations/<文件路径>.json`

## 技术架构

### 智能定位机制

- 排除非正文元素：文件名、笔记属性、标题栏等
- 渐进式搜索：从局部到全局，性能更优
- 双重匹配策略：精确匹配 + 模糊匹配
- 相似度算法：使用 Levenshtein 距离计算上下文相似度

### 项目结构

```
obsidian-annotation-marker/
├── src/
│   ├── main.ts              # 插件入口
│   ├── annotationMode.ts     # 标注模式管理
│   ├── annotationRenderer.ts # 标注渲染器
│   ├── annotationMenu.ts     # 标注菜单
│   ├── annotationListPanel.ts # 标注列表
│   ├── selectionMenu.ts      # 选中文本菜单
│   ├── dataManager.ts        # 数据管理
│   ├── types.ts              # 类型定义
│   └── utils/
│       └── helpers.ts         # 辅助函数
├── manifest.json            # 插件清单
├── package.json             # 项目配置
├── tsconfig.json            # TypeScript 配置
├── esbuild.config.mjs       # 构建配置
├── styles.css               # 样式文件
└── README.md                # 项目文档
```

### 开发环境

- Node.js: 18+
- TypeScript: 5.8+
- esbuild: 0.25.5

### 构建命令

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build
```

## 使用限制

- 标注模式仅在预览模式下可用
- 切换到编辑模式会自动退出标注模式
- 不支持跨段落添加标注
- 不支持跨列表项添加标注
- 不支持跨表格单元格添加标注
- 标注数据存储在本地，不会随文件同步到其他设备

## 问题反馈

如果遇到问题或有建议，请在 [GitHub Issues](https://github.com/uuq007/obsidian-annotation-marker/issues) 中提交。

## 许可证

MIT License
