import { App, Notice, setIcon } from "obsidian";
import { AnnotationColor, ExtractedRubyInfo, Marker, OriginalRuby, PartialAnnotationInfo, SelectionRectSnapshot } from "./types";
import { DataManager } from "./dataManager";
import { calculateRangeOffsetInElement } from "./utils/helpers";
import { buildCreationMarkerSelection } from "./markerSelection";

type RubyText = { startIndex: number; length: number; ruby: string };

export class SelectionMenu {
  private app: App;
  private dataManager: DataManager;
  private menuEl: HTMLElement | null = null;
  private selectedColor: AnnotationColor = "yellow";
  private selectedMarkerId: string | null = null;
  private currentFilePath: string | null = null;
  private selectedText = "";
  private onAddCallback: (() => void) | null = null;
  private pendingNote = "";
  private noteInput: HTMLTextAreaElement | null = null;
  private colorContainer: HTMLElement | null = null;
  private rubyTexts: RubyText[] = [];
  private rubyTextInput: HTMLInputElement | null = null;
  private rubyTextPreview: HTMLElement | null = null;
  private selectedRubyRange: { start: number; end: number } | null = null;
  private extractedRubyInfo: ExtractedRubyInfo | null = null;
  private partialAnnotationInfo: PartialAnnotationInfo | null = null;
  private startLineInstance = 0;
  private endLineInstance = 0;
  private startOffsetInstance = 0;
  private endOffsetInstance = 0;
  private previewEl: HTMLElement | null = null;
  private renderer: any = null;
  private contextBeforeInstance = "";
  private contextAfterInstance = "";
  private containedAnnotationIds: string[] = [];
  private originalRubies: OriginalRuby[] = [];
  private isNotePanelOpen = false;
  private isRubyPanelOpen = false;
  private notePanelEl: HTMLElement | null = null;
  private rubyPanelEl: HTMLElement | null = null;
  private panelStackEl: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private saveBarEl: HTMLElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private addRubyBtn: HTMLButtonElement | null = null;
  private noteToggleBtn: HTMLButtonElement | null = null;
  private rubyToggleBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private anchorPointX: number | null = null;
  private anchorPointY: number | null = null;
  private selectionHighlightEl: HTMLElement | null = null;

  constructor(app: App, dataManager: DataManager) {
    this.app = app;
    this.dataManager = dataManager;
  }

  show(
    x: number,
    y: number,
    selectedText: string,
    startLine: number,
    endLine: number,
    startOffset: number,
    endOffset: number,
    filePath: string,
    selectionRects: SelectionRectSnapshot[],
    onAdd: () => void,
    extractedRubyInfo?: ExtractedRubyInfo,
    partialAnnotationInfo?: PartialAnnotationInfo,
    previewEl?: HTMLElement,
    renderer?: any,
    contextBefore?: string,
    contextAfter?: string,
    containedAnnotationIds?: string[],
    originalRubies?: OriginalRuby[]
  ): void {
    this.currentFilePath = filePath;
    this.selectedText = selectedText;
    this.onAddCallback = onAdd;
    this.extractedRubyInfo = extractedRubyInfo ?? null;
    this.partialAnnotationInfo = partialAnnotationInfo ?? null;
    this.previewEl = previewEl ?? null;
    this.renderer = renderer ?? null;
    this.contextBeforeInstance = contextBefore ?? "";
    this.contextAfterInstance = contextAfter ?? "";
    this.containedAnnotationIds = containedAnnotationIds ?? [];
    this.originalRubies = originalRubies ?? [];
    this.startLineInstance = startLine;
    this.endLineInstance = endLine;
    this.startOffsetInstance = startOffset;
    this.endOffsetInstance = endOffset;

    this.hide();
    this.resetUiState();

    this.anchorPointX = x;
    this.anchorPointY = y;

    const markerSelection = buildCreationMarkerSelection(this.dataManager.getMarkerManager().getMarkers());
    this.selectedMarkerId = markerSelection.selectedMarkerId;
    this.selectedColor = this.dataManager.getMarkerManager().getLegacyColorForMarker(this.selectedMarkerId ?? undefined);
    this.rubyTexts = extractedRubyInfo?.rubyTexts ? [...extractedRubyInfo.rubyTexts] : [];
    this.isRubyPanelOpen = this.partialAnnotationInfo !== null || this.rubyTexts.length > 0;

    this.selectionHighlightEl = document.createElement("div");
    this.selectionHighlightEl.className = "annotation-selection-highlight-layer";
    selectionRects.forEach((rect) => {
      const rectEl = document.createElement("div");
      rectEl.className = "annotation-selection-highlight-rect";
      rectEl.style.left = `${rect.left}px`;
      rectEl.style.top = `${rect.top}px`;
      rectEl.style.width = `${rect.width}px`;
      rectEl.style.height = `${rect.height}px`;
      this.selectionHighlightEl!.appendChild(rectEl);
    });
    document.body.appendChild(this.selectionHighlightEl);

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-selection-menu";
    this.menuEl.dataset.startLine = startLine.toString();
    this.menuEl.dataset.endLine = endLine.toString();
    this.menuEl.dataset.startOffset = startOffset.toString();
    this.menuEl.dataset.endOffset = endOffset.toString();

    this.renderToolbar();
    document.body.appendChild(this.menuEl);

    requestAnimationFrame(() => {
      this.positionMenu();
      this.syncUiState();
      this.bindOutsideClick();
    });
  }

  private renderToolbar(): void {
    if (!this.menuEl) return;

    const content = this.menuEl.createDiv({ cls: "annotation-menu-scrollable-content annotation-toolbar-content" });
    this.anchorEl = content.createDiv({ cls: "annotation-toolbar-anchor" });
    const primaryEl = this.anchorEl.createDiv({ cls: "annotation-toolbar-primary annotation-toolbar-primary-single-row" });
    const markerGroup = primaryEl.createDiv({ cls: "annotation-toolbar-group annotation-toolbar-group-markers" });
    this.renderMarkerToolbar(markerGroup);
    primaryEl.createDiv({ cls: "annotation-toolbar-divider" });
    const actionGroup = primaryEl.createDiv({ cls: "annotation-toolbar-group annotation-toolbar-group-actions" });
    this.renderActionToolbar(actionGroup);
    this.renderCloseButton(actionGroup);

    this.panelStackEl = content.createDiv({ cls: "annotation-toolbar-panel-stack" });
    this.notePanelEl = this.panelStackEl.createDiv({ cls: "annotation-toolbar-panel annotation-toolbar-panel-note" });
    this.rubyPanelEl = this.panelStackEl.createDiv({ cls: "annotation-toolbar-panel annotation-toolbar-panel-ruby" });

    this.renderNotePanel();
    this.renderRubyPanel();

    this.saveBarEl = this.anchorEl.createDiv({ cls: "annotation-toolbar-commit-bar" });
    this.cancelBtn = this.saveBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-commit-cancel",
      text: "取消",
    });
    this.cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });

    this.saveBtn = this.saveBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-primary annotation-toolbar-commit-save",
      text: this.partialAnnotationInfo ? "保存注音" : "保存",
    });
    this.saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const note = this.noteInput?.value.trim() ?? "";
      if (note.length > 400) {
        new Notice("批注内容不能超过400字");
        return;
      }
      if (!this.isDirty()) {
        return;
      }
      await this.createAnnotation(note);
    });
  }

  private renderMarkerToolbar(container: HTMLElement): void {
    const section = container.createDiv({ cls: "annotation-menu-section annotation-toolbar-section annotation-toolbar-section-markers" });
    this.colorContainer = section.createDiv({ cls: "annotation-color-buttons annotation-toolbar-marker-row" });

    const markerSelection = buildCreationMarkerSelection(this.dataManager.getMarkerManager().getMarkers());
    markerSelection.options.forEach((option) => {
      const { marker, disabled } = option;
      const btn = this.colorContainer!.createEl("button", {
        cls: `annotation-color-dot marker-preset-${marker.preset}`,
        attr: {
          type: "button",
          title: disabled ? `${marker.name}（已删除）` : marker.name,
          "aria-label": marker.name,
          "data-marker-id": marker.id,
        },
      });
      btn.style.setProperty("--marker-preview-color", marker.color);

      if (marker.id === this.selectedMarkerId) {
        btn.addClass("active");
      }

      btn.disabled = !!this.partialAnnotationInfo || disabled;
      if (this.partialAnnotationInfo) {
        btn.title = "为已有标注补充注音时不能修改记号";
      }

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (btn.disabled) return;

        this.selectedMarkerId = marker.id;
        this.selectedColor = this.dataManager.getMarkerManager().getLegacyColorForMarker(marker.id);
        this.syncMarkerButtons();

        if (!this.isDirty()) {
          await this.createAnnotation("");
        } else {
          this.syncUiState();
        }
      });
    });
  }

  private renderActionToolbar(container: HTMLElement): void {
    const row = container.createDiv({ cls: "annotation-toolbar-actions" });

    this.noteToggleBtn = row.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action",
      attr: { type: "button", "aria-expanded": "false", title: "添加或编辑批注" },
    });
    setIcon(this.noteToggleBtn, "message-square");
    this.noteToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleNotePanel();
    });

    this.rubyToggleBtn = row.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action",
      attr: { type: "button", "aria-expanded": "false", title: "添加注音" },
    });
    setIcon(this.rubyToggleBtn, "languages");
    this.rubyToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleRubyPanel();
    });

    const copyBtn = row.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action",
      attr: { type: "button", title: "复制当前选中文本" },
    });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(this.selectedText);
      new Notice("已复制到剪贴板");
      if (!this.isDirty()) {
        this.hide();
      }
    });
  }

  private renderCloseButton(container: HTMLElement): void {
    this.closeBtn = container.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-action annotation-toolbar-close",
      attr: { type: "button", title: this.isDirty() ? "当前有未保存内容" : "关闭工具栏" },
    });
    setIcon(this.closeBtn, "x");
    this.closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.isDirty()) {
        return;
      }
      this.hide();
    });
  }

  private renderNotePanel(): void {
    if (!this.notePanelEl) return;
    this.notePanelEl.empty();

    const preview = this.notePanelEl.createDiv({ cls: "annotation-menu-preview annotation-toolbar-preview" });
    const previewText = this.selectedText.length > 100 ? `${this.selectedText.substring(0, 100)}...` : this.selectedText;
    preview.createEl("span", { text: `"${previewText}"` });

    const noteLabel = this.notePanelEl.createDiv({ cls: "annotation-note-label-row" });
    const charCount = noteLabel.createSpan({ cls: "annotation-char-count", text: `(${this.pendingNote.length}/400)` });

    this.noteInput = this.notePanelEl.createEl("textarea", {
      cls: "annotation-note-input-small annotation-toolbar-note-input",
      attr: {
        maxlength: "400",
        placeholder: "输入批注内容（可选，最多400字）...",
      },
    });
    this.noteInput.value = this.pendingNote;
    this.noteInput.addEventListener("input", () => {
      const value = this.noteInput?.value ?? "";
      this.pendingNote = value;
      charCount.textContent = `(${value.length}/400)`;
      charCount.toggleClass("annotation-char-count-error", value.length > 400);
      this.syncUiState();
    });
  }

  private renderRubyPanel(): void {
    if (!this.rubyPanelEl) return;
    this.rubyPanelEl.empty();

    const inputRow = this.rubyPanelEl.createDiv({ cls: "annotation-ruby-input-row annotation-toolbar-ruby-input-row" });
    this.rubyTextInput = inputRow.createEl("input", {
      type: "text",
      cls: "annotation-ruby-input",
      attr: { placeholder: "输入注音内容..." },
    });
    this.rubyTextInput.addEventListener("input", () => {
      this.syncRubyAddButton();
    });
    this.rubyTextInput.addEventListener("focus", () => {
      if (!this.selectedRubyRange || !this.rubyTextPreview) {
        return;
      }

      const selection = window.getSelection();
      const textNode = this.rubyTextPreview.firstChild;
      if (!selection || !textNode) {
        return;
      }

      const range = document.createRange();
      range.setStart(textNode, this.selectedRubyRange.start);
      range.setEnd(textNode, this.selectedRubyRange.end);
      selection.removeAllRanges();
      selection.addRange(range);
    });

    const preview = this.rubyPanelEl.createDiv({ cls: "annotation-ruby-preview annotation-toolbar-ruby-preview" });
    this.rubyTextPreview = preview.createDiv({
      cls: "annotation-ruby-text-preview",
      text: this.selectedText,
    });
    this.rubyTextPreview.setAttribute("data-selected-text", this.selectedText);
    this.rubyTextPreview.setAttribute("data-has-selection", "false");

    const helper = preview.createDiv({
      cls: "annotation-toolbar-ruby-helper",
      text: "",
    });

    this.rubyTextPreview.addEventListener("mouseup", () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const rubyTextOffset = calculateRangeOffsetInElement(range, this.rubyTextPreview!);
          if (rubyTextOffset) {
            this.selectedRubyRange = {
              start: rubyTextOffset.start,
              end: rubyTextOffset.end,
            };
            this.rubyTextPreview?.setAttribute("data-has-selection", "true");
            helper.textContent = this.selectedText.substring(rubyTextOffset.start, rubyTextOffset.end);
          }
        } else {
          this.selectedRubyRange = null;
          this.rubyTextPreview?.setAttribute("data-has-selection", "false");
          helper.textContent = "";
        }
        this.syncRubyAddButton();
      }, 10);
    });

    this.addRubyBtn = this.rubyPanelEl.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-toolbar-ruby-add",
      text: "添加",
      attr: { type: "button" },
    });
    this.addRubyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!this.canAddRuby()) {
        return;
      }

      const rubyValue = this.rubyTextInput?.value.trim() ?? "";
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
        selectedRubyText = this.selectedText.substring(this.selectedRubyRange.start, this.selectedRubyRange.end);
        rubyStart = this.selectedRubyRange.start;
      } else if (this.selectedText.length === 1) {
        selectedRubyText = this.selectedText;
        rubyStart = 0;
      }

      this.rubyTexts.push({
        startIndex: rubyStart,
        length: selectedRubyText.length,
        ruby: rubyValue,
      });

      if (selection) {
        selection.removeAllRanges();
      }
      this.selectedRubyRange = null;
      this.rubyTextInput!.value = "";
      this.rubyTextPreview?.setAttribute("data-has-selection", "false");
      helper.textContent = "";
      this.renderRubyList();
      this.syncUiState();
      this.syncRubyAddButton();
    });

    this.rubyPanelEl.createDiv({ cls: "annotation-ruby-list" });
    this.renderRubyList();
    this.syncRubyAddButton();
  }

  private renderRubyList(): void {
    const rubyList = this.rubyPanelEl?.querySelector(".annotation-ruby-list") as HTMLElement | null;
    if (!rubyList) return;

    rubyList.empty();
    if (this.rubyTexts.length === 0) {
      rubyList.createDiv({ text: "暂无注音", cls: "annotation-ruby-empty" });
      return;
    }

    this.rubyTexts.forEach((ruby, index) => {
      const item = rubyList.createDiv({ cls: "annotation-ruby-item" });
      item.createSpan({
        text: `${this.selectedText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
        cls: "annotation-ruby-item-text",
      });
      const deleteBtn = item.createEl("button", {
        text: "×",
        cls: "annotation-ruby-item-delete",
        attr: { type: "button", "aria-label": "删除注音" },
      });
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.rubyTexts.splice(index, 1);
        this.renderRubyList();
        this.syncUiState();
      });
    });
  }

  private toggleNotePanel(): void {
    if (this.isNotePanelOpen && !this.pendingNote.trim()) {
      this.isNotePanelOpen = false;
    } else {
      this.isNotePanelOpen = true;
    }
    this.syncUiState();
    if (this.isNotePanelOpen) {
      this.noteInput?.focus();
    }
  }

  private toggleRubyPanel(): void {
    if (this.isRubyPanelOpen && this.rubyTexts.length === 0) {
      this.isRubyPanelOpen = false;
      this.selectedRubyRange = null;
      this.rubyTextPreview?.setAttribute("data-has-selection", "false");
    } else {
      this.isRubyPanelOpen = true;
    }
    this.syncUiState();
    if (this.isRubyPanelOpen) {
      this.rubyTextInput?.focus();
    }
  }

  private canAddRuby(): boolean {
    const rubyValue = this.rubyTextInput?.value.trim() ?? "";
    const hasSelection = !!this.selectedRubyRange || this.selectedText.length === 1;
    return rubyValue.length > 0 && hasSelection;
  }

  private isDirty(): boolean {
    return this.pendingNote.trim().length > 0 || this.rubyTexts.length > 0;
  }

  private syncMarkerButtons(): void {
    if (!this.colorContainer) return;
    this.colorContainer.querySelectorAll(".annotation-color-dot").forEach((button) => {
      const element = button as HTMLElement;
      const isActive = element.dataset.markerId === this.selectedMarkerId;
      element.classList.toggle("active", isActive);
    });
  }

  private syncUiState(): void {
    if (!this.menuEl) return;

    const dirty = this.isDirty();
    this.menuEl.classList.toggle("is-dirty", dirty);
    this.menuEl.setAttribute("data-state", dirty ? "dirty" : "clean");

    if (this.notePanelEl) {
      this.notePanelEl.style.display = this.isNotePanelOpen ? "block" : "none";
    }
    if (this.rubyPanelEl) {
      this.rubyPanelEl.style.display = this.isRubyPanelOpen ? "block" : "none";
    }

    if (this.noteToggleBtn) {
      this.noteToggleBtn.classList.toggle("is-active", this.isNotePanelOpen);
      this.noteToggleBtn.setAttribute("aria-expanded", this.isNotePanelOpen ? "true" : "false");
    }
    if (this.rubyToggleBtn) {
      this.rubyToggleBtn.classList.toggle("is-active", this.isRubyPanelOpen);
      this.rubyToggleBtn.setAttribute("aria-expanded", this.isRubyPanelOpen ? "true" : "false");
    }
    if (this.closeBtn) {
      this.closeBtn.disabled = dirty;
      this.closeBtn.title = dirty ? "当前有未保存内容，请先保存或取消" : "关闭工具栏";
    }

    if (this.saveBarEl) {
      this.saveBarEl.style.display = dirty ? "flex" : "none";
    }
    if (this.saveBtn) {
      this.saveBtn.disabled = !dirty;
    }

    this.syncRubyAddButton();
    requestAnimationFrame(() => this.positionMenu());
  }

  private syncRubyAddButton(): void {
    if (!this.addRubyBtn) return;
    this.addRubyBtn.disabled = !this.canAddRuby();
  }

  private bindOutsideClick(): void {
    if (!this.menuEl) return;

    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.menuEl || this.menuEl.contains(e.target as Node)) {
        return;
      }
      if (this.isDirty()) {
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

    const menuWidth = 320;
    const menuHeight = this.menuEl.offsetHeight || 220;
    const anchorHeight = this.anchorEl?.offsetHeight || 72;
    const viewportPadding = 10;
    const offset = 2;
    const expandedHeight = Math.max(0, menuHeight - anchorHeight);
    const x = this.anchorPointX;
    const y = this.anchorPointY;
    let menuX = x - Math.round(menuWidth / 2);
    let toolbarTop = y - Math.round(anchorHeight / 2);
    let placement: "above" | "below" = "below";

    if (menuX + menuWidth > window.innerWidth - viewportPadding) {
      menuX = window.innerWidth - menuWidth - viewportPadding;
    }

    toolbarTop = Math.max(
      viewportPadding,
      Math.min(window.innerHeight - anchorHeight - viewportPadding, toolbarTop)
    );

    const toolbarBottom = toolbarTop + anchorHeight;
    const spaceBelow = window.innerHeight - toolbarBottom - viewportPadding;
    const spaceAbove = toolbarTop - viewportPadding;

    if (expandedHeight > 0) {
      if (spaceBelow >= expandedHeight + offset) {
        placement = "above";
      } else if (spaceAbove >= expandedHeight + offset) {
        placement = "below";
      } else if (spaceBelow >= spaceAbove) {
        placement = "above";
      } else {
        placement = "below";
      }
    }

    let menuY = placement === "above" ? toolbarTop : toolbarTop - expandedHeight;

    if (placement === "above" && menuY + menuHeight > window.innerHeight - viewportPadding) {
      menuY = Math.max(
        viewportPadding,
        window.innerHeight - viewportPadding - menuHeight
      );
    }

    if (placement === "below" && menuY < viewportPadding) {
      menuY = viewportPadding;
    }

    if (menuY < viewportPadding) {
      menuY = viewportPadding;
    }

    this.menuEl.style.left = `${Math.max(viewportPadding, menuX)}px`;
    this.menuEl.style.top = `${menuY}px`;
    this.menuEl.setAttribute("data-placement", placement);
  }

  private resetUiState(): void {
    this.pendingNote = "";
    this.noteInput = null;
    this.colorContainer = null;
    this.rubyTextInput = null;
    this.rubyTextPreview = null;
    this.selectedRubyRange = null;
    this.notePanelEl = null;
    this.rubyPanelEl = null;
    this.panelStackEl = null;
    this.anchorEl = null;
    this.saveBarEl = null;
    this.saveBtn = null;
    this.cancelBtn = null;
    this.addRubyBtn = null;
    this.noteToggleBtn = null;
    this.rubyToggleBtn = null;
    this.closeBtn = null;
    this.isNotePanelOpen = false;
    this.isRubyPanelOpen = false;
    this.anchorPointX = null;
    this.anchorPointY = null;
    this.selectionHighlightEl = null;
  }

  private async createAnnotation(note: string): Promise<void> {
    if (!this.currentFilePath) return;

    try {
      if (this.partialAnnotationInfo) {
        const annotationId = this.partialAnnotationInfo.annotationId;
        const data = await this.dataManager.loadAnnotations(this.currentFilePath);
        const existingAnnotation = data?.annotations.find((annotation) => annotation.id === annotationId);
        if (!existingAnnotation) {
          new Notice("无法找到原有标注");
          return;
        }

        const newRubyTexts = this.rubyTexts.map((ruby) => ({
          startIndex: this.partialAnnotationInfo!.startIndex + ruby.startIndex,
          length: ruby.length,
          ruby: ruby.ruby,
        }));

        const updatedRubyTexts = this.mergeRubyTexts(existingAnnotation.rubyTexts || [], newRubyTexts);
        await this.dataManager.updateAnnotation(this.currentFilePath, annotationId, {
          rubyTexts: updatedRubyTexts.length > 0 ? updatedRubyTexts : undefined,
          originalRubies: existingAnnotation.originalRubies,
        });

        const markElement = document.querySelector(`mark[data-annotation-id="${annotationId}"]`);
        if (markElement && this.renderer && this.previewEl) {
          const renderedAnnotations = this.renderer.getRenderedAnnotations();
          renderedAnnotations.delete(annotationId);
          this.renderer["processedAnnotations"].delete(annotationId);

          const parent = markElement.parentNode;
          if (parent) {
            let textContent = "";
            const walker = document.createTreeWalker(markElement, NodeFilter.SHOW_TEXT, null);
            let node = walker.nextNode();
            while (node) {
              const textNode = node as Text;
              const parentElement = textNode.parentElement;
              if (parentElement && parentElement.tagName !== "RT") {
                textContent += textNode.textContent;
              }
              node = walker.nextNode();
            }

            parent.replaceChild(document.createTextNode(textContent), markElement);
            this.dataManager.clearCache();
            await new Promise((resolve) => setTimeout(resolve, 100));

            const refreshed = await this.dataManager.loadAnnotations(this.currentFilePath);
            if (refreshed && refreshed.annotations.length > 0) {
              this.renderer.setAnnotations(refreshed.annotations);
              const result = this.renderer.renderByText(this.previewEl);
              if (result.updatedContexts.length > 0) {
                for (const update of result.updatedContexts) {
                  await this.dataManager.updateAnnotation(this.currentFilePath, update.id, {
                    contextBefore: update.contextBefore,
                    contextAfter: update.contextAfter,
                    startLine: update.startLine,
                    endLine: update.endLine,
                    startOffset: update.startOffset,
                    endOffset: update.endOffset,
                  });
                }
              }
            }
          }
        }

        this.partialAnnotationInfo = null;
        this.hide();
        if (this.onAddCallback) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await this.onAddCallback();
        }
        new Notice("注音已添加");
        return;
      }

      if (this.extractedRubyInfo?.annotationIds?.length) {
        for (const annotationId of this.extractedRubyInfo.annotationIds) {
          await this.dataManager.deleteAnnotation(this.currentFilePath, annotationId);
        }
        this.dataManager.clearCache();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (this.containedAnnotationIds.length > 0) {
        for (const annotationId of this.containedAnnotationIds) {
          await this.dataManager.deleteAnnotation(this.currentFilePath, annotationId);
        }
        this.dataManager.clearCache();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const rubyTexts = this.rubyTexts.length > 0 ? this.rubyTexts : undefined;
      const result = await this.dataManager.addAnnotation(this.currentFilePath, {
        text: this.selectedText,
        contextBefore: this.contextBeforeInstance,
        contextAfter: this.contextAfterInstance,
        color: this.selectedColor,
        markerId: this.selectedMarkerId ?? undefined,
        markerLabel: this.getSelectedMarker()?.name,
        note,
        rubyTexts,
        originalRubies: this.originalRubies.length > 0 ? this.originalRubies : undefined,
        startLine: this.startLineInstance,
        endLine: this.endLineInstance,
        startOffset: this.startOffsetInstance,
        endOffset: this.endOffsetInstance,
        isValid: 1,
      });

      if (result) {
        this.hide();
        if (this.onAddCallback) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await this.onAddCallback();
        }
        new Notice(note || rubyTexts ? "标注和批注已添加" : "标注已添加");
      }
    } catch (e) {
      console.error("添加标注失败:", e);
      new Notice("添加标注失败");
    }
  }

  private mergeRubyTexts(existing: RubyText[], newItems: RubyText[]): RubyText[] {
    const merged = [...existing];

    for (const newItem of newItems) {
      const overlapIndex = merged.findIndex((item) =>
        (newItem.startIndex >= item.startIndex && newItem.startIndex < item.startIndex + item.length) ||
        (item.startIndex >= newItem.startIndex && item.startIndex < newItem.startIndex + newItem.length)
      );

      if (overlapIndex !== -1) {
        merged[overlapIndex] = newItem;
      } else {
        merged.push(newItem);
      }
    }

    return merged.sort((a, b) => a.startIndex - b.startIndex);
  }

  private getSelectedMarker(): Marker | null {
    return this.dataManager.getMarkerManager().getMarkerById(this.selectedMarkerId ?? undefined);
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

    if (this.selectionHighlightEl) {
      this.selectionHighlightEl.remove();
      this.selectionHighlightEl = null;
    }

    this.resetUiState();
  }

}
