import { App, Notice } from "obsidian";
import { AnnotationColor, COLOR_LABELS, ExtractedRubyInfo, PartialAnnotationInfo, OriginalRuby } from "./types";
import { DataManager } from "./dataManager";
import { calculateRangeOffsetInElement } from "./utils/helpers";

export class SelectionMenu {
  private app: App;
  private dataManager: DataManager;
  private menuEl: HTMLElement | null = null;
  private selectedColor: AnnotationColor = "yellow";
  private currentFilePath: string | null = null;
  private selectedText: string = "";
  private onAddCallback: (() => void) | null = null;
  private pendingNote: string = "";
  private noteInput: HTMLTextAreaElement | null = null;
  private colorContainer: HTMLElement | null = null;
  private rubyTextEnabled: boolean = false;
  private rubyTexts: Array<{ startIndex: number; length: number; ruby: string }> = [];
  private rubyTextInput: HTMLInputElement | null = null;
  private rubyTextContainer: HTMLElement | null = null;
  private rubyPreview: HTMLElement | null = null;
  private rubyTextPreview: HTMLElement | null = null;
  private selectedRubyRange: { start: number; end: number } | null = null;
  private extractedRubyInfo: ExtractedRubyInfo | null = null;
  private partialAnnotationInfo: PartialAnnotationInfo | null = null;
  private updateRubyList: (() => void) | null = null;
  private fullText: string = "";
  private startIndexInFullText: number = 0;
  private endIndexInFullText: number = 0;
  private startLineInstance: number = 0;
  private endLineInstance: number = 0;
  private startOffsetInstance: number = 0;
  private endOffsetInstance: number = 0;
  private previewEl: HTMLElement | null = null;
  private renderer: any = null;
  private contextBeforeInstance: string = "";
  private contextAfterInstance: string = "";
  private containedAnnotationIds: string[] = [];
  private originalRubies: OriginalRuby[] = [];

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
    this.extractedRubyInfo = extractedRubyInfo || null;
    this.partialAnnotationInfo = partialAnnotationInfo || null;
    this.previewEl = previewEl || null;
    this.renderer = renderer || null;
    this.contextBeforeInstance = contextBefore || "";
    this.contextAfterInstance = contextAfter || "";
    this.containedAnnotationIds = containedAnnotationIds || [];
    this.originalRubies = originalRubies || [];




    this.startLineInstance = startLine;
    this.endLineInstance = endLine;
    this.startOffsetInstance = startOffset;
    this.endOffsetInstance = endOffset;
    this.hide();

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-selection-menu";

    this.menuEl.dataset.startLine = startLine.toString();
    this.menuEl.dataset.endLine = endLine.toString();
    this.menuEl.dataset.startOffset = startOffset.toString();
    this.menuEl.dataset.endOffset = endOffset.toString();



    const isUpdatingAnnotation = !!this.partialAnnotationInfo;

    this.rubyTexts = extractedRubyInfo?.rubyTexts ? [...extractedRubyInfo.rubyTexts] : [];
    this.rubyTextEnabled = this.rubyTexts.length > 0 || isUpdatingAnnotation;
    this.selectedRubyRange = null;

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-selection-menu";

    const header = this.menuEl.createDiv({ cls: "annotation-menu-header" });
    const titleText = isUpdatingAnnotation ? "添加注音" : "添加标注";
    header.createEl("span", { text: titleText, cls: "annotation-menu-title" });
    const closeBtn = header.createEl("button", { cls: "annotation-menu-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hide());

    const scrollableContent = this.menuEl.createDiv({ cls: "annotation-menu-scrollable-content" });

    const textPreview = scrollableContent.createDiv({ cls: "annotation-menu-preview" });
    const previewText = selectedText.length > 80 ? selectedText.substring(0, 80) + "..." : selectedText;
    textPreview.createEl("span", { text: `"${previewText}"` });

    const colorSection = scrollableContent.createDiv({ cls: "annotation-menu-section" });
    colorSection.createEl("label", { text: "选择颜色立即标注" });
    this.colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });

    const colors: AnnotationColor[] = ["red", "yellow", "green", "blue", "purple", "none"];
    colors.forEach((c) => {
      const btn = this.colorContainer!.createEl("button", { cls: `annotation-color-dot color-${c}` });

      if (isUpdatingAnnotation) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
        btn.title = "更新已有标注时不能更改颜色";
      } else {
        if (c === this.selectedColor) {
          btn.addClass("active");
        }
        btn.title = COLOR_LABELS[c];
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectedColor = c;

          this.colorContainer!.querySelectorAll(".annotation-color-dot").forEach((b) => b.removeClass("active"));
          btn.addClass("active");

          if (c === "none" && !this.pendingNote && this.rubyTexts.length === 0) {
            this.hide();
            return;
          }

          if (this.pendingNote) {
            return;
          }

          this.createAnnotation("");
        });
      }
    });

    const noteSection = scrollableContent.createDiv({ cls: "annotation-menu-section" });
    const noteLabel = noteSection.createDiv({ cls: "annotation-note-label-row" });
    noteLabel.createEl("label", { text: "或添加批注" });
    const charCount = noteLabel.createSpan({ cls: "annotation-char-count", text: "(0/400)" });

    this.noteInput = noteSection.createEl("textarea", { cls: "annotation-note-input-small", placeholder: "输入批注内容（可选，最多400字）..." });
    this.noteInput.setAttribute("maxlength", "400");

    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput!.value.length;
      this.pendingNote = this.noteInput!.value;
      charCount.textContent = `(${len}/400)`;
      if (len > 400) {
        charCount.addClass("annotation-char-count-error");
      } else {
        charCount.removeClass("annotation-char-count-error");
      }
    });

    const rubySection = noteSection.createDiv({ cls: "annotation-ruby-section" });
    const rubyRow = rubySection.createDiv({ cls: "annotation-ruby-row" });
    const rubyCheckbox = rubyRow.createEl("input", { type: "checkbox", cls: "annotation-ruby-checkbox" });
    rubyCheckbox.checked = this.rubyTextEnabled;
    rubyCheckbox.addEventListener("change", () => {
      this.rubyTextEnabled = rubyCheckbox.checked;
      if (this.rubyTextEnabled) {
        this.rubyTextContainer!.style.display = "block";
        this.rubyTextInput!.focus();

        requestAnimationFrame(() => {
          this.adjustMenuPosition();
        });
      } else {
        this.rubyTextContainer!.style.display = "none";
        this.rubyTexts = [];
        this.updateRubyList?.();
      }
    });
    rubyRow.createEl("label", { text: "注音" });

    this.rubyTextContainer = rubySection.createDiv({ cls: "annotation-ruby-input-container" });
    if (!this.rubyTextEnabled) {
      this.rubyTextContainer.style.display = "none";
    }

    this.rubyPreview = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-preview" });
    const rubyLabelText = isUpdatingAnnotation
      ? "已选中文字（将添加注音）："
      : "划选需要注音的文字：";
    this.rubyPreview.createEl("label", { text: rubyLabelText });
    this.rubyTextPreview = this.rubyPreview.createDiv({ cls: "annotation-ruby-text-preview", text: selectedText });
    this.rubyTextPreview.setAttribute("data-selected-text", selectedText);

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
        selectedRubyText = selectedText.substring(this.selectedRubyRange.start, this.selectedRubyRange.end);
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
          if (selectedText.length === 1) {
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
          const textPart = item.createSpan({ text: `${selectedText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`, cls: "annotation-ruby-item-text" });
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

    const actionRow = this.menuEl.createDiv({ cls: "annotation-action-row" });
    actionRow.style.flexShrink = "0";

    const copyBtn = actionRow.createEl("button", { cls: "annotation-btn annotation-btn-secondary annotation-btn-small", text: "复制" });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(selectedText);
      new Notice("已复制到剪贴板");
    });

    const saveButtonText = isUpdatingAnnotation ? "保存注音" : "保存";
    const noteBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-primary annotation-btn-small",
      text: saveButtonText
    });
    noteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const note = this.noteInput!.value.trim();
      if (note.length > 400) {
        new Notice("批注内容不能超过400字");
        return;
      }
      await this.createAnnotation(note);
    });

    document.body.appendChild(this.menuEl);

    requestAnimationFrame(() => {
      const menuWidth = 280;
      const menuHeight = this.menuEl!.offsetHeight || 200;
  
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
  
      if (menuY < 10) {
        menuY = 10;
      }
  
      this.menuEl!.style.left = `${Math.max(10, menuX)}px`;
      this.menuEl!.style.top = `${menuY}px`;
    });

    const clickHandler = (e: MouseEvent) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.hide();
        document.removeEventListener("click", clickHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", clickHandler), 10);
  }

  private async createAnnotation(note: string): Promise<void> {
    if (!this.currentFilePath) return;

    try {
      if (this.partialAnnotationInfo) {
        const annotationId = this.partialAnnotationInfo.annotationId;

        const data = await this.dataManager.loadAnnotations(this.currentFilePath);
        if (!data) {
          new Notice("无法找到原有标注");
          return;
        }

        const existingAnnotation = data.annotations.find(a => a.id === annotationId);
        if (!existingAnnotation) {
          new Notice("无法找到原有标注");
          return;
        }

        const newRubyTexts = this.rubyTexts.map(ruby => ({
          startIndex: this.partialAnnotationInfo!.startIndex + ruby.startIndex,
          length: ruby.length,
          ruby: ruby.ruby
        }));

        const updatedRubyTexts = this.mergeRubyTexts(
          existingAnnotation.rubyTexts || [],
          newRubyTexts
        );

        await this.dataManager.updateAnnotation(this.currentFilePath, annotationId, {
          rubyTexts: updatedRubyTexts.length > 0 ? updatedRubyTexts : undefined,
          originalRubies: existingAnnotation.originalRubies
        });

        const markElement = document.querySelector(`mark[data-annotation-id="${annotationId}"]`);
        if (markElement) {
          if (this.renderer) {
            const renderedAnnotations = this.renderer.getRenderedAnnotations();
            renderedAnnotations.delete(annotationId);
            this.renderer['processedAnnotations'].delete(annotationId);
          }

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
            const textNode = document.createTextNode(textContent);
            parent.replaceChild(textNode, markElement);

            if (this.renderer && this.previewEl) {
              this.dataManager.clearCache();
              await new Promise(resolve => setTimeout(resolve, 100));

              const data = await this.dataManager.loadAnnotations(this.currentFilePath);
              if (data && data.annotations.length > 0) {
                this.renderer.setAnnotations(data.annotations);
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
        }

        this.partialAnnotationInfo = null;
        this.hide();
        if (this.onAddCallback) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await this.onAddCallback();
        }
        new Notice("注音已添加");
        return;
      }

      const partialInfo = this.partialAnnotationInfo as PartialAnnotationInfo | null;
      if (partialInfo && partialInfo.annotationId) {

        const annotationId = partialInfo.annotationId;

        const data = await this.dataManager.loadAnnotations(this.currentFilePath);
        if (!data) {

          return;
        }

        const annotation = data.annotations.find(a => a.id === annotationId);
        if (!annotation) {

          return;
        }



        const rubyTexts = annotation.rubyTexts || [];


        const newRubyTexts = this.mergeRubyTexts(rubyTexts, this.rubyTexts);


        const startIndex = partialInfo.startIndex;
        const length = partialInfo.length;

        const existingRubyIndex = rubyTexts.findIndex(r =>
          r.startIndex <= startIndex && r.startIndex + r.length > startIndex
        );

        if (existingRubyIndex !== -1) {
          rubyTexts.splice(existingRubyIndex, 1);
        }

        await this.dataManager.updateAnnotation(this.currentFilePath, annotationId, {
          rubyTexts: newRubyTexts,
          originalRubies: annotation.originalRubies
        });

        this.pendingNote = "";
        this.rubyTextEnabled = false;
        this.rubyTexts = [];
        this.extractedRubyInfo = null;
        this.partialAnnotationInfo = null;
        this.hide();
        if (this.onAddCallback) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await this.onAddCallback();
        }
        new Notice("注音已更新");
        return;
      }

      if (this.extractedRubyInfo &&
          this.extractedRubyInfo.annotationIds &&
          this.extractedRubyInfo.annotationIds.length > 0) {
        for (const annotationId of this.extractedRubyInfo.annotationIds) {
          await this.dataManager.deleteAnnotation(this.currentFilePath, annotationId);
        }

        this.dataManager.clearCache();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.containedAnnotationIds && this.containedAnnotationIds.length > 0) {

        for (const annotationId of this.containedAnnotationIds) {
          await this.dataManager.deleteAnnotation(this.currentFilePath, annotationId);
        }

        this.dataManager.clearCache();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const rubyTexts = this.rubyTextEnabled && this.rubyTexts.length > 0 ? this.rubyTexts : undefined;

      const startLine = this.startLineInstance;
      const endLine = this.endLineInstance;
      const startOffset = this.startOffsetInstance;
      const endOffset = this.endOffsetInstance;








      const result = await this.dataManager.addAnnotation(this.currentFilePath, {
        text: this.selectedText,
        contextBefore: this.contextBeforeInstance,
        contextAfter: this.contextAfterInstance,
        color: this.selectedColor,
        note,
        rubyTexts,
        originalRubies: this.originalRubies.length > 0 ? this.originalRubies : undefined,
        startLine,
        endLine,
        startOffset,
        endOffset,
        isValid: 1,
      });

      if (result) {
        this.pendingNote = "";
        this.rubyTextEnabled = false;
        this.rubyTexts = [];
        this.originalRubies = [];
        this.extractedRubyInfo = null;
        this.hide();
        if (this.onAddCallback) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await this.onAddCallback();
        }
        new Notice(note || rubyTexts ? "标注和批注已添加" : "标注已添加");
      }
    } catch (e) {
      console.error("添加标注失败:", e);
      new Notice("添加标注失败");
    }
  }

  private mergeRubyTexts(
    existing: Array<{ startIndex: number; length: number; ruby: string }>,
    newItems: Array<{ startIndex: number; length: number; ruby: string }>
  ): Array<{ startIndex: number; length: number; ruby: string }> {
    const merged = [...existing];

    for (const newItem of newItems) {
      const overlapIndex = merged.findIndex(item =>
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

  hide(): void {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }

  private adjustMenuPosition(): void {
    if (!this.menuEl) return;

    const menuHeight = this.menuEl.offsetHeight || 200;
    const currentTop = parseInt(this.menuEl.style.top || "0", 10);
    const bottomPosition = currentTop + menuHeight;

    if (bottomPosition > window.innerHeight - 20) {
      const newTop = Math.max(10, window.innerHeight - menuHeight - 20);
      this.menuEl.style.top = `${newTop}px`;
    }
  }
}
