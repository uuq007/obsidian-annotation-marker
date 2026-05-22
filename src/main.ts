import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type WorkspaceLeaf,
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
import { countOccurrenceIndex, annotationPathToNotePath } from "./utils/helpers";
import type { BlockSegment } from "./types";
import { createAnnotationViewExtension } from "./view/annotationViewPlugin";
import { AnnotationSidebarView, ANNOTATION_SIDEBAR_VIEW_TYPE } from "./sidebar/AnnotationSidebarView";
import { preScanOldAnnotations } from "./importer/oldAnnotationImporter";
import { ImportConfirmModal } from "./importer/ImportConfirmModal";
import { initLocale, t } from "./i18n";
import { FolderSuggestModal, FileNameModal, ConfirmOverwriteModal } from "./ui/ExportModal";
import { sortAnnotations, buildExportContent } from "./utils/exporter";
import { restoreEditorFocus } from "./utils/focusManager";

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
  annotationPanels: Map<WorkspaceLeaf, AnnotationListPanel> = new Map();

  // 实时同步防抖定时器
  private syncToOriginalTimers: Map<string, number> = new Map();

  // 侧边栏刷新回调
  annotationChangeCallbacks: Array<() => void> = [];
  private notifyDebounceTimer: number | null = null;

  // 抑制自动进入标注模式（关闭标注视图时使用）
  private suppressAutoOpen: boolean = false;
  // 插件卸载中标志，防止 layout-change 清除 session 数据
  private isUnloading: boolean = false;
  // 标注视图恢复中标志，防止 layout-change 干扰恢复过程
  private isRecovering: boolean = false;

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

    // 启动时修复因标注模式残留的空标签页
    // 延迟执行，确保 Obsidian 完成所有标签页的恢复
    this.app.workspace.onLayoutReady(() => {
      setTimeout(() => this.recoverOrphanedAnnotationTabs(), 1000);
    });
  }

  onunload() {
    this.isUnloading = true;
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
    const data = await this.loadData();
    // 过滤掉内部使用的字段，避免污染 settings 对象
    const { _activeSessions, _sessionCounts, ...settings } = (data as any) ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
  }

  async saveSettings() {
    const data: any = { ...this.settings };
    if (this.activeAnnotationSessions.size > 0) {
      const sessionData: Record<string, string> = {};
      const countData: Record<string, number> = {};
      for (const [originalPath, annotationPath] of this.activeAnnotationSessions) {
        sessionData[originalPath] = annotationPath;
        // 统计当前有多少 leaf 在显示该标注文件
        let tabCount = 0;
        this.app.workspace.iterateAllLeaves((leaf) => {
          if ((leaf.view as any)?.file?.path === annotationPath) tabCount++;
        });
        countData[originalPath] = tabCount;
      }
      data._activeSessions = sessionData;
      data._sessionCounts = countData;
    }
    await this.saveData(data);
  }

  // ========== 启动时修复孤立标签页 ==========

  private async recoverOrphanedAnnotationTabs() {
    this.isRecovering = true;
    try {
    await this._doRecoverOrphanedTabs();
    } finally {
    this.isRecovering = false;
    }
  }

  private async _doRecoverOrphanedTabs() {
    const savedData = await this.loadData();
    const savedSessions = (savedData as any)?._activeSessions as Record<string, string> | undefined;
    const savedCounts = (savedData as any)?._sessionCounts as Record<string, number> | undefined;
    if (!savedSessions || Object.keys(savedSessions).length === 0) return;

    // 收集有效的 session 并创建 fakeTFile
    const validSessions: { originalPath: string; annotationPath: string; tabCount: number; fakeTFile: TFile }[] = [];
    for (const key of Object.keys(savedSessions)) {
      const originalPath: string = key;
      const annotationPath: string = (savedSessions as any)[key];
      const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
      const annotationExists = await this.app.vault.adapter.exists(annotationPath);
      if (!annotationExists || !(originalFile instanceof TFile)) continue;

      const fakeTFile = this.createFakeTFile(annotationPath);
      this.injectMetadataCache(annotationPath, originalPath, fakeTFile);
      this.activeAnnotationSessions.set(originalPath, annotationPath);

      const tabCount = (savedCounts as any)?.[key] ?? 1;
      validSessions.push({ originalPath, annotationPath, tabCount, fakeTFile });
    }

    if (validSessions.length === 0) return;

    // 构建 annotationPath → session 的映射
    const annotationPathToSession = new Map<string, typeof validSessions[0]>();
    for (const session of validSessions) {
      annotationPathToSession.set(session.annotationPath, session);
    }

    // 收集所有需要恢复的 leaf：
    // 1. 文件路径指向标注文件的（Obsidian 可能从磁盘打开了真实标注文件）
    // 2. viewState 记录了标注文件路径的（空标签页的历史路径）
    // 3. 完全空的标签页
    const candidatesBySession = new Map<string, WorkspaceLeaf[]>();
    for (const session of validSessions) {
      candidatesBySession.set(session.originalPath, []);
    }
    const freeLeaves: WorkspaceLeaf[] = [];

    this.app.workspace.iterateAllLeaves((leaf) => {
      const currentFile = (leaf.view as any)?.file?.path as string | undefined;
      const viewState = leaf.getViewState();
      const intendedFile: string | undefined = (viewState?.state as any)?.file;

      // 当前文件或 viewState 指向某个标注文件
      const matchedPath = currentFile && annotationPathToSession.has(currentFile)
        ? currentFile
        : intendedFile && annotationPathToSession.has(intendedFile)
          ? intendedFile
          : null;

      if (matchedPath) {
        const session = annotationPathToSession.get(matchedPath)!;
        candidatesBySession.get(session.originalPath)!.push(leaf);
      } else if (!currentFile && !intendedFile) {
        freeLeaves.push(leaf);
      }
    });

    // 恢复每个 session 的标签页
    for (const session of validSessions) {
      let restored = 0;
      const candidates = candidatesBySession.get(session.originalPath) ?? [];

      // 先恢复明确匹配的 leaf
      for (const leaf of candidates) {
        if (restored >= session.tabCount) break;
        await this.restoreLeafToAnnotation(leaf, session);
        restored++;
      }

      // 不足的用空闲标签页补充
      while (restored < session.tabCount && freeLeaves.length > 0) {
        const leaf = freeLeaves.shift()!;
        await this.restoreLeafToAnnotation(leaf, session);
        restored++;
      }
    }

    // 持久化 session 数据（含 tabCount），确保下次重启也能恢复
    await this.saveSettings();
  }

  private async restoreLeafToAnnotation(leaf: WorkspaceLeaf, session: { originalPath: string; annotationPath: string; fakeTFile: TFile }) {
    await leaf.openFile(session.fakeTFile, { state: { mode: this.settings.defaultViewMode } });
    this.updateAnnotationTabTitle(leaf, session.originalPath);
    this.setupAnnotationListPanel(session.originalPath, leaf);
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

  // ========== 标签页标题 ==========

  private updateAnnotationTabTitle(leaf: any, originalPath: string) {
    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    const displayName = originalFile instanceof TFile
      ? originalFile.basename
      : originalPath.replace(/\.md$/, "").split("/").pop() ?? originalPath;
    const tabTitle = t().annotationViewTitle(displayName);

    requestAnimationFrame(() => {
      const tabHeaderEl = (leaf as any).tabHeaderEl;
      if (tabHeaderEl) {
        const titleEl = tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
        if (titleEl) {
          titleEl.textContent = tabTitle;
        }
        tabHeaderEl.setAttribute('aria-label', tabTitle);
      }
      // 同步更新视图区域标题
      const viewContainerEl = (leaf as any).view?.containerEl;
      if (viewContainerEl) {
        const inlineTitleEl = viewContainerEl.querySelector('.inline-title');
        if (inlineTitleEl) {
          inlineTitleEl.textContent = tabTitle;
        }
        const headerTitleEl = viewContainerEl.querySelector('.view-header-title');
        if (headerTitleEl) {
          headerTitleEl.textContent = tabTitle;
        }
      }
    });
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
        // 插件卸载期间不处理，避免清除持久化的 session 数据
        if (this.isUnloading || this.isRecovering) return;

        for (const [originalPath, annotationPath] of this.activeAnnotationSessions) {
          let isStillOpen = false;
          // 单次遍历：同时检查 view.file 和 viewState（标签页激活时 view.file 可能暂时为 null）
          this.app.workspace.iterateAllLeaves((l) => {
            const filePath = (l.view as any)?.file?.path;
            if (filePath === annotationPath) {
              isStillOpen = true;
              this.updateAnnotationTabTitle(l, originalPath);
            } else if (!isStillOpen) {
              const vs = l.getViewState();
              if ((vs?.state as any)?.file === annotationPath) {
                isStillOpen = true;
              }
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
            this.saveSettings();

            // 清理残留的面板
            for (const [leaf, panel] of this.annotationPanels) {
              if (panel.getNotePath() === originalPath) {
                panel.hide();
                this.annotationPanels.delete(leaf);
              }
            }
          }
        }
      })
    );

    // 标签页激活时更新 inline-title（未激活标签页的 DOM 可能未渲染）
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) return;
        const filePath = (leaf.view as any)?.file?.path as string | undefined;
        if (!filePath) return;
        const originalPath = this.getOriginalPathByAnnotationPath(filePath);
        if (originalPath) {
          this.updateAnnotationTabTitle(leaf, originalPath);
        }
      })
    );
  }

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

  private hasOtherLeafWithFile(excludedLeaf: WorkspaceLeaf, filePath: string): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((l) => {
      if (l !== excludedLeaf && (l.view as any)?.file?.path === filePath) {
        found = true;
      }
    });
    return found;
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

  async openAnnotationView(leaf: WorkspaceLeaf, notePath: string) {
    const savedScroll = this.getSavedScroll(leaf);

    const ok = await this.fileManager.ensureAnnotationFile(notePath);
    if (!ok) {
      new Notice(t().noticeFileCreateFailed);
      return;
    }

    const annotationPath = normalizePath(this.fileManager.getAnnotationFilePath(notePath));

    // 复用已有 session 的 fakeTFile，避免多标签页覆盖
    const existingFake = (this.app.vault as any).fileMap[annotationPath] as TFile | undefined;
    const fakeTFile = existingFake ?? this.createFakeTFile(annotationPath);

    const isNewSession = !this.activeAnnotationSessions.has(notePath);
    this.activeAnnotationSessions.set(notePath, annotationPath);

    try {
      if (isNewSession) {
        this.injectMetadataCache(annotationPath, notePath, fakeTFile);
      }

      await leaf.openFile(fakeTFile, { state: { mode: this.settings.defaultViewMode } });

      this.updateAnnotationTabTitle(leaf, notePath);

      if (savedScroll) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
        });
      }

      this.setupAnnotationListPanel(notePath, leaf);
      // openFile 完成后再保存，确保 tabCount 统计准确
      this.saveSettings();
    } catch (e) {
      console.error("[标注] openFile 失败:", e);
      new Notice(t().noticeOpenFailed + e);
    }
  }

  async closeAnnotationView(leaf: WorkspaceLeaf, originalPath: string) {
    this.suppressAutoOpen = true;
    const savedScroll = this.getSavedScroll(leaf);
    const annotationPath = this.activeAnnotationSessions.get(originalPath);

    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    if (!(originalFile instanceof TFile)) {
      new Notice(t().noticeOriginalMissing);
      if (annotationPath && !this.hasOtherLeafWithFile(leaf, annotationPath)) {
        this.removeFakeTFile(annotationPath);
        this.removeMetadataCache(annotationPath);
      }
      this.activeAnnotationSessions.delete(originalPath);
      this.saveSettings();
      // 清理该 leaf 的面板
      const panel = this.annotationPanels.get(leaf);
      if (panel) {
        panel.hide();
        this.annotationPanels.delete(leaf);
      }
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

    // 检查是否还有其他 leaf 在使用该标注文件
    const otherLeafHasAnnotation = annotationPath
      ? this.hasOtherLeafWithFile(leaf, annotationPath)
      : false;

    if (!otherLeafHasAnnotation) {
      if (annotationPath) {
        this.removeFakeTFile(annotationPath);
        this.removeMetadataCache(annotationPath);
      }
      this.activeAnnotationSessions.delete(originalPath);
      this.saveSettings();
    }

    this.selectionMenu.hide();
    this.annotationMenu.hide();
    const panel = this.annotationPanels.get(leaf);
    if (panel) {
      panel.hide();
      this.annotationPanels.delete(leaf);
    }

    if (savedScroll) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
      });
    }

    // 延迟重置，确保 file-open 事件已触发并被抑制
    setTimeout(() => { this.suppressAutoOpen = false; }, 500);
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

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const isSourceMode = view?.getMode() === "source";

      // 阅读模式下检查点击是否在预览容器内；source 模式下标记在 CM6 编辑器中，跳过此检查
      if (!isSourceMode) {
        const previewContainer = view?.previewMode?.containerEl;
        if (previewContainer && !previewContainer.contains(markEl)) return;
      }

      // 阅读模式下阻止默认行为；source 模式下不拦截，避免干扰 CM6 焦点
      if (!isSourceMode) {
        e.preventDefault();
        e.stopPropagation();
      }

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

        if (annotationIds.length >= 1) {
          const annotation = annotations.find((a) => a.id === annotationIds[0]);
          if (!annotation) return;
          this.annotationMenu.show({
            x: e.clientX,
            y: e.clientY,
            annotation,
            notePath,
            onUpdate: () => {
              this.refreshAnnotationView(notePath);
              if (isSourceMode && view) restoreEditorFocus(view);
            },
          });
        }
      });
    });
  }

  private setupAnnotationListPanel(notePath: string, leaf: WorkspaceLeaf) {
    const view = leaf.view instanceof MarkdownView ? leaf.view : null;
    if (!view) return;

    // 清理该 leaf 的旧面板
    const oldPanel = this.annotationPanels.get(leaf);
    if (oldPanel) {
      oldPanel.hide();
    }

    const panel = new AnnotationListPanel(this.app, this.fileManager);
    this.annotationPanels.set(leaf, panel);
    panel.show({
      notePath,
      onUpdate: () => this.refreshAnnotationView(notePath),
      containerEl: view.containerEl,
    });
  }

  async refreshAnnotationView(notePath: string) {
    try {
      // 查找持有该标注文件的 MarkdownView
      const annotationPath = this.activeAnnotationSessions.get(notePath);
      if (!annotationPath) return;

      const leaves: WorkspaceLeaf[] = [];
      this.app.workspace.iterateAllLeaves((leaf) => {
        const v = leaf.view;
        if (v instanceof MarkdownView && (v as any)?.file?.path === annotationPath) {
          leaves.push(leaf);
        }
      });

      if (leaves.length === 0) return;

      const content = await this.fileManager.readAnnotationFile(notePath);

      // 刷新所有显示该标注文件的 leaf
      for (const leaf of leaves) {
        const view = leaf.view as MarkdownView;

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

            // 保存光标位置，clamp 到新文档长度内
            const savedPos = Math.min(
              editorView.state.selection.main.head,
              content.length
            );

            editorView.dispatch({
              changes: { from: 0, to: editorView.state.doc.length, insert: content },
              selection: { anchor: savedPos },
            });

            requestAnimationFrame(() => {
              editorView.scrollDOM.scrollTop = scrollTop;
            });
          }
        }

        // 同步更新 MarkdownView 内部数据
        (view as any).data = content;

        // 刷新该 leaf 的面板
        this.annotationPanels.get(leaf)?.refresh();
      }


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
      this.app.workspace.on("file-open", async (file) => {
        if (!this.settings.autoOpenAnnotation) return;
        if (this.suppressAutoOpen) return;
        if (!file || file.extension !== "md") return;

        // 如果当前文件已在标注视图中则跳过
        if (this.getOriginalPathByAnnotationPath(file.path)) return;

        // 检查是否存在标注文件
        const hasFile = await this.fileManager.hasAnnotationFile(file.path);
        if (!hasFile) return;

        // 检查是否有实际标注内容
        const annotations = await this.fileManager.getAnnotations(file.path);
        if (annotations.length === 0) return;

        const leaf = this.app.workspace.activeLeaf;
        if (leaf && (leaf.view as any)?.file?.path === file.path) {
          await this.openAnnotationView(leaf, file.path);
        }
      })
    );

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
            this.saveSettings();

            // 注入新元数据缓存
            this.injectMetadataCache(newAnnotationPath, file.path, newFakeTFile);

            // 更新打开的 leaf
            this.app.workspace.iterateAllLeaves((leaf) => {
              if ((leaf.view as any)?.file?.path === annotationPath) {
                leaf.openFile(newFakeTFile, { state: { mode: this.settings.defaultViewMode } });
                this.updateAnnotationTabTitle(leaf, file.path);
              }
            });

            // 迁移同步定时器
            const timer = this.syncToOriginalTimers.get(oldPath);
            if (timer !== undefined) {
              clearTimeout(timer);
              this.syncToOriginalTimers.delete(oldPath);
              this.debouncedSyncToOriginal(file.path);
            }

            // 迁移面板：更新所有关联 leaf 的面板 notePath
            for (const [leaf, panel] of this.annotationPanels) {
              const leafAnnotationPath = (leaf.view as any)?.file?.path;
              if (leafAnnotationPath === annotationPath || leafAnnotationPath === newAnnotationPath) {
                panel.updateNotePath(file.path);
              }
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
            this.saveSettings();
            // 清理所有显示该标注文件的 leaf 的面板
            for (const [leaf, panel] of this.annotationPanels) {
              const leafFilePath = (leaf.view as any)?.file?.path;
              if (leafFilePath === annotationPath) {
                panel.hide();
                this.annotationPanels.delete(leaf);
              }
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

    this.addCommand({
      id: "export-current-annotations",
      name: t().commandExport,
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") return false;

        if (!checking) {
          this.exportCurrentAnnotations(activeFile.path);
        }
        return true;
      },
    });
  }

  // ========== 导出标注 ==========

  async exportCurrentAnnotations(notePath: string): Promise<void> {
    const loc = t();
    const hasFile = await this.fileManager.hasAnnotationFile(notePath);
    if (!hasFile) {
      new Notice(loc.noData);
      return;
    }

    const annotations = await this.fileManager.getAnnotations(notePath);
    if (annotations.length === 0) {
      new Notice(loc.noData);
      return;
    }

    const sorted = sortAnnotations(annotations, "position-asc");
    const content = buildExportContent(sorted);
    const exportFolder = this.settings.exportFolder?.trim();

    const doExport = (folderPath: string) => {
      const originalFile = this.app.vault.getAbstractFileByPath(notePath);
      const noteName = originalFile instanceof TFile ? originalFile.name.replace(/\.md$/, "") : "";

      new FileNameModal(this.app, noteName, async (fileName: string) => {
        const filePath = normalizePath(folderPath && folderPath !== "/" ? `${folderPath}/${fileName}` : fileName);
        const existing = this.app.vault.getAbstractFileByPath(filePath);

        const doWrite = async () => {
          if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
          } else {
            await this.app.vault.create(filePath, content);
          }
          new Notice(loc.noticeExportSuccess(sorted.length));
        };

        if (existing instanceof TFile) {
          new ConfirmOverwriteModal(
            this.app,
            `${loc.exportConfirmOverwrite}\n${filePath}\n\n${loc.exportConfirmOverwriteDesc}`,
            doWrite
          ).open();
        } else {
          await doWrite();
        }
      }).open();
    };

    if (exportFolder) {
      doExport(exportFolder);
    } else {
      new FolderSuggestModal(this.app, doExport).open();
    }
  }
}
