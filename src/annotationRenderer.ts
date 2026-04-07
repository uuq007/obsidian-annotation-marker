import { MarkdownView } from "obsidian";
import { Annotation, MATCH_THRESHOLD, CONTEXT_LENGTH_BEFORE, CONTEXT_LENGTH_AFTER } from "./types";
import { calculateSimilarity } from "./utils/helpers";
import { MarkdownPostProcessorContext } from "obsidian";
import { buildRenderedAnnotationAttrs } from "./markerPresentation";

export interface RenderResult {
  lostAnnotations: Annotation[];
  updatedContexts: { id: string; contextBefore: string; contextAfter: string; startLine: number; endLine: number; startOffset: number; endOffset: number }[];
}

export interface MatchResult {
  found: boolean;
  textPosition: { start: number; end: number };
  contextBefore?: string;
  contextAfter?: string;
  element?: HTMLElement;
}

export interface AnnotationPosition {
  startOffset: number;
  endOffset: number;
  lineStart: number;
  lineEnd: number;
}

export class AnnotationRenderer {
  private view: MarkdownView;
  private annotations: Annotation[] = [];
  private annotationElements: Map<string, HTMLElement[]> = new Map();
  private tooltipEl: HTMLElement | null = null;
  private hideTooltipTimeout: number | null = null;
  private renderedAnnotations: Set<string> = new Set();
  private processedAnnotations: Set<string> = new Set();
  private domTextCache: Map<string, string> = new Map();
  private elementContextMap: WeakMap<HTMLElement, MarkdownPostProcessorContext>;
  private extractedElementTexts: Map<HTMLElement, string>;

  constructor(
    view: MarkdownView, 
    elementContextMap?: WeakMap<HTMLElement, MarkdownPostProcessorContext>,
    extractedElementTexts?: Map<HTMLElement, string>
  ) {
    this.view = view;
    this.elementContextMap = elementContextMap || new WeakMap();
    this.extractedElementTexts = extractedElementTexts || new Map();
  }

  public destroy(): void {
    this.clearProcessedAnnotations();
  }

  public clearProcessedAnnotations(): void {
    this.processedAnnotations.clear();
    this.renderedAnnotations.clear();
    this.domTextCache.clear();
  }

  setAnnotations(annotations: Annotation[]): void {
    this.annotations = annotations;
  }

  setRenderedAnnotations(renderedIds: Set<string>): void {
    this.renderedAnnotations = renderedIds;
  }

  getRenderedAnnotations(): Set<string> {
    return this.renderedAnnotations;
  }

  renderByText(container: Element): RenderResult {



    const { elements, lineRange } = this.getVisibleElementsInfo(container);


    const lostAnnotations: Annotation[] = [];
    const updatedContexts: {
      id: string;
      contextBefore: string;
      contextAfter: string;
      startLine: number;
      endLine: number;
      startOffset: number;
      endOffset: number;
    }[] = [];

    for (const element of elements) {
      const context = this.elementContextMap.get(element);
      if (!context) continue;

      const sectionInfo = context.getSectionInfo(element);
      if (!sectionInfo) continue;

      const annotationsInElement = this.annotations.filter(annotation =>
        annotation.isValid === 1 &&
        annotation.startLine >= sectionInfo.lineStart &&
        annotation.endLine <= sectionInfo.lineEnd &&
        !this.processedAnnotations.has(annotation.id)
      );

      if (annotationsInElement.length === 0) continue;



      for (const annotation of annotationsInElement) {



        let result = this.findTextInElement(element, annotation);

        if (!result || !result.found) {

          result = this.findInAdjacentElements(elements, elements.indexOf(element), annotation);
        }

        if (!result || !result.found) {

          lostAnnotations.push(annotation);
          continue;
        }



        const context = result.element ? this.elementContextMap.get(result.element) : this.elementContextMap.get(element);
        const sectionInfo = context ? context.getSectionInfo(result.element || element) : null;

        updatedContexts.push({
          id: annotation.id,
          contextBefore: result.contextBefore || "",
          contextAfter: result.contextAfter || "",
          startLine: sectionInfo ? sectionInfo.lineStart : annotation.startLine,
          endLine: sectionInfo ? sectionInfo.lineEnd : annotation.endLine,
          startOffset: result.textPosition.start,
          endOffset: result.textPosition.end
        });





        const renderTarget = result.element || element;

        this.renderAnnotationInElement(renderTarget, annotation, result.textPosition.start, result.textPosition.end);

        this.processedAnnotations.add(annotation.id);
      }
    }



    return { lostAnnotations, updatedContexts };
  }

  private getVisibleElementsInfo(container: Element): { 
    elements: HTMLElement[]; 
    lineRange: { minLine: number; maxLine: number } 
  } {
    const contentContainer = container.querySelector(
      '.markdown-preview-sizer.markdown-preview-section'
    ) as HTMLElement | null;

    const scrollView = container.querySelector(
      '.markdown-preview-view'
    ) as HTMLElement | null;

    if (!contentContainer || !scrollView) {
      return { elements: [], lineRange: { minLine: 0, maxLine: 0 } };
    }

    const excludeSelectors = [
      '.mod-frontmatter',
      '.mod-footer',
      '.mod-header',
      '.markdown-preview-pusher'
    ];

    const allChildren = Array.from(contentContainer.children);

    const allElements = allChildren.filter((el) => {
      const className = el.className;
      if (typeof className !== 'string') return true;

      for (const selector of excludeSelectors) {
        if (el.matches(selector)) return false;
      }
      return true;
    });

    const scrollRect = scrollView.getBoundingClientRect();

    const visibleElements = allElements.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < scrollRect.bottom && rect.bottom > scrollRect.top;
    }) as HTMLElement[];

    let minLine = Infinity;
    let maxLine = -Infinity;

    for (const el of visibleElements) {
      const context = this.elementContextMap.get(el);
      if (context) {
        const sectionInfo = context.getSectionInfo(el);
        if (sectionInfo) {
          minLine = Math.min(minLine, sectionInfo.lineStart);
          maxLine = Math.max(maxLine, sectionInfo.lineEnd);
        }
      }
    }

    const lineRange = {
      minLine: minLine === Infinity ? 0 : minLine,
      maxLine: maxLine === -Infinity ? 0 : maxLine
    };

    return { elements: visibleElements, lineRange };
  }

  private shouldSkipElement(element: Element): boolean {
    return !!(
      element.closest("pre.frontmatter") ||
      element.closest("div.frontmatter") ||
      element.closest("div.metadata-content") ||
      element.closest("div.mod-header") ||
      element.closest("div.mod-ui") ||
      element.closest("div.el-pre")
    );
  }

  private applyMarkerPresentation(element: HTMLElement, annotation: Annotation): void {
    const attrs = buildRenderedAnnotationAttrs(annotation);
    attrs.classNames.forEach((className) => element.addClass(className));
    if (attrs.markerId) {
      element.dataset.markerId = attrs.markerId;
    }
  }

  private createHighlightSpan(annotation: Annotation, text: string): HTMLElement {
    let rubyTexts = annotation.rubyTexts;

    if (!rubyTexts && annotation.rubyText) {
      rubyTexts = [{
        startIndex: 0,
        length: text.length,
        ruby: annotation.rubyText
      }];
    }

    const hasRubies = rubyTexts && rubyTexts.length > 0;
    const hasOriginalRubies = annotation.originalRubies && annotation.originalRubies.length > 0;



    const container = document.createElement("mark");
    container.dataset.annotationId = annotation.id;
    this.applyMarkerPresentation(container, annotation);

    if (!hasRubies && !hasOriginalRubies) {
      container.textContent = text;
    } else {
      const allRubies: Array<{ type: 'plugin' | 'original'; startIndex: number; length: number; ruby?: string; rubyHTML?: string }> = [];

      if (hasOriginalRubies) {
        annotation.originalRubies!.forEach(r => {
          allRubies.push({
            type: 'original',
            startIndex: r.startIndex,
            length: r.length,
            rubyHTML: r.rubyHTML
          });
        });
      }

      if (hasRubies) {
        rubyTexts!.forEach(r => {
          allRubies.push({
            type: 'plugin',
            startIndex: r.startIndex,
            length: r.length,
            ruby: r.ruby
          });
        });
      }

      allRubies.sort((a, b) => a.startIndex - b.startIndex);



      let currentIndex = 0;

      for (const item of allRubies) {


        if (item.startIndex > currentIndex) {
          const beforeText = text.substring(currentIndex, item.startIndex);

          container.appendChild(document.createTextNode(beforeText));
        }

        if (item.type === 'plugin') {
          const rubyEl = document.createElement("ruby");
          rubyEl.setAttribute("data-annotation-ruby", "true");
          const spanEl = document.createElement("span");
          const rubyText = text.substring(item.startIndex, item.startIndex + item.length);

          spanEl.textContent = rubyText;
          rubyEl.appendChild(spanEl);

          const rtEl = document.createElement("rt");
          rtEl.textContent = item.ruby!;
          rubyEl.appendChild(rtEl);

          container.appendChild(rubyEl);
        } else {
          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = item.rubyHTML!;
          const rubyEl = tempDiv.firstChild as Element;
          if (rubyEl) {

            container.appendChild(rubyEl);
          }
        }

        currentIndex = item.startIndex + item.length;
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

    // 获取整个标注 mark 元素的位置，而不是内部子元素
    const target = e.target as HTMLElement;
    const markElement = target.closest('mark[data-annotation-id]');
    const rect = (markElement || target).getBoundingClientRect();
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

    // 设置箭头位置，让箭头指向标注区域的中心
    // 箭头是 10px 宽，中心在 5px 处，所以需要让箭头中心对齐 tooltip 中心
    const arrowLeft = tooltipRect.width / 2 - 5;
    this.tooltipEl.style.setProperty('--arrow-left', `${arrowLeft}px`);

    this.tooltipEl.style.opacity = "1";
    this.tooltipEl.style.visibility = "visible";
  }

  private moveTooltip(e: MouseEvent): void {
    if (!this.tooltipEl) return;

    // 获取整个标注 mark 元素的位置，而不是内部子元素
    const target = e.target as HTMLElement;
    const markElement = target.closest('mark[data-annotation-id]');
    const rect = (markElement || target).getBoundingClientRect();
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

    // 设置箭头位置，让箭头指向标注区域的中心
    const arrowLeft = tooltipRect.width / 2 - 5;
    this.tooltipEl.style.setProperty('--arrow-left', `${arrowLeft}px`);
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

  private extractTextFromElement(element: HTMLElement): string {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();

    while (node) {
      const textNode = node as Text;
      const parent = textNode.parentElement;

      if (parent &&
          parent.tagName !== "RT" &&
          !parent.closest("div.inline-title") &&
          !parent.closest("[class*='metadata-']") &&
          !parent.closest("div.mod-header") &&
          !parent.closest("div.mod-ui")) {
        textNodes.push(textNode);
      }

      node = walker.nextNode();
    }

    return textNodes.map(n => n.textContent ?? "").join("");
  }

  private extractContextFromDOM(
    element: HTMLElement,
    textPosition: { start: number; end: number },
    beforeLength: number,
    afterLength: number
  ): { contextBefore: string; contextAfter: string } {



    if (this.extractedElementTexts.size === 0) {

      const elementText = this.extractTextFromElement(element);
      const contextBefore = elementText.substring(Math.max(0, textPosition.start - beforeLength), textPosition.start);
      const contextAfter = elementText.substring(textPosition.end, Math.min(elementText.length, textPosition.end + afterLength));

      return { contextBefore, contextAfter };
    }

    const elements = Array.from(this.extractedElementTexts.keys());
    const currentIndex = elements.indexOf(element);

    if (currentIndex === -1) {

      const elementText = this.extractTextFromElement(element);
      const contextBefore = elementText.substring(Math.max(0, textPosition.start - beforeLength), textPosition.start);
      const contextAfter = elementText.substring(textPosition.end, Math.min(elementText.length, textPosition.end + afterLength));

      return { contextBefore, contextAfter };
    }



    const currentText = this.extractedElementTexts.get(element) || '';

    let contextBefore = '';
    let contextAfter = '';

    const startOffset = textPosition.start;
    const endOffset = textPosition.end;

    if (startOffset <= currentText.length) {
      const beforeInCurrent = currentText.substring(
        Math.max(0, startOffset - beforeLength),
        startOffset
      );
      contextBefore = beforeInCurrent;

    }

    if (contextBefore.length < beforeLength) {

      let needed = beforeLength - contextBefore.length;
      for (let i = currentIndex - 1; i >= 0 && needed > 0; i--) {
        const prevElement = elements[i];
        if (!prevElement) continue;

        if (this.shouldSkipElement(prevElement)) {

          continue;
        }

        const prevText = this.extractedElementTexts.get(prevElement) || '';
        const prevTextFromEnd = prevText.substring(Math.max(0, prevText.length - needed));
        contextBefore = prevTextFromEnd + contextBefore;
        needed = beforeLength - contextBefore.length;

      }

    }

    if (endOffset <= currentText.length) {
      const afterInCurrent = currentText.substring(
        endOffset,
        Math.min(currentText.length, endOffset + afterLength)
      );
      contextAfter = afterInCurrent;

    }

    if (contextAfter.length < afterLength) {

      let needed = afterLength - contextAfter.length;
      for (let i = currentIndex + 1; i < elements.length && needed > 0; i++) {
        const nextElement = elements[i];
        if (!nextElement) continue;

        if (this.shouldSkipElement(nextElement)) {

          continue;
        }

        const nextText = this.extractedElementTexts.get(nextElement) || '';
        const nextTextPortion = nextText.substring(0, needed);
        contextAfter = contextAfter + nextTextPortion;
        needed = afterLength - contextAfter.length;

      }

    }



    return { contextBefore, contextAfter };
  }

  private findTextInElement(
    element: HTMLElement,
    annotation: Annotation,
    searchRange: number = 100
  ): MatchResult | null {


    const elementText = this.extractTextFromElement(element);



    const startOffset = annotation.startOffset;
    const endOffset = annotation.endOffset;


    const searchText = annotation.text;



    if (startOffset >= 0 && endOffset <= elementText.length) {

      if (endOffset > startOffset) {
        const textInElement = elementText.substring(startOffset, endOffset);


        if (textInElement === searchText) {

          const { contextBefore, contextAfter } = this.extractContextFromDOM(
            element,
            { start: startOffset, end: endOffset },
            CONTEXT_LENGTH_BEFORE,
            CONTEXT_LENGTH_AFTER
          );



          const contextMatch =
            (annotation.contextBefore === "" || contextBefore === annotation.contextBefore) &&
            (annotation.contextAfter === "" || contextAfter === annotation.contextAfter);

          if (contextMatch) {

            return {
              found: true,
              textPosition: { start: startOffset, end: endOffset },
              contextBefore,
              contextAfter,
              element
            };
          } else {

          }
        } else {

        }
      }
    } else {

    }




    const fuzzyResult = this.fuzzyMatchInElement(
      element,
      annotation,
      searchRange
    );

    if (fuzzyResult) {

      return fuzzyResult;
    }


    return null;
  }

  private fuzzyMatchInElement(
    element: HTMLElement,
    annotation: Annotation,
    searchRange: number
  ): MatchResult | null {
    const elementText = this.extractTextFromElement(element);
    const searchText = annotation.text;
    const startOffset = annotation.startOffset;
    const endOffset = annotation.endOffset;



    const searchStart = Math.max(0, startOffset - searchRange);
    const searchEnd = Math.min(elementText.length, endOffset + searchRange);
    const searchArea = elementText.substring(searchStart, searchEnd);



    const matches = this.findAllOccurrences(searchArea, searchText, searchStart);



    if (matches.length === 0) {

      return null;
    }

    if (matches.length === 1) {


      const match = matches[0]!;
      const similarity = this.calculateContextSimilarity(
        annotation,
        match,
        element
      );



      if (similarity > 0.5) {

        return this.createMatchResult(match, element);
      } else {

        return null;
      }
    }



    let bestMatch = null;
    let bestSimilarity = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const similarity = this.calculateContextSimilarity(
        annotation,
        match,
        element
      );



      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = match;
      } else if (similarity === bestSimilarity && bestMatch) {
        if (match.start < bestMatch.start) {
          bestMatch = match;

        }
      }
    }

    if (bestMatch && bestSimilarity > 0.5) {

      return this.createMatchResult(bestMatch, element);
    } else {

      return null;
    }
  }

  private findAllOccurrences(
    searchArea: string,
    searchText: string,
    offset: number
  ): Array<{ start: number; end: number }> {
    const matches: Array<{ start: number; end: number }> = [];
    let pos = 0;

    while (pos < searchArea.length) {
      const index = searchArea.indexOf(searchText, pos);
      if (index === -1) break;

      matches.push({
        start: offset + index,
        end: offset + index + searchText.length
      });

      pos = index + 1;
    }

    return matches;
  }

  private calculateContextSimilarity(
    annotation: Annotation,
    match: { start: number; end: number },
    element: HTMLElement
  ): number {
    const { contextBefore: currentContextBefore, contextAfter: currentContextAfter } = this.extractContextFromDOM(
      element,
      { start: match.start, end: match.end },
      CONTEXT_LENGTH_BEFORE,
      CONTEXT_LENGTH_AFTER
    );

    const originalContextBefore = annotation.contextBefore || "";
    const originalContextAfter = annotation.contextAfter || "";

    const beforeSimilarity = calculateSimilarity(currentContextBefore, originalContextBefore);
    const afterSimilarity = calculateSimilarity(currentContextAfter, originalContextAfter);

    const avgSimilarity = (beforeSimilarity + afterSimilarity) / 2;



    return avgSimilarity;
  }

  private createMatchResult(
    match: { start: number; end: number },
    element: HTMLElement
  ): MatchResult {
    const { contextBefore, contextAfter } = this.extractContextFromDOM(
      element,
      { start: match.start, end: match.end },
      CONTEXT_LENGTH_BEFORE,
      CONTEXT_LENGTH_AFTER
    );

    return {
      found: true,
      textPosition: { start: match.start, end: match.end },
      contextBefore,
      contextAfter,
      element
    };
  }

  private findInAdjacentElements(
    elements: HTMLElement[],
    currentIndex: number,
    annotation: Annotation
  ): MatchResult | null {
    const adjacentOffsets = [-1, 1, -2, 2];

    for (const offset of adjacentOffsets) {
      const adjacentIndex = currentIndex + offset;

      if (adjacentIndex >= 0 && adjacentIndex < elements.length) {
        const adjacentElement = elements[adjacentIndex];


        const result = this.findTextInElement(adjacentElement!, annotation);

        if (result && result.found) {

          return result;
        }
      }
    }


    return null;
  }



  private renderAnnotationInElement(
    element: HTMLElement,
    annotation: Annotation,
    startPosition: number,
    endPosition: number
  ): void {
    try {
      const textNodes: Text[] = [];
      const nodePositions: Map<Text, number> = new Map();

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
      let currentNodeStartPos = 0;
      let node = walker.nextNode();

      while (node) {
        const textNode = node as Text;
        const parent = textNode.parentElement;

        if (parent && parent.tagName !== "RT" &&
            !parent.closest("div.inline-title") &&
            !parent.closest("[class*='metadata-']") &&
            !parent.closest("div.multi-select-pill-content") &&
            !parent.closest("div.metadata-content") &&
            !parent.closest("div.mod-header") &&
            !parent.closest("div.mod-ui")) {
          nodePositions.set(textNode, currentNodeStartPos);
          textNodes.push(textNode);
          currentNodeStartPos += textNode.textContent?.length || 0;
        }

        node = walker.nextNode();
      }

      let currentPos = 0;
      let remainingLength = endPosition - startPosition;
      const matches: { node: Text; start: number; length: number }[] = [];

      for (const textNode of textNodes) {
        const nodePos = nodePositions.get(textNode) || 0;
        const nodeLength = textNode.textContent?.length || 0;

        if (nodePos + nodeLength <= startPosition) {
          currentPos = nodePos + nodeLength;
          continue;
        }

        if (currentPos >= endPosition || remainingLength <= 0) break;

        const startInNode = Math.max(0, startPosition - currentPos);
        const availableLength = nodeLength - startInNode;
        const takeLength = Math.min(availableLength, remainingLength);

        matches.push({
          node: textNode,
          start: startInNode,
          length: takeLength
        });

        remainingLength -= takeLength;
        currentPos = nodePos + nodeLength;

        if (remainingLength <= 0) break;
      }

      const rubyTexts = annotation.rubyTexts;
      let currentOffset = 0;
      const markElements: HTMLElement[] = [];

      // 检查是否需要跨元素渲染（标注跨越多个文本节点）
      const needsCrossElementRendering = matches.length > 1;

      if (needsCrossElementRendering) {
        // 跨元素渲染：用单个 <mark> 包裹整个选区
        const firstMatch = matches[0]!;
        const lastMatch = matches[matches.length - 1]!;

        // 处理第一个文本节点（标注开始前）
        const firstText = firstMatch.node.textContent || "";
        const beforeFirst = firstText.substring(0, firstMatch.start);

        // 处理最后一个文本节点（标注结束后）
        const lastText = lastMatch.node.textContent || "";
        const afterLast = lastText.substring(lastMatch.start + lastMatch.length);

        // 收集选区内的所有节点
        const startNode = firstMatch.node;
        const endNode = lastMatch.node;

        // 使用 Range 来获取选区内容
        const range = document.createRange();

        // 设置 Range 的起始位置
        const startOffset = firstMatch.start;
        range.setStart(startNode, startOffset);

        // 设置 Range 的结束位置
        const endOffset = lastMatch.start + lastMatch.length;
        range.setEnd(endNode, endOffset);

        // 创建空的 mark 元素容器（不预先填充内容）
        const markElement = document.createElement("mark");
        markElement.dataset.annotationId = annotation.id;
        this.applyMarkerPresentation(markElement, annotation);

        markElement.style.cursor = "pointer";
        markElement.addEventListener("mouseenter", (e) => this.showTooltip(e, annotation));
        markElement.addEventListener("mousemove", (e) => this.moveTooltip(e));
        markElement.addEventListener("mouseleave", () => this.hideTooltip());

        // 提取 Range 内容到 mark 元素中
        try {
          const fragment = range.extractContents();
          markElement.appendChild(fragment);
        } catch (e) {
          // 如果 extractContents 失败（部分选中导致），使用备用方案
          console.warn('[⚠️ AnnotationRenderer] extractContents 失败，使用备用方案:', e);

          // 备用方案：手动收集内容
          let currentNode: Node | null = startNode;
          let reachedEnd = false;

          while (currentNode && !reachedEnd) {
            if (currentNode === endNode) {
              // 处理结束节点
              if (currentNode.nodeType === Node.TEXT_NODE) {
                const textNode = currentNode as Text;
                const endText = textNode.textContent?.substring(0, endOffset) || "";
                markElement.appendChild(document.createTextNode(endText));
              }
              reachedEnd = true;
            } else if (currentNode === startNode) {
              // 处理开始节点（只取部分内容）
              if (currentNode.nodeType === Node.TEXT_NODE) {
                const textNode = currentNode as Text;
                const startText = textNode.textContent?.substring(startOffset) || "";
                markElement.appendChild(document.createTextNode(startText));
              }
            } else {
              // 处理中间节点（完整移动）
              markElement.appendChild(currentNode.cloneNode(true));
            }

            // 移动到下一个节点
            if (currentNode === endNode) {
              reachedEnd = true;
            } else if (currentNode.firstChild) {
              currentNode = currentNode.firstChild;
            } else if (currentNode.nextSibling) {
              currentNode = currentNode.nextSibling;
            } else {
              // 向上查找下一个节点
              let parentNode: Node | null = currentNode.parentNode;
              while (parentNode && parentNode !== element && !parentNode.nextSibling) {
                parentNode = parentNode.parentNode;
              }
              if (parentNode && parentNode !== element) {
                currentNode = parentNode.nextSibling;
              } else {
                reachedEnd = true;
              }
            }
          }
        }

        // 构建替换后的文档结构
        const newFragment = document.createDocumentFragment();

        // 添加标注前的内容
        if (beforeFirst) {
          newFragment.appendChild(document.createTextNode(beforeFirst));
        }

        // 添加 mark 元素
        newFragment.appendChild(markElement);

        // 添加标注后的内容
        if (afterLast) {
          newFragment.appendChild(document.createTextNode(afterLast));
        }

        // 找到第一个文本节点的父元素，并替换内容
        const firstParent = startNode.parentNode;
        if (firstParent) {
          // 需要移除从 startNode 到 endNode 之间的所有节点
          // 并插入新构建的 fragment

          // 首先将第一个节点替换为新 fragment
          firstParent.replaceChild(newFragment, startNode);

          // 然后删除中间的所有节点（直到并包括 endNode）
          let nodeToRemove: Node | null = startNode.nextSibling;
          while (nodeToRemove) {
            const nextSibling = nodeToRemove.nextSibling;

            // 检查是否是 endNode 或包含 endNode
            let shouldRemove = false;
            if (nodeToRemove === endNode) {
              shouldRemove = true;
            } else {
              // 检查 nodeToRemove 是否包含 endNode
              const containsEnd = nodeToRemove.contains(endNode);
              if (containsEnd) {
                shouldRemove = true;
              }
            }

            if (shouldRemove) {
              firstParent.removeChild(nodeToRemove);
              if (nodeToRemove === endNode) {
                break;
              }
            } else {
              // 如果不包含 endNode，继续检查下一个
              if (nodeToRemove.contains(endNode)) {
                // 找到了包含 endNode 的节点，停止删除
                break;
              }
            }

            nodeToRemove = nextSibling;
          }
        }

        markElements.push(markElement);
      } else {
        // 单元素渲染：保持原有逻辑
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i]!;
          if (!document.contains(match.node)) {
            continue;
          }

          const text = match.node.textContent || "";
          const highlighted = text.substring(match.start, match.start + match.length);

          let matchRubyTexts: typeof rubyTexts = undefined;

          if (rubyTexts && rubyTexts.length > 0) {
            const segmentStart = currentOffset;
            const segmentEnd = currentOffset + highlighted.replace(/\r\n/g, '\n').length;
            const fullText = annotation.text;

            matchRubyTexts = rubyTexts
              .filter(ruby => {
                const rubyStart = ruby.startIndex;
                const rubyEnd = ruby.startIndex + ruby.length;
                const inRange = rubyStart < segmentEnd && rubyEnd > segmentStart;
                return inRange;
              })
              .map(ruby => {
                const relativeStartIndex = Math.max(0, ruby.startIndex - segmentStart);
                const adjustedLength = Math.min(ruby.length, segmentEnd - ruby.startIndex);
                return {
                  startIndex: relativeStartIndex,
                  length: adjustedLength,
                  ruby: ruby.ruby
                };
              })
              .filter(ruby => ruby.length > 0);
          }

          currentOffset += highlighted.replace(/\r\n/g, '\n').length;

          const modifiedAnnotation = matchRubyTexts && matchRubyTexts.length > 0
            ? { ...annotation, rubyTexts: matchRubyTexts }
            : { ...annotation, rubyTexts: undefined };

          const markElement = this.createHighlightSpan(modifiedAnnotation, highlighted);

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

          markElements.push(markElement);
        }
      }

      this.annotationElements.set(annotation.id, markElements);
    } catch (error) {
      throw error;
    }
  }





}
