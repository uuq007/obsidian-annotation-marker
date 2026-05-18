import { Modal, Notice } from "obsidian";
import type { AnnotationColor, AnnotationPluginSettings, AnnotationRuby } from "../types";
import { ALL_COLORS, COLOR_CLASSES } from "../constants";
import { t } from "../i18n";

// 编辑批注的模态框
export class EditNoteModal extends Modal {
  private annotationText: string;
  private currentNote: string;
  private currentColor: AnnotationColor;
  private currentRubyTexts: AnnotationRuby[];
  private getSettings: () => AnnotationPluginSettings;
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
    getSettings: () => AnnotationPluginSettings,
    params: {
      text: string;
      note: string;
      color: AnnotationColor;
      rubyTexts?: AnnotationRuby[];
    },
    onSave: (note: string, color: AnnotationColor, rubyTexts?: AnnotationRuby[]) => void
  ) {
    super(app);
    this.getSettings = getSettings;
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
    const settings = this.getSettings();
    const maxLen = settings.maxNoteLength;
    const loc = t();
    contentEl.addClass("annotation-note-modal");

    this.containerEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.containerEl.addEventListener("mouseup", (e) => e.stopPropagation());
    this.containerEl.addEventListener("focusin", (e) => e.stopPropagation());

    contentEl.createEl("h3", { text: this.currentNote ? loc.modalEditNote : loc.modalAddNote });

    const previewEl = contentEl.createDiv({ cls: "annotation-modal-preview" });
    const previewHeader = previewEl.createDiv({ cls: "annotation-modal-preview-header" });
    previewHeader.createEl("strong", { text: loc.modalAnnotationText });
    const copyBtn = previewHeader.createEl("button", {
      cls: "annotation-copy-btn",
      text: loc.copy,
    });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.annotationText).then(() => {
        copyBtn.textContent = loc.copied;
        setTimeout(() => { copyBtn.textContent = loc.copy; }, 1500);
      });
    });
    const previewText = this.annotationText.length > 200
      ? this.annotationText.substring(0, 200) + "..."
      : this.annotationText;
    const previewSpan = previewEl.createEl("span", { text: previewText, cls: "annotation-modal-preview-text" });
    previewSpan.style.whiteSpace = "pre-wrap";

    // 颜色选择
    const colorContainer = contentEl.createDiv({ cls: "annotation-color-picker" });
    colorContainer.createEl("label", { text: loc.modalAnnotationColor });

    const colors: AnnotationColor[] = [...ALL_COLORS];
    for (const c of colors) {
      const btn = colorContainer.createEl("button", { cls: `annotation-color-dot ${COLOR_CLASSES[c]}` });
      btn.title = c === "none" ? loc.none : (settings as any)[`colorLabel${c}`] ?? loc.colorLabel(c);
      if (c === this.currentColor) btn.addClass("active");
      btn.addEventListener("click", () => {
        colorContainer.querySelectorAll(".annotation-color-dot")
          .forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        this.currentColor = c;
      });
    }

    const noteContainer = contentEl.createDiv({ cls: "annotation-note-container" });
    noteContainer.createEl("label", { text: loc.modalNoteLabel(maxLen) });
    this.noteInput = noteContainer.createEl("textarea", { cls: "annotation-note-input" });
    this.noteInput.setAttribute("maxlength", String(maxLen));
    this.noteInput.setAttribute("rows", "4");
    this.noteInput.setAttribute("placeholder", loc.modalNotePlaceholder);
    this.noteInput.value = this.currentNote;

    const charCount = noteContainer.createDiv({
      cls: "annotation-char-count",
      text: loc.charCount(this.currentNote.length, maxLen),
    });
    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput?.value.length ?? 0;
      charCount.textContent = loc.charCount(len, maxLen);
      charCount.toggleClass("annotation-char-count-error", len > maxLen);
    });

    this.buildRubySection(contentEl);

    const buttonContainer = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttonContainer.createEl("button", {
      text: loc.cancel,
      cls: "annotation-btn annotation-btn-secondary",
    }).addEventListener("click", () => this.close());

    buttonContainer.createEl("button", {
      text: loc.save,
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
    const loc = t();
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
    rubyRow.createEl("label", { text: loc.menuRuby });

    this.rubyTextContainer = rubySection.createDiv({ cls: "annotation-ruby-input-container" });
    this.rubyTextContainer.style.display = this.rubyTextEnabled ? "block" : "none";

    const rubyPreview = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-preview" });
    rubyPreview.createEl("label", { text: loc.menuRubySelectText });
    this.rubyTextPreview = rubyPreview.createDiv({
      cls: "annotation-ruby-text-preview",
      text: this.annotationText,
    });

    this.rubyTextPreview.addEventListener("mouseup", (e) => {
      e.stopPropagation();
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

    const rubyInputRow = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-input-row" });
    rubyInputRow.createEl("label", { text: loc.menuRubyContent });
    this.rubyTextInput = rubyInputRow.createEl("input", {
      type: "text",
      cls: "annotation-ruby-input",
      placeholder: loc.menuRubyPlaceholder,
    });

    const addRubyBtn = rubyInputRow.createEl("button", {
      text: loc.add,
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
        new Notice(loc.noticeRubySelectAndInput);
      }
    });

    const rubyListContainer = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-list-container" });
    rubyListContainer.createEl("label", { text: loc.menuRubyAdded });
    const rubyList = rubyListContainer.createDiv({ cls: "annotation-ruby-list" });
    this.updateRubyList = () => {
      rubyList.empty();
      if (this.rubyTexts.length === 0) {
        rubyList.createDiv({ text: loc.noRuby, cls: "annotation-ruby-empty" });
      } else {
        this.rubyTexts.forEach((ruby, index) => {
          const item = rubyList.createDiv({ cls: "annotation-ruby-item" });
          item.createSpan({
            text: `${this.annotationText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
            cls: "annotation-ruby-item-text",
          });
          const deleteBtn = item.createEl("button", { text: loc.close, cls: "annotation-ruby-item-delete" });
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
