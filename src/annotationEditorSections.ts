import type { AnnotationRuby } from "./types";
import { calculateRangeOffsetInElement } from "./utils/helpers";

export interface NoteEditorOptions {
  container: HTMLElement;
  selectedText: string;
  note: string;
  previewLabel?: string;
  contentLabel?: string;
  placeholder?: string;
  textareaClassName?: string;
  onChange?: (value: string) => void;
}

export interface NoteEditorRefs {
  input: HTMLTextAreaElement;
  charCount: HTMLElement;
}

export function renderNoteEditor(options: NoteEditorOptions): NoteEditorRefs {
  const {
    container,
    selectedText,
    note,
    previewLabel = "原文本",
    contentLabel = "批注内容",
    placeholder = "输入批注内容（可选，最多400字）...",
    textareaClassName = "annotation-note-input-small annotation-toolbar-note-input",
    onChange,
  } = options;

  const preview = container.createDiv({ cls: "annotation-menu-preview annotation-toolbar-preview" });
  preview.createEl("label", { text: previewLabel });
  const previewText = selectedText.length > 100 ? `${selectedText.substring(0, 100)}...` : selectedText;
  preview.createEl("span", { text: `"${previewText}"` });

  const noteLabel = container.createDiv({ cls: "annotation-panel-field-label-row" });
  noteLabel.createEl("label", { text: contentLabel });
  const charCount = noteLabel.createSpan({ cls: "annotation-char-count", text: `${note.length}/400` });

  const input = container.createEl("textarea", {
    cls: textareaClassName,
    attr: {
      maxlength: "400",
      placeholder,
    },
  });
  input.value = note;
  input.addEventListener("input", () => {
    const value = input.value;
    charCount.textContent = `${value.length}/400`;
    charCount.toggleClass("annotation-char-count-error", value.length > 400);
    onChange?.(value);
  });

  return { input, charCount };
}

export interface RubyEditorOptions {
  container: HTMLElement;
  selectedText: string;
  rubyTexts: AnnotationRuby[];
  onItemsChange?: (items: AnnotationRuby[]) => void;
  onDraftChange?: () => void;
}

export interface RubyEditorRefs {
  input: HTMLInputElement;
  preview: HTMLElement;
  addButton: HTMLButtonElement;
  renderList: () => void;
}

export function renderRubyEditor(options: RubyEditorOptions): RubyEditorRefs {
  const { container, selectedText, onItemsChange, onDraftChange } = options;
  let rubyTexts = [...options.rubyTexts];
  let selectedRubyRange: { start: number; end: number } | null = null;

  const inputRow = container.createDiv({ cls: "annotation-ruby-input-row annotation-toolbar-ruby-input-row" });
  inputRow.createEl("label", { cls: "annotation-panel-field-label", text: "注音内容" });
  const input = inputRow.createEl("input", {
    type: "text",
    cls: "annotation-ruby-input",
    attr: { placeholder: "输入注音内容..." },
  });

  const preview = container.createDiv({ cls: "annotation-ruby-preview annotation-toolbar-ruby-preview" });
  preview.createEl("label", { text: "原文本内选择注音范围" });
  const textPreview = preview.createDiv({
    cls: "annotation-ruby-text-preview",
    text: selectedText,
  });
  textPreview.setAttribute("data-selected-text", selectedText);
  textPreview.setAttribute("data-has-selection", "false");

  const helper = preview.createDiv({
    cls: "annotation-toolbar-ruby-helper",
    text: "",
  });

  const canAddRuby = (): boolean => {
    const rubyValue = input.value.trim();
    const hasSelection = !!selectedRubyRange || selectedText.length === 1;
    return rubyValue.length > 0 && hasSelection;
  };

  const syncAddButton = () => {
    addButton.disabled = !canAddRuby();
    onDraftChange?.();
  };

  textPreview.addEventListener("mouseup", () => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const rubyTextOffset = calculateRangeOffsetInElement(range, textPreview);
        if (rubyTextOffset) {
          selectedRubyRange = {
            start: rubyTextOffset.start,
            end: rubyTextOffset.end,
          };
          textPreview.setAttribute("data-has-selection", "true");
          helper.textContent = selectedText.substring(rubyTextOffset.start, rubyTextOffset.end);
        }
      } else {
        selectedRubyRange = null;
        textPreview.setAttribute("data-has-selection", "false");
        helper.textContent = "";
      }
      syncAddButton();
    }, 10);
  });

  input.addEventListener("input", syncAddButton);
  input.addEventListener("focus", () => {
    if (!selectedRubyRange) {
      return;
    }

    const selection = window.getSelection();
    const textNode = textPreview.firstChild;
    if (!selection || !textNode) {
      return;
    }

    const range = document.createRange();
    range.setStart(textNode, selectedRubyRange.start);
    range.setEnd(textNode, selectedRubyRange.end);
    selection.removeAllRanges();
    selection.addRange(range);
  });

  const addButton = container.createEl("button", {
    cls: "annotation-btn annotation-btn-secondary annotation-toolbar-ruby-add",
    text: "添加",
    attr: { type: "button" },
  });

  const list = container.createDiv({ cls: "annotation-ruby-list" });
  const renderList = () => {
    list.empty();
    if (rubyTexts.length === 0) {
      list.createDiv({ text: "暂无注音", cls: "annotation-ruby-empty" });
      return;
    }

    rubyTexts.forEach((ruby, index) => {
      const item = list.createDiv({ cls: "annotation-ruby-item" });
      item.createSpan({
        text: `${selectedText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
        cls: "annotation-ruby-item-text",
      });
      const deleteBtn = item.createEl("button", {
        text: "×",
        cls: "annotation-ruby-item-delete",
        attr: { type: "button", "aria-label": "删除注音" },
      });
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        rubyTexts.splice(index, 1);
        onItemsChange?.([...rubyTexts]);
        renderList();
        onDraftChange?.();
      });
    });
  };

  addButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canAddRuby()) {
      return;
    }

    const rubyValue = input.value.trim();
    const selection = window.getSelection();
    let selectedRubyText = "";
    let rubyStart = 0;

    if (selection && !selection.isCollapsed) {
      selectedRubyText = selection.toString();
      const range = selection.getRangeAt(0);
      const rubyTextOffset = calculateRangeOffsetInElement(range, textPreview);
      if (rubyTextOffset) {
        rubyStart = rubyTextOffset.start;
      }
    } else if (selectedRubyRange) {
      selectedRubyText = selectedText.substring(selectedRubyRange.start, selectedRubyRange.end);
      rubyStart = selectedRubyRange.start;
    } else if (selectedText.length === 1) {
      selectedRubyText = selectedText;
      rubyStart = 0;
    }

    rubyTexts.push({
      startIndex: rubyStart,
      length: selectedRubyText.length,
      ruby: rubyValue,
    });

    if (selection) {
      selection.removeAllRanges();
    }
    selectedRubyRange = null;
    input.value = "";
    textPreview.setAttribute("data-has-selection", "false");
    helper.textContent = "";
    onItemsChange?.([...rubyTexts]);
    renderList();
    syncAddButton();
  });

  renderList();
  syncAddButton();

  return {
    input,
    preview: textPreview,
    addButton,
    renderList,
  };
}
