import { App, Notice, MarkdownView } from "obsidian";
import { Annotation } from "./types";
import { DataManager } from "./dataManager";
import { buildListMarkerPreview } from "./markerPresentation";

export class AnnotationListPanel {
  private app: App;
  private dataManager: DataManager;
  private panelEl: HTMLElement | null = null;
  private listBtn: HTMLElement | null = null;
  private filePath: string | null = null;
  private onUpdate: (() => void) | null = null;
  private previewContainer: HTMLElement | null = null;
  private currentView: MarkdownView | null = null;
  private sortOption: "position-asc" | "position-desc" | "time-asc" | "time-desc" = "position-asc";
  private panelClickHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(app: App, dataManager: DataManager) {
    this.app = app;
    this.dataManager = dataManager;
  }

  show(filePath: string, previewContainer: HTMLElement, onUpdate: () => void, view: MarkdownView): void {
    this.filePath = filePath;
    this.previewContainer = previewContainer;
    this.onUpdate = onUpdate;
    this.currentView = view;
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

    this.hidePanel();

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
        annotations.sort((a, b) => {
          if (a.startLine !== b.startLine) {
            return a.startLine - b.startLine;
          }
          if (a.startOffset !== b.startOffset) {
            return a.startOffset - b.startOffset;
          }
          return a.id.localeCompare(b.id);
        });
        break;
      case "position-desc":
        annotations.sort((a, b) => {
          if (a.startLine !== b.startLine) {
            return b.startLine - a.startLine;
          }
          if (a.startOffset !== b.startOffset) {
            return b.startOffset - a.startOffset;
          }
          return b.id.localeCompare(a.id);
        });
        break;
      case "time-asc":
        annotations.sort((a, b) => {
          const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          if (timeDiff !== 0) {
            return timeDiff;
          }
          return a.id.localeCompare(b.id);
        });
        break;
      case "time-desc":
        annotations.sort((a, b) => {
          const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (timeDiff !== 0) {
            return timeDiff;
          }
          return b.id.localeCompare(a.id);
        });
        break;
    }

    annotations.forEach((annotation) => {
      const item = content.createDiv({ cls: "annotation-list-item" });
      const marker = this.dataManager.getMarkerManager().getMarkerById(annotation.markerId);
      const preview = buildListMarkerPreview(annotation, marker);

      const colorDot = item.createSpan({
        cls: preview.dotClassName
      });
      if (preview.color) {
        colorDot.style.setProperty("--marker-preview-color", preview.color);
      }

      if (preview.label) {
        const labelPreview = item.createDiv({ cls: "annotation-list-note" });
        labelPreview.textContent = `🏷️ ${preview.label}${preview.deleted ? "（已删除）" : ""}`;
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
    if (this.contextMenuClickHandler) {
      document.removeEventListener("click", this.contextMenuClickHandler);
      this.contextMenuClickHandler = null;
    }

    const menu = document.createElement("div");
    menu.className = "annotation-context-menu";

    const detailBtn = menu.createEl("button", { text: "标注详情", cls: "annotation-context-menu-item" });
    detailBtn.addEventListener("click", () => {
      this.showAnnotationDetail(annotation);
      menu.remove();
      if (this.contextMenuClickHandler) {
        document.removeEventListener("click", this.contextMenuClickHandler);
        this.contextMenuClickHandler = null;
      }
    });

    const deleteBtn = menu.createEl("button", { text: "删除标注", cls: "annotation-context-menu-item annotation-context-menu-danger" });
    deleteBtn.addEventListener("click", async () => {
      await this.deleteAnnotation(annotation);
      menu.remove();
      if (this.contextMenuClickHandler) {
        document.removeEventListener("click", this.contextMenuClickHandler);
        this.contextMenuClickHandler = null;
      }
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

    this.contextMenuClickHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        if (this.contextMenuClickHandler) {
          document.removeEventListener("click", this.contextMenuClickHandler);
          this.contextMenuClickHandler = null;
        }
      }
    };
    setTimeout(() => {
      if (this.contextMenuClickHandler) {
        document.addEventListener("click", this.contextMenuClickHandler);
      }
    }, 10);
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

  private highlightAnnotation(highlightEl: HTMLElement): void {
    highlightEl.style.transition = "box-shadow 0.3s ease";
    highlightEl.style.boxShadow = "0 0 0 3px var(--interactive-accent)";

    setTimeout(() => {
      highlightEl.style.boxShadow = "";
    }, 2000);
  }

  private async scrollToAnnotation(annotation: Annotation): Promise<void> {


    if (!this.currentView || !this.currentView.previewMode) {

      return;
    }

    const previewMode = this.currentView.previewMode;



    (previewMode as any).renderer.applyScroll(annotation.startLine, {
      center: true
    });



    await new Promise(resolve => setTimeout(resolve, 300));

    const highlightEl = this.findAnnotationElement(annotation.id);
    if (highlightEl) {

      this.highlightAnnotation(highlightEl);
    } else {


      await new Promise(resolve => setTimeout(resolve, 300));

      const retryHighlight = this.findAnnotationElement(annotation.id);
      if (retryHighlight) {

        this.highlightAnnotation(retryHighlight);
      } else {

        new Notice('未能定位到标注，可能文档内容已更改');
      }
    }

    this.hidePanel();
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
    if (this.contextMenuClickHandler) {
      document.removeEventListener("click", this.contextMenuClickHandler);
      this.contextMenuClickHandler = null;
    }
    this.hidePanel();
    if (this.listBtn) {
      this.listBtn.remove();
      this.listBtn = null;
    }
  }
}
