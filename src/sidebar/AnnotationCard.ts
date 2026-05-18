import type { ParsedAnnotation, AnnotationColor } from "../types";
import { COLOR_CLASSES } from "../constants";
import { t } from "../i18n";

// 侧边栏卡片数据
export interface AnnotationCardData {
  annotation: ParsedAnnotation;
  notePath: string;   // 所属笔记路径
  fileName: string;   // 笔记文件名
}

// 创建单个标注卡片
export function createAnnotationCard(
  parent: HTMLElement,
  cardData: AnnotationCardData,
  handlers: {
    onClick: (cardData: AnnotationCardData) => void;
    onOpen: (cardData: AnnotationCardData) => void;
    onDelete: (cardData: AnnotationCardData) => void;
  }
): HTMLElement {
  const { annotation, fileName } = cardData;
  const loc = t();

  const card = parent.createDiv({ cls: "annotation-sidebar-card" });

  // 卡片头部：颜色圆点 + 徽章 + 时间 + 文件名
  const header = card.createDiv({ cls: "annotation-sidebar-card-header" });
  header.createSpan({ cls: `annotation-list-dot ${COLOR_CLASSES[annotation.color]}` });

  // 全文/跨段标记
  if (annotation.isFullText && annotation.positions.length > 1) {
    const badge = header.createSpan({ cls: "annotation-list-badge" });
    badge.textContent = loc.fullTextBadge(annotation.positions.length);
  } else if (annotation.isCrossBlock) {
    const badge = header.createSpan({ cls: "annotation-list-badge" });
    badge.textContent = loc.crossBlockBadge(annotation.positions.length);
  }

  // 创建时间
  const date = new Date(parseInt(annotation.id));
  if (!isNaN(date.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const timeStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    header.createSpan({ cls: "annotation-sidebar-card-time", text: timeStr });
  }

  // 文件名
  header.createSpan({
    cls: "annotation-sidebar-card-filename",
    text: fileName,
  });

  // 标注文字
  const textEl = card.createDiv({ cls: "annotation-sidebar-card-text" });
  const previewText = annotation.text.length > 80
    ? annotation.text.substring(0, 80) + "..."
    : annotation.text;
  textEl.textContent = previewText;

  // 批注内容
  if (annotation.note) {
    const noteEl = card.createDiv({ cls: "annotation-sidebar-card-note" });
    const noteText = annotation.note.length > 100
      ? annotation.note.substring(0, 100) + "..."
      : annotation.note;
    noteEl.textContent = noteText;
  }

  // 操作按钮
  const actions = card.createDiv({ cls: "annotation-sidebar-card-actions" });
  const openBtn = actions.createEl("button", {
    text: loc.cardOpen,
    cls: "annotation-btn annotation-btn-secondary",
  });
  const deleteBtn = actions.createEl("button", {
    text: loc.cardDelete,
    cls: "annotation-btn annotation-btn-danger",
  });

  // 事件绑定
  card.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    handlers.onClick(cardData);
  });
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onOpen(cardData);
  });
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onDelete(cardData);
  });

  return card;
}
