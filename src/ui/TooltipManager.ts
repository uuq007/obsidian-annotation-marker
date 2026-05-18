import type AnnotationPlugin from "../main";
import { t } from "../i18n";

// 悬停显示批注内容的工具提示管理器
export class TooltipManager {
  private plugin: AnnotationPlugin;
  private tooltipEl: HTMLElement | null = null;
  private hideTooltipTimeout: number | null = null;

  constructor(plugin: AnnotationPlugin) {
    this.plugin = plugin;
  }

  register(): void {
    this.plugin.registerDomEvent(document, "mouseover", (e: MouseEvent) => {
      this.handleMouseOver(e);
    });

    this.plugin.registerDomEvent(document, "mousemove", (e: MouseEvent) => {
      this.handleMouseMove(e);
    });

    this.plugin.registerDomEvent(document, "mouseout", (e: MouseEvent) => {
      this.handleMouseOut(e);
    });
  }

  private handleMouseOver(e: MouseEvent): void {
    // 只在标注视图中生效
    if (!this.plugin.getActiveAnnotationNotePath()) return;

    const target = e.target as HTMLElement;
    const markEl = target.closest("mark[data-annotation-id]") as HTMLElement;
    if (!markEl) return;

    const note = markEl.getAttribute("data-annotation-note");
    if (!note) return;

    // 取消隐藏定时器
    if (this.hideTooltipTimeout) {
      clearTimeout(this.hideTooltipTimeout);
      this.hideTooltipTimeout = null;
    }

    // 创建或复用 tooltip
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement("div");
      this.tooltipEl.className = "annotation-highlight-tooltip";
      document.body.appendChild(this.tooltipEl);
    }

    this.tooltipEl.innerHTML = `<div class="annotation-tooltip-label">${t().tooltipLabel}</div><div class="annotation-tooltip-content">${this.escapeHtml(note)}</div>`;

    this.positionTooltip(markEl);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.tooltipEl || !this.plugin.getActiveAnnotationNotePath()) return;

    const target = e.target as HTMLElement;
    const markEl = target.closest("mark[data-annotation-id]") as HTMLElement;
    if (!markEl) return;

    const note = markEl.getAttribute("data-annotation-note");
    if (!note) return;

    this.positionTooltip(markEl);
  }

  private handleMouseOut(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const markEl = target.closest("mark[data-annotation-id]") as HTMLElement;
    if (!markEl) return;

    // 检查是否真的离开了 mark 元素
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget) {
      const relatedMark = relatedTarget.closest("mark[data-annotation-id]");
      if (relatedMark === markEl) return;
    }

    this.hideTooltipTimeout = window.setTimeout(() => {
      this.hideTooltip();
    }, 150);
  }

  private positionTooltip(markEl: HTMLElement): void {
    if (!this.tooltipEl) return;

    const rect = markEl.getBoundingClientRect();
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const threshold = window.innerHeight * 0.5;

    // 标注在视口下半部分 → tooltip 显示在上方（用 tooltip-bottom 让箭头朝下）
    if (rect.bottom > threshold) {
      this.tooltipEl.classList.add("tooltip-bottom");
      this.tooltipEl.style.top = `${rect.top - tooltipRect.height - 12}px`;
    } else {
      // 标注在视口上半部分 → tooltip 显示在下方
      this.tooltipEl.classList.remove("tooltip-bottom");
      this.tooltipEl.style.top = `${rect.bottom + 8}px`;
    }

    // 水平居中于标注，但不超出视口
    const left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    this.tooltipEl.style.left = `${Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10))}px`;

    // 箭头居中
    const arrowLeft = tooltipRect.width / 2 - 5;
    this.tooltipEl.style.setProperty("--arrow-left", `${arrowLeft}px`);

    this.tooltipEl.style.opacity = "1";
    this.tooltipEl.style.visibility = "visible";
  }

  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.opacity = "0";
      this.tooltipEl.style.visibility = "hidden";
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text.length > 200 ? text.substring(0, 200) + "..." : text;
    return div.innerHTML;
  }

  hide(): void {
    if (this.hideTooltipTimeout) {
      clearTimeout(this.hideTooltipTimeout);
      this.hideTooltipTimeout = null;
    }
    this.hideTooltip();
  }

  destroy(): void {
    this.hide();
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }
}
