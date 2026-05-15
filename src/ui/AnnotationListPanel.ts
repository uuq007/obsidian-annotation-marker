import { App, MarkdownView, Notice } from "obsidian";
import type { ParsedAnnotation } from "../types";
import { COLOR_CLASSES } from "../constants";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { editAnnotationInEditor } from "../utils/annotationEditorHelper";

// 标注列表浮动面板（右侧按钮打开）
export class AnnotationListPanel {
  private app: App;
  private fileManager: AnnotationFileManager;
  private containerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private listBtn: HTMLElement | null = null;
  private currentNotePath: string | null = null;
  private onUpdate: (() => void) | null = null;
  private sortOption: "position-asc" | "position-desc" | "time-asc" | "time-desc" = "position-asc";
  private panelClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(app: App, fileManager: AnnotationFileManager) {
    this.app = app;
    this.fileManager = fileManager;
  }

  show(params: {
    notePath: string;
    onUpdate: () => void;
    containerEl: HTMLElement;
  }): void {
    this.currentNotePath = params.notePath;
    this.onUpdate = params.onUpdate;
    this.containerEl = params.containerEl;
    this.hide();

    this.createListButton();
  }

  // 创建列表按钮（挂载到传入的容器元素，跟随面板定位）
  private createListButton(): void {
    if (!this.containerEl) return;

    this.listBtn = document.createElement("div");
    this.listBtn.className = "annotation-list-btn";
    this.listBtn.innerHTML = "<span>📝</span>";
    this.listBtn.title = "查看标注";

    this.listBtn.style.position = "absolute";
    this.listBtn.style.right = "20px";
    this.listBtn.style.top = "50%";
    this.listBtn.style.transform = "translateY(-50%)";
    this.listBtn.style.zIndex = "100";

    this.containerEl.appendChild(this.listBtn);

    this.listBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.panelEl && this.panelEl.style.display !== "none") {
        this.hidePanel();
      } else {
        this.showPanel();
      }
    });
  }

  private async showPanel(): Promise<void> {
    if (!this.currentNotePath) return;
    this.hidePanel();

    this.panelEl = document.createElement("div");
    this.panelEl.className = "annotation-list-panel";

    // 标题栏
    const header = this.panelEl.createDiv({ cls: "annotation-list-header" });
    header.createEl("span", { text: "标注列表", cls: "annotation-list-title" });

    // 排序选择
    const sortContainer = header.createDiv({ cls: "annotation-list-sort-container" });
    const sortSelect = sortContainer.createEl("select", { cls: "annotation-list-sort-select" });
    sortSelect.innerHTML = `
      <option value="position-asc" ${this.sortOption === "position-asc" ? "selected" : ""}>按内容顺序（从上到下）</option>
      <option value="position-desc" ${this.sortOption === "position-desc" ? "selected" : ""}>按内容倒序（从下到上）</option>
      <option value="time-asc" ${this.sortOption === "time-asc" ? "selected" : ""}>按时间正序（从旧到新）</option>
      <option value="time-desc" ${this.sortOption === "time-desc" ? "selected" : ""}>按时间倒序（从新到旧）</option>
    `;
    sortSelect.addEventListener("change", () => {
      this.sortOption = sortSelect.value as typeof this.sortOption;
      this.refreshContent();
    });

    const closeBtn = header.createEl("button", { cls: "annotation-list-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hidePanel());

    const content = this.panelEl.createDiv({ cls: "annotation-list-content" });
    this.renderContent(content);

    const container = this.containerEl;
    if (!container) return;
    container.appendChild(this.panelEl);

    // 绝对定位，跟随当前面板
    this.panelEl.style.position = "absolute";
    this.panelEl.style.right = "60px";
    this.panelEl.style.top = "50%";
    this.panelEl.style.transform = "translateY(-50%)";
    this.panelEl.style.zIndex = "100";

    this.panelClickHandler = (e: MouseEvent) => {
      if (this.panelEl && !this.panelEl.contains(e.target as Node) &&
        (!this.listBtn || !this.listBtn.contains(e.target as Node))) {
        this.hidePanel();
      }
    };
    setTimeout(() => {
      if (this.panelClickHandler) {
        document.addEventListener("click", this.panelClickHandler);
      }
    }, 10);
  }

  private async renderContent(content: HTMLElement): Promise<void> {
    content.empty();

    if (!this.currentNotePath) {
      content.createDiv({ cls: "annotation-list-empty", text: "暂无标注" });
      return;
    }

    let annotations: ParsedAnnotation[];
    try {
      annotations = await this.fileManager.getAnnotations(this.currentNotePath);
    } catch {
      content.createDiv({ cls: "annotation-list-empty", text: "暂无标注" });
      return;
    }

    if (annotations.length === 0) {
      content.createDiv({ cls: "annotation-list-empty", text: "暂无标注" });
      return;
    }

    // 排序
    const sorted = [...annotations];
    switch (this.sortOption) {
      case "position-asc":
        sorted.sort((a, b) => a.positions[0]!.start - b.positions[0]!.start);
        break;
      case "position-desc":
        sorted.sort((a, b) => b.positions[0]!.start - a.positions[0]!.start);
        break;
      case "time-asc":
        sorted.sort((a, b) => parseInt(a.id) - parseInt(b.id));
        break;
      case "time-desc":
        sorted.sort((a, b) => parseInt(b.id) - parseInt(a.id));
        break;
    }

    for (const annotation of sorted) {
      const item = content.createDiv({ cls: "annotation-list-item" });

      item.createSpan({ cls: `annotation-list-dot ${COLOR_CLASSES[annotation.color]}` });

      // 全文标注标记
      if (annotation.isFullText && annotation.positions.length > 1) {
        const badge = item.createSpan({ cls: "annotation-list-badge" });
        badge.textContent = `全文(${annotation.positions.length})`;
      } else if (annotation.isCrossBlock) {
        // 跨段标注标记
        const badge = item.createSpan({ cls: "annotation-list-badge" });
        badge.textContent = `跨段(${annotation.positions.length})`;
      }

      const textPreview = item.createDiv({ cls: "annotation-list-text" });
      const previewText = annotation.text.length > 60
        ? annotation.text.substring(0, 60) + "..."
        : annotation.text;
      textPreview.textContent = previewText;

      if (annotation.note) {
        const notePreview = item.createDiv({ cls: "annotation-list-note" });
        const noteText = annotation.note.length > 100
          ? annotation.note.substring(0, 100) + "..."
          : annotation.note;
        notePreview.textContent = `📝 ${noteText}`;
      }

      item.addEventListener("click", () => {
        this.scrollToAnnotation(annotation);
      });

      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(annotation, e.clientX, e.clientY);
      });
    }
  }

  private async refreshContent(): Promise<void> {
    if (!this.panelEl) return;
    const content = this.panelEl.querySelector(".annotation-list-content") as HTMLElement;
    if (content) {
      await this.renderContent(content);
    }
  }

  private showContextMenu(annotation: ParsedAnnotation, x: number, y: number): void {
    document.querySelectorAll(".annotation-context-menu").forEach((el) => el.remove());

    const menu = document.createElement("div");
    menu.className = "annotation-context-menu";

    const deleteBtn = menu.createEl("button", {
      text: "删除标注",
      cls: "annotation-context-menu-item annotation-context-menu-danger",
    });
    deleteBtn.addEventListener("click", async () => {
      if (!this.currentNotePath) return;
      // 编辑模式：用 replaceRange 局部替换
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const deleted = view ? await editAnnotationInEditor(view, this.fileManager, this.currentNotePath, annotation.id, 'delete') : false;
      if (!deleted) {
        await this.fileManager.removeAnnotation(this.currentNotePath, annotation.id);
      }
      menu.remove();
      new Notice("标注已删除");
      this.hidePanel();
      this.onUpdate?.();
    });

    document.body.appendChild(menu);

    const menuWidth = 120;
    const menuHeight = menu.offsetHeight || 80;
    let menuX = x + 10;
    let menuY = y + 10;

    if (menuX + menuWidth > window.innerWidth) menuX = x - menuWidth - 10;
    if (menuY + menuHeight > window.innerHeight) menuY = window.innerHeight - menuHeight - 10;

    menu.style.left = `${Math.max(10, menuX)}px`;
    menu.style.top = `${Math.max(10, menuY)}px`;

    const handler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", handler);
      }
    };
    setTimeout(() => document.addEventListener("click", handler), 10);
  }

  // 滚动到指定标注位置并高亮
  private async scrollToAnnotation(annotation: ParsedAnnotation): Promise<void> {
    this.hidePanel();

    // 计算行号
    const content = await this.fileManager.readAnnotationFile(this.currentNotePath!);
    const lineIndex = content.substring(0, annotation.positions[0]!.start).split("\n").length - 1;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.previewMode) {
      const renderer = (view.previewMode as any).renderer;
      if (renderer && typeof renderer.applyScroll === "function") {
        // 判断是否为脚注区域的标注
        const currentFile = (view as any)?.file;
        const cache = this.app.metadataCache.getFileCache(currentFile);
        const isFootnote = cache?.footnotes?.some(
          fn => lineIndex >= fn.position.start.line && lineIndex <= fn.position.end.line
        );

        if (isFootnote) {
          // 脚注标注：用 applyScroll 滚到最后一个有效 section
          const sections = cache?.sections;
          if (sections && sections.length > 0) {
            const lastSection = sections[sections.length - 1]!;
            const lastLine = lastSection.position.end.line;
            renderer.applyScroll(lastLine, { center: true });
          }
        } else {
          // 普通标注：滚到标注所在行
          renderer.applyScroll(lineIndex, { center: true });
        }
      }
    }

    // 等待渲染完成后查找并高亮
    await new Promise(resolve => setTimeout(resolve, 300));

    const containerEl = view?.previewMode?.containerEl;
    const highlightEls = containerEl?.querySelectorAll(
      `mark[data-annotation-id="${annotation.id}"]`
    );

    if (highlightEls && highlightEls.length > 0) {
      this.highlightElements(Array.from(highlightEls) as HTMLElement[]);
    } else {
      new Notice("未能定位到标注，可能文档内容已更改");
    }
  }

  // 给标注元素添加临时蓝色边框高亮
  private highlightElements(elements: HTMLElement[]): void {
    for (const el of elements) {
      el.style.transition = "box-shadow 0.3s ease";
      el.style.boxShadow = "0 0 0 3px var(--interactive-accent)";
    }
    setTimeout(() => {
      for (const el of elements) {
        el.style.boxShadow = "";
      }
    }, 2000);
  }

  private hidePanel(): void {
    if (this.panelClickHandler) {
      document.removeEventListener("click", this.panelClickHandler);
      this.panelClickHandler = null;
    }
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }

  hide(): void {
    this.hidePanel();
    if (this.listBtn) {
      this.listBtn.remove();
      this.listBtn = null;
    }
  }

  async refresh(): Promise<void> {
    if (this.panelEl) {
      await this.refreshContent();
    }
  }
}
