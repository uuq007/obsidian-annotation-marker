import type AnnotationPlugin from "../main";
import { t } from "../i18n";

// 悬停显示批注内容的工具提示管理器
// 触屏端不做长按唤起：tap 标注会合成 click 弹出详情菜单（main.ts 的 click 处理器），
// 那才是移动端查看标注内容的正式通道；本类只负责展示与"及时收起"
export class TooltipManager {
  private plugin: AnnotationPlugin;
  private tooltipEl: HTMLElement | null = null;
  private hideTooltipTimeout: number | null = null;

  constructor(plugin: AnnotationPlugin) {
    this.plugin = plugin;
  }

  register(): void {
    // 桌面 hover 三件套：悬入显示、移动跟位、移出延迟隐藏。
    // 触屏端 tap 合成的 mouseover 之后永无 mouseout，只靠它们气泡会永久粘滞，
    // 因此下方补齐多条兜底关闭路径
    this.plugin.registerDomEvent(activeDocument, "mouseover", (e: MouseEvent) => {
      this.handleMouseOver(e);
    });

    this.plugin.registerDomEvent(activeDocument, "mousemove", (e: MouseEvent) => {
      this.handleMouseMove(e);
    });

    this.plugin.registerDomEvent(activeDocument, "mouseout", (e: MouseEvent) => {
      this.handleMouseOut(e);
    });

    // ===== 生命周期兜底：tooltip 为 position:fixed 锚定创建时坐标，布局或视口一旦变化必须收起 =====

    // 切换文件 / 布局变动 / 打开新文件时收起，防止气泡跨文件残留（此前切文件后气泡不消失的主因）
    const workspace = this.plugin.app.workspace;
    this.plugin.registerEvent(workspace.on("active-leaf-change", () => {
      if (this.tooltipEl?.hasClass("is-visible")) this.hide();
    }));
    this.plugin.registerEvent(workspace.on("layout-change", () => {
      if (this.tooltipEl?.hasClass("is-visible")) this.hide();
    }));
    this.plugin.registerEvent(workspace.on("file-open", () => {
      if (this.tooltipEl?.hasClass("is-visible")) this.hide();
    }));

    // 滚动会使固定定位的气泡错位，直接收起（capture 以捕获编辑器/预览内部容器的滚动）
    this.plugin.registerDomEvent(activeDocument, "scroll", () => {
      if (this.tooltipEl?.hasClass("is-visible")) this.hide();
    }, { capture: true });

    // tap / 点击任意位置先收旧泡（tooltip 自身 pointer-events:none，不影响命中）；
    // 若落点仍是带批注的标注，随后的合成 mouseover 会再弹新泡，视觉上是干净的"关旧开新"
    this.plugin.registerDomEvent(activeDocument, "pointerdown", () => {
      if (this.tooltipEl?.hasClass("is-visible")) this.hide();
    }, { capture: true });

    // 应用退到后台时收起，避免回前台时气泡锚定的内容早已滚出视野
    this.plugin.registerDomEvent(activeDocument, "visibilitychange", () => {
      if (activeDocument.hidden && this.tooltipEl?.hasClass("is-visible")) this.hide();
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
