import { Modal, Notice } from "obsidian";
import type { AnnotationColor, AnnotationRuby } from "../types";
import { COLOR_LABELS } from "../constants";

// 编辑批注的模态框
export class EditNoteModal extends Modal {
  private annotationText: string;
  private currentNote: string;
  private currentColor: AnnotationColor;
  private currentRubyTexts: AnnotationRuby[];
  private onSave: (note: string, color: AnnotationColor, rubyTexts?: AnnotationRuby[]) => void;

  private noteInput: HTMLTextAreaElement | null = null;
  private rubyTextEnabled = false;
  private rubyTexts: AnnotationRuby[] = [];
  private rubyTextInput: HTMLInputElement | null = null;
  private rubyTextContainer: HTMLElement | null = null;
  private rubyTextPreview: HTMLElement | null = null;
  private selectedRubyRange: { start: number; end: number } | null = null;
  private updateRubyList: (() => void) | null = null;

  constructor(
    app: any,
    params: {
      text: string;
      note: string;
      color: AnnotationColor;
      rubyTexts?: AnnotationRuby[];
    },
    onSave: (note: string, color: AnnotationColor, rubyTexts?: AnnotationRuby[]) => void
  ) {
    super(app);
    this.annotationText = params.text;
    this.currentNote = params.note;
    this.currentColor = params.color;
    this.currentRubyTexts = params.rubyTexts || [];
    this.rubyTexts = [...this.currentRubyTexts];
    this.rubyTextEnabled = this.rubyTexts.length > 0;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("annotation-note-modal");

    contentEl.createEl("h3", { text: this.currentNote ? "编辑批注" : "添加批注" });

    // 标注文字预览
    const previewEl = contentEl.createDiv({ cls: "annotation-modal-preview" });
    previewEl.createEl("strong", { text: "标注文字：" });
    const previewText = this.annotationText.length > 50
      ? this.annotationText.substring(0, 50) + "..."
      : this.annotationText;
    previewEl.createEl("span", { text: previewText });

    // 颜色选择
    const colorContainer = contentEl.createDiv({ cls: "annotation-color-picker" });
    colorContainer.createEl("label", { text: "标注颜色：" });

    const colors: AnnotationColor[] = ["red", "yellow", "green", "blue", "purple", "none"];
    for (const c of colors) {
      const btn = colorContainer.createEl("button", { cls: `annotation-color-dot color-${c}` });
      btn.title = COLOR_LABELS[c];
      if (c === this.currentColor) btn.addClass("active");
      btn.addEventListener("click", () => {
        colorContainer.querySelectorAll(".annotation-color-dot")
          .forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        this.currentColor = c;
      });
    }

    // 批注输入
    const noteContainer = contentEl.createDiv({ cls: "annotation-note-container" });
    noteContainer.createEl("label", { text: "批注内容（最多400字）：" });
    this.noteInput = noteContainer.createEl("textarea", { cls: "annotation-note-input" });
    this.noteInput.setAttribute("maxlength", "400");
    this.noteInput.setAttribute("rows", "4");
    this.noteInput.setAttribute("placeholder", "请输入批注内容...");
    this.noteInput.value = this.currentNote;

    const charCount = noteContainer.createDiv({
      cls: "annotation-char-count",
      text: `${this.currentNote.length}/400`,
    });
    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput?.value.length ?? 0;
      charCount.textContent = `${len}/400`;
      charCount.toggleClass("annotation-char-count-error", len > 400);
    });

    // 注音区域
    this.buildRubySection(contentEl);

    // 按钮区
    const buttonContainer = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttonContainer.createEl("button", {
      text: "取消",
      cls: "annotation-btn annotation-btn-secondary",
    }).addEventListener("click", () => this.close());

    buttonContainer.createEl("button", {
      text: "保存",
      cls: "annotation-btn annotation-btn-primary",
    }).addEventListener("click", () => {
      const note = this.noteInput?.value ?? "";
      const rubyTexts = this.rubyTextEnabled && this.rubyTexts.length > 0
        ? this.rubyTexts
        : undefined;
      this.onSave(note, this.currentColor, rubyTexts);
      this.close();
    });
  }

  private buildRubySection(parent: HTMLElement): void {
    const rubySection = parent.createDiv({ cls: "annotation-ruby-section" });
    const rubyRow = rubySection.createDiv({ cls: "annotation-ruby-row" });
    const rubyCheckbox = rubyRow.createEl("input", {
      type: "checkbox",
      cls: "annotation-ruby-checkbox",
    });
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

    // 注音预览
    const rubyPreview = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-preview" });
    rubyPreview.createEl("label", { text: "划选需要注音的文字：" });
    this.rubyTextPreview = rubyPreview.createDiv({
      cls: "annotation-ruby-text-preview",
      text: this.annotationText,
    });

    this.rubyTextPreview.addEventListener("mouseup", () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          let start = 0;
          const textNode = this.rubyTextPreview!.firstChild;
          if (textNode && range.startContainer === textNode) {
            start = range.startOffset;
          }
          this.selectedRubyRange = {
            start,
            end: start + sel.toString().length,
          };
        }
      }, 10);
    });

    // 注音输入
    const rubyInputRow = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-input-row" });
    rubyInputRow.createEl("label", { text: "注音内容：" });
    this.rubyTextInput = rubyInputRow.createEl("input", {
      type: "text",
      cls: "annotation-ruby-input",
      placeholder: "输入注音内容...",
    });

    const addRubyBtn = rubyInputRow.createEl("button", {
      text: "添加",
      cls: "annotation-btn annotation-btn-small",
    });
    addRubyBtn.addEventListener("click", () => {
      const sel = window.getSelection();
      let text = "";
      let start = 0;

      if (sel && !sel.isCollapsed) {
        text = sel.toString();
        const range = sel.getRangeAt(0);
        const textNode = this.rubyTextPreview!.firstChild;
        if (textNode && range.startContainer === textNode) {
          start = range.startOffset;
        }
      } else if (this.selectedRubyRange) {
        text = this.annotationText.substring(
          this.selectedRubyRange.start,
          this.selectedRubyRange.end
        );
        start = this.selectedRubyRange.start;
      }

      const value = this.rubyTextInput!.value.trim();
      if (text && value) {
        this.rubyTexts.push({ startIndex: start, length: text.length, ruby: value });
        this.rubyTextInput!.value = "";
        this.selectedRubyRange = null;
        sel?.removeAllRanges();
        this.updateRubyList?.();
      } else if (!text && this.annotationText.length === 1 && value) {
        this.rubyTexts.push({ startIndex: 0, length: 1, ruby: value });
        this.rubyTextInput!.value = "";
        this.updateRubyList?.();
      } else {
        new Notice("请先划选需要注音的文字并输入注音内容");
      }
    });

    // 已添加注音列表
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
          item.createSpan({
            text: `${this.annotationText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
            cls: "annotation-ruby-item-text",
          });
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
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
