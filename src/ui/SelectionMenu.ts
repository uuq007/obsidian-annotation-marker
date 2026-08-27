import { App, MarkdownView, Notice, Platform, normalizePath, type EditorPosition } from "obsidian";
import { EditorView } from "@codemirror/view";
import type { AnnotationColor, AnnotationRuby, BlockSegment, AnnotationPluginSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { COLOR_CLASSES, getActiveColors } from "../constants";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { calculateRangeOffsetInElement, generateId } from "../utils/helpers";
import { buildMarkTag, PartialWikiLinkError } from "../annotationFile/annotationSerializer";
import { restoreEditorFocus } from "../utils/focusManager";
import { showSelectionHighlight, clearSelectionHighlight } from "../utils/selectionHighlight";
import { t } from "../i18n";

// 移动端注音预览划选的选区稳定防抖时长（ms）
const RUBY_SELECTION_DEBOUNCE_MS = 300;

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
  // 文本预览 span 引用（移动端 updateSelection 原地更新待标注内容用）
  private textPreviewSpan: HTMLSpanElement | null = null;
  // createAnnotation 重入门闩：await 文件写入期间菜单仍可见，色点/保存按钮可再次触发，
  // 会造成 replaceRange 双重执行（mark 嵌套）或文件路径重复插入
  private creating = false;
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
  // 移动端可视视口 resize 监听（软键盘弹出收缩视口时把菜单钳回可见范围）
  private vvResizeHandler: (() => void) | null = null;
  // 移动端注音预览划选监听的清理函数
  private rubyMobileSelectionCleanup: (() => void) | null = null;

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
    const maxLen = this.getSettings().maxNoteLength;
    const loc = t();

    this.menuEl = createDiv();
    this.menuEl.className = "annotation-card-menu annotation-selection-menu";

    // 阻止菜单内的事件冒泡到 document，防止 Obsidian 焦点管理器抢走输入框焦点
    this.menuEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.menuEl.addEventListener("mouseup", (e) => e.stopPropagation());
    this.menuEl.addEventListener("focusin", (e) => e.stopPropagation());

    // 标题栏
    const header = this.menuEl.createDiv({ cls: "annotation-menu-header" });
    header.createSpan({ text: loc.menuAddAnnotation, cls: "annotation-menu-title" });
    const closeBtn = header.createEl("button", { cls: "annotation-menu-close", text: loc.close });
    closeBtn.addEventListener("click", () => this.hide());

    const scrollableContent = this.menuEl.createDiv({ cls: "annotation-menu-scrollable-content" });

    // 文本预览
    const textPreview = scrollableContent.createDiv({ cls: "annotation-menu-preview" });
    this.textPreviewSpan = textPreview.createSpan();
    const previewText = this.selectedText.length > 80
      ? this.selectedText.substring(0, 80) + "..."
      : this.selectedText;
    this.textPreviewSpan.textContent = `"${previewText}"`;

    // 颜色选择
    const colorSection = scrollableContent.createDiv({ cls: "annotation-menu-section" });
    colorSection.createEl("label", { text: loc.menuSelectColor });
    this.colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });

    const settings = this.getSettings();
    const colors: AnnotationColor[] = getActiveColors(settings);
    const settingsMap = settings as unknown as Record<string, unknown>;
    for (const c of colors) {
      const btn = this.colorContainer.createEl("button", {
        cls: `annotation-color-dot ${COLOR_CLASSES[c]}`,
      });
      if (c === this.selectedColor) btn.addClass("active");
      const colorLabel = typeof settingsMap[`colorLabel${c}`] === "string"
        ? (settingsMap[`colorLabel${c}`] as string)
        : loc.colorLabel(c);
      btn.title = c === "none" ? loc.none : colorLabel;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectedColor = c;
        this.colorContainer!.querySelectorAll(".annotation-color-dot")
          .forEach((b) => b.removeClass("active"));
        btn.addClass("active");

        // 如果没批注也没注音，选色后直接标注
        if (c !== "none" && !this.pendingNote && this.rubyTexts.length === 0) {
          void this.createAnnotation("");
          return;
        }
      });
    }

    // 批注输入
    const noteSection = scrollableContent.createDiv({ cls: "annotation-menu-section" });
    const noteLabel = noteSection.createDiv({ cls: "annotation-note-label-row" });
    noteLabel.createEl("label", { text: loc.menuOrAddNote });
    const charCount = noteLabel.createSpan({ cls: "annotation-char-count", text: loc.charCount(0, maxLen) });

    this.noteInput = noteSection.createEl("textarea", {
      cls: "annotation-note-input-small",
      placeholder: loc.notePlaceholder(maxLen),
    });
    this.noteInput.setAttribute("maxlength", String(maxLen));
    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput!.value.length;
      this.pendingNote = this.noteInput!.value;
      charCount.textContent = loc.charCount(len, maxLen);
      charCount.toggleClass("annotation-char-count-error", len > maxLen);
    });

    // 注音区域
    this.buildRubySection(noteSection);

    // 底部操作栏
    const actionRow = this.menuEl.createDiv({ cls: "annotation-action-row" });

    const copyBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-btn-small",
      text: loc.copy,
    });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(this.selectedText);
      new Notice(loc.noticeCopied);
    });

    const saveBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-primary annotation-btn-small",
      text: loc.save,
    });
    saveBtn.addEventListener("click", (e) => {
      void (async () => {
        e.stopPropagation();
        const note = this.noteInput!.value.trim();
        if (note.length > maxLen) {
          new Notice(loc.noteTooLong(maxLen));
          return;
        }
        await this.createAnnotation(note);
      })();
    });

    const fullTextBtn = actionRow.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annotation-btn-small",
      text: loc.menuFullText,
    });
    fullTextBtn.addEventListener("click", (e) => {
      void (async () => {
        e.stopPropagation();
        const note = this.noteInput!.value.trim();
        if (note.length > maxLen) {
          new Notice(loc.noteTooLong(maxLen));
          return;
        }
        await this.createAnnotation(note, true);
      })();
    });

    activeDocument.body.appendChild(this.menuEl);

    // 定位菜单
    window.requestAnimationFrame(() => {
      if (!this.menuEl) return;
      this.positionMenuAt(params.x, params.y);

      // 克隆 DOM 选区并用高亮层渲染临时背景——一旦后续聚焦输入框，浏览器会把原生
      // 选区移进输入框内，笔记区原选区的视觉就只剩这份克隆高亮（移动端尤其依赖它）
      const selection = activeDocument.getSelection();
      if (selection && selection.rangeCount > 0) {
        showSelectionHighlight(selection.getRangeAt(0).cloneRange());
      }
      // 自动聚焦批注输入框。
      // 桌面端：必须在 rAF 内且注册顺序晚于 hide() 触发的 restoreEditorFocus（focusManager.ts
      // 会在 rAF 中把非编辑器焦点抢回 CM），同帧按注册顺序执行后焦点最终落在输入框。
      // 移动端不自动聚焦：弹菜单一瞬拉起软键盘会把布局顶飞；用户 tap 输入框时才聚焦
      if (!Platform.isMobile) {
        this.noteInput?.focus({ preventScroll: true });
      }

      // 移动端监听可视视口收缩（软键盘弹出）：把菜单顶端钳回可视范围内
      if (Platform.isMobile && window.visualViewport) {
        this.vvResizeHandler = () => this.handleVisualViewportResize();
        window.visualViewport.addEventListener("resize", this.vvResizeHandler);
      }
    });
  }

  // 按锚点坐标定位菜单：左右翻转 + 视口边界钳制（show 与移动端 updateSelection 共用）
  private positionMenuAt(x: number, y: number): void {
    if (!this.menuEl) return;
    // 用真实渲染宽度参与翻转判定（CSS max-width 随视口收缩，写死常量在小屏上会失准）
    const menuWidth = this.menuEl.offsetWidth || 280;
    const menuHeight = this.menuEl.offsetHeight || 200;

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

    this.menuEl.setCssStyles({
      left: `${Math.max(10, menuX)}px`,
      top: `${Math.max(10, menuY)}px`,
    });
  }

  // 软键盘弹出收缩可视视口时，把菜单顶端钳回可视范围（低度干预，只上移不跟随）
  private handleVisualViewportResize(): void {
    const vv = window.visualViewport;
    if (!vv || !this.menuEl) return;
    const limit = vv.height + vv.offsetTop - this.menuEl.offsetHeight - 10;
    const top = parseInt(this.menuEl.style.top || "0", 10);
    if (top > limit) {
      this.menuEl.setCssStyles({ top: `${Math.max(10, limit)}px` });
    }
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
        this.rubyTextContainer!.setCssStyles({ display: "block" });
        this.rubyTextInput!.focus();
        window.requestAnimationFrame(() => this.adjustMenuPosition());
      } else {
        this.rubyTextContainer!.setCssStyles({ display: "none" });
        this.rubyTexts = [];
        this.updateRubyList?.();
      }
    });
    rubyRow.createEl("label", { text: loc.menuRuby });

    this.rubyTextContainer = rubySection.createDiv({ cls: "annotation-ruby-input-container" });
    if (!this.rubyTextEnabled) {
      this.rubyTextContainer.setCssStyles({ display: "none" });
    }

    // 注音预览
    const rubyPreview = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-preview" });
    rubyPreview.createEl("label", { text: loc.menuRubySelectText });
    this.rubyTextPreview = rubyPreview.createDiv({
      cls: "annotation-ruby-text-preview",
      text: this.selectedText,
    });
    this.rubyTextPreview.setAttribute("data-selected-text", this.selectedText);

    // 监听预览区域的选区
    this.rubyTextPreview.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      window.setTimeout(() => this.captureRubyPreviewSelection(), 10);
    });

    if (Platform.isMobile) {
      // 移动端长按划选预览文字不会触发 mouseup：菜单打开期间挂防抖 selectionchange，
      // 选区稳定且仍落在预览内时记录注音范围（main.ts 全局入口因 isOpened() 会短路，不会重建菜单）
      let timer: number | null = null;
      const handler = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = null;
          this.captureRubyPreviewSelection();
        }, RUBY_SELECTION_DEBOUNCE_MS);
      };
      activeDocument.addEventListener("selectionchange", handler);
      this.rubyMobileSelectionCleanup = () => {
        if (timer !== null) window.clearTimeout(timer);
        activeDocument.removeEventListener("selectionchange", handler);
      };
    }

    // 注音输入
    const rubyInputRow = this.rubyTextContainer.createDiv({ cls: "annotation-ruby-input-row" });
    rubyInputRow.createEl("label", { text: loc.menuRubyContent });
    this.rubyTextInput = rubyInputRow.createEl("input", {
      type: "text",
      cls: "annotation-ruby-input",
      placeholder: loc.menuRubyPlaceholder,
    });

    // 聚焦时恢复选区
    this.rubyTextInput.addEventListener("focus", () => {
      if (this.selectedRubyRange) {
        const sel = window.getSelection();
        if (sel) {
          const textNode = this.rubyTextPreview!.firstChild;
          if (textNode) {
            const range = activeDocument.createRange();
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
      text: loc.add,
      cls: "annotation-btn annotation-btn-small",
    });
    addRubyBtn.addEventListener("click", () => this.addRuby());

    // 已添加注音列表
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
            text: `${this.selectedText.substring(ruby.startIndex, ruby.startIndex + ruby.length)} → ${ruby.ruby}`,
            cls: "annotation-ruby-item-text",
          });
          const deleteBtn = item.createEl("button", {
            text: loc.close,
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

  // 记录落在注音预览文本内的选区（桌面 mouseup 与移动端 selectionchange 共用）
  private captureRubyPreviewSelection(): void {
    if (!this.rubyTextPreview || !this.menuEl) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // 只认完全落在预览元素内部的选区，避免把笔记正文选区误记为注音范围
    if (
      !this.rubyTextPreview.contains(range.startContainer) ||
      !this.rubyTextPreview.contains(range.endContainer)
    ) {
      return;
    }
    const offset = calculateRangeOffsetInElement(range, this.rubyTextPreview);
    if (offset) {
      this.selectedRubyRange = { start: offset.start, end: offset.end };
    }
  }

  private addRuby(): void {
    const loc = t();
    const sel = window.getSelection();
    let selectedRubyText = "";
    let rubyStart = 0;

    if (sel && !sel.isCollapsed) {
      // 实时选区必须完全落在注音预览内：用户若在批注框/正文里划选后点"添加"，
      // 直接计算会得到相对预览的错误锚点
      const range = sel.getRangeAt(0);
      const preview = this.rubyTextPreview;
      const insidePreview = !!preview &&
        preview.contains(range.startContainer) &&
        preview.contains(range.endContainer);
      if (insidePreview) {
        selectedRubyText = sel.toString();
        // insidePreview（aliased condition）为真时 preview 已被收窄为 HTMLElement，无需断言
        const offset = calculateRangeOffsetInElement(range, preview);
        if (offset) rubyStart = offset.start;
      }
    }

    if (!selectedRubyText && this.selectedRubyRange) {
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
      new Notice(loc.noticeRubySelect);
    } else {
      new Notice(loc.noticeRubyInput);
    }
  }

  private async createAnnotation(note: string, isFullText = false): Promise<void> {
    if (!this.currentNotePath || this.creating) return;
    const loc = t();
    this.creating = true;

    try {
      // 全文标注不支持注音
      const rubyTexts = !isFullText && this.rubyTextEnabled && this.rubyTexts.length > 0
        ? this.rubyTexts
        : undefined;

      // 编辑模式 + 普通标注（非全文/跨段）：直接用 replaceRange 局部替换。
      // 菜单挂在 body 上，切换到其他 md 标签页并不会关闭菜单——必须校验活动视图
      // 确实是当前标注文件的视图，否则 getValue/写回会把别的笔记内容写进本笔记的标注文件
      if (this.editorRange && !isFullText && !(this.blockSegments && this.blockSegments.length > 0)) {
        const view = this.app?.workspace.getActiveViewOfType(MarkdownView);
        const expectedAnnotationPath = normalizePath(this.fileManager.getAnnotationFilePath(this.currentNotePath));
        if (view && view.file?.path === expectedAnnotationPath) {
          const id = generateId();
          const markTag = buildMarkTag(id, this.selectedText, this.selectedColor, note || undefined, rubyTexts);

          view.editor.replaceRange(markTag, this.editorRange.from, this.editorRange.to);

          // 将光标移到标注范围外，防止实时预览展开 HTML 源码（cm 为 Obsidian 非公开属性）
          const cm = (view.editor as unknown as { cm: EditorView }).cm;
          const cursorPos = cm.state.selection.main.head;
          if (cursorPos < cm.state.doc.length) {
            cm.dispatch({ selection: { anchor: cursorPos + 1 } });
          } else if (cursorPos > 0) {
            cm.dispatch({ selection: { anchor: cursorPos - 1 } });
          }

          // 将编辑器新内容写回标注文件
          const newContent = view.editor.getValue();
          await this.fileManager.writeAnnotationFile(this.currentNotePath, newContent);

          window.getSelection()?.removeAllRanges();
          this.hide();
          new Notice(note || rubyTexts ? loc.noticeAnnotationAndNoteAdded : loc.noticeAnnotationAdded);
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
          await new Promise(resolve => window.setTimeout(resolve, 100));
          this.onAddCallback();
        }
        if (isFullText) {
          new Notice(loc.fullTextAnnotation(result.positions.length));
        } else {
          new Notice(note || rubyTexts ? loc.noticeAnnotationAndNoteAdded : loc.noticeAnnotationAdded);
        }
      } else {
        new Notice(loc.noticeTextNotFound);
      }
    } catch (e) {
      if (e instanceof PartialWikiLinkError) {
        new Notice(loc.noticePartialWikiLink);
        return;
      }
      console.error("添加标注失败:", e);
      new Notice(loc.noticeAddFailed);
    } finally {
      this.creating = false;
    }
  }

  hide(): void {
    // 注销移动端可视视口监听
    if (this.vvResizeHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.vvResizeHandler);
      this.vvResizeHandler = null;
    }
    // 注销移动端注音预览划选监听
    this.rubyMobileSelectionCleanup?.();
    this.rubyMobileSelectionCleanup = null;
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    // 菜单关闭时清除原选区的临时高亮
    clearSelectionHighlight();
    // 移动端关闭时同时塌陷原生选区：所有关闭路径（点 × / 标注成功 / 切文件 / 卸载）
    // 都不留蓝紫选区残影（对 createAnnotation 成功路径幂等；标注写入不依赖实时选区）
    if (Platform.isMobile) {
      activeDocument.getSelection()?.removeAllRanges();
    }
    // 菜单关闭后恢复编辑器焦点
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) restoreEditorFocus(view);
  }

  isOpened(): boolean {
    return this.menuEl !== null;
  }

  // 当前菜单正在展示的选区文本（移动端 handleMobileSelectionStable 判断"内容未变则不刷新"用）
  getSelectedText(): string {
    return this.selectedText;
  }

  // 移动端：菜单打开期间拖动选择手柄 / 二次划选后，原地更新待标注内容。
  // 只替换选区相关状态（文本预览、选区参数、克隆高亮、菜单位置）；
  // 已输入的批注（noteInput/pendingNote）与所选颜色保留；
  // 注音数据锚定旧选区的字符偏移，随选区变化作废重置（注音开关勾选态保留）
  updateSelection(params: {
    x: number;
    y: number;
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    startLine?: number;
    endLine?: number;
    occurrence?: number;
    blockSegments?: BlockSegment[];
    editorRange?: { from: EditorPosition; to: EditorPosition };
  }): void {
    if (!this.menuEl) return;

    this.selectedText = params.selectedText;
    this.contextBefore = params.contextBefore;
    this.contextAfter = params.contextAfter;
    this.startLine = params.startLine;
    this.endLine = params.endLine;
    this.occurrence = params.occurrence;
    this.blockSegments = params.blockSegments ?? null;
    this.editorRange = params.editorRange ?? null;

    // 文本预览原地更新
    const previewText = this.selectedText.length > 80
      ? this.selectedText.substring(0, 80) + "..."
      : this.selectedText;
    if (this.textPreviewSpan) {
      this.textPreviewSpan.textContent = `"${previewText}"`;
    }

    // 注音重置
    this.rubyTexts = [];
    this.selectedRubyRange = null;
    if (this.rubyTextPreview) {
      this.rubyTextPreview.textContent = this.selectedText;
      this.rubyTextPreview.setAttribute("data-selected-text", this.selectedText);
    }
    this.updateRubyList?.();

    // 克隆高亮跟随新选区（此刻原生选区就是手柄调整后的新选区；同名 set 直接覆盖旧高亮）
    const selection = activeDocument.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      showSelectionHighlight(selection.getRangeAt(0).cloneRange());
    } else {
      clearSelectionHighlight();
    }

    // 菜单重新锚定到新选区旁
    window.requestAnimationFrame(() => this.positionMenuAt(params.x, params.y));
  }

  getCurrentNotePath(): string | null {
    return this.menuEl ? this.currentNotePath : null;
  }

  // 快捷键命令路径 A：弹窗已打开时复用其保存的选区状态（等价于"选色 + 保存"）。
  // 不预先 hide：阅读模式下 textarea 聚焦已使 DOM 选区失效，菜单字段是唯一可靠的
  // 选区记录；createAnnotation 成功后自带 hide()，失败时菜单保留便于换色重试
  async annotateWithColor(color: AnnotationColor): Promise<void> {
    this.selectedColor = color;
    // 同步颜色圆点选中态（标注失败菜单保留时保持 UI 一致）
    this.colorContainer?.querySelectorAll(".annotation-color-dot").forEach((b) => {
      b.toggleClass("active", b.hasClass(COLOR_CLASSES[color]));
    });
    const note = this.noteInput ? this.noteInput.value.trim() : this.pendingNote.trim();
    await this.createAnnotation(note);
  }

  // 快捷键命令路径 B/C：弹窗未打开时的"无头"标注——填好字段后直接走 createAnnotation，
  // 完整继承编辑器/文件两条路径、Notice 与成功回调（params 结构即 show() 入参去掉 x/y）
  async annotateDirectly(params: {
    notePath: string;
    selectedText: string;
    color: AnnotationColor;
    contextBefore?: string;
    contextAfter?: string;
    startLine?: number;
    endLine?: number;
    occurrence?: number;
    blockSegments?: BlockSegment[];
    editorRange?: { from: EditorPosition; to: EditorPosition };
    onAdd: () => void;
  }): Promise<void> {
    this.hide();
    // 字段初始化镜像 show() 开头的赋值
    this.currentNotePath = params.notePath;
    this.selectedText = params.selectedText;
    this.contextBefore = params.contextBefore ?? "";
    this.contextAfter = params.contextAfter ?? "";
    this.startLine = params.startLine;
    this.endLine = params.endLine;
    this.occurrence = params.occurrence;
    this.onAddCallback = params.onAdd;
    this.selectedColor = params.color;
    this.pendingNote = "";
    this.rubyTexts = [];
    this.rubyTextEnabled = false;
    this.selectedRubyRange = null;
    this.blockSegments = params.blockSegments ?? null;
    this.editorRange = params.editorRange ?? null;
    await this.createAnnotation("");
  }

  private adjustMenuPosition(): void {
    if (!this.menuEl) return;
    const menuHeight = this.menuEl.offsetHeight || 200;
    const currentTop = parseInt(this.menuEl.style.top || "0", 10);
    if (currentTop + menuHeight > window.innerHeight - 20) {
      this.menuEl.setCssStyles({ top: `${Math.max(10, window.innerHeight - menuHeight - 20)}px` });
    }
  }
}
