import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type EditorPosition,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { AnnotationFileManager } from "./annotationFile/AnnotationFileManager";
import { DEFAULT_SETTINGS, type AnnotationPluginSettings } from "./types";
import { SelectionMenu } from "./ui/SelectionMenu";
import { AnnotationMenu } from "./ui/AnnotationMenu";
import { AnnotationListPanel } from "./ui/AnnotationListPanel";
import { AnnotationSettingTab } from "./ui/AnnotationSettingTab";
import { TooltipManager } from "./ui/TooltipManager";
import { extractSelectionContext, calculateOffsetInBlock, extractCrossBlockSegments } from "./utils/contentMapper";
import { countOccurrenceIndex } from "./utils/helpers";
import type { BlockSegment } from "./types";
import { createAnnotationViewExtension } from "./view/annotationViewPlugin";
import { AnnotationSidebarView, ANNOTATION_SIDEBAR_VIEW_TYPE } from "./sidebar/AnnotationSidebarView";
import { preScanOldAnnotations } from "./importer/oldAnnotationImporter";
import { ImportConfirmModal } from "./importer/ImportConfirmModal";
import { initLocale, t } from "./i18n";

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
  tooltipManager!: TooltipManager;
  annotationPanels: Map<string, AnnotationListPanel> = new Map();

  // 实时同步防抖定时器
  private syncToOriginalTimers: Map<string, number> = new Map();

  // 侧边栏刷新回调
  annotationChangeCallbacks: Array<() => void> = [];
  private notifyDebounceTimer: number | null = null;

  async onload() {
    await this.loadSettings();
    initLocale();

    const pluginDir = this.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
    this.fileManager = new AnnotationFileManager(this.app, pluginDir);

    this.selectionMenu = new SelectionMenu(this.app, this.fileManager, () => this.settings);
    this.annotationMenu = new AnnotationMenu(this.app, this.fileManager, () => this.settings);

    this.tooltipManager = new TooltipManager(this);
    this.tooltipManager.register();

    this.registerEvents();
    this.registerCommands();
    this.registerCacheListeners();
    this.registerAnnotationInteraction();
    this.registerSectionLineCapture();

    this.addRibbonIcon("lucide-highlighter", t().ribbonTooltip, () => {
      this.toggleAnnotationView();
    });

    this.addSettingTab(new AnnotationSettingTab(this));

    // 注册侧边栏视图
    this.registerView(
      ANNOTATION_SIDEBAR_VIEW_TYPE,
      (leaf) => new AnnotationSidebarView(leaf, this)
    );

    this.updateDynamicStyles();

    // 注册 CM6 编辑模式装饰
    this.registerEditorExtension(createAnnotationViewExtension());
  }

  onunload() {
    // 同步所有活跃会话
    for (const [originalPath] of this.activeAnnotationSessions) {
      const timer = this.syncToOriginalTimers.get(originalPath);
      if (timer) clearTimeout(timer);
      try {
        this.fileManager.syncToOriginal(originalPath);
      } catch (e) {
        console.error("同步失败:", e);
      }
    }
    this.syncToOriginalTimers.clear();

    for (const [, annotationPath] of this.activeAnnotationSessions) {
      this.removeFakeTFile(annotationPath);
      this.removeMetadataCache(annotationPath);
    }
    this.activeAnnotationSessions.clear();

    for (const [, panel] of this.annotationPanels) {
      panel.hide();
    }
    this.annotationPanels.clear();

    this.selectionMenu.hide();
    this.annotationMenu.hide();
    this.tooltipManager.destroy();

    // 清理动态样式
    const styleEl = document.getElementById("annotation-dynamic-styles");
    if (styleEl) styleEl.remove();

    // 清理侧边栏回调
    this.annotationChangeCallbacks = [];
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ========== 动态 CSS ==========

  // 将十六进制颜色值转为 rgba 格式
  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // 根据设置注入/更新动态 CSS 变量
  updateDynamicStyles() {
    let el = document.getElementById("annotation-dynamic-styles");
    if (!el) {
      el = document.createElement("style");
      el.id = "annotation-dynamic-styles";
      document.head.appendChild(el);
    }

    const s = this.settings;

    el.textContent = `
      :root {
        --annotation-bg-color1: ${this.hexToRgba(s.color1, 0.35)};
        --annotation-accent-color1: ${this.hexToRgba(s.color1, 0.8)};
        --annotation-bg-color2: ${this.hexToRgba(s.color2, 0.35)};
        --annotation-accent-color2: ${this.hexToRgba(s.color2, 0.8)};
        --annotation-bg-color3: ${this.hexToRgba(s.color3, 0.45)};
        --annotation-accent-color3: ${this.hexToRgba(s.color3, 0.8)};
        --annotation-bg-color4: ${this.hexToRgba(s.color4, 0.35)};
        --annotation-accent-color4: ${this.hexToRgba(s.color4, 0.8)};
        --annotation-bg-color5: ${this.hexToRgba(s.color5, 0.35)};
        --annotation-accent-color5: ${this.hexToRgba(s.color5, 0.8)};
        --annotation-dot-color1: ${s.color1};
        --annotation-dot-color2: ${s.color2};
        --annotation-dot-color3: ${s.color3};
        --annotation-dot-color4: ${s.color4};
        --annotation-dot-color5: ${s.color5};
        --annotation-ruby-font-size: ${s.rubyFontSize};
        --annotation-ruby-color: ${s.rubyColor};
      }
    `;

    // 设置批注效果
    document.body.dataset.noteEffect = s.noteEffect;
  }

  // ========== 实时同步 ==========

  private debouncedSyncToOriginal(originalPath: string) {
    const existing = this.syncToOriginalTimers.get(originalPath);
    if (existing) clearTimeout(existing);
    const timer = window.setTimeout(async () => {
      this.syncToOriginalTimers.delete(originalPath);
      try {
        await this.fileManager.syncToOriginal(originalPath);
      } catch (e) {
        console.error("实时同步失败:", e);
      }
    }, 800);
    this.syncToOriginalTimers.set(originalPath, timer);
  }

  // ========== 假文件管理 ==========

  private createFakeTFile(path: string): TFile {
    const vault = this.app.vault;
    const anyFile = vault.getFiles()[0];
    if (!anyFile) throw new Error("Vault is empty");

    const TFileConstructor = Object.getPrototypeOf(anyFile).constructor;
    const fakeFile = new TFileConstructor(vault, path);

    (fakeFile as any).deleted = false;
    (vault as any).fileMap[path] = fakeFile;

    return fakeFile;
  }

  private removeFakeTFile(path: string) {
    delete (this.app.vault as any).fileMap[path];
  }

  // ========== 元数据缓存 ==========

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

  private registerCacheListeners() {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const filePath = (info as any).file?.path;
        if (!filePath) return;
        const originalPath = this.getOriginalPathByAnnotationPath(filePath);
        if (originalPath) {
          this.injectMetadataCache(filePath, originalPath, (info as any).file);
          this.debouncedSyncToOriginal(originalPath);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", async () => {
        for (const [originalPath, annotationPath] of this.activeAnnotationSessions) {
          let isStillOpen = false;
          this.app.workspace.iterateAllLeaves((l) => {
            if ((l.view as any)?.file?.path === annotationPath) {
              isStillOpen = true;
            }
          });

          if (!isStillOpen) {
            // 同步标注文件编辑回原文件
            const timer = this.syncToOriginalTimers.get(originalPath);
            if (timer) clearTimeout(timer);
            this.syncToOriginalTimers.delete(originalPath);
            try {
              await this.fileManager.syncToOriginal(originalPath);
            } catch (e) {
              console.error("同步失败:", e);
            }

            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);
            this.activeAnnotationSessions.delete(originalPath);
            const panel = this.annotationPanels.get(originalPath);
            if (panel) {
              panel.hide();
              this.annotationPanels.delete(originalPath);
            }
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

  getOriginalPathByAnnotationPath(annotationPath: string): string | null {
    for (const [originalPath, aPath] of this.activeAnnotationSessions) {
      if (aPath === annotationPath) return originalPath;
    }
    return null;
  }

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
      new Notice(t().noticeNoFile);
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
      new Notice(t().noticeFileCreateFailed);
      return;
    }

    const annotationPath = normalizePath(this.fileManager.getAnnotationFilePath(notePath));

    const fakeTFile = this.createFakeTFile(annotationPath);

    this.activeAnnotationSessions.set(notePath, annotationPath);

    try {
      this.injectMetadataCache(annotationPath, notePath, fakeTFile);

      await leaf.openFile(fakeTFile, { state: { mode: "preview" } });

      if (savedScroll) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
        });
      }

      this.setupAnnotationListPanel(notePath);
    } catch (e) {
      console.error("[标注] openFile 失败:", e);
      new Notice(t().noticeOpenFailed + e);
    }
  }

  async closeAnnotationView(leaf: any, originalPath: string) {
    const savedScroll = this.getSavedScroll(leaf);
    const annotationPath = this.activeAnnotationSessions.get(originalPath);

    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    if (!(originalFile instanceof TFile)) {
      new Notice(t().noticeOriginalMissing);
      if (annotationPath) {
        this.removeFakeTFile(annotationPath);
        this.removeMetadataCache(annotationPath);
      }
      this.activeAnnotationSessions.delete(originalPath);
      return;
    }

    // 取消防抖，立即同步
    const timer = this.syncToOriginalTimers.get(originalPath);
    if (timer) clearTimeout(timer);
    this.syncToOriginalTimers.delete(originalPath);
    try {
      await this.fileManager.syncToOriginal(originalPath);
    } catch (e) {
      console.error("同步失败:", e);
    }

    await leaf.openFile(originalFile);

    if (annotationPath) {
      this.removeFakeTFile(annotationPath);
      this.removeMetadataCache(annotationPath);
    }
    this.activeAnnotationSessions.delete(originalPath);

    this.selectionMenu.hide();
    this.annotationMenu.hide();
    const panel = this.annotationPanels.get(originalPath);
    if (panel) {
      panel.hide();
      this.annotationPanels.delete(originalPath);
    }

    if (savedScroll) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
      });
    }
  }

  // ========== 标注交互事件 ==========

  private registerAnnotationInteraction() {
    this.registerDomEvent(document, "mouseup", (e: MouseEvent) => {
      const notePath = this.getActiveAnnotationNotePath();
      if (!notePath) return;

      const target = e.target as HTMLElement;
      if (target.closest(".annotation-card-menu, .modal-container")) return;
      if (target.closest("input, textarea")) return;
      if (target.closest("pre, .el-pre")) return;
      if (target.closest(".internal-embed")) return;
      if (target.closest(".callout") && !target.closest(".callout-content")) return;

      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const context = extractSelectionContext(selection);
        if (!context || !context.text) return;

        const range = selection.getRangeAt(0);
        const startEl = range.startContainer instanceof HTMLElement
          ? range.startContainer : range.startContainer.parentElement;
        const endEl = range.endContainer instanceof HTMLElement
          ? range.endContainer : range.endContainer.parentElement;
        const startLineInfo = startEl ? this.findSectionLineInfo(startEl) : undefined;
        const endLineInfo = endEl ? this.findSectionLineInfo(endEl) : undefined;

        const lineStart = startLineInfo?.lineStart;
        const lineEnd = endLineInfo?.lineEnd ?? startLineInfo?.lineEnd;

        const isCrossSection = startLineInfo?.sectionEl !== endLineInfo?.sectionEl;

        if (isCrossSection) {
          const startCallout = startEl?.closest('.callout');
          const endCallout = endEl?.closest('.callout');
          if (startCallout !== endCallout) {
            new Notice(t().noticeNoCrossCallout);
            return;
          }
        }

        const sectionEl = startLineInfo?.sectionEl;
        const offset = sectionEl && !isCrossSection
          ? calculateOffsetInBlock(range, sectionEl)
          : 0;
        const sectionText = !isCrossSection ? (sectionEl?.textContent || "") : "";
        const occurrence = !isCrossSection
          ? countOccurrenceIndex(sectionText, context.text, offset)
          : undefined;

        let blockSegments: BlockSegment[] | undefined;
        if (isCrossSection) {
          blockSegments = extractCrossBlockSegments(
            range,
            (el) => this.findSectionLineInfo(el)
          );
        }

        this.annotationMenu.hide();

        // 编辑模式下保存编辑器选区位置
        const activeLeaf = this.app.workspace.activeLeaf;
        const view = activeLeaf?.view as MarkdownView;
        let editorRange: { from: EditorPosition; to: EditorPosition } | undefined;
        if (view?.getMode?.() === "source" && view.editor) {
          editorRange = {
            from: view.editor.getCursor("from"),
            to: view.editor.getCursor("to"),
          };
        }

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
          editorRange,
          onAdd: () => this.refreshAnnotationView(notePath),
        });
      }, 10);
    });

    this.registerDomEvent(document, "click", (e: MouseEvent) => {
      const notePath = this.getActiveAnnotationNotePath();
      if (!notePath) return;

      const target = e.target as HTMLElement;
      const markEl = target.closest("mark[data-annotation-id]") as HTMLElement;
      if (!markEl) return;

      e.preventDefault();
      e.stopPropagation();

      const annotationIds: string[] = [];
      let currentEl: HTMLElement | null = markEl;
      while (currentEl) {
        const id = currentEl.getAttribute?.("data-annotation-id");
        if (id && !annotationIds.includes(id)) {
          annotationIds.push(id);
        }
        currentEl = currentEl.parentElement?.closest("mark[data-annotation-id]") as HTMLElement ?? null;
      }

      this.fileManager.getAnnotations(notePath).then((annotations) => {
        this.selectionMenu.hide();

        if (annotationIds.length === 1) {
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

  private setupAnnotationListPanel(notePath: string) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    // 清理旧实例
    const oldPanel = this.annotationPanels.get(notePath);
    if (oldPanel) {
      oldPanel.hide();
    }

    const panel = new AnnotationListPanel(this.app, this.fileManager);
    this.annotationPanels.set(notePath, panel);
    panel.show({
      notePath,
      onUpdate: () => this.refreshAnnotationView(notePath),
      containerEl: view.containerEl,
    });
  }

  async refreshAnnotationView(notePath: string) {
    try {
      // 查找持有该标注文件的 MarkdownView（而非用 activeLeaf）
      const annotationPath = this.activeAnnotationSessions.get(notePath);
      if (!annotationPath) return;

      const views: MarkdownView[] = [];
      this.app.workspace.iterateAllLeaves((leaf) => {
        const v = leaf.view;
        if (v instanceof MarkdownView && (v as any)?.file?.path === annotationPath) {
          views.push(v);
        }
      });

      if (views.length === 0) return;
      const view = views[0]!;

      const content = await this.fileManager.readAnnotationFile(notePath);

      if (view.getMode() === "preview") {
        const renderer = (view.previewMode as any).renderer;
        if (renderer && typeof renderer.set === "function") {
          renderer.set(content);
        }
      } else {
        // 编辑模式：通过 CM6 dispatch 更新编辑器内容
        // @ts-expect-error — Obsidian 官方文档推荐的方式
        const editorView: EditorView = view.editor.cm;
        if (editorView && content !== editorView.state.doc.toString()) {
          const scrollTop = editorView.scrollDOM.scrollTop;
          editorView.dispatch({
            changes: { from: 0, to: editorView.state.doc.length, insert: content }
          });
          requestAnimationFrame(() => {
            editorView.scrollDOM.scrollTop = scrollTop;
          });
        }
      }

      // 同步更新 MarkdownView 内部数据
      (view as any).data = content;

      this.annotationPanels.get(notePath)?.refresh();

      // 通知侧边栏刷新
      this.notifyAnnotationChange();
    } catch (e) {
      console.error("刷新标注视图失败:", notePath, e);
    }
  }

  // ========== 侧边栏 ==========

  notifyAnnotationChange(): void {
    if (this.notifyDebounceTimer) clearTimeout(this.notifyDebounceTimer);
    this.notifyDebounceTimer = window.setTimeout(() => {
      for (const cb of this.annotationChangeCallbacks) {
        try {
          cb();
        } catch (e) {
          console.error("标注变更回调执行失败:", e);
        }
      }
    }, 200);
  }

  async toggleSidebarView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(ANNOTATION_SIDEBAR_VIEW_TYPE);

    if (leaves.length > 0) {
      for (const leaf of leaves) {
        leaf.detach();
      }
    } else {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: ANNOTATION_SIDEBAR_VIEW_TYPE,
          active: true,
        });
        workspace.revealLeaf(rightLeaf);
      }
    }
  }

  // ========== Section 行号捕获 ==========

  private registerSectionLineCapture() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      const sectionInfo = ctx.getSectionInfo(el);
      if (sectionInfo) {
        const footnotesSection = el.querySelector('section.footnotes');
        if (footnotesSection) {
          const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
          if (file instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(file);
            const footnotes = cache?.footnotes;
            if (footnotes && footnotes.length > 0) {
              const container = el.parentElement;
              const items = footnotesSection.querySelectorAll(':scope > ol > li');
              for (let i = 0; i < items.length; i++) {
                const li = items[i] as HTMLElement;
                const liId = li.id;

                const refLink = container?.querySelector(`a.footnote-link[href="#${liId}"]`);
                const originalId = refLink?.getAttribute('data-footref');

                if (originalId) {
                  const fn = footnotes.find(f => f.id === originalId);
                  if (fn) {
                    this.sectionLineMap.set(li, {
                      lineStart: fn.position.start.line,
                      lineEnd: fn.position.end.line,
                    });
                  }
                }
              }
            }
          }
          return;
        }

        this.sectionLineMap.set(el, {
          lineStart: sectionInfo.lineStart,
          lineEnd: sectionInfo.lineEnd,
        });

        const lists = Array.from(el.querySelectorAll("ul, ol"));
        for (const list of lists) {
          const items = list.querySelectorAll(":scope > li");
          for (let i = 0; i < items.length; i++) {
            const li = items[i] as HTMLElement;
            const dataLine = li.getAttribute("data-line");
            if (dataLine === null) continue;

            const lineOffset = parseInt(dataLine, 10);
            const liLineStart = sectionInfo.lineStart + lineOffset;

            let liLineEnd = sectionInfo.lineEnd;
            if (i + 1 < items.length) {
              const nextDataLine = (items[i + 1] as HTMLElement).getAttribute("data-line");
              if (nextDataLine !== null) {
                liLineEnd = sectionInfo.lineStart + parseInt(nextDataLine, 10) - 1;
              }
            } else {
              const parentLi = list.parentElement?.closest("li");
              if (parentLi) {
                const parentInfo = this.sectionLineMap.get(parentLi);
                if (parentInfo) {
                  liLineEnd = parentInfo.lineEnd;
                }
              }
            }

            this.sectionLineMap.set(li, {
              lineStart: liLineStart,
              lineEnd: liLineEnd,
            });
          }
        }

        const tables = Array.from(el.querySelectorAll("table"));
        for (const table of tables) {
          const allRows = table.querySelectorAll("tr");
          for (let i = 0; i < allRows.length; i++) {
            const trLine = sectionInfo.lineStart + (i === 0 ? i : i + 1);
            for (const cell of Array.from(allRows[i]!.querySelectorAll("td, th"))) {
              this.sectionLineMap.set(cell as HTMLElement, {
                lineStart: trLine,
                lineEnd: trLine,
              });
            }
          }
        }
      }
    });
  }

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
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          // 迁移标注文件
          try {
            await this.fileManager.migrateAnnotationFile(oldPath, file.path);
          } catch (e) {
            console.error("迁移标注文件失败:", e);
          }

          // 更新活跃标注会话
          const annotationPath = this.activeAnnotationSessions.get(oldPath);
          if (annotationPath) {
            // 清除旧假文件和元数据缓存
            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);

            // 创建新假文件
            const newAnnotationPath = normalizePath(
              this.fileManager.getAnnotationFilePath(file.path)
            );
            const newFakeTFile = this.createFakeTFile(newAnnotationPath);

            // 更新会话映射
            this.activeAnnotationSessions.delete(oldPath);
            this.activeAnnotationSessions.set(file.path, newAnnotationPath);

            // 注入新元数据缓存
            this.injectMetadataCache(newAnnotationPath, file.path, newFakeTFile);

            // 更新打开的 leaf
            this.app.workspace.iterateAllLeaves((leaf) => {
              if ((leaf.view as any)?.file?.path === annotationPath) {
                leaf.openFile(newFakeTFile, { state: { mode: "preview" } });
              }
            });

            // 迁移同步定时器
            const timer = this.syncToOriginalTimers.get(oldPath);
            if (timer !== undefined) {
              clearTimeout(timer);
              this.syncToOriginalTimers.delete(oldPath);
              this.debouncedSyncToOriginal(file.path);
            }

            // 迁移面板
            const panel = this.annotationPanels.get(oldPath);
            if (panel) {
              this.annotationPanels.delete(oldPath);
              this.annotationPanels.set(file.path, panel);
              panel.updateNotePath(file.path);
            }
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          // 删除标注文件
          try {
            await this.fileManager.deleteAnnotationFile(file.path);
          } catch (e) {
            console.error("删除标注文件失败:", e);
          }

          // 清理活跃标注会话
          const annotationPath = this.activeAnnotationSessions.get(file.path);
          if (annotationPath) {
            // 取消同步定时器（不回写，原文件已删除）
            const timer = this.syncToOriginalTimers.get(file.path);
            if (timer !== undefined) {
              clearTimeout(timer);
              this.syncToOriginalTimers.delete(file.path);
            }

            // 清理假文件和元数据
            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);
            this.activeAnnotationSessions.delete(file.path);

            // 隐藏 UI
            const panel = this.annotationPanels.get(file.path);
            if (panel) {
              panel.hide();
              this.annotationPanels.delete(file.path);
            }
            this.selectionMenu.hide();
            this.annotationMenu.hide();

            // 关闭显示该标注文件的 leaf
            this.app.workspace.iterateAllLeaves((leaf) => {
              if ((leaf.view as any)?.file?.path === annotationPath) {
                leaf.detach();
              }
            });
          }
        }
      })
    );
  }

  registerCommands() {
    this.addCommand({
      id: "toggle-annotation-view",
      name: t().commandToggleView,
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

    this.addCommand({
      id: "toggle-annotation-sidebar",
      name: t().commandSidebar,
      callback: () => this.toggleSidebarView(),
    });

    this.addCommand({
      id: "import-old-annotations",
      name: t().commandImport,
      callback: async () => {
        const pluginDir = this.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
        const scan = await preScanOldAnnotations(this.app, pluginDir);
        if (scan.fileCount === 0) {
          new Notice(t().noticeNoLegacyData);
          return;
        }
        new ImportConfirmModal(this.app, this.fileManager, pluginDir, scan).open();
      },
    });
  }
}
