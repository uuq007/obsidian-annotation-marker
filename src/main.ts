import {
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  type WorkspaceLeaf,
  normalizePath,
  type EditorPosition,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { AnnotationFileManager } from "./annotationFile/AnnotationFileManager";
import { DEFAULT_SETTINGS, COLOR_NUMBERS, type AnnotationPluginSettings, type AnnotationColor } from "./types";
import { getActiveColorNumbers } from "./constants";
import { SelectionMenu } from "./ui/SelectionMenu";
import { AnnotationMenu } from "./ui/AnnotationMenu";
import { AnnotationListPanel } from "./ui/AnnotationListPanel";
import { AnnotationSettingTab } from "./ui/AnnotationSettingTab";
import { TooltipManager } from "./ui/TooltipManager";
import { extractSelectionContext, calculateOffsetInBlock, extractCrossBlockSegments } from "./utils/contentMapper";
import { countOccurrenceIndex, getViewFilePath, annotationPathToNotePath } from "./utils/helpers";
import type { BlockSegment } from "./types";
import { createAnnotationViewExtension } from "./view/annotationViewPlugin";
import { AnnotationSidebarView, ANNOTATION_SIDEBAR_VIEW_TYPE } from "./sidebar/AnnotationSidebarView";
import { preScanOldAnnotations } from "./importer/oldAnnotationImporter";
import { ImportConfirmModal } from "./importer/ImportConfirmModal";
import { initLocale, t } from "./i18n";
import { FolderSuggestModal, FileNameModal, ConfirmOverwriteModal } from "./ui/ExportModal";
import { sortAnnotations, buildExportContent } from "./utils/exporter";
import { restoreEditorFocus } from "./utils/focusManager";
import { clearSelectionHighlight } from "./utils/selectionHighlight";

// 移动端选区稳定防抖时长（ms）：兼作"选择手柄缓冲窗口"——
// 选中后在此时间内拖动起点/终点手柄调整选区，菜单不会弹出（拖动中 selectionchange
// 连发会不断重置计时器）；停手稳定该时长后才弹。可在 500-1000 间按手感微调
const MOBILE_SELECTION_DEBOUNCE_MS = 600;

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

  // 原文件外部修改的合并防抖定时器（按文件路径）
  private externalSyncTimers: Map<string, number> = new Map();

  // 移动端选区稳定检测：selectionchange 防抖定时器（触摸选词不触发 mouseup，改由选区稳定后弹菜单）
  private mobileSelectionTimer: number | null = null;

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

    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/obsidian-annotation-marker`;
    this.fileManager = new AnnotationFileManager(this.app, pluginDir);

    // 安装枚举过滤补丁：须早于 onLayoutReady 延迟 1s 的孤立标签页恢复（会调 createFakeTFile）
    this.installLoadedFilesPatch();

    this.selectionMenu = new SelectionMenu(this.app, this.fileManager, () => this.settings);
    this.annotationMenu = new AnnotationMenu(this.app, this.fileManager, () => this.settings);

    this.tooltipManager = new TooltipManager(this);
    this.tooltipManager.register();

    this.registerEvents();
    this.registerCommands();
    this.registerCacheListeners();
    this.registerAnnotationInteraction();
    this.registerSectionLineCapture();
    this.registerImageEmbedFixer();

    this.addRibbonIcon("lucide-highlighter", t().ribbonTooltip, () => {
      void this.toggleAnnotationView();
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
      window.setTimeout(() => void this.recoverOrphanedAnnotationTabs(), 1000);
    });
  }

  onunload() {
    this.isUnloading = true;
    // 第一时间还原枚举函数；后续 removeFakeTFile 清空 fileMap，原始枚举也不会再列出假文件
    this.uninstallLoadedFilesPatch();
    // 清理待触发的移动端选区弹窗定时器
    this.cancelMobileSelectionTimer();
    // 同步所有活跃会话
    for (const [originalPath] of this.activeAnnotationSessions) {
      const timer = this.syncToOriginalTimers.get(originalPath);
      if (timer) window.clearTimeout(timer);
      // syncToOriginal 为异步，try/catch 无法捕获 rejection，改用 .catch
      void this.fileManager.syncToOriginal(originalPath).catch((e) => {
        console.error("同步失败:", e);
      });
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

    // 清理侧边栏回调
    this.annotationChangeCallbacks = [];
  }

  async loadSettings() {
    const data = await this.loadData() as Record<string, unknown> | null;
    // 过滤掉旧版持久化的内部字段，避免污染 settings 对象
    const stored = (data ?? {}) as Partial<AnnotationPluginSettings> & Record<string, unknown>;
    delete stored._activeSessions;
    delete stored._sessionCounts;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);

    // 规范化激活颜色列表：过滤非法值/去重（按序号升序），全空时回退默认 1..5
    const active = getActiveColorNumbers(this.settings);
    this.settings.activeColors = active.length > 0
      ? active
      : [...DEFAULT_SETTINGS.activeColors];
    // 默认颜色不在激活列表（如指向被删除的颜色）时回退 "3"
    if (this.settings.defaultColor !== "none" && !this.settings.activeColors.includes(this.settings.defaultColor)) {
      this.settings.defaultColor = "3";
    }
  }

  async saveSettings() {
    const data = { ...this.settings } as Record<string, unknown>;
    if (this.activeAnnotationSessions.size > 0) {
      const sessionData: Record<string, string> = {};
      const countData: Record<string, number> = {};
      for (const [originalPath, annotationPath] of this.activeAnnotationSessions) {
        sessionData[originalPath] = annotationPath;
        // 统计当前有多少 leaf 在显示该标注文件
        let tabCount = 0;
        this.app.workspace.iterateAllLeaves((leaf) => {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.file?.path === annotationPath) tabCount++;
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
    const savedData = await this.loadData() as Record<string, unknown> | null;
    const stored: Record<string, unknown> = savedData ?? {};
    const savedSessions = stored._activeSessions as Record<string, string> | undefined;
    const savedCounts = stored._sessionCounts as Record<string, number> | undefined;
    if (!savedSessions || Object.keys(savedSessions).length === 0) return;

    // 收集有效的 session 并创建 fakeTFile
    const validSessions: { originalPath: string; annotationPath: string; tabCount: number; fakeTFile: TFile }[] = [];
    for (const key of Object.keys(savedSessions)) {
      const originalPath: string = key;
      const annotationPath = savedSessions[key];
      if (!annotationPath) continue;
      const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
      const annotationExists = await this.app.vault.adapter.exists(annotationPath);
      if (!annotationExists || !(originalFile instanceof TFile)) continue;

      const fakeTFile = this.createFakeTFile(annotationPath);
      this.injectMetadataCache(annotationPath, originalPath, fakeTFile);
      this.activeAnnotationSessions.set(originalPath, annotationPath);

      const tabCount = savedCounts?.[key] ?? 1;
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
      // 只在主工作区恢复标注标签页；排除左右侧边栏与浮窗 leaf，
      // 防止标注视图被塞进侧边栏并被 workspace.json 持久化
      if (leaf.getRoot() !== this.app.workspace.rootSplit) return;
      const currentFile = getViewFilePath(leaf.view);
      const viewState = leaf.getViewState();
      const intendedFile: string | undefined = (viewState.state as { file?: string } | undefined)?.file;

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
    const s = this.settings;
    const root = activeDocument.documentElement;

    // 颜色变量（背景 + 强调色 + 圆点）。
    // 全量注入 1..10：停用色的存量标注引用的变量依然有效，保证显示不受增减颜色影响
    const sMap = s as unknown as Record<string, unknown>;
    const dMap = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    for (const n of COLOR_NUMBERS) {
      const raw = sMap[`color${n}`];
      // 色值非法时回退默认，避免 hexToRgba 解析出 NaN
      const hex = typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)
        ? raw
        : dMap[`color${n}`] as string;
      // color3（默认色）背景透明度稍高，其余统一
      const bgAlpha = n === "3" ? 0.45 : 0.35;
      root.style.setProperty(`--annotation-bg-color${n}`, this.hexToRgba(hex, bgAlpha));
      root.style.setProperty(`--annotation-accent-color${n}`, this.hexToRgba(hex, 0.8));
      root.style.setProperty(`--annotation-dot-color${n}`, hex);
    }

    // 注音样式
    root.style.setProperty("--annotation-ruby-font-size", s.rubyFontSize);
    root.style.setProperty("--annotation-ruby-color", s.rubyColor);

    // 设置批注效果
    activeDocument.body.dataset.noteEffect = s.noteEffect;
  }

  // ========== 标签页标题 ==========

  private updateAnnotationTabTitle(leaf: WorkspaceLeaf, originalPath: string) {
    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    const displayName = originalFile instanceof TFile
      ? originalFile.basename
      : originalPath.replace(/\.md$/, "").split("/").pop() ?? originalPath;
    const tabTitle = t().annotationViewTitle(displayName);

    window.requestAnimationFrame(() => {
      const tabHeaderEl = (leaf as unknown as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
      if (tabHeaderEl) {
        const titleEl = tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
        if (titleEl) {
          titleEl.textContent = tabTitle;
        }
        tabHeaderEl.setAttribute('aria-label', tabTitle);
      }
      // 同步更新视图区域标题
      const viewContainerEl = leaf.view?.containerEl;
      if (viewContainerEl) {
        const inlineTitleEl = viewContainerEl.querySelector('.inline-title');
        if (inlineTitleEl) {
          inlineTitleEl.textContent = tabTitle;
          inlineTitleEl.setAttribute("contenteditable", "false");
        }
        const headerTitleEl = viewContainerEl.querySelector('.view-header-title');
        if (headerTitleEl) {
          headerTitleEl.textContent = tabTitle;
          headerTitleEl.setAttribute("contenteditable", "false");
        }
      }
    });
  }

  // ========== 实时同步 ==========

  private debouncedSyncToOriginal(originalPath: string) {
    const existing = this.syncToOriginalTimers.get(originalPath);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.syncToOriginalTimers.delete(originalPath);
      void this.fileManager.syncToOriginal(originalPath).catch((e) => {
        console.error("实时同步失败:", e);
      });
    }, 800);
    this.syncToOriginalTimers.set(originalPath, timer);
  }

  // ========== 假文件管理 ==========

  // 枚举过滤补丁：把注入 fileMap 的标注假文件从会被用户界面枚举的出口里剔除，
  // 使其不出现在快速切换器等 UI 中。已覆盖三个出口：
  // - vault.getAllLoadedFiles：直接 for-in 遍历 fileMap
  // - workspace.getRecentFiles：快速切换器空查询的"最近文件"来源（标注标签页
  //   开着时其路径必然在列表中，且 getAbstractFileByPath 能解析到假文件）
  // - workspace.getLastOpenFiles：最近打开文件（CLI __files/recents 等使用），
  //   内部转调 getRecentFiles，两层包装时过滤幂等
  // 注意：vault.getFiles/getMarkdownFiles 走 TFolder.children 递归，本来就不含假文件；
  // getAbstractFileByPath 等 fileMap 直查是"可解析性"依赖（openFile/恢复/行号捕获），绝不能动
  private loadedFilesPatchInstalled: boolean = false;
  // 补丁登记：宿主对象、方法名、原函数（onunload 还原用，不 bind 保留可比较性）
  private patchedMethods: { host: object; name: string; original: (...args: unknown[]) => unknown }[] = [];
  // 需隐藏的标注路径集合；在 createFakeTFile/removeFakeTFile 中增删，
  // 与 fileMap 注入严格同生命周期（这两处是 fileMap 注入的唯一出入口）
  private hiddenAnnotationPaths: Set<string> = new Set();

  // 安装枚举过滤补丁（幂等）。集合为空时等价直通，常驻开销仅一次 size 判断
  private installLoadedFilesPatch(): void {
    if (this.loadedFilesPatchInstalled) return;
    const self = this;
    // 通用包装：原方法返回数组时按路径过滤（TAbstractFile 数组与纯路径字符串数组均覆盖）
    const wrap = (host: object, name: string): void => {
      const slot = host as unknown as Record<string, unknown>;
      const original = slot[name];
      if (typeof original !== "function") return;
      this.patchedMethods.push({ host, name, original: original as (...args: unknown[]) => unknown });
      slot[name] = function (this: unknown, ...args: unknown[]) {
        const result = (original as (...args: unknown[]) => unknown).apply(this, args);
        if (!Array.isArray(result) || self.hiddenAnnotationPaths.size === 0) return result;
        return result.filter((item) =>
          !self.hiddenAnnotationPaths.has(typeof item === "string" ? item : (item as { path: string }).path)
        );
      };
    };
    wrap(this.app.vault, "getAllLoadedFiles");
    wrap(this.app.workspace, "getRecentFiles");
    wrap(this.app.workspace, "getLastOpenFiles");
    this.loadedFilesPatchInstalled = true;
  }

  // 还原原始函数。原为原型方法时 delete 实例属性恢复原型查找；
  // 原为实例属性（他人补丁）时原样回写，不破坏补丁链
  private uninstallLoadedFilesPatch(): void {
    if (!this.loadedFilesPatchInstalled) return;
    for (const rec of this.patchedMethods) {
      const slot = rec.host as unknown as Record<string, unknown>;
      const proto = Object.getPrototypeOf(rec.host) as Record<string, unknown>;
      if (proto[rec.name] === rec.original) {
        delete slot[rec.name];
      } else {
        slot[rec.name] = rec.original;
      }
    }
    this.patchedMethods = [];
    this.loadedFilesPatchInstalled = false;
    this.hiddenAnnotationPaths.clear();
  }

  private createFakeTFile(path: string): TFile {
    const vault = this.app.vault;
    const anyFile = vault.getFiles()[0];
    if (!anyFile) throw new Error("Vault is empty");

    const proto = Object.getPrototypeOf(anyFile) as {
      constructor: new (...args: unknown[]) => TFile;
    };
    const fakeFile = new proto.constructor(vault, path);

    (fakeFile as unknown as { deleted: boolean }).deleted = false;
    (vault as unknown as { fileMap: Record<string, TFile> }).fileMap[path] = fakeFile;
    this.hiddenAnnotationPaths.add(path); // 注入即隐藏：同步进枚举过滤集合

    return fakeFile;
  }

  private removeFakeTFile(path: string) {
    delete (this.app.vault as unknown as { fileMap: Record<string, TFile> }).fileMap[path];
    this.hiddenAnnotationPaths.delete(path); // 移除注入即解除隐藏
  }

  // ========== 元数据缓存 ==========

  private injectMetadataCache(annotationPath: string, originalPath: string, fakeTFile: TFile) {
    const cacheInternal = this.app.metadataCache as unknown as {
      metadataCache: Record<string, unknown>;
      fileCache: Record<string, unknown>;
    };

    const originalCache = cacheInternal.metadataCache[originalPath];
    if (originalCache) {
      cacheInternal.metadataCache[annotationPath] = originalCache;
    }

    const originalFileCache = cacheInternal.fileCache[originalPath];
    if (originalFileCache) {
      cacheInternal.fileCache[annotationPath] = originalFileCache;
    }

    if (originalCache) {
      this.debouncedMetadataTrigger(fakeTFile, originalCache);
    }
  }

  // metadataCache "changed" 广播防抖：Dataview/graph 等重索引型订阅者开销大，
  // 不应随每次击键唤醒（上方字典再注入本身是纯赋值，保留逐次执行）
  private metadataTriggerTimer: number | null = null;
  private debouncedMetadataTrigger(fakeTFile: TFile, cache: unknown): void {
    if (this.metadataTriggerTimer) window.clearTimeout(this.metadataTriggerTimer);
    this.metadataTriggerTimer = window.setTimeout(() => {
      this.metadataTriggerTimer = null;
      this.app.metadataCache.trigger("changed", fakeTFile, "", cache);
    }, 800);
  }

  private removeMetadataCache(annotationPath: string) {
    const cacheInternal = this.app.metadataCache as unknown as {
      metadataCache: Record<string, unknown>;
      fileCache: Record<string, unknown>;
    };
    delete cacheInternal.metadataCache[annotationPath];
    delete cacheInternal.fileCache[annotationPath];
  }

  private registerCacheListeners() {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const file = (info as { file?: TFile }).file;
        if (!file) return;
        const originalPath = this.getOriginalPathByAnnotationPath(file.path);
        if (originalPath) {
          this.injectMetadataCache(file.path, originalPath, file);
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
            const filePath = getViewFilePath(l.view);
            if (filePath === annotationPath) {
              isStillOpen = true;
              this.updateAnnotationTabTitle(l, originalPath);
            } else if (!isStillOpen) {
              const vs = l.getViewState();
              if ((vs.state as { file?: string } | undefined)?.file === annotationPath) {
                isStillOpen = true;
              }
            }
          });

          if (!isStillOpen) {
            // 同步标注文件编辑回原文件
            const timer = this.syncToOriginalTimers.get(originalPath);
            if (timer) window.clearTimeout(timer);
            this.syncToOriginalTimers.delete(originalPath);
            try {
              await this.fileManager.syncToOriginal(originalPath);
            } catch (e) {
              console.error("同步失败:", e);
            }

            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);
            this.activeAnnotationSessions.delete(originalPath);
            await this.saveSettings();

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
        const filePath = getViewFilePath(leaf.view);
        if (!filePath) return;
        const originalPath = this.getOriginalPathByAnnotationPath(filePath);
        if (originalPath) {
          this.updateAnnotationTabTitle(leaf, originalPath);
        }
      })
    );
  }

  private getSavedScroll(leaf: WorkspaceLeaf): number {
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      const currentMode = (view as unknown as { currentMode?: { getScroll?: () => unknown } }).currentMode;
      if (currentMode?.getScroll) {
        const scroll = currentMode.getScroll();
        return typeof scroll === "number" ? scroll : 0;
      }
    }
    return 0;
  }

  private restoreScroll(leaf: WorkspaceLeaf, scroll: number) {
    if (!scroll) return;
    leaf.view.setEphemeralState({ scroll });
  }

  private hasOtherLeafWithFile(excludedLeaf: WorkspaceLeaf, filePath: string): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((l) => {
      if (l !== excludedLeaf && getViewFilePath(l.view) === filePath) {
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
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const currentFile = view?.file;
    if (!currentFile) return null;
    return this.getOriginalPathByAnnotationPath(currentFile.path);
  }

  async toggleAnnotationView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const currentFile = view?.file;
    if (!currentFile) {
      new Notice(t().noticeNoFile);
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
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
    const existingFake = (this.app.vault as unknown as { fileMap: Record<string, TFile> }).fileMap[annotationPath];
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
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
        });
      }

      this.setupAnnotationListPanel(notePath, leaf);
      // openFile 完成后再保存，确保 tabCount 统计准确
      await this.saveSettings();
    } catch (e) {
      console.error("[标注] openFile 失败:", e);
      new Notice(t().noticeOpenFailed + (e instanceof Error ? e.message : String(e)));
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
      await this.saveSettings();
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
    if (timer) window.clearTimeout(timer);
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
      await this.saveSettings();
    }

    this.selectionMenu.hide();
    this.annotationMenu.hide();
    const panel = this.annotationPanels.get(leaf);
    if (panel) {
      panel.hide();
      this.annotationPanels.delete(leaf);
    }

    if (savedScroll) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => this.restoreScroll(leaf, savedScroll));
      });
    }

    // 延迟重置，确保 file-open 事件已触发并被抑制
    window.setTimeout(() => { this.suppressAutoOpen = false; }, 500);
  }

  // ========== 标注交互事件 ==========

  private registerAnnotationInteraction() {
    // 已有标注的点击详情菜单：移动端 tap 会合成 click，全平台共用
    this.registerMarkClickInteraction();
    // 「添加标注」入口按平台分流：触摸长按选词不会触发 mouseup，移动端改用 selectionchange 防抖；
    // 两入口互斥注册，同一手势只有一条路径可产生弹窗（天然防双触发），桌面行为保持不变
    if (Platform.isMobile) {
      this.registerMobileSelectionEntry();
    } else {
      this.registerDesktopMouseupEntry();
    }
  }

  // 桌面端入口：划选松开（mouseup）后延迟读取选区并弹出添加标注菜单
  private registerDesktopMouseupEntry() {
    this.registerDomEvent(activeDocument, "mouseup", (e: MouseEvent) => {
      const notePath = this.getActiveAnnotationNotePath();
      if (!notePath) return;

      const target = e.target as HTMLElement;
      if (target.closest(".annotation-card-menu, .modal-container")) return;
      if (target.closest("input, textarea")) return;
      if (target.closest("pre, .el-pre")) return;
      if (target.closest(".internal-embed")) return;
      if (target.closest(".callout") && !target.closest(".callout-content")) return;
      if (target.closest(".frontmatter, .cm-hmd-frontmatter, .metadata-container")) return;
      if (target.closest(".inline-title, .view-header-title")) return;

      window.setTimeout(() => {
        this.tryShowSelectionMenu(e.clientX, e.clientY, notePath);
      }, 10);
    });
  }

  // 移动端入口：长按选词 / 拖动选择手柄只会派发 selectionchange 而无 mouseup，
  // 因此监听选区变化，待选区稳定（防抖到期）后再弹菜单
  private registerMobileSelectionEntry() {
    // 选词与拖手柄期间 selectionchange 连发，每次都重置定时器，只有停手稳定后才触发一次
    this.registerDomEvent(activeDocument, "selectionchange", () => {
      this.cancelMobileSelectionTimer();
      this.mobileSelectionTimer = window.setTimeout(() => {
        this.mobileSelectionTimer = null;
        this.handleMobileSelectionStable();
      }, MOBILE_SELECTION_DEBOUNCE_MS);
    }, { capture: true });

    // 滚动后选区矩形的视口坐标已失效，滚动时取消待触发的弹窗
    // （拖选择手柄扩展选区时页面不滚动，不受影响）
    this.registerDomEvent(activeDocument, "scroll", () => {
      this.cancelMobileSelectionTimer();
    }, { capture: true });
  }

  private cancelMobileSelectionTimer(): void {
    if (this.mobileSelectionTimer !== null) {
      window.clearTimeout(this.mobileSelectionTimer);
      this.mobileSelectionTimer = null;
    }
  }

  // 移动端：防抖到期后的校验链，任一环节失败即静默放弃
  private handleMobileSelectionStable(): void {
    const notePath = this.getActiveAnnotationNotePath();
    if (!notePath) return;

    const menuOpened = this.selectionMenu.isOpened();
    const selection = window.getSelection();

    // 选区塌陷/为空（tap 空白处塌陷、tap 进了批注输入框等）：
    // 菜单开着时只擦除克隆的紫色临时高亮并保留菜单——用户仍可点颜色圆点完成标注
    // （annotateWithColor 使用菜单内存字段，不依赖实时选区），修复 iPad 选区高亮残留
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      if (menuOpened) {
        clearSelectionHighlight();
      }
      return;
    }

    // 选区起止元素都必须落在当前笔记的预览容器或编辑器容器内（排除侧栏、标签栏、本插件菜单等）
    const range = selection.getRangeAt(0);
    const startEl = range.startContainer.instanceOf(HTMLElement)
      ? range.startContainer : range.startContainer.parentElement;
    const endEl = range.endContainer.instanceOf(HTMLElement)
      ? range.endContainer : range.endContainer.parentElement;
    if (!startEl || !endEl) return;

    // 排除模态框、插件自身菜单及各类输入控件内的选区
    const excludedSelf = ".annotation-card-menu, .modal-container, input, textarea";
    if (startEl.closest(excludedSelf) || endEl.closest(excludedSelf)) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    // 编辑器容器通过非公开的 cm 属性取（公开 Editor 类型未暴露容器，与 focusManager.ts 同一访问方式）
    const cmDom = (view?.editor as unknown as { cm?: EditorView } | undefined)?.cm?.dom;
    const validContainers = [view?.previewMode?.containerEl, cmDom];
    const inNoteContainer = validContainers.some(
      (c) => c && c.contains(startEl) && c.contains(endEl)
    );
    if (!inNoteContainer) return;

    // 内容过滤清单与桌面 mouseup 分支一致（代码块/嵌入/callout 外壳/frontmatter/标题等）
    for (const el of [startEl, endEl]) {
      if (el.closest("pre, .el-pre")) return;
      if (el.closest(".internal-embed")) return;
      if (el.closest(".callout") && !el.closest(".callout-content")) return;
      if (el.closest(".frontmatter, .cm-hmd-frontmatter, .metadata-container")) return;
      if (el.closest(".inline-title, .view-header-title")) return;
    }

    // 移动端无指针坐标，用选区矩形下缘中点作为菜单锚点；无效矩形或整体在视口外则放弃本次
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    const selectionInfo = this.collectSelectionParams(selection);
    if (!selectionInfo) return;

    if (menuOpened) {
      // 待标注内容没变（零星 selectionchange / 同段重复触发）时跳过，避免菜单闪烁重建
      if (
        this.selectionMenu.getCurrentNotePath() === notePath &&
        this.selectionMenu.getSelectedText() === selectionInfo.selectedText
      ) {
        return;
      }

      // 拖动手柄调整选区 / 二次划选：原地更新待标注内容，保留已输入批注与所选颜色
      if (this.selectionMenu.getCurrentNotePath() === notePath) {
        this.selectionMenu.updateSelection({
          x: rect.left + rect.width / 2,
          y: rect.bottom,
          ...selectionInfo,
          editorRange: this.collectEditorRange(),
        });
        return;
      }
      // notePath 不同（旧会话残留菜单的边角情形）→ 走下方整体重建
    }

    this.tryShowSelectionMenu(rect.left + rect.width / 2, rect.bottom, notePath);
  }

  // 编辑模式（source/Live Preview）下保存编辑器选区位置，供 replaceRange 局部替换路径使用
  private collectEditorRange(): { from: EditorPosition; to: EditorPosition } | undefined {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.getMode?.() === "source" && view.editor) {
      return { from: view.editor.getCursor("from"), to: view.editor.getCursor("to") };
    }
    return undefined;
  }

  // 从当前 DOM 选区弹出「添加标注」菜单（桌面 mouseup 与移动端 selectionchange 共用）
  private tryShowSelectionMenu(x: number, y: number, notePath: string): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectionInfo = this.collectSelectionParams(selection);
    if (!selectionInfo) return;

    this.annotationMenu.hide();

    this.selectionMenu.show({
      x,
      y,
      ...selectionInfo,
      notePath,
      editorRange: this.collectEditorRange(),
      onAdd: () => { void this.refreshAnnotationView(notePath); },
    });
  }

  // 点击已有标注 → 弹出详情/改色/删除菜单
  private registerMarkClickInteraction() {
    this.registerDomEvent(activeDocument, "click", (e: MouseEvent) => {
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
              void this.refreshAnnotationView(notePath);
              if (isSourceMode && view) restoreEditorFocus(view);
            },
          });
        }
      }).catch((err) => console.error("获取标注失败:", err));
    });
  }

  // 从 DOM 选区解析标注所需的上下文（mouseup 弹窗与快捷键命令共用）
  private collectSelectionParams(selection: Selection): {
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    startLine?: number;
    endLine?: number;
    occurrence?: number;
    blockSegments?: BlockSegment[];
  } | null {
    const context = extractSelectionContext(selection);
    if (!context || !context.text) return null;

    const range = selection.getRangeAt(0);
    const startEl = range.startContainer.instanceOf(HTMLElement)
      ? range.startContainer : range.startContainer.parentElement;
    const endEl = range.endContainer.instanceOf(HTMLElement)
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
        return null;
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

    return {
      selectedText: context.text,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      startLine: lineStart,
      endLine: lineEnd,
      occurrence,
      blockSegments,
    };
  }

  // 读取颜色的显示名：优先用户自定义 colorLabel，回退内置文案（与 SelectionMenu 一致）
  private getColorLabel(c: string): string {
    const settingsMap = this.settings as unknown as Record<string, unknown>;
    const key = `colorLabel${c}`;
    return typeof settingsMap[key] === "string" ? settingsMap[key] : t().colorLabel(c);
  }

  // 快捷键命令：用指定颜色立即标注当前选区（无批注、无注音）
  private async annotateSelectionWithColor(color: AnnotationColor): Promise<void> {
    const notePath = this.getActiveAnnotationNotePath();
    if (!notePath) return;
    const loc = t();
    const onAdd = () => { void this.refreshAnnotationView(notePath); };

    // 路径 A：弹窗已开且属于当前笔记（重新划选都会经 mouseup 刷新 show，字段与选区同步）。
    // 直接复用菜单状态——阅读模式下 textarea 聚焦后 DOM 选区已失效，菜单字段是唯一可靠来源
    if (this.selectionMenu.isOpened() && this.selectionMenu.getCurrentNotePath() === notePath) {
      await this.selectionMenu.annotateWithColor(color);
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    // 路径 B：源码/实时预览模式且弹窗未开：用 CM 编辑器选区（state.selection 失焦后仍保留，
    // 不依赖 DOM Selection）。编辑器替换路径不需要 context/行号/occurrence。
    // 单行限制：此场景拿不到 blockSegments（sectionLineMap 仅由 preview 后处理器填充），
    // 跨空行的 mark 标签会破坏渲染结构；跨段场景由路径 A 的鼠标划选覆盖
    if (view?.getMode?.() === "source" && view.editor) {
      const text = view.editor.getSelection();
      if (!text) {
        new Notice(loc.noticeNoSelection);
        return;
      }
      const from = view.editor.getCursor("from");
      const to = view.editor.getCursor("to");
      if (from.line !== to.line) {
        new Notice(loc.noticeMultiLineSelection);
        return;
      }
      await this.selectionMenu.annotateDirectly({
        notePath,
        selectedText: text,
        color,
        editorRange: { from, to },
        onAdd,
      });
      return;
    }

    // 路径 C：阅读模式且弹窗未开：走与 mouseup 相同的 DOM 选区解析
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      new Notice(loc.noticeNoSelection);
      return;
    }
    const info = this.collectSelectionParams(selection);
    if (!info) {
      new Notice(loc.noticeNoSelection);
      return;
    }
    await this.selectionMenu.annotateDirectly({ ...info, notePath, color, onAdd });
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
      onUpdate: () => { void this.refreshAnnotationView(notePath); },
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
        if (v instanceof MarkdownView && v.file?.path === annotationPath) {
          leaves.push(leaf);
        }
      });

      if (leaves.length === 0) return;

      const content = await this.fileManager.readAnnotationFile(notePath);

      // 刷新所有显示该标注文件的 leaf
      for (const leaf of leaves) {
        const view = leaf.view as MarkdownView;

        if (view.getMode() === "preview") {
          const renderer = (view.previewMode as unknown as { renderer?: { set?: (c: string) => void } }).renderer;
          if (renderer && typeof renderer.set === "function") {
            renderer.set(content);
          }
        } else {
          // 编辑模式：通过 CM6 dispatch 更新编辑器内容（cm 为 Obsidian 非公开属性）
          const editorView = (view.editor as unknown as { cm: EditorView }).cm;
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

            window.requestAnimationFrame(() => {
              editorView.scrollDOM.scrollTop = scrollTop;
            });
          }
        }

        // 同步更新 MarkdownView 内部数据
        (view as unknown as { data: string }).data = content;

        // 刷新该 leaf 的面板
        void this.annotationPanels.get(leaf)?.refresh();
      }


      // 通知侧边栏刷新
      this.notifyAnnotationChange();
    } catch (e) {
      console.error("刷新标注视图失败:", notePath, e);
    }
  }

  // ========== 侧边栏 ==========

  notifyAnnotationChange(): void {
    if (this.notifyDebounceTimer) window.clearTimeout(this.notifyDebounceTimer);
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
        await workspace.revealLeaf(rightLeaf);
      }
    }
  }

  // ========== 图片嵌入修正 ==========

  // 标注文件通过 fakeTFile 注入，其 path 指向插件目录，导致 Obsidian 以该目录为基准
  // 解析相对图片路径。只有含 ".."（相对上跳）的路径才会强制走"相对当前文件目录"解析，
  // 因基准错误而失败；纯文件名/子目录/wikilink 等有兜底不受影响。
  // 这里在渲染后改用原笔记路径重新解析受影响的图片嵌入，注入正确的 <img>。
  private registerImageEmbedFixer() {
    const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/obsidian-annotation-marker`;
    const prefix = `${pluginDir}/annotations/`;

    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!ctx.sourcePath.startsWith(prefix)) return;
      const originalPath = annotationPathToNotePath(pluginDir, ctx.sourcePath);

      const embeds = el.querySelectorAll<HTMLElement>(".internal-embed");
      for (const embed of Array.from(embeds)) {
        if (embed.dataset.imageFixed === "1") continue;

        const rawSrc = embed.getAttribute("src");
        if (!rawSrc) continue;
        // 跳过外部链接
        if (/^(https?:|data:|app:|obsidian:|capacitor:)/i.test(rawSrc)) continue;
        // 只处理含 ".."（相对上跳）的路径——纯文件名/子目录/wikilink 有兜底不受影响
        if (!/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawSrc)) continue;

        // 用原笔记路径作基准重新解析，得到 vault 根相对路径
        const target = this.app.metadataCache.getFirstLinkpathDest(rawSrc, originalPath);
        if (!(target instanceof TFile)) continue;

        // post-processor 跑在 Obsidian embed 解析之前（此时 internal-embed 尚未填充），
        // 把 src 改写成 vault 根相对路径，Obsidian 后续用正确路径解析填充
        embed.setAttribute("src", target.path);
        embed.dataset.imageFixed = "1";
      }
    });
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

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file?.path === file.path) {
          await this.openAnnotationView(this.app.workspace.getLeaf(false), file.path);
        }
      })
    );

    // 原文件被外部修改时（分屏直接编辑原文件、同步盘更新等），把变更经 diffSync
    // 合并进对应的标注文件——否则会话关闭回写时会用旧内容覆盖外部修改。
    // 按文件防抖，避免连续保存期间反复全量 diff；合并后刷新展示中的标注视图
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const notePath = file.path;
        if (!this.activeAnnotationSessions.has(notePath)) return;

        const timer = this.externalSyncTimers.get(notePath);
        if (timer) window.clearTimeout(timer);
        this.externalSyncTimers.set(notePath, window.setTimeout(() => {
          this.externalSyncTimers.delete(notePath);
          void this.fileManager.syncFromOriginal(notePath)
            .then(() => this.refreshAnnotationView(notePath))
            .catch((e) => console.error("合并原文件外部修改失败:", e));
        }, 1500));
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
            await this.saveSettings();

            // 注入新元数据缓存
            this.injectMetadataCache(newAnnotationPath, file.path, newFakeTFile);

            // 更新打开的 leaf
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (getViewFilePath(leaf.view) === annotationPath) {
                void leaf.openFile(newFakeTFile, { state: { mode: this.settings.defaultViewMode } });
                this.updateAnnotationTabTitle(leaf, file.path);
              }
            });

            // 迁移同步定时器
            const timer = this.syncToOriginalTimers.get(oldPath);
            if (timer !== undefined) {
              window.clearTimeout(timer);
              this.syncToOriginalTimers.delete(oldPath);
              this.debouncedSyncToOriginal(file.path);
            }

            // 迁移面板：更新所有关联 leaf 的面板 notePath
            for (const [leaf, panel] of this.annotationPanels) {
              const leafAnnotationPath = getViewFilePath(leaf.view);
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
              window.clearTimeout(timer);
              this.syncToOriginalTimers.delete(file.path);
            }

            // 清理假文件和元数据
            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);
            this.activeAnnotationSessions.delete(file.path);
            await this.saveSettings();
            // 清理所有显示该标注文件的 leaf 的面板
            for (const [leaf, panel] of this.annotationPanels) {
              const leafFilePath = getViewFilePath(leaf.view);
              if (leafFilePath === annotationPath) {
                panel.hide();
                this.annotationPanels.delete(leaf);
              }
            }
            this.selectionMenu.hide();
            this.annotationMenu.hide();

            // 关闭显示该标注文件的 leaf
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (getViewFilePath(leaf.view) === annotationPath) {
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
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file || file.extension !== "md") return false;

        if (!checking) {
          void this.toggleAnnotationView();
        }
        return true;
      },
    });

    this.addCommand({
      id: "toggle-annotation-sidebar",
      name: t().commandSidebar,
      callback: () => { void this.toggleSidebarView(); },
    });

    this.addCommand({
      id: "import-old-annotations",
      name: t().commandImport,
      callback: async () => {
        const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/obsidian-annotation-marker`;
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
          void this.exportCurrentAnnotations(activeFile.path);
        }
        return true;
      },
    });

    // 每种激活颜色一个"立即标注选区"命令（供绑定快捷键快速高亮）
    this.refreshAnnotateColorCommands();
  }

  // 每种激活颜色一个"立即标注选区"命令（供绑定快捷键）。
  // 颜色增删后由设置页调用本方法同步命令列表，无需重载插件
  refreshAnnotateColorCommands() {
    // 先移除全部颜色命令（含已停用色），再按当前激活色重新注册。
    // app.commands 为非公开 API，双重断言访问
    const commands = (this.app as unknown as { commands?: { removeCommand?: (id: string) => void } }).commands;
    for (const n of COLOR_NUMBERS) {
      commands?.removeCommand?.(`${this.manifest.id}:annotate-color-${n}`);
    }
    for (const c of getActiveColorNumbers(this.settings)) {
      this.addCommand({
        id: `annotate-color-${c}`,
        name: t().commandAnnotateColor(this.getColorLabel(c)),
        checkCallback: (checking) => {
          // 仅标注模式可用；选区有无在执行期用 Notice 反馈
          if (!this.getActiveAnnotationNotePath()) return false;
          if (!checking) void this.annotateSelectionWithColor(c as AnnotationColor);
          return true;
        },
      });
    }
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
