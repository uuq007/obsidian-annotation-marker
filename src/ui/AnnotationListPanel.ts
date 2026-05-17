import { App, MarkdownView, Notice } from "obsidian";
import type { ParsedAnnotation } from "../types";
import { COLOR_CLASSES } from "../constants";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { editAnnotationInEditor } from "../utils/annotationEditorHelper";
import { scrollToAnnotation } from "../utils/scrollToAnnotation";

// 标注列表浮动面板（右侧按钮打开）
export class AnnotationListPanel {
  private app: App;
  private fileManager: AnnotationFileManager;
  private containerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private listBtn: HTMLElement | null = null;
  private currentNotePath: string | null = null;
  private onUpdate: (() => void) | null = null;
  private sortOption: "position-asc" | "position-desc" | "time-asc" | "time-desc" | "color-asc" | "color-desc" = "position-asc";
  private panelClickHandler: ((e: MouseEvent) => void) | null = null;

  // 拖动相关
  private isMouseDown = false;
  private isDragging = false;
  private wasDragged = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartLeft = 0;
  private dragStartTop = 0;
  private dragContainerWidth = 0;
  private dragContainerHeight = 0;
  private dragBtnWidth = 0;
  private dragBtnHeight = 0;
  private dragMoveHandler: ((e: MouseEvent) => void) | null = null;
  private dragEndHandler: ((e: MouseEvent) => void) | null = null;

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

    // 点击切换面板（拖动后不触发）
    this.listBtn.addEventListener("click", (e) => {
      if (this.wasDragged) {
        this.wasDragged = false;
        return;
      }
      e.stopPropagation();
      if (this.panelEl && this.panelEl.style.display !== "none") {
        this.hidePanel();
      } else {
        this.showPanel();
      }
    });

    // 拖动开始
    this.listBtn.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.isMouseDown = true;
      this.isDragging = false;
      this.wasDragged = false;

      // mousedown 时缓存所有尺寸，避免 mousemove 中触发回流
      const btnRect = this.listBtn!.getBoundingClientRect();
      const containerRect = this.containerEl!.getBoundingClientRect();
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartLeft = btnRect.left - containerRect.left;
      this.dragStartTop = btnRect.top - containerRect.top;
      this.dragContainerWidth = containerRect.width;
      this.dragContainerHeight = containerRect.height;
      this.dragBtnWidth = btnRect.width;
      this.dragBtnHeight = btnRect.height;
    });

    // 拖动移动和结束
    this.dragMoveHandler = (e: MouseEvent) => {
      if (!this.isMouseDown || !this.listBtn) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > 3) {
        this.isDragging = true;
        this.listBtn.classList.add("dragging");
      }
      if (!this.isDragging) return;

      // 纯计算，不触发 DOM 读取
      let newLeft = this.dragStartLeft + dx;
      let newTop = this.dragStartTop + dy;
      newLeft = Math.max(0, Math.min(this.dragContainerWidth - this.dragBtnWidth, newLeft));
      newTop = Math.max(0, Math.min(this.dragContainerHeight - this.dragBtnHeight, newTop));

      this.listBtn.style.left = `${newLeft}px`;
      this.listBtn.style.top = `${newTop}px`;
      this.listBtn.style.right = "auto";
      this.listBtn.style.transform = "none";
    };

    this.dragEndHandler = () => {
      if (this.isDragging) {
        this.wasDragged = true;
        this.isDragging = false;
      }
      this.isMouseDown = false;
      if (this.listBtn) {
        this.listBtn.classList.remove("dragging");
      }
    };

    document.addEventListener("mousemove", this.dragMoveHandler);
    document.addEventListener("mouseup", this.dragEndHandler);
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
      <option value="color-asc" ${this.sortOption === "color-asc" ? "selected" : ""}>按颜色排序（正序）</option>
      <option value="color-desc" ${this.sortOption === "color-desc" ? "selected" : ""}>按颜色排序（倒序）</option>
    `;
    sortSelect.addEventListener("change", () => {
      this.sortOption = sortSelect.value as typeof this.sortOption;
      this.refreshContent();
    });

    const closeBtn = header.createEl("button", { cls: "annotation-list-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hidePanel());

    const content = this.panelEl.createDiv({ cls: "annotation-list-content" });
    // 先渲染内容，再定位，避免空面板闪烁后跳位
    await this.renderContent(content);

    const container = this.containerEl;
    if (!container) return;

    // 先放到屏幕外测量尺寸，避免用户看到错误位置
    this.panelEl.style.position = "absolute";
    this.panelEl.style.left = "-9999px";
    this.panelEl.style.top = "-9999px";
    this.panelEl.style.zIndex = "100";
    container.appendChild(this.panelEl);

    // 读取面板实际高度
    const panelHeight = this.panelEl.offsetHeight || 300;

    if (this.listBtn) {
      const btnRect = this.listBtn.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const panelWidth = 300;

      // 按钮在容器内的偏移
      const btnLeftInContainer = btnRect.left - containerRect.left;
      const btnTopInContainer = btnRect.top - containerRect.top;

      // 容器在视口中的可见边界
      const containerVisibleLeft = Math.max(containerRect.left, 0);
      const containerVisibleRight = Math.min(containerRect.right, window.innerWidth);

      // 面板在按钮右侧/左侧的可用空间（基于容器可见区域）
      const spaceRight = containerVisibleRight - btnRect.right;
      const spaceLeft = btnRect.left - containerVisibleLeft;

      if (spaceRight >= panelWidth + 10) {
        this.panelEl.style.left = `${btnLeftInContainer + btnRect.width + 10}px`;
      } else if (spaceLeft >= panelWidth + 10) {
        this.panelEl.style.left = `${btnLeftInContainer - panelWidth - 10}px`;
      } else if (spaceRight >= spaceLeft) {
        this.panelEl.style.left = `${btnLeftInContainer + btnRect.width + 5}px`;
      } else {
        this.panelEl.style.left = `${Math.max(0, btnLeftInContainer - panelWidth - 5)}px`;
      }

      // 垂直方向：使用容器可见边界
      const containerVisibleTop = Math.max(containerRect.top, 0);
      const containerVisibleBottom = Math.min(containerRect.bottom, window.innerHeight);
      let panelTop = btnTopInContainer;
      if (btnRect.top + panelHeight > containerVisibleBottom - 10) {
        panelTop = btnTopInContainer + btnRect.height - panelHeight;
        if (btnRect.bottom - panelHeight < containerVisibleTop + 10) {
          panelTop = containerVisibleTop - btnRect.top + containerRect.top + 10;
        }
      }
      this.panelEl.style.top = `${panelTop}px`;
      this.panelEl.style.transform = "";
    } else {
      this.panelEl.style.right = "60px";
      this.panelEl.style.top = "50%";
      this.panelEl.style.transform = "translateY(-50%)";
    }

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
      case "color-asc":
        sorted.sort((a, b) => a.color.localeCompare(b.color));
        break;
      case "color-desc":
        sorted.sort((a, b) => b.color.localeCompare(a.color));
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
        this.jumpToAnnotation(annotation);
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

  // 跳转到指定标注位置并高亮
  private async jumpToAnnotation(annotation: ParsedAnnotation): Promise<void> {
    this.hidePanel();

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    await scrollToAnnotation(
      this.app,
      this.fileManager,
      view,
      this.currentNotePath!,
      annotation
    );
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
    if (this.dragMoveHandler) {
      document.removeEventListener("mousemove", this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragEndHandler) {
      document.removeEventListener("mouseup", this.dragEndHandler);
      this.dragEndHandler = null;
    }
    if (this.listBtn) {
      this.listBtn.remove();
      this.listBtn = null;
    }
  }

  // 更新内部 notePath（供文件重命名时使用）
  updateNotePath(newPath: string): void {
    this.currentNotePath = newPath;
  }

  async refresh(): Promise<void> {
    if (this.panelEl) {
      await this.refreshContent();
    }
  }
}
