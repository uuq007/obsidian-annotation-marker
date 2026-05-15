import { App, MarkdownView, Notice, type EditorPosition } from "obsidian";
import type { AnnotationColor, AnnotationRuby, BlockSegment, AnnotationPluginSettings } from "../types";
import { COLOR_NUMBERS, DEFAULT_SETTINGS } from "../types";
import { ALL_COLORS, COLOR_CLASSES } from "../constants";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { calculateRangeOffsetInElement, generateId } from "../utils/helpers";
import { buildMarkTag } from "../annotationFile/annotationSerializer";

// 添加标注的浮动菜单
export class SelectionMenu {
  private fileManager: AnnotationFileManager;
  private getSettings: () => AnnotationPluginSettings;
  private menuEl: HTMLElement | null = null;
  private selectedColor: AnnotationColor = DEFAULT_SETTINGS.defaultColor;
  private currentNotePath: string | null = null;
  private selectedText = "";
  private contextBefore = "";
  private contextAfter = "";
  private startLine: number | undefined;
  private endLine: number | undefined;
  private occurrence: number | undefined;
  private onAddCallback: (() => void) | null = null;
  private pendingNote = "";
  private noteInput: HTMLTextAreaElement | null = null;
  private colorContainer: HTMLElement | null = null;
  private rubyTextEnabled = false;
  private rubyTexts: AnnotationRuby[] = [];
  private rubyTextInput: HTMLInputElement | null = null;
  private rubyTextContainer: HTMLElement | null = null;
  private rubyTextPreview: HTMLElement | null = null;
  private selectedRubyRange: { start: number; end: number } | null = null;
  private updateRubyList: (() => void) | null = null;
  private blockSegments: BlockSegment[] | null = null;
  private editorRange: { from: EditorPosition; to: EditorPosition } | null = null;

  constructor(private app: App, fileManager: AnnotationFileManager, getSettings: () => AnnotationPluginSettings) {
    this.fileManager = fileManager;
    this.getSettings = getSettings;
  }

  show(params: {
    x: number;
    y: number;
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    notePath: string;
    startLine?: number;
    endLine?: number;
    occurrence?: number;
    blockSegments?: BlockSegment[];
    editorRange?: { from: EditorPosition; to: EditorPosition };
    onAdd: () => void;
  }): void {
    this.hide();

    this.currentNotePath = params.notePath;
    this.selectedText = params.selectedText;
    this.contextBefore = params.contextBefore;
    this.contextAfter = params.contextAfter;
    this.startLine = params.startLine;
    this.endLine = params.endLine;
    this.occurrence = params.occurrence;
    this.onAddCallback = params.onAdd;
    this.selectedColor = this.getSettings().defaultColor;
    this.pendingNote = "";
    this.rubyTexts = [];
    this.rubyTextEnabled = false;
    this.selectedRubyRange = null;
    this.blockSegments = params.blockSegments ?? null;
    this.editorRange = params.editorRange ?? null;

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-selection-menu";

    // 阻止菜单内的事件冒泡到 document，防止 Obsidian 焦点管理器抢走输入框焦点
    this.menuEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.menuEl.addEventListener("mouseup", (e) => e.stopPropagation());
    this.menuEl.addEventListener("focusin", (e) => e.stopPropagation());

    // 标题栏
    const header = this.menuEl.createDiv({ cls: "annotation-menu-header" });
    header.createEl("span", { text: "添加标注", cls: "annotation-menu-title" });
    const closeBtn = header.createEl("button", { cls: "annotation-menu-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hide());

    const scrollableContent = this.menuEl.createDiv({ cls: "annotation-menu-scrollable-content" });

    // 文本预览
    const textPreview = scrollableContent.createDiv({ cls: "annotation-menu-preview" });
    const previewText = this.selectedText.length > 80
      ? this.selectedText.substring(0, 80) + "..."
      : this.selectedText;
    textPreview.createEl("span", { text: `"${previewText}"` });

    // 颜色选择
    const colorSection = scrollableContent.createDiv({ cls: "annotation-menu-section" });
    colorSection.createEl("label", { text: "选择颜色立即标注" });
    this.colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });

    const colors: AnnotationColor[] = [...ALL_COLORS];
    const settings = this.getSettings();
    for (const c of colors) {
      const btn = this.colorContainer.createEl("button", {
        cls: `annotation-color-dot ${COLOR_CLASSES[c]}`,
      });
      if (c === this.selectedColor) btn.addClass("active");
      btn.title = c === "none" ? "无色" : (settings as any)[`colorLabel${c}`] ?? `颜色${c}`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectedColor = c;
        this.colorContainer!.querySelectorAll(".annotation-color-dot")
          .forEach((b) => b.removeClass("active"));
        btn.addClass("active");

        // 如果没批注也没注音，选色后直接标注
        if (c !== "none" && !this.pendingNote && this.rubyTexts.length === 0) {
          this.createAnnotation("");
          return;
        }
      });
    }

    // 批注输入
    const noteSection = scrollableContent.createDiv({ cls: "annotation-menu-section" });
    const noteLabel = noteSection.createDiv({ cls: "annotation-note-label-row" });
    noteLabel.createEl("label", { text: "或添加批注" });
    const charCount = noteLabel.createSpan({ cls: "annotation-char-count", text: "(0/400)" });

    this.noteInput = noteSection.createEl("textarea", {
      cls: "annotation-note-input-small",
      placeholder: "输入批注内容（可选，最多400字）...",
    });
    this.noteInput.setAttribute("maxlength", "400");
    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput!.value.length;
      this.pendingNote = this.noteInput!.value;
      charCount.textContent = `(${len}/400)`;
      charCount.toggleClass("annotation-char-count-error", len > 400);
    });

    // 注音区域
    this.buildRubySection(noteSection);

    // 底部操作栏
    const actionRow = this.menuEl.createDiv({ cls: "annotation-action-row" });

    const copyBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-btn-small",
      text: "复制",
    });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(this.selectedText);
      new Notice("已复制到剪贴板");
    });

    const saveBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-primary annotation-btn-small",
      text: "保存",
    });
    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const note = this.noteInput!.value.trim();
      if (note.length > 400) {
        new Notice("批注内容不能超过400字");
        return;
      }
      await this.createAnnotation(note);
    });

    const fullTextBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-btn-small",
      text: "全文标注",
    });
    fullTextBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const note = this.noteInput!.value.trim();
      if (note.length > 400) {
        new Notice("批注内容不能超过400字");
        return;
      }
      await this.createAnnotation(note, true);
    });

    document.body.appendChild(this.menuEl);

    // 定位菜单
    requestAnimationFrame(() => {
      if (!this.menuEl) return;
      const menuWidth = 280;
      const menuHeight = this.menuEl.offsetHeight || 200;

      let menuX = params.x + 10;
      let menuY = params.y + 10;

      if (menuX + menuWidth > window.innerWidth) {
        menuX = params.x - menuWidth - 10;
      }

      const threshold = window.innerHeight * 0.4;
      if (params.y > threshold) {
        menuY = params.y - menuHeight - 10;
      }
      if (menuY + menuHeight > window.innerHeight) {
        menuY = window.innerHeight - menuHeight - 10;
      }

      this.menuEl.style.left = `${Math.max(10, menuX)}px`;
      this.menuEl.style.top = `${Math.max(10, menuY)}px`;
    });

    // 点击外部关闭
    const clickHandler = (e: MouseEvent) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.hide();
        document.removeEventListener("click", clickHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", clickHandler), 10);
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
        requestAnimationFrame(() => this.adjustMenuPosition());
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

    // 注音预览
    const rubyPreview = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-preview" });
    rubyPreview.createEl("label", { text: "划选需要注音的文字：" });
    this.rubyTextPreview = rubyPreview.createDiv({
      cls: "annotation-ruby-text-preview",
      text: this.selectedText,
    });
    this.rubyTextPreview.setAttribute("data-selected-text", this.selectedText);

    // 监听预览区域的选区
    this.rubyTextPreview.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const offset = calculateRangeOffsetInElement(range, this.rubyTextPreview!);
          if (offset) {
            this.selectedRubyRange = { start: offset.start, end: offset.end };
          }
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

    // 聚焦时恢复选区
    this.rubyTextInput.addEventListener("focus", () => {
      if (this.selectedRubyRange) {
        const sel = window.getSelection();
        if (sel) {
          const textNode = this.rubyTextPreview!.firstChild;
          if (textNode) {
            const range = document.createRange();
            range.setStart(textNode, this.selectedRubyRange.start);
            range.setEnd(textNode, this.selectedRubyRange.end);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }
    });

    // 添加注音按钮
    const addRubyBtn = rubyInputRow.createEl("button", {
      text: "添加",
      cls: "annotation-btn annotation-btn-small",
    });
    addRubyBtn.addEventListener("click", () => this.addRuby());

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
            text: `${this.selectedText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
            cls: "annotation-ruby-item-text",
          });
          const deleteBtn = item.createEl("button", {
            text: "×",
            cls: "annotation-ruby-item-delete",
          });
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

  private addRuby(): void {
    const sel = window.getSelection();
    let selectedRubyText = "";
    let rubyStart = 0;

    if (sel && !sel.isCollapsed) {
      selectedRubyText = sel.toString();
      const range = sel.getRangeAt(0);
      const offset = calculateRangeOffsetInElement(range, this.rubyTextPreview!);
      if (offset) rubyStart = offset.start;
    } else if (this.selectedRubyRange) {
      selectedRubyText = this.selectedText.substring(
        this.selectedRubyRange.start,
        this.selectedRubyRange.end
      );
      rubyStart = this.selectedRubyRange.start;
    }

    const rubyValue = this.rubyTextInput!.value.trim();

    if (selectedRubyText && rubyValue) {
      this.rubyTexts.push({ startIndex: rubyStart, length: selectedRubyText.length, ruby: rubyValue });
      this.rubyTextInput!.value = "";
      this.selectedRubyRange = null;
      sel?.removeAllRanges();
      this.updateRubyList?.();
    } else if (!selectedRubyText && this.selectedText.length === 1 && rubyValue) {
      // 单字自动注音
      this.rubyTexts.push({ startIndex: 0, length: 1, ruby: rubyValue });
      this.rubyTextInput!.value = "";
      this.selectedRubyRange = null;
      this.updateRubyList?.();
    } else if (!selectedRubyText) {
      new Notice("请先划选需要注音的文字");
    } else {
      new Notice("请输入注音内容");
    }
  }

  private async createAnnotation(note: string, isFullText = false): Promise<void> {
    if (!this.currentNotePath) return;

    try {
      // 全文标注不支持注音
      const rubyTexts = !isFullText && this.rubyTextEnabled && this.rubyTexts.length > 0
        ? this.rubyTexts
        : undefined;

      // 编辑模式 + 普通标注（非全文/跨段）：直接用 replaceRange 局部替换
      if (this.editorRange && !isFullText && !(this.blockSegments && this.blockSegments.length > 0)) {
        const view = this.app?.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const id = generateId();
          const markTag = buildMarkTag(id, this.selectedText, this.selectedColor, note || undefined, rubyTexts);

          view.editor.replaceRange(markTag, this.editorRange.from, this.editorRange.to);

          // 将编辑器新内容写回标注文件
          const newContent = view.editor.getValue();
          await this.fileManager.writeAnnotationFile(this.currentNotePath, newContent);

          window.getSelection()?.removeAllRanges();
          this.hide();
          new Notice(note || rubyTexts ? "标注和批注已添加" : "标注已添加");
          return;
        }
      }

      let result;

      if (isFullText) {
        result = await this.fileManager.addFullTextAnnotation(this.currentNotePath, {
          text: this.selectedText,
          color: this.selectedColor,
          note: note || undefined,
          isFullText: true,
        });
      } else if (this.blockSegments && this.blockSegments.length > 0) {
        // 跨段标注
        result = await this.fileManager.addCrossBlockAnnotation(this.currentNotePath, {
          text: this.selectedText,
          color: this.selectedColor,
          note: note || undefined,
          rubyTexts,
          blockSegments: this.blockSegments,
        });
      } else {
        result = await this.fileManager.addAnnotation(this.currentNotePath, {
          text: this.selectedText,
          color: this.selectedColor,
          note: note || undefined,
          rubyTexts,
          contextBefore: this.contextBefore,
          contextAfter: this.contextAfter,
          startLine: this.startLine,
          endLine: this.endLine,
          occurrence: this.occurrence,
        });
      }

      if (result) {
        // 清除浏览器文本选区，防止 mouseup handler 再次弹出菜单
        window.getSelection()?.removeAllRanges();
        this.hide();
        if (this.onAddCallback) {
          await new Promise(resolve => setTimeout(resolve, 100));
          this.onAddCallback();
        }
        if (isFullText) {
          new Notice(`全文标注已添加（共 ${result.positions.length} 处）`);
        } else {
          new Notice(note || rubyTexts ? "标注和批注已添加" : "标注已添加");
        }
      } else {
        new Notice("未能在文件中找到选中的文字");
      }
    } catch (e) {
      console.error("添加标注失败:", e);
      new Notice("添加标注失败");
    }
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
    if (currentTop + menuHeight > window.innerHeight - 20) {
      this.menuEl.style.top = `${Math.max(10, window.innerHeight - menuHeight - 20)}px`;
    }
  }
}
