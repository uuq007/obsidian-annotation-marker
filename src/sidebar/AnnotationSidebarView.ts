import { ItemView, MarkdownView, Notice, normalizePath, TFile } from "obsidian";
import type { AnnotationColor, AnnotationRuby, ParsedAnnotation } from "../types";
import { ALL_COLORS, COLOR_CLASSES } from "../constants";
import { annotationPathToNotePath } from "../utils/helpers";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { editAnnotationInEditor } from "../utils/annotationEditorHelper";
import { scanAnnotationTags } from "../view/annotationTagParser";
import { createAnnotationCard, type AnnotationCardData } from "./AnnotationCard";
import type AnnotationPlugin from "../main";

export const ANNOTATION_SIDEBAR_VIEW_TYPE = "annotation-sidebar-view";

type SidebarMode = "current" | "all";
type SortOption = "position-asc" | "position-desc" | "time-asc" | "time-desc" | "color-asc" | "color-desc";

export class AnnotationSidebarView extends ItemView {
  private plugin: AnnotationPlugin;
  private fileManager: AnnotationFileManager;

  // 状态
  private mode: SidebarMode = "current";
  private searchQuery = "";
  private colorFilter: AnnotationColor | "all" = "all";
  private sortOption: SortOption = "position-asc";

  // DOM 引用
  private cardListEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private tabs: Record<SidebarMode, HTMLElement> = { current: null!, all: null! };
  private colorBtns: Map<string, HTMLElement> = new Map();

  // 详情面板状态
  private detailCardData: AnnotationCardData | null = null;
  private detailIsEditing = false;
  // 编辑态暂存
  private editColor: AnnotationColor = "1";
  private editNote = "";
  private editRubyTexts: AnnotationRuby[] = [];

  // 全部笔记模式缓存
  private allAnnotationsCache: AnnotationCardData[] | null = null;

  // 防抖定时器
  private searchDebounceTimer: number | null = null;

  constructor(leaf: any, plugin: AnnotationPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.fileManager = plugin.fileManager;
  }

  getViewType(): string {
    return ANNOTATION_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "标注管理";
  }

  getIcon(): string {
    return "lucide-bookmark";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("annotation-sidebar");

    this.renderToolbar(container);
    this.renderTabs(container);
    this.renderSearchBar(container);

    this.cardListEl = container.createDiv({ cls: "annotation-sidebar-card-list" });

    // 注册事件
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.mode === "current" && !this.detailCardData) {
          this.refresh();
        }
      })
    );

    // 注册刷新回调
    this.plugin.annotationChangeCallbacks.push(() => {
      if (this.detailCardData) {
        // 详情面板打开中，关闭后刷新
        this.closeDetailPanel();
      }
      this.refresh();
    });

    // 初始加载
    await this.refresh();
  }

  async onClose(): Promise<void> {
    // 移除刷新回调
    const cb = () => {
      if (this.detailCardData) this.closeDetailPanel();
      this.refresh();
    };
    const idx = this.plugin.annotationChangeCallbacks.indexOf(cb);
    if (idx >= 0) {
      this.plugin.annotationChangeCallbacks.splice(idx, 1);
    }
    this.allAnnotationsCache = null;
    this.detailCardData = null;
  }

  // ========== 渲染方法 ==========

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: "annotation-sidebar-toolbar" });
    toolbar.createSpan({ cls: "annotation-sidebar-title", text: "标注管理" });

    const sortSelect = toolbar.createEl("select", { cls: "annotation-sidebar-sort-select" });
    sortSelect.innerHTML = `
      <option value="position-asc">按内容顺序</option>
      <option value="position-desc">按内容倒序</option>
      <option value="time-asc">按时间正序</option>
      <option value="time-desc">按时间倒序</option>
      <option value="color-asc">按颜色排序</option>
      <option value="color-desc">按颜色倒序</option>
    `;
    sortSelect.addEventListener("change", () => {
      this.sortOption = sortSelect.value as SortOption;
      this.renderCards();
    });
  }

  private renderTabs(container: HTMLElement): void {
    const tabsEl = container.createDiv({ cls: "annotation-sidebar-tabs" });

    this.tabs.current = tabsEl.createEl("button", {
      cls: "annotation-sidebar-tab active",
      text: "当前笔记",
    });
    this.tabs.all = tabsEl.createEl("button", {
      cls: "annotation-sidebar-tab",
      text: "全部笔记",
    });

    this.tabs.current.addEventListener("click", () => this.switchMode("current"));
    this.tabs.all.addEventListener("click", () => this.switchMode("all"));
  }

  private switchMode(newMode: SidebarMode): void {
    if (this.mode === newMode) return;
    this.mode = newMode;
    this.tabs.current.toggleClass("active", newMode === "current");
    this.tabs.all.toggleClass("active", newMode === "all");
    this.closeDetailPanel();
    this.refresh();
  }

  private renderSearchBar(container: HTMLElement): void {
    const searchBar = container.createDiv({ cls: "annotation-sidebar-search" });

    this.searchInput = searchBar.createEl("input", {
      type: "text",
      cls: "annotation-sidebar-search-input",
      placeholder: "搜索标注文本、批注或笔记名...",
    });
    this.searchInput.addEventListener("input", () => {
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = window.setTimeout(() => {
        this.searchQuery = this.searchInput?.value ?? "";
        this.renderCards();
      }, 300);
    });

    // 颜色筛选按钮
    const colorFilters = searchBar.createDiv({ cls: "annotation-sidebar-color-filters" });

    const allBtn = colorFilters.createEl("button", {
      cls: "annotation-sidebar-color-btn annotation-sidebar-color-all active",
      text: "全部",
    });
    allBtn.addEventListener("click", () => {
      this.colorFilter = "all";
      this.updateColorBtnState();
      this.renderCards();
    });
    this.colorBtns.set("all", allBtn);

    for (const color of ALL_COLORS) {
      const btn = colorFilters.createEl("button", {
        cls: `annotation-sidebar-color-btn annotation-list-dot ${COLOR_CLASSES[color]}`,
      });
      btn.addEventListener("click", () => {
        this.colorFilter = color;
        this.updateColorBtnState();
        this.renderCards();
      });
      this.colorBtns.set(color, btn);
    }
  }

  private updateColorBtnState(): void {
    for (const [key, btn] of this.colorBtns) {
      btn.toggleClass("active", key === this.colorFilter);
    }
  }

  // ========== 数据加载 ==========

  async refresh(): Promise<void> {
    this.allAnnotationsCache = null;
    await this.renderCards();
  }

  private async renderCards(): Promise<void> {
    if (!this.cardListEl) return;
    this.cardListEl.empty();
    this.detailCardData = null;

    let cards: AnnotationCardData[];

    try {
      if (this.mode === "current") {
        cards = await this.loadCurrentFileAnnotations();
      } else {
        cards = await this.loadAllAnnotations();
      }
    } catch {
      this.renderEmpty(this.cardListEl, "加载失败");
      return;
    }

    const filtered = this.applyFilters(cards);
    const sorted = this.applySort(filtered);

    if (sorted.length === 0) {
      this.renderEmpty(
        this.cardListEl,
        this.searchQuery || this.colorFilter !== "all"
          ? "没有匹配的标注"
          : "暂无标注"
      );
      return;
    }

    for (const cardData of sorted) {
      createAnnotationCard(this.cardListEl, cardData, {
        onClick: (data) => this.showDetailPanel(data),
        onOpen: (data) => this.handleCardOpen(data),
        onDelete: (data) => this.handleCardDelete(data),
      });
    }
  }

  private async loadCurrentFileAnnotations(): Promise<AnnotationCardData[]> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      // 没有活跃文件，尝试通过标注会话获取
      const notePath = this.plugin.getActiveAnnotationNotePath();
      if (notePath) return this.loadAnnotationsForNote(notePath);
      return [];
    }

    if (activeFile.extension !== "md") return [];

    // 检查当前文件是否是标注文件（fakeTFile）
    const originalPath = this.plugin.getOriginalPathByAnnotationPath(activeFile.path);
    const notePath = originalPath ?? activeFile.path;

    return this.loadAnnotationsForNote(notePath);
  }

  private async loadAnnotationsForNote(notePath: string): Promise<AnnotationCardData[]> {
    const hasFile = await this.fileManager.hasAnnotationFile(notePath);
    if (!hasFile) return [];
    const annotations = await this.fileManager.getAnnotations(notePath);
    const fileName = notePath.split("/").pop() ?? notePath;
    return annotations.map((a) => ({ annotation: a, notePath, fileName }));
  }

  private async loadAllAnnotations(): Promise<AnnotationCardData[]> {
    if (this.allAnnotationsCache) return this.allAnnotationsCache;

    const pluginDir = this.plugin.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
    const annotationsDir = normalizePath(`${pluginDir}/annotations`);

    const exists = await this.app.vault.adapter.exists(annotationsDir);
    if (!exists) {
      this.allAnnotationsCache = [];
      return [];
    }

    const listed = await this.app.vault.adapter.list(annotationsDir);
    const results: AnnotationCardData[] = [];

    for (const filePath of listed.files) {
      if (!filePath.endsWith(".md")) continue;
      try {
        const notePath = annotationPathToNotePath(pluginDir, filePath);
        const originalFile = this.app.vault.getAbstractFileByPath(notePath);
        if (!(originalFile instanceof TFile)) continue;
        const annotations = await this.fileManager.getAnnotations(notePath);
        const fileName = originalFile.name;
        for (const annotation of annotations) {
          results.push({ annotation, notePath, fileName });
        }
      } catch {
        // 跳过
      }
    }

    this.allAnnotationsCache = results;
    return results;
  }

  // ========== 筛选与排序 ==========

  private applyFilters(cards: AnnotationCardData[]): AnnotationCardData[] {
    let result = cards;
    if (this.colorFilter !== "all") {
      result = result.filter((c) => c.annotation.color === this.colorFilter);
    }
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter((c) => {
        const text = c.annotation.text.toLowerCase();
        const note = c.annotation.note?.toLowerCase() ?? "";
        const fileName = c.fileName.toLowerCase();
        return text.includes(query) || note.includes(query) || fileName.includes(query);
      });
    }
    return result;
  }

  private applySort(cards: AnnotationCardData[]): AnnotationCardData[] {
    const sorted = [...cards];
    switch (this.sortOption) {
      case "position-asc":
        sorted.sort((a, b) => a.annotation.positions[0]!.start - b.annotation.positions[0]!.start);
        break;
      case "position-desc":
        sorted.sort((a, b) => b.annotation.positions[0]!.start - a.annotation.positions[0]!.start);
        break;
      case "time-asc":
        sorted.sort((a, b) => parseInt(a.annotation.id) - parseInt(b.annotation.id));
        break;
      case "time-desc":
        sorted.sort((a, b) => parseInt(b.annotation.id) - parseInt(a.annotation.id));
        break;
      case "color-asc":
        sorted.sort((a, b) => a.annotation.color.localeCompare(b.annotation.color));
        break;
      case "color-desc":
        sorted.sort((a, b) => b.annotation.color.localeCompare(a.annotation.color));
        break;
    }
    return sorted;
  }

  private renderEmpty(container: HTMLElement, message: string): void {
    container.createDiv({ cls: "annotation-sidebar-empty", text: message });
  }

  // ========== 详情面板 ==========

  private showDetailPanel(cardData: AnnotationCardData): void {
    if (!this.cardListEl) return;
    this.detailCardData = cardData;
    this.detailIsEditing = false;
    this.editColor = cardData.annotation.color;
    this.editNote = cardData.annotation.note;
    this.editRubyTexts = [...cardData.annotation.rubyTexts];

    this.cardListEl.empty();
    this.renderDetailContent();
  }

  private closeDetailPanel(): void {
    this.detailCardData = null;
    this.detailIsEditing = false;
    this.renderCards();
  }

  private renderDetailContent(): void {
    if (!this.cardListEl || !this.detailCardData) return;
    this.cardListEl.empty();

    const { annotation, notePath } = this.detailCardData;

    const panel = this.cardListEl.createDiv({ cls: "annotation-sidebar-detail" });

    // 头部
    const header = panel.createDiv({ cls: "annotation-sidebar-detail-header" });
    header.createSpan({ cls: "annotation-sidebar-detail-title", text: "标注详情" });
    const closeBtn = header.createEl("button", {
      cls: "annotation-sidebar-detail-close",
      text: "×",
    });
    closeBtn.addEventListener("click", () => this.closeDetailPanel());

    // 标注文字（只读）
    const textSection = panel.createDiv({ cls: "annotation-sidebar-detail-section" });
    textSection.createEl("label", { text: "标注文字" });
    textSection.createDiv({ cls: "annotation-sidebar-detail-text", text: annotation.text });

    // 全文/跨段标记
    if (annotation.isFullText && annotation.positions.length > 1) {
      textSection.createDiv({
        cls: "annotation-list-badge",
        text: `全文标注（共 ${annotation.positions.length} 处）`,
      });
    } else if (annotation.isCrossBlock) {
      textSection.createDiv({
        cls: "annotation-list-badge",
        text: `跨段标注（共 ${annotation.positions.length} 处）`,
      });
    }

    // 标注颜色
    const colorSection = panel.createDiv({ cls: "annotation-sidebar-detail-section" });
    colorSection.createEl("label", { text: "标注颜色" });

    if (this.detailIsEditing) {
      const colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });
      for (const c of ALL_COLORS) {
        const btn = colorContainer.createEl("button", {
          cls: `annotation-color-dot ${COLOR_CLASSES[c]}`,
        });
        if (c === this.editColor) btn.addClass("active");
        btn.addEventListener("click", () => {
          this.editColor = c;
          colorContainer.querySelectorAll(".annotation-color-dot")
            .forEach((b) => b.removeClass("active"));
          btn.addClass("active");
        });
      }
    } else {
      colorSection.createDiv({ cls: "annotation-sidebar-detail-color" }).createSpan({
        cls: `annotation-list-dot ${COLOR_CLASSES[annotation.color]}`,
      });
    }

    // 批注内容
    const noteSection = panel.createDiv({ cls: "annotation-sidebar-detail-section" });
    noteSection.createEl("label", { text: "批注内容" });

    if (this.detailIsEditing) {
      const noteInput = noteSection.createEl("textarea", {
        cls: "annotation-sidebar-detail-textarea",
      });
      noteInput.setAttribute("maxlength", "400");
      noteInput.setAttribute("rows", "3");
      noteInput.setAttribute("placeholder", "请输入批注内容...");
      noteInput.value = this.editNote;

      const charCount = noteSection.createDiv({
        cls: "annotation-char-count",
        text: `${this.editNote.length}/400`,
      });
      noteInput.addEventListener("input", () => {
        this.editNote = noteInput.value;
        charCount.textContent = `${noteInput.value.length}/400`;
        charCount.toggleClass("annotation-char-count-error", noteInput.value.length > 400);
      });
    } else {
      noteSection.createDiv({
        cls: "annotation-sidebar-detail-note",
        text: annotation.note || "（无批注）",
      });
    }

    // 注音
    if (annotation.rubyTexts.length > 0 || this.detailIsEditing) {
      const rubySection = panel.createDiv({ cls: "annotation-sidebar-detail-section" });
      rubySection.createEl("label", { text: "注音" });

      if (this.detailIsEditing) {
        const rubyList = rubySection.createDiv({ cls: "annotation-sidebar-detail-ruby-list" });
        const updateRubyList = () => {
          rubyList.empty();
          if (this.editRubyTexts.length === 0) {
            rubyList.createDiv({ text: "暂无注音", cls: "annotation-ruby-empty" });
          } else {
            for (let i = 0; i < this.editRubyTexts.length; i++) {
              const ruby = this.editRubyTexts[i]!;
              const item = rubyList.createDiv({ cls: "annotation-ruby-item" });
              item.createSpan({
                cls: "annotation-ruby-item-text",
                text: `${annotation.text.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
              });
              const delBtn = item.createEl("button", {
                text: "×",
                cls: "annotation-ruby-item-delete",
              });
              delBtn.addEventListener("click", () => {
                this.editRubyTexts.splice(i, 1);
                updateRubyList();
              });
            }
          }
        };
        updateRubyList();
      } else {
        const rubyList = rubySection.createDiv({ cls: "annotation-sidebar-detail-ruby-list" });
        for (const ruby of annotation.rubyTexts) {
          rubyList.createDiv({
            cls: "annotation-ruby-item",
            text: `${annotation.text.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
          });
        }
      }
    }

    // 操作按钮
    const actions = panel.createDiv({ cls: "annotation-sidebar-detail-actions" });

    if (this.detailIsEditing) {
      const saveBtn = actions.createEl("button", {
        text: "保存",
        cls: "annotation-btn annotation-btn-primary",
      });
      saveBtn.addEventListener("click", () => this.handleDetailSave());

      const cancelBtn = actions.createEl("button", {
        text: "取消",
        cls: "annotation-btn annotation-btn-secondary",
      });
      cancelBtn.addEventListener("click", () => {
        this.detailIsEditing = false;
        this.editColor = annotation.color;
        this.editNote = annotation.note;
        this.editRubyTexts = [...annotation.rubyTexts];
        this.renderDetailContent();
      });
    } else {
      const editBtn = actions.createEl("button", {
        text: "编辑",
        cls: "annotation-btn annotation-btn-secondary",
      });
      editBtn.addEventListener("click", () => {
        this.detailIsEditing = true;
        this.renderDetailContent();
      });

      const openBtn = actions.createEl("button", {
        text: "打开",
        cls: "annotation-btn annotation-btn-secondary",
      });
      openBtn.addEventListener("click", () => {
        if (this.detailCardData) this.handleCardOpen(this.detailCardData);
      });

      const deleteBtn = actions.createEl("button", {
        text: "删除",
        cls: "annotation-btn annotation-btn-danger",
      });
      deleteBtn.addEventListener("click", () => {
        if (this.detailCardData) this.handleCardDelete(this.detailCardData);
      });
    }
  }

  // ========== 保存编辑 ==========

  private async handleDetailSave(): Promise<void> {
    if (!this.detailCardData) return;
    const { annotation, notePath } = this.detailCardData;

    // 查找标注视图
    const view = this.findAnnotationView(notePath);
    let edited = false;

    if (view && view.getMode() === "source") {
      edited = await editAnnotationInEditor(view, this.fileManager, notePath, annotation.id, {
        color: this.editColor,
        note: this.editNote,
        rubyTexts: this.editRubyTexts.length > 0 ? this.editRubyTexts : undefined,
        isFullText: annotation.isFullText,
        isCrossBlock: annotation.isCrossBlock,
      });
    }

    if (!edited) {
      await this.fileManager.updateAnnotation(notePath, annotation.id, {
        color: this.editColor,
        note: this.editNote,
        rubyTexts: this.editRubyTexts.length > 0 ? this.editRubyTexts : undefined,
      });
    }

    // 刷新标注视图
    this.plugin.refreshAnnotationView(notePath);
    this.closeDetailPanel();
    new Notice("标注已更新");
  }

  // ========== 查找标注视图 ==========

  private findAnnotationView(notePath: string): MarkdownView | null {
    const annotationPath = this.plugin.activeAnnotationSessions.get(notePath);
    if (!annotationPath) return null;

    let result: MarkdownView | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && (view as any)?.file?.path === annotationPath) {
        result = view;
      }
    });
    return result;
  }

  // ========== 卡片操作 ==========

  private async handleCardOpen(cardData: AnnotationCardData): Promise<void> {
    const { notePath, annotation } = cardData;

    // 检查目标笔记是否已在标注视图中
    const annotationPath = this.plugin.activeAnnotationSessions.get(notePath);
    let targetLeaf: any = null;

    if (annotationPath) {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if ((leaf.view as any)?.file?.path === annotationPath) {
          targetLeaf = leaf;
        }
      });
    }

    if (!targetLeaf) {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!(file instanceof TFile)) {
        new Notice("找不到对应笔记文件");
        return;
      }
      targetLeaf = this.app.workspace.getLeaf(false);
      await targetLeaf.openFile(file);
      await this.plugin.openAnnotationView(targetLeaf, notePath);
    }

    this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    await this.scrollToAnnotationInLeaf(targetLeaf, annotation);
  }

  private async scrollToAnnotationInLeaf(leaf: any, annotation: ParsedAnnotation): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400));

    const view = leaf.view as MarkdownView;
    if (!view) return;

    const viewNotePath = this.getNotePathForView(view);
    if (!viewNotePath) return;

    const ap = this.plugin.activeAnnotationSessions.get(viewNotePath);
    const notePath = ap ? this.plugin.getOriginalPathByAnnotationPath(ap) ?? viewNotePath : viewNotePath;

    // 编辑模式
    if (view.getMode() === "source") {
      const doc = view.editor.getValue();
      const blocks = scanAnnotationTags(doc, 0, doc);
      const target = blocks.find((b) => b.id === annotation.id);
      if (!target) {
        new Notice("未能定位到标注");
        return;
      }
      const pos = view.editor.offsetToPos(target.markOpenFrom);
      view.editor.setCursor(pos);
      view.editor.scrollIntoView({ from: pos, to: pos }, true);

      await new Promise((resolve) => setTimeout(resolve, 300));
      this.highlightAnnotationInContainer(view.containerEl, annotation.id);
      return;
    }

    // 阅读模式
    try {
      const content = await this.fileManager.readAnnotationFile(notePath);
      const lineIndex = content.substring(0, annotation.positions[0]!.start).split("\n").length - 1;
      const previewMode = view.previewMode as any;
      if (previewMode?.renderer?.applyScroll) {
        previewMode.renderer.applyScroll(lineIndex, { center: true });
      }
    } catch {
      // 忽略
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    const containerEl = view.previewMode?.containerEl;
    this.highlightAnnotationInContainer(containerEl ?? view.containerEl, annotation.id);
  }

  private getNotePathForView(view: MarkdownView): string | null {
    const filePath = (view as any)?.file?.path;
    if (!filePath) return null;
    return this.plugin.getOriginalPathByAnnotationPath(filePath) ?? filePath;
  }

  private highlightAnnotationInContainer(containerEl: HTMLElement, annotationId: string): void {
    const els = containerEl.querySelectorAll(
      `mark[data-annotation-id="${annotationId}"]`
    );
    if (els && els.length > 0) {
      for (const el of Array.from(els) as HTMLElement[]) {
        el.style.transition = "box-shadow 0.3s ease";
        el.style.boxShadow = "0 0 0 3px var(--interactive-accent)";
      }
      setTimeout(() => {
        for (const el of Array.from(els) as HTMLElement[]) {
          el.style.boxShadow = "";
        }
      }, 2000);
    }
  }

  private async handleCardDelete(cardData: AnnotationCardData): Promise<void> {
    const { annotation, notePath } = cardData;

    // 确认删除
    const msg = (annotation.isFullText || annotation.positions.length > 1) && annotation.positions.length > 1
      ? `确定删除全部 ${annotation.positions.length} 处标注？`
      : "确定删除此标注？";
    if (!confirm(msg)) return;

    // 查找标注视图，尝试 replaceRange
    const view = this.findAnnotationView(notePath);
    const deleted = view && view.getMode() === "source"
      ? await editAnnotationInEditor(view, this.fileManager, notePath, annotation.id, "delete")
      : false;

    if (!deleted) {
      await this.fileManager.removeAnnotation(notePath, annotation.id);
    }

    // 刷新标注视图
    this.plugin.refreshAnnotationView(notePath);
    this.closeDetailPanel();
    new Notice("标注已删除");
  }
}
