import { App, MarkdownView, Notice } from "obsidian";
import type { AnnotationColor, AnnotationPluginSettings, ParsedAnnotation } from "../types";
import { ALL_COLORS, COLOR_CLASSES } from "../constants";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { EditNoteModal } from "./EditNoteModal";
import { ConfirmOverwriteModal } from "./ExportModal";
import { editAnnotationInEditor } from "../utils/annotationEditorHelper";
import { restoreEditorFocus } from "../utils/focusManager";
import { t } from "../i18n";

// 标注详情的浮动菜单（点击已有标注时弹出）
export class AnnotationMenu {
  private fileManager: AnnotationFileManager;
  private getSettings: () => AnnotationPluginSettings;
  private menuEl: HTMLElement | null = null;

  constructor(private app: App, fileManager: AnnotationFileManager, getSettings: () => AnnotationPluginSettings) {
    this.fileManager = fileManager;
    this.getSettings = getSettings;
  }

  show(params: {
    x: number;
    y: number;
    annotation: ParsedAnnotation;
    notePath: string;
    onUpdate: () => void;
  }): void {
    this.hide();

    const { annotation, notePath, onUpdate } = params;
    const settings = this.getSettings();
    const loc = t();

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-view-menu";

    const header = this.menuEl.createDiv({ cls: "annotation-menu-header" });
    header.createEl("span", { text: loc.menuAnnotationDetail, cls: "annotation-menu-title" });
    const closeBtn = header.createEl("button", { cls: "annotation-menu-close", text: loc.close });
    closeBtn.addEventListener("click", () => this.hide());

    const textPreview = this.menuEl.createDiv({ cls: "annotation-menu-text" });
    const previewText = annotation.text.length > 80
      ? annotation.text.substring(0, 80) + "..."
      : annotation.text;
    textPreview.createEl("span", { text: `"${previewText}"` });

    if (annotation.isFullText && annotation.positions.length > 1) {
      const fullTextHint = this.menuEl.createDiv({ cls: "annotation-fulltext-hint" });
      fullTextHint.createEl("span", { text: loc.fullTextAnnotation(annotation.positions.length) });
    } else if (annotation.isCrossBlock) {
      const crossBlockHint = this.menuEl.createDiv({ cls: "annotation-fulltext-hint" });
      crossBlockHint.createEl("span", { text: loc.crossBlockAnnotation(annotation.positions.length) });
    }

    if (annotation.note) {
      const noteSection = this.menuEl.createDiv({ cls: "annotation-menu-note" });
      noteSection.createEl("label", { text: loc.noteContent });
      noteSection.createEl("div", { cls: "annotation-note-text", text: annotation.note });
    }

    // 颜色选择
    const colorSection = this.menuEl.createDiv({ cls: "annotation-menu-section" });
    colorSection.createEl("label", { text: loc.sidebarAnnotationColor });
    const colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });

    const colors: AnnotationColor[] = [...ALL_COLORS];
    for (const c of colors) {
      const btn = colorContainer.createEl("button", {
        cls: `annotation-color-dot ${COLOR_CLASSES[c]}`,
      });
      if (c === annotation.color) btn.addClass("active");
      btn.title = c === "none" ? loc.none : (settings as any)[`colorLabel${c}`] ?? loc.colorLabel(c);
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (c !== annotation.color) {
          // 编辑模式：用 replaceRange 局部替换
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          const edited = view ? await editAnnotationInEditor(view, this.fileManager, notePath, annotation.id, {
            color: c,
            note: annotation.note,
            rubyTexts: annotation.rubyTexts,
            isFullText: annotation.isFullText,
            isCrossBlock: annotation.isCrossBlock,
          }) : false;
          if (!edited) {
            await this.fileManager.updateAnnotation(notePath, annotation.id, { color: c });
          }
          this.hide();
          onUpdate();
          new Notice(loc.noticeColorChanged);
        }
      });
    }

    const actions = this.menuEl.createDiv({ cls: "annotation-menu-actions" });

    const editBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.menuEditNote,
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showEditModal(annotation, notePath, onUpdate);
    });

    const copyBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.menuCopyOriginal,
    });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(annotation.text);
      new Notice(loc.noticeOriginalCopied);
    });

    const deleteBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-danger",
      text: loc.delete,
    });
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const msg = (annotation.isFullText || annotation.positions.length > 1) && annotation.positions.length > 1
        ? loc.confirmDeleteMulti(annotation.positions.length)
        : loc.confirmDelete;
      // 使用 Obsidian Modal 替代浏览器 confirm()，避免焦点丢失
      new ConfirmOverwriteModal(
        (this.fileManager as any).app,
        msg,
        async () => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          const deleted = view ? await editAnnotationInEditor(view, this.fileManager, notePath, annotation.id, 'delete') : false;
          if (!deleted) {
            await this.fileManager.removeAnnotation(notePath, annotation.id);
          }
          this.hide();
          onUpdate();
          new Notice(loc.noticeDeleted);
        },
        loc.delete
      ).open();
    });

    document.body.appendChild(this.menuEl);

    const menuWidth = 300;
    const menuHeight = this.menuEl.offsetHeight || 250;
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

    const clickHandler = (e: MouseEvent) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.hide();
        document.removeEventListener("click", clickHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", clickHandler), 10);
  }

  private showEditModal(
    annotation: ParsedAnnotation,
    notePath: string,
    onUpdate: () => void
  ): void {
    this.hide();
    const loc = t();
    const modal = new EditNoteModal(
      (this.fileManager as any).app,
      this.getSettings,
      {
        text: annotation.text,
        note: annotation.note,
        color: annotation.color,
        rubyTexts: annotation.rubyTexts,
      },
      async (note, color, rubyTexts) => {
        // 编辑模式：用 replaceRange 局部替换
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const edited = view ? await editAnnotationInEditor(view, this.fileManager, notePath, annotation.id, {
          color,
          note,
          rubyTexts,
          isFullText: annotation.isFullText,
          isCrossBlock: annotation.isCrossBlock,
        }) : false;
        if (!edited) {
          await this.fileManager.updateAnnotation(notePath, annotation.id, {
            color,
            note,
            rubyTexts,
          });
        }
        onUpdate();
        new Notice(loc.noticeNoteUpdated);
      }
    );
    modal.open();
  }

  hide(): void {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
    // 菜单关闭后恢复编辑器焦点
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) restoreEditorFocus(view);
  }
}
