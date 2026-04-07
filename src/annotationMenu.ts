import { App, Modal, Notice } from "obsidian";
import { Annotation, AnnotationColor, Marker } from "./types";
import { DataManager } from "./dataManager";
import { calculateRangeOffsetInElement } from "./utils/helpers";
import { AnnotationMode } from "./annotationMode";
import { buildExistingMarkerSelection } from "./markerSelection";

export class AnnotationMenu {
  private app: App;
  private dataManager: DataManager;
  private menuEl: HTMLElement | null = null;
  private annotationMode?: AnnotationMode;

  constructor(app: App, dataManager: DataManager, annotationMode?: AnnotationMode) {
    this.app = app;
    this.dataManager = dataManager;
    this.annotationMode = annotationMode;
  }

  show(x: number, y: number, annotation: Annotation, annotationId: string, filePath: string, onUpdate: () => void, annotationMode?: AnnotationMode): void {
    this.hide();

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-view-menu";

    const header = this.menuEl.createDiv({ cls: "annotation-menu-header" });
    header.createEl("span", { text: "标注详情", cls: "annotation-menu-title" });
    const closeBtn = header.createEl("button", { cls: "annotation-menu-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hide());

    const textPreview = this.menuEl.createDiv({ cls: "annotation-menu-text" });
    const previewText = annotation.text.length > 80 ? annotation.text.substring(0, 80) + "..." : annotation.text;
    textPreview.createEl("span", { text: `"${previewText}"` });

    if (annotation.note) {
      const noteSection = this.menuEl.createDiv({ cls: "annotation-menu-note" });
      noteSection.createEl("label", { text: "批注内容" });
      noteSection.createEl("div", { cls: "annotation-note-text", text: annotation.note });
    }

    const colorSection = this.menuEl.createDiv({ cls: "annotation-menu-section" });
    colorSection.createEl("label", { text: "记号" });
    const colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });
    const markerSelection = buildExistingMarkerSelection(this.dataManager.getMarkerManager().getMarkers(), annotation.markerId);
    markerSelection.options.forEach((option) => {
      const { marker, disabled } = option;
      const btn = colorContainer.createEl("button", { cls: `annotation-color-dot marker-preset-${marker.preset}` });
      btn.style.setProperty("--marker-preview-color", marker.color);
      if (marker.id === markerSelection.selectedMarkerId) {
        btn.addClass("active");
      }
      btn.disabled = disabled;
      btn.title = disabled ? `${marker.name}（已删除）` : marker.name;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!disabled && marker.id !== annotation.markerId) {
          this.updateMarker(annotation, annotationId, filePath, marker, onUpdate, annotationMode);
        }
      });
    });

    if (markerSelection.options.some((option) => option.marker.id === annotation.markerId && option.disabled)) {
      this.menuEl.createDiv({
        cls: "annotation-marker-settings-status",
        text: "当前记号已删除，仅保留历史显示；切换后无法再选回，除非先恢复。",
      });
    }

    const actions = this.menuEl.createDiv({ cls: "annotation-menu-actions" });

    const editBtn = actions.createEl("button", { cls: "annotation-btn annotation-btn-secondary", text: "编辑批注" });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showEditModal(annotation, annotationId, filePath, onUpdate, annotationMode);
    });

    const copyBtn = actions.createEl("button", { cls: "annotation-btn annotation-btn-secondary", text: "复制原文" });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(annotation.text);
      new Notice("已复制原文到剪贴板");
    });

    const deleteBtn = actions.createEl("button", { cls: "annotation-btn annotation-btn-danger", text: "删除" });
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.dataManager.deleteAnnotation(filePath, annotation.id);
      this.hide();
      onUpdate();
      new Notice("标注已删除");
    });

    document.body.appendChild(this.menuEl);

    const menuWidth = 300;
    const menuHeight = this.menuEl.offsetHeight || 250;

    let menuX = x + 10;
    let menuY = y + 10;

    if (menuX + menuWidth > window.innerWidth) {
      menuX = x - menuWidth - 10;
    }

    const threshold = window.innerHeight * 0.4;
    if (y > threshold) {
      menuY = y - menuHeight - 10;
    }

    if (menuY + menuHeight > window.innerHeight) {
      menuY = window.innerHeight - menuHeight - 10;
    }

    this.menuEl.style.left = `${Math.max(10, menuX)}px`;
    this.menuEl.style.top = `${Math.max(10, menuY)}px`;

    const clickHandler = (e: MouseEvent) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.hide();
        document.removeEventListener("click", clickHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", clickHandler), 10);
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
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }
}

class EditNoteModal extends Modal {
  private dataManager: DataManager;
  private annotation: Annotation;
  private onSave: (note: string, marker: Marker, rubyTexts?: Array<{ startIndex: number; length: number; ruby: string }>) => void;
  private noteInput: HTMLTextAreaElement | null = null;
  private currentMarker: Marker;
  private rubyTextEnabled: boolean = false;
  private rubyTexts: Array<{ startIndex: number; length: number; ruby: string }> = [];
  private rubyTextInput: HTMLInputElement | null = null;
  private rubyTextContainer: HTMLElement | null = null;
  private rubyPreview: HTMLElement | null = null;
  private rubyTextPreview: HTMLElement | null = null;
  private selectedRubyRange: { start: number; end: number } | null = null;
  private updateRubyList: (() => void) | null = null;

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
      this.rubyTextEnabled = true;
    } else {
      this.rubyTextEnabled = !!annotation.rubyTexts && annotation.rubyTexts.length > 0;
      this.rubyTexts = annotation.rubyTexts || [];
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("annotation-note-modal");

    contentEl.createEl("h3", { text: this.annotation.note ? "编辑批注" : "添加批注" });

    const previewEl = contentEl.createDiv({ cls: "annotation-modal-preview" });
    previewEl.createEl("strong", { text: "标注文字：" });
    const previewText = this.annotation.text.length > 50 ? this.annotation.text.substring(0, 50) + "..." : this.annotation.text;
    previewEl.createEl("span", { text: previewText });

    const colorContainer = contentEl.createDiv({ cls: "annotation-color-picker" });
    colorContainer.createEl("label", { text: "记号：" });

    const markerSelection = buildExistingMarkerSelection(this.dataManager.getMarkerManager().getMarkers(), this.annotation.markerId);
    markerSelection.options.forEach((option) => {
      const { marker, disabled } = option;
      const btn = colorContainer.createEl("button", { cls: `annotation-color-dot marker-preset-${marker.preset}` });
      btn.style.setProperty("--marker-preview-color", marker.color);
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
      contentEl.createDiv({
        cls: "annotation-marker-settings-status",
        text: "当前记号已删除，保存时请选择一个新的可用记号。",
      });
    }

    const noteContainer = contentEl.createDiv({ cls: "annotation-note-container" });
    noteContainer.createEl("label", { text: "批注内容（最多400字）：" });
    this.noteInput = noteContainer.createEl("textarea", { cls: "annotation-note-input" });
    this.noteInput.setAttribute("maxlength", "400");
    this.noteInput.setAttribute("rows", "4");
    this.noteInput.setAttribute("placeholder", "请输入批注内容...");
    this.noteInput.value = this.annotation.note;

    const charCount = noteContainer.createDiv({ cls: "annotation-char-count", text: `${this.annotation.note.length}/400` });
    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput?.value.length ?? 0;
      charCount.textContent = `${len}/400`;
    });

    const rubySection = contentEl.createDiv({ cls: "annotation-ruby-section" });
    const rubyRow = rubySection.createDiv({ cls: "annotation-ruby-row" });
    const rubyCheckbox = rubyRow.createEl("input", { type: "checkbox", cls: "annotation-ruby-checkbox" });
    rubyCheckbox.checked = this.rubyTextEnabled;
    rubyCheckbox.addEventListener("change", () => {
      this.rubyTextEnabled = rubyCheckbox.checked;
      if (this.rubyTextEnabled) {
        this.rubyTextContainer!.style.display = "block";
        this.rubyTextInput!.focus();
      } else {
        this.rubyTextContainer!.style.display = "none";
        this.rubyTexts = [];
        this.updateRubyList?.();
      }
    });
    rubyRow.createEl("label", { text: "注音" });

    this.rubyTextContainer = rubySection.createDiv({ cls: "annotation-ruby-input-container" });
    this.rubyTextContainer.style.display = this.rubyTextEnabled ? "block" : "none";

    this.rubyPreview = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-preview" });
    this.rubyPreview.createEl("label", { text: "划选需要注音的文字：" });
    this.rubyTextPreview = this.rubyPreview.createDiv({ cls: "annotation-ruby-text-preview", text: this.annotation.text });
    this.rubyTextPreview.setAttribute("data-selected-text", this.annotation.text);

    const rubyInputRow = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-input-row" });
    rubyInputRow.createEl("label", { text: "注音内容：" });
    this.rubyTextInput = rubyInputRow.createEl("input", { type: "text", cls: "annotation-ruby-input", placeholder: "输入注音内容..." });

    this.rubyTextPreview.addEventListener("mouseup", () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const rubyTextOffset = calculateRangeOffsetInElement(range, this.rubyTextPreview!);

          if (rubyTextOffset) {
            this.selectedRubyRange = {
              start: rubyTextOffset.start,
              end: rubyTextOffset.end
            };
          }
        }
      }, 10);
    });

    this.rubyTextInput.addEventListener("focus", () => {
      if (this.selectedRubyRange) {
        const selection = window.getSelection();
        if (selection) {
          const fullText = this.rubyTextPreview!.textContent || "";
          const textNode = this.rubyTextPreview!.firstChild;
          if (textNode) {
            const range = document.createRange();
            range.setStart(textNode, this.selectedRubyRange.start);
            range.setEnd(textNode, this.selectedRubyRange.end);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    });

    const addRubyBtn = rubyInputRow.createEl("button", { text: "添加", cls: "annotation-btn annotation-btn-small" });
    addRubyBtn.addEventListener("click", () => {
      const selection = window.getSelection();
      let selectedRubyText = "";
      let rubyStart = 0;

      if (selection && !selection.isCollapsed) {
        selectedRubyText = selection.toString();
        const range = selection.getRangeAt(0);
        const rubyTextOffset = calculateRangeOffsetInElement(range, this.rubyTextPreview!);
        if (rubyTextOffset) {
          rubyStart = rubyTextOffset.start;
        }
      } else if (this.selectedRubyRange) {
        selectedRubyText = this.annotation.text.substring(this.selectedRubyRange.start, this.selectedRubyRange.end);
        rubyStart = this.selectedRubyRange.start;
      }

      if (selectedRubyText && this.rubyTextInput!.value.trim()) {
        this.rubyTexts.push({
          startIndex: rubyStart,
          length: selectedRubyText.length,
          ruby: this.rubyTextInput!.value.trim()
        });
        this.rubyTextInput!.value = "";
        this.selectedRubyRange = null;
        if (selection) {
          selection.removeAllRanges();
        }
        this.updateRubyList?.();
      } else {
        if (!selectedRubyText) {
          if (this.annotation.text.length === 1) {
            this.rubyTexts.push({
              startIndex: 0,
              length: 1,
              ruby: this.rubyTextInput!.value.trim()
            });
            this.rubyTextInput!.value = "";
            this.selectedRubyRange = null;
            this.updateRubyList?.();
          } else {
            new Notice("请先划选需要注音的文字");
          }
        } else {
          new Notice("请输入注音内容");
        }
      }
    });

    const rubyListContainer = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-list-container" });
    rubyListContainer.createEl("label", { text: "已添加的注音：" });
    const rubyList = rubyListContainer.createDiv({ cls: "annotation-ruby-list" });
    this.updateRubyList = () => {
      rubyList.empty();
      if (this.rubyTexts.length === 0) {
        rubyList.createDiv({ text: "暂无注音", cls: "annotation-ruby-empty" });
      } else {
        this.rubyTexts.forEach((ruby, index) => {
          const item = rubyList.createDiv({ cls: "annotation-ruby-item" });
          const textPart = item.createSpan({ text: `${this.annotation.text.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`, cls: "annotation-ruby-item-text" });
          const deleteBtn = item.createEl("button", { text: "×", cls: "annotation-ruby-item-delete" });
          deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.rubyTexts.splice(index, 1);
            this.updateRubyList?.();
          });
        });
      }
    };
    this.updateRubyList();

    const buttonContainer = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttonContainer.createEl("button", { text: "取消", cls: "annotation-btn annotation-btn-secondary" }).addEventListener("click", () => {
      this.close();
    });
    const saveBtn = buttonContainer.createEl("button", { text: "保存", cls: "annotation-btn annotation-btn-primary" });
    saveBtn.addEventListener("click", () => {
      const note = this.noteInput?.value ?? "";
      const rubyTexts = this.rubyTextEnabled && this.rubyTexts.length > 0 ? this.rubyTexts : undefined;
      this.onSave(note, this.currentMarker, rubyTexts);
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
