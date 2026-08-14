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
    this.plugin.registerDomEvent(activeDocument, "mouseover", (e: MouseEvent) => {
      this.handleMouseOver(e);
    });

    this.plugin.registerDomEvent(activeDocument, "mousemove", (e: MouseEvent) => {
      this.handleMouseMove(e);
    });

    this.plugin.registerDomEvent(activeDocument, "mouseout", (e: MouseEvent) => {
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
      window.clearTimeout(this.hideTooltipTimeout);
      this.hideTooltipTimeout = null;
    }

    // 创建或复用 tooltip
    if (!this.tooltipEl) {
      this.tooltipEl = createDiv();
      this.tooltipEl.className = "annotation-highlight-tooltip";
      activeDocument.body.appendChild(this.tooltipEl);
    }

    this.tooltipEl.empty();
    this.tooltipEl.createDiv({ cls: "annotation-tooltip-label", text: t().tooltipLabel });
    this.tooltipEl.createDiv({ cls: "annotation-tooltip-content", text: note });

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

    let tooltipTop: number;
    // 标注在视口下半部分 → tooltip 显示在上方（用 tooltip-bottom 让箭头朝下）
    if (rect.bottom > threshold) {
      this.tooltipEl.classList.add("tooltip-bottom");
      tooltipTop = rect.top - tooltipRect.height - 12;
    } else {
      // 标注在视口上半部分 → tooltip 显示在下方
      this.tooltipEl.classList.remove("tooltip-bottom");
      tooltipTop = rect.bottom + 8;
    }

    // 水平居中于标注，但不超出视口
    const left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    const tooltipLeft = Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10));

    this.tooltipEl.setCssStyles({
      top: `${tooltipTop}px`,
      left: `${tooltipLeft}px`,
    });

    // 箭头居中
    const arrowLeft = tooltipRect.width / 2 - 5;
    this.tooltipEl.style.setProperty("--arrow-left", `${arrowLeft}px`);

    this.tooltipEl.addClass("is-visible");
  }

  private hideTooltip(): void {
    this.tooltipEl?.removeClass("is-visible");
  }

  hide(): void {
    if (this.hideTooltipTimeout) {
      window.clearTimeout(this.hideTooltipTimeout);
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
