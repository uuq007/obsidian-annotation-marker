import { App, Notice, MarkdownView } from "obsidian";
import { Annotation } from "./types";
import { DataManager } from "./dataManager";

export class AnnotationListPanel {
  private app: App;
  private dataManager: DataManager;
  private panelEl: HTMLElement | null = null;
  private listBtn: HTMLElement | null = null;
  private filePath: string | null = null;
  private onUpdate: (() => void) | null = null;
  private previewContainer: HTMLElement | null = null;
  private sortOption: "position-asc" | "position-desc" | "time-asc" | "time-desc" = "position-asc";

  constructor(app: App, dataManager: DataManager) {
    this.app = app;
    this.dataManager = dataManager;
  }

  show(filePath: string, previewContainer: HTMLElement, onUpdate: () => void): void {
    this.filePath = filePath;
    this.previewContainer = previewContainer;
    this.onUpdate = onUpdate;
    this.hide();

    this.createListButton();
  }

  private createListButton(): void {
    if (!this.previewContainer) return;

    this.listBtn = document.createElement("div");
    this.listBtn.className = "annotation-list-btn";
    this.listBtn.innerHTML = `<span>📝</span>`;
    this.listBtn.title = "查看标注";
    
    const containerRect = this.previewContainer.getBoundingClientRect();
    this.listBtn.style.position = "absolute";
    this.listBtn.style.right = "8px";
    this.listBtn.style.top = "50%";
    this.listBtn.style.transform = "translateY(-50%)";
    
    this.previewContainer.style.position = "relative";
    this.previewContainer.appendChild(this.listBtn);

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
    if (!this.filePath || !this.previewContainer) return;

    this.panelEl = document.createElement("div");
    this.panelEl.className = "annotation-list-panel";

    const header = this.panelEl.createDiv({ cls: "annotation-list-header" });
    header.createEl("span", { text: "标注列表", cls: "annotation-list-title" });

    const sortContainer = header.createDiv({ cls: "annotation-list-sort-container" });

    const sortSelect = sortContainer.createEl("select", { cls: "annotation-list-sort-select" });
    sortSelect.innerHTML = `
      <option value="position-asc" ${this.sortOption === "position-asc" ? "selected" : ""}>按内容顺序（从上到下）</option>
      <option value="position-desc" ${this.sortOption === "position-desc" ? "selected" : ""}>按内容倒序（从下到上）</option>
      <option value="time-asc" ${this.sortOption === "time-asc" ? "selected" : ""}>按时间正序（从旧到新）</option>
      <option value="time-desc" ${this.sortOption === "time-desc" ? "selected" : ""}>按时间倒序（从新到旧）</option>
    `;
    sortSelect.addEventListener("change", () => {
      this.sortOption = sortSelect.value as "position-asc" | "position-desc" | "time-asc" | "time-desc";
      this.refreshContent();
    });

    const closeBtn = header.createEl("button", { cls: "annotation-list-close", text: "×" });
    closeBtn.addEventListener("click", () => this.hidePanel());

    const content = this.panelEl.createDiv({ cls: "annotation-list-content" });
    this.renderContent(content);

    this.previewContainer.appendChild(this.panelEl);

    const containerRect = this.previewContainer.getBoundingClientRect();
    this.panelEl.style.position = "absolute";
    this.panelEl.style.right = "60px";
    this.panelEl.style.top = "50%";
    this.panelEl.style.transform = "translateY(-50%)";

    const clickHandler = (e: MouseEvent) => {
      if (this.panelEl && !this.panelEl.contains(e.target as Node) &&
          (!this.listBtn || !this.listBtn.contains(e.target as Node))) {
        this.hidePanel();
        document.removeEventListener("click", clickHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", clickHandler), 10);
  }

  private async renderContent(content: HTMLElement): Promise<void> {
    content.empty();

    if (!this.filePath) {
      content.createDiv({
        cls: "annotation-list-empty",
        text: "暂无标注"
      });
      return;
    }

    const data = await this.dataManager.loadAnnotations(this.filePath);
    if (!data || data.annotations.length === 0) {
      content.createDiv({
        cls: "annotation-list-empty",
        text: "暂无标注"
      });
      return;
    }

    let annotations = [...data.annotations];
    switch (this.sortOption) {
      case "position-asc":
        annotations.sort((a, b) => a.positionPercent - b.positionPercent);
        break;
      case "position-desc":
        annotations.sort((a, b) => b.positionPercent - a.positionPercent);
        break;
      case "time-asc":
        annotations.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "time-desc":
        annotations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
    }

    annotations.forEach((annotation) => {
      const item = content.createDiv({ cls: "annotation-list-item" });

      const colorDot = item.createSpan({
        cls: `annotation-list-dot color-${annotation.color}`
      });

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
    });
  }

  private async refreshContent(): Promise<void> {
    if (!this.panelEl) return;
    const content = this.panelEl.querySelector(".annotation-list-content") as HTMLElement;
    if (content) {
      await this.renderContent(content);
    }
  }

  private showContextMenu(annotation: Annotation, x: number, y: number): void {
    const menu = document.createElement("div");
    menu.className = "annotation-context-menu";

    const detailBtn = menu.createEl("button", { text: "标注详情", cls: "annotation-context-menu-item" });
    detailBtn.addEventListener("click", () => {
      this.showAnnotationDetail(annotation);
      menu.remove();
    });

    const deleteBtn = menu.createEl("button", { text: "删除标注", cls: "annotation-context-menu-item annotation-context-menu-danger" });
    deleteBtn.addEventListener("click", async () => {
      await this.deleteAnnotation(annotation);
      menu.remove();
    });

    document.body.appendChild(menu);

    const menuWidth = 120;
    const menuHeight = menu.offsetHeight || 80;

    let menuX = x + 10;
    let menuY = y + 10;

    if (menuX + menuWidth > window.innerWidth) {
      menuX = x - menuWidth - 10;
    }

    if (menuY + menuHeight > window.innerHeight) {
      menuY = window.innerHeight - menuHeight - 10;
    }

    menu.style.left = `${Math.max(10, menuX)}px`;
    menu.style.top = `${Math.max(10, menuY)}px`;

    const clickHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", clickHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", clickHandler), 10);
  }

  private showAnnotationDetail(annotation: Annotation): void {
    const highlightEl = this.findAnnotationElement(annotation.id);
    if (highlightEl) {
      highlightEl.scrollIntoView({ behavior: "smooth", block: "center" });
      const rect = highlightEl.getBoundingClientRect();
      setTimeout(() => {
        const clickEvent = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        });
        highlightEl.dispatchEvent(clickEvent);
      }, 300);
    }
    this.hidePanel();
  }

  private async deleteAnnotation(annotation: Annotation): Promise<void> {
    if (!this.filePath) return;

    await this.dataManager.deleteAnnotation(this.filePath, annotation.id);
    new Notice("标注已删除");
    this.hidePanel();
    if (this.onUpdate) {
      this.onUpdate();
    }
  }

  private findAnnotationElement(annotationId: string | null): HTMLElement | null {
    if (!annotationId) return null;
    const highlightEl = document.querySelector(`[data-annotation-id="${annotationId}"]`) as HTMLElement;
    return highlightEl;
  }

  private scrollToAnnotation(annotation: Annotation): void {
    const highlightEl = this.findAnnotationElement(annotation.id);
    if (highlightEl) {
      highlightEl.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightEl.style.transition = "box-shadow 0.3s ease";
      highlightEl.style.boxShadow = "0 0 0 3px var(--interactive-accent)";
      setTimeout(() => {
        highlightEl.style.boxShadow = "";
      }, 2000);
    }
    this.hidePanel();
  }

  private hidePanel(): void {
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
}
