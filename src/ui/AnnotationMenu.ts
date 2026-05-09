import { Notice } from "obsidian";
import type { AnnotationColor, ParsedAnnotation } from "../types";
import { COLOR_LABELS } from "../constants";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { EditNoteModal } from "./EditNoteModal";

// 标注详情的浮动菜单（点击已有标注时弹出）
export class AnnotationMenu {
  private fileManager: AnnotationFileManager;
  private menuEl: HTMLElement | null = null;

  constructor(fileManager: AnnotationFileManager) {
    this.fileManager = fileManager;
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

    this.menuEl = document.createElement("div");
    this.menuEl.className = "annotation-card-menu annotation-view-menu";

    // 标题栏
    const header = this.menuEl.createDiv({ cls: "annotation-menu-header" });
    header.createEl("span", { text: "标注详情", cls: "annotation-menu-title" });
    const closeBtn = header.createEl("button", { cls: "annotation-menu-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hide());

    // 文本预览
    const textPreview = this.menuEl.createDiv({ cls: "annotation-menu-text" });
    const previewText = annotation.text.length > 80
      ? annotation.text.substring(0, 80) + "..."
      : annotation.text;
    textPreview.createEl("span", { text: `"${previewText}"` });

    // 全文标注提示
    if (annotation.isFullText && annotation.positions.length > 1) {
      const fullTextHint = this.menuEl.createDiv({ cls: "annotation-fulltext-hint" });
      fullTextHint.createEl("span", { text: `全文标注（共 ${annotation.positions.length} 处）` });
    }

    // 批注内容
    if (annotation.note) {
      const noteSection = this.menuEl.createDiv({ cls: "annotation-menu-note" });
      noteSection.createEl("label", { text: "批注内容" });
      noteSection.createEl("div", { cls: "annotation-note-text", text: annotation.note });
    }

    // 颜色选择
    const colorSection = this.menuEl.createDiv({ cls: "annotation-menu-section" });
    colorSection.createEl("label", { text: "标注颜色" });
    const colorContainer = colorSection.createDiv({ cls: "annotation-color-buttons" });

    const colors: AnnotationColor[] = ["red", "yellow", "green", "blue", "purple", "none"];
    for (const c of colors) {
      const btn = colorContainer.createEl("button", {
        cls: `annotation-color-dot color-${c}`,
      });
      if (c === annotation.color) btn.addClass("active");
      btn.title = COLOR_LABELS[c];
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (c !== annotation.color) {
          await this.fileManager.updateAnnotation(notePath, annotation.id, { color: c });
          this.hide();
          onUpdate();
          new Notice("标注颜色已修改");
        }
      });
    }

    // 操作按钮
    const actions = this.menuEl.createDiv({ cls: "annotation-menu-actions" });

    const editBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: "编辑批注",
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showEditModal(annotation, notePath, onUpdate);
    });

    const copyBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: "复制原文",
    });
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(annotation.text);
      new Notice("已复制原文到剪贴板");
    });

    const deleteBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-danger",
      text: "删除",
    });
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const msg = annotation.isFullText && annotation.positions.length > 1
        ? `确定删除全部 ${annotation.positions.length} 处标注？`
        : "确定删除此标注？";
      if (!confirm(msg)) return;
      await this.fileManager.removeAnnotation(notePath, annotation.id);
      this.hide();
      onUpdate();
      new Notice("标注已删除");
    });

    document.body.appendChild(this.menuEl);

    // 定位菜单
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

    // 点击外部关闭
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
    const modal = new EditNoteModal(
      (this.fileManager as any).app,
      {
        text: annotation.text,
        note: annotation.note,
        color: annotation.color,
        rubyTexts: annotation.rubyTexts,
      },
      async (note, color, rubyTexts) => {
        await this.fileManager.updateAnnotation(notePath, annotation.id, {
          color,
          note,
          rubyTexts,
        });
        onUpdate();
        new Notice("批注已更新");
      }
    );
    modal.open();
  }

  hide(): void {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }
}
