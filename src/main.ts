import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
} from "obsidian";
import { AnnotationFileManager } from "./annotationFile/AnnotationFileManager";
import { DEFAULT_SETTINGS, type AnnotationPluginSettings } from "./types";
import { SelectionMenu } from "./ui/SelectionMenu";
import { AnnotationMenu } from "./ui/AnnotationMenu";
import { AnnotationListPanel } from "./ui/AnnotationListPanel";
import { extractSelectionContext, calculateOffsetInBlock } from "./utils/contentMapper";

export default class AnnotationPlugin extends Plugin {
  settings: AnnotationPluginSettings;
  fileManager: AnnotationFileManager;

  // 原始文件路径 → 标注文件路径的映射
  activeAnnotationSessions: Map<string, string> = new Map();

  // DOM 元素 → 源文件行号的映射（由 MarkdownPostProcessor 填充）
  sectionLineMap: WeakMap<HTMLElement, { lineStart: number; lineEnd: number }> = new WeakMap();

  // UI 组件
  selectionMenu!: SelectionMenu;
  annotationMenu!: AnnotationMenu;
  annotationListPanel!: AnnotationListPanel;

  async onload() {
    await this.loadSettings();

    const pluginDir = this.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
    this.fileManager = new AnnotationFileManager(this.app, pluginDir);

    this.selectionMenu = new SelectionMenu(this.fileManager);
    this.annotationMenu = new AnnotationMenu(this.fileManager);
    this.annotationListPanel = new AnnotationListPanel(this.app, this.fileManager);

    this.registerEvents();
    this.registerCommands();
    this.registerCacheListeners();
    this.registerAnnotationInteraction();
    this.registerSectionLineCapture();

    this.addRibbonIcon("lucide-highlighter", "标注模式", () => {
      this.toggleAnnotationView();
    });
  }

  onunload() {
    // 清理所有假文件和元数据缓存
    for (const [, annotationPath] of this.activeAnnotationSessions) {
      this.removeFakeTFile(annotationPath);
      this.removeMetadataCache(annotationPath);
    }
    this.activeAnnotationSessions.clear();

    // 清理 UI 组件
    this.selectionMenu.hide();
    this.annotationMenu.hide();
    this.annotationListPanel.hide();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ========== 假文件管理 ==========

  // 构造假 TFile 并注入 vault 的 fileMap
  private createFakeTFile(path: string): TFile {
    const vault = this.app.vault;
    const anyFile = vault.getFiles()[0];
    if (!anyFile) throw new Error("Vault is empty");

    const TFileConstructor = Object.getPrototypeOf(anyFile).constructor;
    const fakeFile = new TFileConstructor(vault, path);

    // 不能标记为 deleted，否则视图拒绝打开
    (fakeFile as any).deleted = false;

    // 注入 vault 的文件字典，让 getAbstractFileByPath 能找到它
    (vault as any).fileMap[path] = fakeFile;

    return fakeFile;
  }

  // 从 vault.fileMap 中移除假文件
  private removeFakeTFile(path: string) {
    delete (this.app.vault as any).fileMap[path];
  }

  // ========== 元数据缓存 ==========

  // 为标注文件注入原笔记的元数据缓存
  private injectMetadataCache(annotationPath: string, originalPath: string, fakeTFile: TFile) {
    const cacheInternal = this.app.metadataCache as any;

    const originalCache = cacheInternal.metadataCache[originalPath];
    if (originalCache) {
      cacheInternal.metadataCache[annotationPath] = originalCache;
    }

    const originalFileCache = cacheInternal.fileCache[originalPath];
    if (originalFileCache) {
      cacheInternal.fileCache[annotationPath] = originalFileCache;
    }

    if (originalCache) {
      this.app.metadataCache.trigger("changed", fakeTFile, "", originalCache);
    }
  }

  private removeMetadataCache(annotationPath: string) {
    const cacheInternal = this.app.metadataCache as any;
    delete cacheInternal.metadataCache[annotationPath];
    delete cacheInternal.fileCache[annotationPath];
  }

  // 注册元数据缓存相关的全局事件监听
  private registerCacheListeners() {
    // 编辑时重新注入缓存
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const filePath = (info as any).file?.path;
        if (!filePath) return;
        const originalPath = this.getOriginalPathByAnnotationPath(filePath);
        if (originalPath) {
          this.injectMetadataCache(filePath, originalPath, (info as any).file);
        }
      })
    );

    // 标签页关闭时清理假文件和缓存
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        for (const [originalPath, annotationPath] of this.activeAnnotationSessions) {
          let isStillOpen = false;
          this.app.workspace.iterateAllLeaves((l) => {
            if ((l.view as any)?.file?.path === annotationPath) {
              isStillOpen = true;
            }
          });

          if (!isStillOpen) {
            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);
            this.activeAnnotationSessions.delete(originalPath);
            // 清理标注列表面板
            this.annotationListPanel.hide();
          }
        }
      })
    );
  }

  // ========== 视图切换 ==========

  private getSavedScroll(leaf: any): number {
    const view = leaf?.view;
    if (view?.currentMode?.getScroll) {
      const scroll = view.currentMode.getScroll();
      return typeof scroll === "number" ? scroll : 0;
    }
    return 0;
  }

  private restoreScroll(leaf: any, scroll: number) {
    if (!scroll) return;
    const view = leaf?.view;
    if (view?.setEphemeralState) {
      view.setEphemeralState({ scroll });
    }
  }

  private getOriginalPathByAnnotationPath(annotationPath: string): string | null {
    for (const [originalPath, aPath] of this.activeAnnotationSessions) {
      if (aPath === annotationPath) return originalPath;
    }
    return null;
  }

  // 获取当前标注视图对应的原始笔记路径
  getActiveAnnotationNotePath(): string | null {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return null;
    const currentFile = (leaf.view as any)?.file;
    if (!currentFile) return null;
    return this.getOriginalPathByAnnotationPath(currentFile.path);
  }

  async toggleAnnotationView() {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;

    const currentFile = (leaf.view as any)?.file;
    if (!currentFile) {
      new Notice("请先打开一个 Markdown 文件");
      return;
    }

    const originalPath = this.getOriginalPathByAnnotationPath(currentFile.path);
    if (originalPath) {
      await this.closeAnnotationView(leaf, originalPath);
    } else if (currentFile.extension === "md") {
      await this.openAnnotationView(leaf, currentFile.path);
    }
  }

  async openAnnotationView(leaf: any, notePath: string) {
    const savedScroll = this.getSavedScroll(leaf);

    const ok = await this.fileManager.ensureAnnotationFile(notePath);
    if (!ok) {
      new Notice("标注文件创建失败");
      return;
    }

    const annotationPath = normalizePath(this.fileManager.getAnnotationFilePath(notePath));
    console.log("[标注] annotationPath:", annotationPath);

    const fakeTFile = this.createFakeTFile(annotationPath);

    this.activeAnnotationSessions.set(notePath, annotationPath);

    try {
      this.injectMetadataCache(annotationPath, notePath, fakeTFile);

      await leaf.openFile(fakeTFile, { state: { mode: "preview" } });
      console.log("[标注] openFile 完成, 当前 view:", (leaf.view as any)?.constructor?.name);

      if (savedScroll) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
        });
      }

      // 显示标注列表面板
      this.setupAnnotationListPanel(notePath);
    } catch (e) {
      console.error("[标注] openFile 失败:", e);
      new Notice("打开标注文件失败: " + e);
    }
  }

  async closeAnnotationView(leaf: any, originalPath: string) {
    const savedScroll = this.getSavedScroll(leaf);
    const annotationPath = this.activeAnnotationSessions.get(originalPath);

    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    if (!(originalFile instanceof TFile)) {
      new Notice("原始文件不存在");
      if (annotationPath) {
        this.removeFakeTFile(annotationPath);
        this.removeMetadataCache(annotationPath);
      }
      this.activeAnnotationSessions.delete(originalPath);
      return;
    }

    await leaf.openFile(originalFile);

    if (annotationPath) {
      this.removeFakeTFile(annotationPath);
      this.removeMetadataCache(annotationPath);
    }
    this.activeAnnotationSessions.delete(originalPath);

    // 清理 UI
    this.selectionMenu.hide();
    this.annotationMenu.hide();
    this.annotationListPanel.hide();

    if (savedScroll) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
      });
    }
  }

  // ========== 标注交互事件 ==========

  // 注册标注视图中的鼠标事件（选区检测、标注点击）
  private registerAnnotationInteraction() {
    // 全局 mouseup 事件：检测文本选区并弹出添加菜单
    this.registerDomEvent(document, "mouseup", (e: MouseEvent) => {
      const notePath = this.getActiveAnnotationNotePath();
      if (!notePath) return;

      // 忽略来自标注菜单内部的 mouseup（避免点击菜单按钮时重复弹出）
      const target = e.target as HTMLElement;
      if (target.closest(".annotation-card-menu")) return;

      // 延迟一帧确保 Selection 已更新
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const context = extractSelectionContext(selection);
        if (!context || !context.text) return;

        // 从选区元素查找行号信息
        const range = selection.getRangeAt(0);
        const node = range.startContainer;
        const el = node instanceof HTMLElement ? node : node.parentElement;
        const lineInfo = el ? this.findSectionLineInfo(el) : undefined;

        // 计算选中文本在 section 内是第几次出现
        const sectionEl = lineInfo?.sectionEl;
        const offset = sectionEl
          ? calculateOffsetInBlock(range, sectionEl)
          : 0;
        const sectionText = sectionEl?.textContent || "";
        const occurrence = countOccurrenceIndex(sectionText, context.text, offset);

        this.annotationMenu.hide();

        this.selectionMenu.show({
          x: e.clientX,
          y: e.clientY,
          selectedText: context.text,
          contextBefore: context.contextBefore,
          contextAfter: context.contextAfter,
          notePath,
          startLine: lineInfo?.lineStart,
          endLine: lineInfo?.lineEnd,
          occurrence,
          onAdd: () => this.refreshAnnotationView(notePath),
        });
      }, 10);
    });

    // 全局 click 事件：检测点击已有标注并弹出详情菜单
    this.registerDomEvent(document, "click", (e: MouseEvent) => {
      const notePath = this.getActiveAnnotationNotePath();
      if (!notePath) return;

      const target = e.target as HTMLElement;
      // 检查是否点击了 <mark> 标签
      const markEl = target.closest("mark[data-annotation-id]") as HTMLElement;
      if (!markEl) return;

      const annotationId = markEl.getAttribute("data-annotation-id");
      if (!annotationId) return;

      e.preventDefault();
      e.stopPropagation();

      // 从标注文件中解析该标注的数据
      this.fileManager.getAnnotations(notePath).then((annotations) => {
        const annotation = annotations.find((a) => a.id === annotationId);
        if (!annotation) return;

        this.selectionMenu.hide();

        this.annotationMenu.show({
          x: e.clientX,
          y: e.clientY,
          annotation,
          notePath,
          onUpdate: () => this.refreshAnnotationView(notePath),
        });
      });
    });
  }

  // 设置标注列表面板
  private setupAnnotationListPanel(notePath: string) {
    this.annotationListPanel.show({
      notePath,
      onUpdate: () => this.refreshAnnotationView(notePath),
    });
  }

  // 刷新标注视图（标注增删改后调用）
  // 通过 ReadViewRenderer.set() 直接更新渲染器文本并触发重渲染
  private async refreshAnnotationView(notePath: string) {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;

    const view = leaf.view as MarkdownView;
    if (!view.previewMode) return;

    // 从磁盘读取最新内容（FileManager 已通过 adapter.write 写入）
    const content = await this.fileManager.readAnnotationFile(notePath);

    // 通过 ReadViewRenderer.set() 更新文本并触发重新渲染
    const renderer = (view.previewMode as any).renderer;
    if (renderer && typeof renderer.set === "function") {
      renderer.set(content);
    }

    // 刷新标注列表面板
    this.annotationListPanel.refresh();
  }

  // ========== Section 行号捕获 ==========

  // 注册 MarkdownPostProcessor，捕获每个 section 的行号信息
  private registerSectionLineCapture() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      const sectionInfo = ctx.getSectionInfo(el);
      if (sectionInfo) {
        this.sectionLineMap.set(el, {
          lineStart: sectionInfo.lineStart,
          lineEnd: sectionInfo.lineEnd,
        });
      }
    });
  }

  // 从 DOM 元素向上查找最近的 sectionLineMap 条目（同时返回 section 元素）
  private findSectionLineInfo(el: HTMLElement): { lineStart: number; lineEnd: number; sectionEl: HTMLElement } | null {
    let current: HTMLElement | null = el;
    while (current) {
      const info = this.sectionLineMap.get(current);
      if (info) return { ...info, sectionEl: current };
      current = current.parentElement;
    }
    return null;
  }

  // ========== 事件和命令 ==========

  registerEvents() {
    // 文件重命名时迁移标注文件
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          try {
            await this.fileManager.migrateAnnotationFile(oldPath, file.path);
          } catch (e) {
            console.error("迁移标注文件失败:", e);
          }
        }
      })
    );

    // 文件删除时清理标注文件
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          try {
            await this.fileManager.deleteAnnotationFile(file.path);
          } catch (e) {
            console.error("删除标注文件失败:", e);
          }
        }
      })
    );
  }

  registerCommands() {
    this.addCommand({
      id: "toggle-annotation-view",
      name: "切换标注视图",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        const file = (leaf.view as any)?.file;
        if (!file || file.extension !== "md") return false;

        if (!checking) {
          this.toggleAnnotationView();
        }
        return true;
      },
    });
  }
}

// 计算选中文本在 section 文本中是第几次出现（0-indexed）
// 找到所有出现位置，返回离 offset 最近的那个的索引
function countOccurrenceIndex(text: string, searchText: string, offset: number): number {
  const positions: number[] = [];
  let pos = 0;
  while (true) {
    const idx = text.indexOf(searchText, pos);
    if (idx < 0) break;
    positions.push(idx);
    pos = idx + 1;
  }
  if (positions.length === 0) return 0;

  // 找离 offset 最近的出现位置
  let bestIdx = 0;
  let bestDist = Math.abs(positions[0]! - offset);
  for (let i = 1; i < positions.length; i++) {
    const dist = Math.abs(positions[i]! - offset);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
