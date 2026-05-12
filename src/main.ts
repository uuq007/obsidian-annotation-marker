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
import { extractSelectionContext, calculateOffsetInBlock, extractCrossBlockSegments } from "./utils/contentMapper";
import { countOccurrenceIndex } from "./utils/helpers";
import type { BlockSegment } from "./types";

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

      // 忽略来自标注菜单、模态框、输入框内部的 mouseup
      const target = e.target as HTMLElement;
      if (target.closest(".annotation-card-menu, .modal-container")) return;
      if (target.closest("input, textarea")) return;

      // 延迟一帧确保 Selection 已更新
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const context = extractSelectionContext(selection);
        if (!context || !context.text) return;

        // 从选区起点和终点分别查找 section 行号信息
        const range = selection.getRangeAt(0);
        const startEl = range.startContainer instanceof HTMLElement
          ? range.startContainer : range.startContainer.parentElement;
        const endEl = range.endContainer instanceof HTMLElement
          ? range.endContainer : range.endContainer.parentElement;
        const startLineInfo = startEl ? this.findSectionLineInfo(startEl) : undefined;
        const endLineInfo = endEl ? this.findSectionLineInfo(endEl) : undefined;

        // 合并行号范围（支持跨 section 选区）
        const lineStart = startLineInfo?.lineStart;
        const lineEnd = endLineInfo?.lineEnd ?? startLineInfo?.lineEnd;

        // 判断是否跨 section 选区
        const isCrossSection = startLineInfo?.sectionEl !== endLineInfo?.sectionEl;

        // 计算选中文本在 section 内是第几次出现（跨 section 时不计算，用全文搜索）
        const sectionEl = startLineInfo?.sectionEl;
        const offset = sectionEl && !isCrossSection
          ? calculateOffsetInBlock(range, sectionEl)
          : 0;
        const sectionText = !isCrossSection ? (sectionEl?.textContent || "") : "";
        const occurrence = !isCrossSection
          ? countOccurrenceIndex(sectionText, context.text, offset)
          : undefined;

        // 跨段选区：提取每块的文本和行号
        let blockSegments: BlockSegment[] | undefined;
        if (isCrossSection) {
          blockSegments = extractCrossBlockSegments(
            range,
            (el) => this.findSectionLineInfo(el)
          );
        }

        this.annotationMenu.hide();

        this.selectionMenu.show({
          x: e.clientX,
          y: e.clientY,
          selectedText: context.text,
          contextBefore: context.contextBefore,
          contextAfter: context.contextAfter,
          notePath,
          startLine: lineStart,
          endLine: lineEnd,
          occurrence,
          blockSegments,
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

      e.preventDefault();
      e.stopPropagation();

      // 收集被点击位置的所有嵌套标注 ID（从内到外）
      const annotationIds: string[] = [];
      let currentEl: HTMLElement | null = markEl;
      while (currentEl) {
        const id = currentEl.getAttribute?.("data-annotation-id");
        if (id && !annotationIds.includes(id)) {
          annotationIds.push(id);
        }
        // 向上查找父级 mark 标签
        currentEl = currentEl.parentElement?.closest("mark[data-annotation-id]") as HTMLElement ?? null;
      }

      // 从标注文件中解析标注数据
      this.fileManager.getAnnotations(notePath).then((annotations) => {
        this.selectionMenu.hide();

        if (annotationIds.length === 1) {
          // 单个标注：直接显示详情
          const annotation = annotations.find((a) => a.id === annotationIds[0]);
          if (!annotation) return;
          this.annotationMenu.show({
            x: e.clientX,
            y: e.clientY,
            annotation,
            notePath,
            onUpdate: () => this.refreshAnnotationView(notePath),
          });
        } else {
          // 多个嵌套标注：显示最内层的标注（用户最可能想操作的）
          const annotation = annotations.find((a) => a.id === annotationIds[0]);
          if (!annotation) return;
          this.annotationMenu.show({
            x: e.clientX,
            y: e.clientY,
            annotation,
            notePath,
            onUpdate: () => this.refreshAnnotationView(notePath),
          });
        }
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

        // 列表元素：为每个 <li data-line> 注册独立行号映射
        // 这样 findSectionLineInfo 会优先返回 <li>（比 <ul> 更靠近文本节点）
        const lists = Array.from(el.querySelectorAll("ul, ol"));
        for (const list of lists) {
          const items = list.querySelectorAll(":scope > li");
          for (let i = 0; i < items.length; i++) {
            const li = items[i] as HTMLElement;
            const dataLine = li.getAttribute("data-line");
            if (dataLine === null) continue;

            const lineOffset = parseInt(dataLine, 10);
            const liLineStart = sectionInfo.lineStart + lineOffset;

            // lineEnd：下一个 <li> 的 data-line - 1，或 section 的 lineEnd
            let liLineEnd = sectionInfo.lineEnd;
            if (i + 1 < items.length) {
              const nextDataLine = (items[i + 1] as HTMLElement).getAttribute("data-line");
              if (nextDataLine !== null) {
                liLineEnd = sectionInfo.lineStart + parseInt(nextDataLine, 10) - 1;
              }
            }

            this.sectionLineMap.set(li, {
              lineStart: liLineStart,
              lineEnd: liLineEnd,
            });
          }
        }
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

