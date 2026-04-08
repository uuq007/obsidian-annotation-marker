import { App, Modal, Notice, setIcon } from "obsidian";
import { Annotation, AnnotationColor, Marker } from "./types";
import { DataManager } from "./dataManager";
import { AnnotationMode } from "./annotationMode";
import { buildExistingMarkerSelection } from "./markerSelection";
import { renderNoteEditor, renderRubyEditor } from "./annotationEditorSections";
import { AnnotationToolbarView, renderAnnotationToolbar } from "./annotationToolbar";
import { renderMarkerButtons } from "./markerButtons";

export class AnnotationMenu {
  private app: App;
  private dataManager: DataManager;
  private menuEl: HTMLElement | null = null;
  private annotationMode?: AnnotationMode;
  private anchorEl: HTMLElement | null = null;
  private markerScrollContainer: HTMLElement | null = null;
  private anchorPointX: number | null = null;
  private anchorPointY: number | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private toolbarView: AnnotationToolbarView | null = null;

  constructor(app: App, dataManager: DataManager, annotationMode?: AnnotationMode) {
    this.app = app;
    this.dataManager = dataManager;
    this.annotationMode = annotationMode;
  }

  show(x: number, y: number, annotation: Annotation, annotationId: string, filePath: string, onUpdate: () => void, annotationMode?: AnnotationMode): void {
    this.hide();
    this.anchorPointX = x;
    this.anchorPointY = y;

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-selection-menu annotation-view-menu";

    this.toolbarView = renderAnnotationToolbar(this.menuEl, { markerLayout: "single-row-scroll" });
    this.anchorEl = this.toolbarView.anchorEl;
    this.markerScrollContainer = this.toolbarView.markerGroupEl;
    const colorContainer = this.toolbarView.markerGroupEl.createDiv({ cls: "annotation-color-buttons annotation-toolbar-marker-row" });
    const markerSelection = buildExistingMarkerSelection(this.dataManager.getMarkerManager().getMarkers(), annotation.markerId);
    renderMarkerButtons({
      container: colorContainer,
      selection: markerSelection,
      onMarkerClick: async (markerId) => {
        if (markerId === annotation.markerId) return;
        const marker = this.dataManager.getMarkerManager().getMarkerById(markerId);
        if (!marker) return;
        await this.updateMarker(annotation, annotationId, filePath, marker, onUpdate, annotationMode);
      },
    });
    const actionGroup = this.toolbarView.actionGroupEl;
    const editBtn = actionGroup.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action",
      attr: { type: "button", title: "编辑标注" },
    });
    setIcon(editBtn, "square-pen");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showEditModal(annotation, annotationId, filePath, onUpdate, annotationMode);
    });

    const deleteBtn = actionGroup.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action",
      attr: { type: "button", title: "删除标注" },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.dataManager.deleteAnnotation(filePath, annotation.id);
      this.hide();
      onUpdate();
      new Notice("标注已删除");
    });

    const closeBtn = actionGroup.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action annotation-toolbar-close",
      attr: { type: "button", title: "关闭" },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.hide());

    const detailPanel = this.toolbarView.panelStackEl.createDiv({ cls: "annotation-toolbar-panel annotation-view-panel" });
    const panelHeader = detailPanel.createDiv({ cls: "annotation-panel-header" });
    const title = panelHeader.createDiv({ cls: "annotation-panel-title" });
    const titleIcon = title.createSpan({ cls: "annotation-panel-title-icon" });
    setIcon(titleIcon, "highlighter");
    title.createSpan({ text: "标注预览", cls: "annotation-panel-title-text" });

    const textPreview = detailPanel.createDiv({ cls: "annotation-menu-text annotation-toolbar-preview" });
    const textHeader = textPreview.createDiv({ cls: "annotation-panel-field-label-row" });
    textHeader.createEl("label", { text: "原文" });
    const copyTextBtn = textHeader.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action annotation-inline-copy-btn",
      attr: { type: "button", title: "复制原文" },
    });
    setIcon(copyTextBtn, "copy");
    copyTextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(annotation.text);
      this.hide();
      new Notice("已复制原文到剪贴板");
    });
    const previewText = annotation.text.length > 80 ? annotation.text.substring(0, 80) + "..." : annotation.text;
    textPreview.createEl("span", { text: `"${previewText}"` });

    if (annotation.note) {
      const noteSection = detailPanel.createDiv({ cls: "annotation-menu-note annotation-toolbar-panel-field" });
      const noteHeader = noteSection.createDiv({ cls: "annotation-panel-field-label-row" });
      noteHeader.createEl("label", { text: "批注" });
      const copyNoteBtn = noteHeader.createEl("button", {
        cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action annotation-inline-copy-btn",
        attr: { type: "button", title: "复制批注" },
      });
      setIcon(copyNoteBtn, "copy");
      copyNoteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(annotation.note);
        this.hide();
        new Notice("已复制批注到剪贴板");
      });
      noteSection.createEl("div", { cls: "annotation-note-text", text: annotation.note });
    }

    if (markerSelection.options.some((option) => option.marker.id === annotation.markerId && option.disabled)) {
      detailPanel.createDiv({
        cls: "annotation-marker-settings-status",
        text: "当前记号已删除，仅保留历史显示；切换后无法再选回，除非先恢复。",
      });
    }

    document.body.appendChild(this.menuEl);
    requestAnimationFrame(() => {
      this.positionMenu();
      this.bindOutsideClick();
    });
  }

  private async updateMarker(annotation: Annotation, annotationId: string, filePath: string, marker: Marker, onUpdate: () => void, annotationMode?: AnnotationMode): Promise<void> {
    await this.dataManager.updateAnnotation(filePath, annotation.id, {
      color: this.dataManager.getMarkerManager().getLegacyColorForMarker(marker.id),
      markerId: marker.id,
      markerLabel: marker.name,
    });
    this.hide();

    if (annotationMode) {
      await annotationMode.reRenderAnnotation(annotationId);
    }

    new Notice("标注记号已修改");
  }

  private showEditModal(annotation: Annotation, annotationId: string, filePath: string, onUpdate: () => void, annotationMode?: AnnotationMode): void {
    this.hide();
    const modal = new EditNoteModal(this.app, this.dataManager, annotation, async (note, marker, rubyTexts) => {
      await this.dataManager.updateAnnotation(filePath, annotation.id, {
        note,
        color: this.dataManager.getMarkerManager().getLegacyColorForMarker(marker.id),
        markerId: marker.id,
        markerLabel: marker.name,
        rubyTexts,
      });

      if (annotationMode) {
        await annotationMode.reRenderAnnotation(annotationId);
      }

      new Notice("批注已更新");
    });
    modal.open();
  }

  hide(): void {
    if (this.outsideClickHandler) {
      document.removeEventListener("click", this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    this.anchorEl = null;
    this.markerScrollContainer = null;
    this.anchorPointX = null;
    this.anchorPointY = null;
    this.toolbarView = null;
  }

  private bindOutsideClick(): void {
    if (!this.menuEl) return;
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.menuEl || this.menuEl.contains(e.target as Node)) {
        return;
      }
      this.hide();
    };
    setTimeout(() => {
      if (this.outsideClickHandler) {
        document.addEventListener("click", this.outsideClickHandler);
      }
    }, 10);
  }

  private positionMenu(): void {
    if (!this.menuEl || this.anchorPointX === null || this.anchorPointY === null) return;
    this.toolbarView?.position(this.anchorPointX, this.anchorPointY);
  }
}

class EditNoteModal extends Modal {
  private dataManager: DataManager;
  private annotation: Annotation;
  private onSave: (note: string, marker: Marker, rubyTexts?: Array<{ startIndex: number; length: number; ruby: string }>) => void;
  private noteInput: HTMLTextAreaElement | null = null;
  private currentMarker: Marker;
  private rubyTexts: Array<{ startIndex: number; length: number; ruby: string }> = [];
  private rubyTextInput: HTMLInputElement | null = null;

  constructor(app: App, dataManager: DataManager, annotation: Annotation, onSave: (note: string, marker: Marker, rubyTexts?: Array<{ startIndex: number; length: number; ruby: string }>) => void) {
    super(app);
    this.dataManager = dataManager;
    this.annotation = annotation;
    this.onSave = onSave;
    this.currentMarker = this.dataManager.getMarkerManager().getMarkerById(annotation.markerId) ?? this.dataManager.getMarkerManager().getMarkers()[0]!;

    if (annotation.rubyText && !annotation.rubyTexts) {
      this.rubyTexts = [{
        startIndex: 0,
        length: annotation.text.length,
        ruby: annotation.rubyText
      }];
    } else {
      this.rubyTexts = annotation.rubyTexts || [];
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("annotation-note-modal", "annotation-edit-modal");

    const header = contentEl.createDiv({ cls: "annotation-panel-header annotation-edit-header" });
    const title = header.createDiv({ cls: "annotation-panel-title" });
    const titleIcon = title.createSpan({ cls: "annotation-panel-title-icon" });
    setIcon(titleIcon, "square-pen");
    title.createSpan({ cls: "annotation-panel-title-text", text: this.annotation.note ? "编辑批注" : "添加批注" });
    header.createSpan({ cls: "annotation-panel-meta", text: this.rubyTexts.length > 0 ? `${this.rubyTexts.length} 项注音` : "编辑模式" });

    const body = contentEl.createDiv({ cls: "annotation-edit-body" });

    const colorContainer = body.createDiv({ cls: "annotation-color-picker annotation-toolbar-panel-field" });
    colorContainer.createEl("label", { text: "记号" });

    const markerButtons = colorContainer.createDiv({ cls: "annotation-color-buttons annotation-toolbar-marker-row" });
    const markerSelection = buildExistingMarkerSelection(this.dataManager.getMarkerManager().getMarkers(), this.annotation.markerId);
    markerSelection.options.forEach((option) => {
      const { marker, disabled } = option;
      const btn = markerButtons.createEl("button", { cls: `annotation-color-dot marker-preset-${marker.preset}` });
      btn.style.setProperty("--marker-preview-color", marker.color);
      btn.setText("Aa");
      btn.title = disabled ? `${marker.name}（已删除）` : marker.name;
      if (marker.id === this.currentMarker.id) {
        btn.addClass("active");
      }
      btn.disabled = disabled;
      btn.addEventListener("click", () => {
        if (disabled) return;
        colorContainer.querySelectorAll(".annotation-color-dot").forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        this.currentMarker = marker;
      });
    });

    if (markerSelection.options.some((option) => option.marker.id === this.annotation.markerId && option.disabled)) {
      body.createDiv({
        cls: "annotation-marker-settings-status",
        text: "当前记号已删除，保存时请选择一个新的可用记号。",
      });
    }

    const noteContainer = body.createDiv({ cls: "annotation-note-container annotation-toolbar-panel-field" });
    const noteEditor = renderNoteEditor({
      container: noteContainer,
      selectedText: this.annotation.text,
      note: this.annotation.note,
      previewLabel: "原文",
      contentLabel: "批注内容",
      textareaClassName: "annotation-note-input",
    });
    this.noteInput = noteEditor.input;

    const rubySection = body.createDiv({ cls: "annotation-ruby-section annotation-toolbar-panel-field" });
    rubySection.createEl("label", { text: "注音编辑" });
    const rubyEditor = renderRubyEditor({
      container: rubySection,
      selectedText: this.annotation.text,
      rubyTexts: this.rubyTexts,
      onItemsChange: (items) => {
        this.rubyTexts = items;
        header.querySelector(".annotation-panel-meta")!.textContent = items.length > 0 ? `${items.length} 项注音` : "编辑模式";
      },
    });
    this.rubyTextInput = rubyEditor.input;

    const buttonContainer = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttonContainer.createEl("button", { text: "取消", cls: "annotation-btn annotation-btn-secondary" }).addEventListener("click", () => {
      this.close();
    });
    const saveBtn = buttonContainer.createEl("button", { text: "保存", cls: "annotation-btn annotation-btn-primary" });
    saveBtn.addEventListener("click", () => {
      const note = this.noteInput?.value ?? "";
      const rubyTexts = this.rubyTexts.length > 0 ? this.rubyTexts : undefined;
      this.onSave(note, this.currentMarker, rubyTexts);
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
