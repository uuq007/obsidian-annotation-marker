import { MarkdownView } from "obsidian";
import { Annotation, COLOR_MAP, MATCH_THRESHOLD } from "./types";
import { calculateSimilarity } from "./utils/helpers";

export interface RenderResult {
  lostAnnotations: Annotation[];
  updatedContexts: { id: string; contextBefore: string; contextAfter: string; positionPercent: number }[];
}

export class AnnotationRenderer {
  private view: MarkdownView;
  private annotations: Annotation[] = [];
  private annotationElements: Map<string, HTMLElement[]> = new Map();
  private tooltipEl: HTMLElement | null = null;
  private hideTooltipTimeout: number | null = null;

  constructor(view: MarkdownView) {
    this.view = view;
  }

  public destroy(): void {
  }

  setAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations;
  }

  renderByText(container: Element): RenderResult {
    this.clear();
    const lostAnnotations: Annotation[] = [];
    const updatedContexts: { id: string; contextBefore: string; contextAfter: string; positionPercent: number }[] = [];

    this.annotations.forEach((annotation) => {
      const result = this.findAndHighlight(annotation, container);
      if (!result) {
        lostAnnotations.push(annotation);
      } else if (result.updated) {
        updatedContexts.push({
          id: annotation.id,
          contextBefore: result.newContextBefore!,
          contextAfter: result.newContextAfter!,
          positionPercent: result.newPositionPercent!,
        });
      }
    });

    return { lostAnnotations, updatedContexts };
  }

  private findAndHighlight(
    annotation: Annotation,
    container: Element
  ): { updated: boolean; newContextBefore?: string; newContextAfter?: string; newPositionPercent?: number } | null {
    const textNodes = this.getAllTextNodes(container);
    const fullText = textNodes.map((n) => n.textContent ?? "").join("");
    const searchText = annotation.text;

    const exactResult = this.findExactMatch(annotation, fullText, textNodes);
    if (exactResult) {
      return { updated: false };
    }

    const fuzzyResult = this.findFuzzyMatch(annotation, fullText, textNodes);
    if (fuzzyResult) {
      return {
        updated: true,
        newContextBefore: fuzzyResult.newContextBefore,
        newContextAfter: fuzzyResult.newContextAfter,
        newPositionPercent: fuzzyResult.newPositionPercent,
      };
    }

    return null;
  }

  private findExactMatch(
    annotation: Annotation,
    fullText: string,
    textNodes: Text[]
  ): boolean {
    const { text, contextBefore, contextAfter, positionPercent } = annotation;

    // 1. 计算初始范围：以positionPercent为中心，text长度为范围
    const centerPosition = (positionPercent / 100) * fullText.length;
    const halfTextLength = text.length / 2;
    const initialStart = Math.max(0, Math.floor(centerPosition - halfTextLength));
    const initialEnd = Math.min(fullText.length, Math.ceil(centerPosition + halfTextLength));

    // 2. 扩展到包含上下文
    const contextStart = Math.max(0, initialStart - contextBefore.length);
    const contextEnd = Math.min(fullText.length, initialEnd + contextAfter.length);

    // 3. 计算第一次搜索范围：增加全文5%
    const extension5Percent = Math.max(50, Math.floor(fullText.length * 0.05));
    let searchStart = Math.max(0, contextStart - extension5Percent);
    let searchEnd = Math.min(fullText.length, contextEnd + extension5Percent);

    // 4-6. 渐进式扩展搜索，每次增加50字符，最多250字符
    const maxExtension = 250;
    const extensionStep = 50;

      for (let currentExtension = 0; currentExtension <= maxExtension; currentExtension += extensionStep) {
      // 在当前搜索范围内查找
      const searchArea = fullText.substring(searchStart, searchEnd);
      const searchText = contextBefore + text + contextAfter;

      let searchIndex = 0;
      while (searchIndex < searchArea.length) {
        const index = searchArea.indexOf(searchText, searchIndex);
        if (index === -1) break;

        const actualIndex = searchStart + index;

        // 找到匹配，只高亮 text 部分（跳过上下文）
        const textIndex = actualIndex + contextBefore.length;
        const matchResult = this.findNodesForPosition(textNodes, textIndex, text.length);
        if (matchResult) {
          this.wrapMatchedNodes(annotation, matchResult);
          return true;
        }

        searchIndex = index + 1;
      }

      // 扩展搜索范围
      searchStart = Math.max(0, searchStart - extensionStep);
      searchEnd = Math.min(fullText.length, searchEnd + extensionStep);
    }

    return false;
  }

  private findFuzzyMatch(
    annotation: Annotation,
    fullText: string,
    textNodes: Text[]
  ): { newContextBefore: string; newContextAfter: string; newPositionPercent: number } | null {
    const { text, contextBefore, contextAfter, positionPercent } = annotation;

    // 1. 计算初始范围：以positionPercent为中心，text长度为范围
    const centerPosition = (positionPercent / 100) * fullText.length;
    const halfTextLength = text.length / 2;
    const initialStart = Math.max(0, Math.floor(centerPosition - halfTextLength));
    const initialEnd = Math.min(fullText.length, Math.ceil(centerPosition + halfTextLength));

    // 2. 计算第一次搜索范围：增加全文5%
    const extension5Percent = Math.max(50, Math.floor(fullText.length * 0.05));
    let searchStart = Math.max(0, initialStart - extension5Percent);
    let searchEnd = Math.min(fullText.length, initialEnd + extension5Percent);

    // 3-5. 渐进式扩展搜索
    const maxExtension = 250;
    const extensionStep = 50;
    let bestMatch: { index: number; score: number; contextBefore: string; contextAfter: string } | null = null;

    for (let currentExtension = 0; currentExtension <= maxExtension; currentExtension += extensionStep) {
      // 在当前搜索范围内查找所有匹配text的位置
      const searchArea = fullText.substring(searchStart, searchEnd);

      let searchIndex = 0;
      while (searchIndex < searchArea.length) {
        const index = searchArea.indexOf(text, searchIndex);
        if (index === -1) break;

        const actualIndex = searchStart + index;

        // 6. 计算相似度
        const actualBefore = fullText.substring(
          Math.max(0, actualIndex - contextBefore.length),
          actualIndex
        );
        const actualAfter = fullText.substring(
          actualIndex + text.length,
          Math.min(fullText.length, actualIndex + text.length + contextAfter.length)
        );

        const beforeScore = contextBefore.length > 0
          ? calculateSimilarity(contextBefore, actualBefore)
          : 1;
        const afterScore = contextAfter.length > 0
          ? calculateSimilarity(contextAfter, actualAfter)
          : 1;
        const totalScore = (beforeScore + afterScore) / 2;

        // 选择相似度最高的（>0.5）
        if (totalScore > MATCH_THRESHOLD) {
          if (!bestMatch || totalScore > bestMatch.score) {
            bestMatch = {
              index: actualIndex,
              score: totalScore,
              contextBefore: actualBefore,
              contextAfter: actualAfter,
            };
          }
        }

        searchIndex = index + 1;
      }

      // 如果已找到高相似度匹配，可以提前结束
      if (bestMatch && bestMatch.score > 0.8) {
        break;
      }

      // 扩展搜索范围
      searchStart = Math.max(0, searchStart - extensionStep);
      searchEnd = Math.min(fullText.length, searchEnd + extensionStep);
    }

    // 5. 若仍未找到，全文搜索
    if (!bestMatch) {
      searchStart = 0;
      searchEnd = fullText.length;

      let searchIndex = 0;
      while (searchIndex < searchEnd) {
        const index = fullText.indexOf(text, searchIndex);
        if (index === -1) break;

        const actualBefore = fullText.substring(
          Math.max(0, index - contextBefore.length),
          index
        );
        const actualAfter = fullText.substring(
          index + text.length,
          Math.min(fullText.length, index + text.length + contextAfter.length)
        );

        const beforeScore = contextBefore.length > 0
          ? calculateSimilarity(contextBefore, actualBefore)
          : 1;
        const afterScore = contextAfter.length > 0
          ? calculateSimilarity(contextAfter, actualAfter)
          : 1;
        const totalScore = (beforeScore + afterScore) / 2;

        if (totalScore > MATCH_THRESHOLD) {
          if (!bestMatch || totalScore > bestMatch.score) {
            bestMatch = {
              index,
              score: totalScore,
              contextBefore: actualBefore,
              contextAfter: actualAfter,
            };
          }
        }

        searchIndex = index + 1;
      }
    }

    // 7. 最终判定
    if (!bestMatch || bestMatch.score <= MATCH_THRESHOLD) {
      return null;
    }

    // 包装成高亮元素
    const matchResult = this.findNodesForPosition(textNodes, bestMatch.index, text.length);
    if (matchResult) {
      const textLength = fullText.length;
      const newPositionPercent = textLength > 0
        ? ((bestMatch.index + bestMatch.index + text.length) / 2 / textLength) * 100
        : 50;

      this.wrapMatchedNodes(annotation, matchResult);
      return {
        newContextBefore: bestMatch.contextBefore,
        newContextAfter: bestMatch.contextAfter,
        newPositionPercent,
      };
    }

    return null;
  }

  private findNodesForPosition(
    textNodes: Text[],
    globalStart: number,
    length: number
  ): { node: Text; start: number; length: number }[] | null {
    let currentOffset = 0;
    let remaining = length;
    const result: { node: Text; start: number; length: number }[] = [];

    for (const textNode of textNodes) {
      const nodeText = textNode.textContent ?? "";
      const nodeLength = nodeText.length;
      const offsetInDocument = textNode.parentElement?.closest("mark[data-annotation-id]") ? -1 : currentOffset;

      if (currentOffset + nodeLength <= globalStart) {
        currentOffset += nodeLength;
        continue;
      }

      if (remaining <= 0) break;

      const startInNode = globalStart - currentOffset;
      const availableInNode = nodeLength - Math.max(0, startInNode);
      const takeLength = Math.min(availableInNode, remaining);

      result.push({
        node: textNode,
        start: Math.max(0, startInNode),
        length: takeLength,
      });

       remaining -= takeLength;
      currentOffset += nodeLength;

      if (remaining <= 0) break;
    }

    return result.length > 0 ? result : null;
  }

  private wrapMatchedNodes(annotation: Annotation, matches: { node: Text; start: number; length: number }[]): void {
    const colorStyle = COLOR_MAP[annotation.color];
    const rubyTexts = annotation.rubyTexts;

    if (matches.length === 0) return;

    let fullHighlightedText = "";

    matches.forEach((match, index) => {
      if (!document.contains(match.node)) {
        return;
      }

      const text = match.node.textContent ?? "";
      const highlighted = text.substring(match.start, match.start + match.length);
      fullHighlightedText += highlighted;
    });

    const markElement = this.createHighlightSpan(annotation, fullHighlightedText, colorStyle);

    if (matches.length === 1) {
      const match = matches[0]!;
      const text = match.node.textContent ?? "";
      const before = text.substring(0, match.start);
      const after = text.substring(match.start + match.length);

      const parent = match.node.parentNode;
      if (parent) {
        const fragment = document.createDocumentFragment();
        if (before) fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(markElement);
        if (after) fragment.appendChild(document.createTextNode(after));
        parent.replaceChild(fragment, match.node);
      }
    } else {
      const firstMatch = matches[0]!;
      const lastMatch = matches[matches.length - 1]!;

      const firstParent = firstMatch.node.parentNode;
      const lastParent = lastMatch.node.parentNode;

      if (!firstParent || !lastParent) return;

      const firstText = firstMatch.node.textContent ?? "";
      const before = firstText.substring(0, firstMatch.start);

      const lastText = lastMatch.node.textContent ?? "";
      const after = lastText.substring(lastMatch.start + lastMatch.length);

      const fragment = document.createDocumentFragment();
      if (before) fragment.appendChild(document.createTextNode(before));
      fragment.appendChild(markElement);
      if (after) fragment.appendChild(document.createTextNode(after));

      const allNodesBetween: Node[] = [];

      let current: Node | null = firstMatch.node.nextSibling;
      while (current) {
        allNodesBetween.push(current);
        if (current === lastMatch.node) {
          break;
        }
        current = current.nextSibling;
      }

      firstParent.insertBefore(fragment, firstMatch.node);

      allNodesBetween.forEach(node => {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      });

      if (firstMatch.node.parentNode) {
        firstMatch.node.parentNode.removeChild(firstMatch.node);
      }
    }

    this.annotationElements.set(annotation.id, [markElement]);
  }

  private getAllTextNodes(container: Element): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      if (textNode.textContent && textNode.textContent.trim().length > 0) {
        const parent = textNode.parentElement;
        // 排除 RT 标签、标注元素、文件名、笔记属性、多选标签、标题栏
        if (parent && parent.tagName !== "RT" &&
            !parent.closest("mark[data-annotation-id]") &&
            !parent.closest("div.inline-title") &&
            !parent.closest("[class*='metadata-']") &&
            !parent.closest("div.multi-select-pill-content") &&
            !parent.closest("div.metadata-content") &&
            !parent.closest("div.mod-header") &&
            !parent.closest("div.mod-ui")) {
          textNodes.push(textNode);
        }
      }
      node = walker.nextNode();
    }

    return textNodes;
  }

  private createHighlightSpan(annotation: Annotation, text: string, colorStyle: { bg: string; border: string }): HTMLElement {
    let rubyTexts = annotation.rubyTexts;

    if (!rubyTexts && annotation.rubyText) {
      rubyTexts = [{
        startIndex: 0,
        length: text.length,
        ruby: annotation.rubyText
      }];
    }

    const hasRubies = rubyTexts && rubyTexts.length > 0;

    const container = document.createElement("mark");
    container.dataset.annotationId = annotation.id;

    if (annotation.color !== "none") {
      container.style.backgroundColor = colorStyle.bg;
    }

    if (annotation.note && annotation.note.trim()) {
      container.style.borderBottom = `2px solid ${colorStyle.border}`;
    }

    if (!hasRubies) {
      container.textContent = text;
    } else {
      let currentIndex = 0;
      const sortedRubies = [...rubyTexts!].sort((a, b) => a.startIndex - b.startIndex);

      for (const ruby of sortedRubies) {
        if (ruby.startIndex > currentIndex) {
          const beforeText = text.substring(currentIndex, ruby.startIndex);
          container.appendChild(document.createTextNode(beforeText));
        }

        const rubyEl = document.createElement("ruby");
        const spanEl = document.createElement("span");
        spanEl.textContent = text.substring(ruby.startIndex, ruby.startIndex + ruby.length);
        rubyEl.appendChild(spanEl);

        const rtEl = document.createElement("rt");
        rtEl.textContent = ruby.ruby;
        rubyEl.appendChild(rtEl);

        container.appendChild(rubyEl);
        currentIndex = ruby.startIndex + ruby.length;
      }

      if (currentIndex < text.length) {
        const afterText = text.substring(currentIndex);
        container.appendChild(document.createTextNode(afterText));
      }
    }

    container.style.cursor = "pointer";
    container.addEventListener("mouseenter", (e) => this.showTooltip(e, annotation));
    container.addEventListener("mousemove", (e) => this.moveTooltip(e));
    container.addEventListener("mouseleave", () => this.hideTooltip());

    return container;
  }

  private showTooltip(e: MouseEvent, annotation: Annotation): void {
    if (!annotation.note || !annotation.note.trim()) {
      return;
    }

    if (this.hideTooltipTimeout) {
      clearTimeout(this.hideTooltipTimeout);
      this.hideTooltipTimeout = null;
    }

    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement("div");
      this.tooltipEl.className = "annotation-highlight-tooltip";
      document.body.appendChild(this.tooltipEl);
    }

    const noteText = annotation.note?.trim() || "";
    const tooltipContent = noteText 
      ? `<div class="annotation-tooltip-label">批注内容</div><div class="annotation-tooltip-content">${this.escapeHtml(noteText)}</div>`
      : `<div class="annotation-tooltip-empty">无批注内容</div>`;
    
    this.tooltipEl.innerHTML = tooltipContent;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const threshold = window.innerHeight * 0.5;

    if (rect.bottom > threshold) {
      this.tooltipEl.classList.add("tooltip-bottom");
      this.tooltipEl.style.top = `${rect.top - tooltipRect.height - 12}px`;
    } else {
      this.tooltipEl.classList.remove("tooltip-bottom");
      this.tooltipEl.style.top = `${rect.bottom + 8}px`;
    }

    const left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    this.tooltipEl.style.left = `${Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10))}px`;
    this.tooltipEl.style.opacity = "1";
    this.tooltipEl.style.visibility = "visible";
  }

  private moveTooltip(e: MouseEvent): void {
    if (!this.tooltipEl) return;

    const target = e.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const threshold = window.innerHeight * 0.5;

    if (rect.bottom > threshold) {
      this.tooltipEl.classList.add("tooltip-bottom");
      this.tooltipEl.style.top = `${rect.top - tooltipRect.height - 12}px`;
    } else {
      this.tooltipEl.classList.remove("tooltip-bottom");
      this.tooltipEl.style.top = `${rect.bottom + 8}px`;
    }

    const left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    this.tooltipEl.style.left = `${Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10))}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.opacity = "0";
      this.tooltipEl.style.visibility = "hidden";
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  clear(): void {
    this.hideTooltip();
    this.annotationElements.forEach((elements) => {
      elements.forEach((el) => {
        const parent = el.parentNode;
        if (parent) {
          let textContent = "";
          if (el.tagName === "MARK") {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
            let node = walker.nextNode();
            while (node) {
              const textNode = node as Text;
              const parentElement = textNode.parentElement;
              if (parentElement && parentElement.tagName !== "RT") {
                textContent += textNode.textContent;
              }
              node = walker.nextNode();
            }
          } else {
            textContent = el.textContent ?? "";
          }
          const textNode = document.createTextNode(textContent);
          parent.replaceChild(textNode, el);
        }
      });
    });
    this.annotationElements.clear();
  }
}
