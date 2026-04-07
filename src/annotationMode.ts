import { App, Notice, TFile, MarkdownView, WorkspaceLeaf, MarkdownPostProcessorContext, MarkdownSectionInformation, MarkdownRenderer, Component, CachedMetadata, SectionCache } from "obsidian";
import { DataManager } from "./dataManager";
import { AnnotationRenderer, RenderResult } from "./annotationRenderer";
import { SelectionMenu } from "./selectionMenu";
import { AnnotationMenu } from "./annotationMenu";
import { AnnotationListPanel } from "./annotationListPanel";
import { ExtractedRubyInfo, PartialAnnotationInfo, CONTEXT_LENGTH_BEFORE, CONTEXT_LENGTH_AFTER } from "./types";

class LeafAnnotationState {
  private app: App;
  private dataManager: DataManager;
  private plugin: any;
  private annotationMode: AnnotationMode;

  public leaf: WorkspaceLeaf;
  public isActive: boolean = false;
  public currentView: MarkdownView | null = null;
  public currentFilePath: string | null = null;
  public renderer: AnnotationRenderer | null = null;

  public selectionMenu: SelectionMenu;
  public annotationMenu: AnnotationMenu;
  public annotationListPanel: AnnotationListPanel;

  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private scrollHandler: (() => void) | null = null;
  private scrollTimeout: number | null = null;

  private contentContainer: HTMLElement | null = null;
  private scrollView: HTMLElement | null = null;
  private elementContextMap: WeakMap<HTMLElement, MarkdownPostProcessorContext> = new WeakMap();
  private processedElements: Set<HTMLElement> = new Set();
  private extractedElementTexts: Map<HTMLElement, string> = new Map();

  constructor(leaf: WorkspaceLeaf, app: App, dataManager: DataManager, plugin: any, annotationMode: AnnotationMode) {
    this.leaf = leaf;
    this.app = app;
    this.dataManager = dataManager;
    this.plugin = plugin;
    this.annotationMode = annotationMode;
    this.selectionMenu = new SelectionMenu(app, dataManager);
    this.annotationMenu = new AnnotationMenu(app, dataManager, annotationMode);
    this.annotationListPanel = new AnnotationListPanel(app, dataManager);
  }

  async activate(file: TFile): Promise<void> {
    // 如果之前有 renderer，先清理它（确保切换文件时状态被重置）
    this.cleanupRenderer();

    const view = this.leaf.view as MarkdownView;
    if (!view) {
      new Notice("请先打开一个Markdown文件");
      return;
    }

    if (view.getMode() !== "preview") {
      view.setState({ mode: "preview" }, { history: false });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.currentView = view;
    this.currentFilePath = file.path;
    this.isActive = true;

    this.addAnnotationCursorStyle();
    this.setupDOMContainers();

    this.renderer = new AnnotationRenderer(view, this.elementContextMap, this.extractedElementTexts);




    // 从全局缓存中获取当前文件的所有元素

    const fileElements = this.annotationMode.getElementsForFilePath(file.path);


    for (const element of fileElements) {
      const context = this.annotationMode.getContextForElement(element);
      if (context) {
        this.registerElement(element, context);
      }
    }

    // 提取所有元素的文本
    this.extractAllElementTexts();

    await this.loadAndRenderAnnotations();

    this.setupEventListeners();

    const previewContainer = this.currentView.previewMode.containerEl as HTMLElement;
    this.annotationListPanel.show(this.currentFilePath, previewContainer, async () => {
      await this.loadAndRenderAnnotations();
    }, this.currentView);

    new Notice("标注模式已开启");
  }

  private cleanupRenderer(): void {
    if (this.renderer) {
      this.renderer.clearProcessedAnnotations();
      this.renderer = null;
    }
  }

  private setupDOMContainers(): void {
    if (!this.currentView) return;

    const previewContainerEl = this.currentView.previewMode.containerEl;

    this.contentContainer = previewContainerEl.querySelector(
      '.markdown-preview-sizer.markdown-preview-section'
    ) as HTMLElement | null;

    this.scrollView = previewContainerEl.querySelector(
      '.markdown-preview-view'
    ) as HTMLElement | null;

  }

  /**
   * 注册元素（由全局 post processor 调用）
   */
  registerElement(element: HTMLElement, context: MarkdownPostProcessorContext): void {
    const sectionInfo = context.getSectionInfo(element);
    const lineRange = sectionInfo ? `行 ${sectionInfo.lineStart}-${sectionInfo.lineEnd}` : '未知行号';



    this.elementContextMap.set(element, context);
    this.processedElements.add(element);


  }

  private extractAllElementTexts(): void {



    this.extractedElementTexts.clear();

    let index = 0;
    this.processedElements.forEach((el) => {
      const text = this.getCleanTextFromElement(el);
      this.extractedElementTexts.set(el, text);
      index++;


    });


  }

  private async waitForElementsRegistered(): Promise<void> {


    let lastCount = 0;
    let stableCount = 0;
    const maxWaitTime = 60000;
    const checkInterval = 100;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const currentCount = this.processedElements.size;
        const elapsed = Date.now() - startTime;



        if (currentCount === lastCount) {
          stableCount++;
          if (stableCount >= 3) {
            clearInterval(interval);

            this.extractAllElementTexts();
            resolve();
            return;
          }
        } else {
          stableCount = 0;
          lastCount = currentCount;
        }

        if (Date.now() - startTime > maxWaitTime) {
          clearInterval(interval);

          this.extractAllElementTexts();
          resolve();
        }
      }, checkInterval);
    });
  }

  private calculateStartOffsetInElement(anchorNode: Node, anchorOffset: number, element: HTMLElement): number | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let accumulatedLength = 0;
    let node = walker.nextNode();

    while (node) {
      if (node === anchorNode) {
        return accumulatedLength + anchorOffset;
      }

      const parent = node.parentElement;
      if (parent && parent.tagName !== "RT") {
        accumulatedLength += (node.textContent || '').length;
      }

      node = walker.nextNode();
    }

    return null;
  }

  private calculateEndOffsetInElement(focusNode: Node, focusOffset: number, element: HTMLElement): number {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let accumulatedLength = 0;
    let node = walker.nextNode();

    while (node) {
      const parent = node.parentElement;
      if (!parent) {
        node = walker.nextNode();
        continue;
      }

      if (parent.tagName === "RT") {
        node = walker.nextNode();
        continue;
      }

      const nodeLength = (node.textContent || '').length;

      if (node === focusNode) {
        return accumulatedLength + focusOffset;
      }

      accumulatedLength += nodeLength;
      node = walker.nextNode();
    }

    return accumulatedLength;
  }

  private findRegisteredElement(node: Node): HTMLElement | null {
    let currentNode: Node | null = node;

    while (currentNode) {
      if (currentNode instanceof HTMLElement) {
        if (this.elementContextMap.has(currentNode)) {
          return currentNode;
        }
      }

      currentNode = currentNode.parentNode;
    }

    return null;
  }

  deactivate(): void {
    if (!this.isActive) return;

    this.clearAllAnnotations();
    this.removeEventListeners();
    this.removeAnnotationCursorStyle();

    if (this.renderer) {
      this.renderer.clearProcessedAnnotations();
      this.renderer = null;
    }

    this.selectionMenu.hide();
    this.annotationMenu.hide();
    this.annotationListPanel.hide();

    this.contentContainer = null;
    this.scrollView = null;
    this.processedElements.clear();
    this.elementContextMap = new WeakMap();
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }

    this.currentView = null;
    this.currentFilePath = null;
    this.isActive = false;

    new Notice("标注模式已关闭");
  }

  private clearAllAnnotations(): void {
    if (!this.currentView || !this.currentView.previewMode) return;

    const previewEl = this.currentView.previewMode.containerEl;

    const allMarks = Array.from(previewEl.querySelectorAll("mark[data-annotation-id]"));
    for (const mark of allMarks) {
      const parent = mark.parentNode;
      if (parent) {
        const fragment = document.createDocumentFragment();

        for (const child of Array.from(mark.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            // 直接移动文本节点
            fragment.appendChild(child);
          } else if (child instanceof Element) {
            const tagName = child.tagName.toLowerCase();
            if (tagName === "ruby") {
              const hasAttribute = child.hasAttribute("data-annotation-ruby");
              if (hasAttribute) {
                // 插件创建的注音，转为文本
                let textContent = "";
                const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
                let node = walker.nextNode();
                while (node) {
                  const textNode = node as Text;
                  const parentElement = textNode.parentElement;
                  if (parentElement && parentElement.tagName !== "RT") {
                    textContent += textNode.textContent;
                  }
                  node = walker.nextNode();
                }
                fragment.appendChild(document.createTextNode(textContent));
              } else {
                // 原文注音，保留原样
                fragment.appendChild(child);
              }
            } else {
              // 其他元素（如 <sup>），保留原样
              fragment.appendChild(child);
            }
          } else {
            // 其他类型节点，保留原样
            fragment.appendChild(child);
          }
        }

        parent.replaceChild(fragment, mark);
      }
    }

    const allRubies = Array.from(previewEl.querySelectorAll("ruby[data-annotation-ruby]"));
    for (const ruby of allRubies) {
      const parent = ruby.parentNode;
      if (parent && !(parent as Element).closest("mark[data-annotation-id]")) {
        let textContent = "";
        const walker = document.createTreeWalker(ruby, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        while (node) {
          const textNode = node as Text;
          const parentElement = textNode.parentElement;
          if (parentElement && parentElement.tagName !== "RT") {
            textContent += textNode.textContent;
          }
          node = walker.nextNode();
        }
        const textNode = document.createTextNode(textContent);
        parent.replaceChild(textNode, ruby);
      }
    }

    this.mergeAdjacentTextNodes(previewEl);
  }

  private async forceReRenderAnnotation(annotationId: string): Promise<void> {
    if (!this.currentView || !this.currentView.previewMode || !this.renderer) return;

    const previewEl = this.currentView.previewMode.containerEl;

    const markElement = previewEl.querySelector(`mark[data-annotation-id="${annotationId}"]`);
    if (!markElement) return;

    const parent = markElement.parentNode;
    if (parent) {
      const fragment = document.createDocumentFragment();

      for (const child of Array.from(markElement.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          // 直接移动文本节点
          fragment.appendChild(child);
        } else if (child instanceof Element) {
          const tagName = child.tagName.toLowerCase();
          if (tagName === "ruby") {
            const hasAttribute = child.hasAttribute("data-annotation-ruby");
            if (hasAttribute) {
              // 插件创建的注音，转为文本
              let textContent = "";
              const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
              let node = walker.nextNode();
              while (node) {
                const textNode = node as Text;
                const parentElement = textNode.parentElement;
                if (parentElement && parentElement.tagName !== "RT") {
                  textContent += textNode.textContent;
                }
                node = walker.nextNode();
              }
              fragment.appendChild(document.createTextNode(textContent));
            } else {
              // 原文注音，保留原样
              fragment.appendChild(child);
            }
          } else {
            // 其他元素（如 <sup>），保留原样
            fragment.appendChild(child);
          }
        } else {
          // 其他类型节点，保留原样
          fragment.appendChild(child);
        }
      }

      parent.replaceChild(fragment, markElement);
    }

    const renderedAnnotations = this.renderer.getRenderedAnnotations();
    renderedAnnotations.delete(annotationId);

    this.renderer['processedAnnotations'].delete(annotationId);

    this.dataManager.clearCache();

    await new Promise(resolve => setTimeout(resolve, 100));

    const data = await this.dataManager.loadAnnotations(this.currentFilePath!);
    if (data && data.annotations.length > 0) {
      this.renderer.setAnnotations(data.annotations);
      const result = this.renderer.renderByText(previewEl);

      if (result.updatedContexts.length > 0) {
        for (const update of result.updatedContexts) {
          await this.dataManager.updateAnnotation(this.currentFilePath!, update.id, {
            contextBefore: update.contextBefore,
            contextAfter: update.contextAfter,
            startLine: update.startLine,
            endLine: update.endLine,
            startOffset: update.startOffset,
            endOffset: update.endOffset,
          });
        }
      }
    }

    const allRubies = Array.from(previewEl.querySelectorAll("ruby[data-annotation-ruby]"));
    for (const ruby of allRubies) {
      const rubyParent = ruby.parentNode;
      if (rubyParent && !(rubyParent as Element).closest("mark[data-annotation-id]")) {
        let textContent = "";
        const walker = document.createTreeWalker(ruby, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        while (node) {
          const textNode = node as Text;
          const parentElement = textNode.parentElement;
          if (parentElement && parentElement.tagName !== "RT") {
            textContent += textNode.textContent;
          }
          node = walker.nextNode();
        }
        const textNode = document.createTextNode(textContent);
        rubyParent.replaceChild(textNode, ruby);
      }
    }

    this.mergeAdjacentTextNodes(previewEl);
  }

  async reRenderAnnotation(annotationId: string): Promise<void> {
    await this.forceReRenderAnnotation(annotationId);
  }

  private addAnnotationCursorStyle(): void {
    document.body.classList.add("annotation-mode-active");
  }

  private removeAnnotationCursorStyle(): void {
    document.body.classList.remove("annotation-mode-active");
  }

  private async loadAndRenderAnnotations(): Promise<void> {
    if (!this.currentFilePath || !this.renderer || !this.currentView) return;



    this.dataManager.clearCache();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const previewEl = this.currentView.previewMode.containerEl;

    const data = await this.dataManager.loadAnnotations(this.currentFilePath);


    const existingAnnotationIds = new Set(
      Array.from(previewEl.querySelectorAll("mark[data-annotation-id]"))
        .map(mark => mark.getAttribute("data-annotation-id"))
        .filter((id): id is string => id !== null)
    );



    let currentAnnotationIds = new Set<string>();

    if (data && data.annotations.length > 0) {
      currentAnnotationIds = new Set(data.annotations.map(a => a.id));
    }

    const annotationsToRemove = Array.from(existingAnnotationIds).filter(id => !currentAnnotationIds.has(id));



    if (annotationsToRemove.length > 0) {
      for (const annotationId of annotationsToRemove) {

        const mark = previewEl.querySelector(`mark[data-annotation-id="${annotationId}"]`);
        if (mark) {
          const parent = mark.parentNode;
          if (parent) {
            const fragment = document.createDocumentFragment();

            for (const child of Array.from(mark.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) {
                // 直接移动文本节点
                fragment.appendChild(child);
              } else if (child instanceof Element) {
                const tagName = child.tagName.toLowerCase();
                if (tagName === "ruby") {
                  const hasAttribute = child.hasAttribute("data-annotation-ruby");
                  if (hasAttribute) {
                    // 插件创建的注音，转为文本
                    let textContent = "";
                    const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
                    let node = walker.nextNode();
                    while (node) {
                      const textNode = node as Text;
                      const parentElement = textNode.parentElement;
                      if (parentElement && parentElement.tagName !== "RT") {
                        textContent += textNode.textContent;
                      }
                      node = walker.nextNode();
                    }
                    fragment.appendChild(document.createTextNode(textContent));
                  } else {
                    // 原文注音，保留原样
                    fragment.appendChild(child);
                  }
                } else {
                  // 其他元素（如 <sup>），保留原样
                  fragment.appendChild(child);
                }
              } else {
                // 其他类型节点，保留原样
                fragment.appendChild(child);
              }
            }

            parent.replaceChild(fragment, mark);
          }
        }
      }

      const allRubies = Array.from(previewEl.querySelectorAll("ruby[data-annotation-ruby]"));
      if (allRubies.length > 0) {
        for (const ruby of allRubies) {
          const parent = ruby.parentNode;
          if (parent && !(parent as Element).closest("mark[data-annotation-id]")) {
            let textContent = "";
            const walker = document.createTreeWalker(ruby, NodeFilter.SHOW_TEXT, null);
            let node = walker.nextNode();
            while (node) {
              const textNode = node as Text;
              const parentElement = textNode.parentElement;
              if (parentElement && parentElement.tagName !== "RT") {
                textContent += textNode.textContent;
              }
              node = walker.nextNode();
            }
            const textNode = document.createTextNode(textContent);
            parent.replaceChild(textNode, ruby);
          }
        }
      }

      this.mergeAdjacentTextNodes(previewEl);

    }

    if (!data || data.annotations.length === 0) {

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    this.extractAllElementTexts();

    const annotationsToRender = data.annotations.filter(a => !existingAnnotationIds.has(a.id));
    this.renderer.setAnnotations(annotationsToRender);
    const result: RenderResult = this.renderer.renderByText(previewEl);

    if (result.updatedContexts.length > 0) {
      for (const update of result.updatedContexts) {
        await this.dataManager.updateAnnotation(this.currentFilePath, update.id, {
          contextBefore: update.contextBefore,
          contextAfter: update.contextAfter,
          startLine: update.startLine,
          endLine: update.endLine,
          startOffset: update.startOffset,
          endOffset: update.endOffset,
        });
      }
    }

    if (result.lostAnnotations.length > 0) {

    }


  }

  private setupEventListeners(): void {
    this.mouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);
    this.clickHandler = (e: MouseEvent) => this.handleClick(e);

    document.addEventListener("mouseup", this.mouseUpHandler);
    document.addEventListener("click", this.clickHandler, true);

    if (this.scrollView) {
      this.scrollHandler = () => this.handleScroll();
      this.scrollView.addEventListener('scroll', this.scrollHandler);
    }
  }

  private removeEventListeners(): void {
    if (this.mouseUpHandler) {
      document.removeEventListener("mouseup", this.mouseUpHandler);
      this.mouseUpHandler = null;
    }
    if (this.clickHandler) {
      document.removeEventListener("click", this.clickHandler, true);
      this.clickHandler = null;
    }
    if (this.scrollHandler && this.scrollView) {
      this.scrollView.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }

  private handleScroll() {
    if (!this.scrollTimeout) {
      this.scrollTimeout = window.setTimeout(() => {
        this.scrollTimeout = null;
        this.renderVisibleAnnotations();
      }, 100);
    }
  }

  private async renderVisibleAnnotations(): Promise<void> {
    if (!this.isActive || !this.renderer || !this.currentView || !this.currentFilePath) return;

    if (!this.contentContainer || !this.scrollView) return;

    const excludeSelectors = [
      '.mod-frontmatter',
      '.mod-footer',
      '.mod-header',
      '.markdown-preview-pusher'
    ];

    const allChildren = Array.from(this.contentContainer.children);

    const allElements = allChildren.filter((el) => {
      const className = el.className;
      if (typeof className !== 'string') return true;

      for (const selector of excludeSelectors) {
        if (el.matches(selector)) return false;
      }
      return true;
    });

    const scrollRect = this.scrollView.getBoundingClientRect();

    const visibleElements = allElements.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < scrollRect.bottom && rect.bottom > scrollRect.top;
    });

    if (visibleElements.length === 0) return;

    const visibleLineRange = this.calculateVisibleLineRange(visibleElements);

    const data = await this.dataManager.loadAnnotations(this.currentFilePath);
    if (!data || data.annotations.length === 0) return;

    const annotationsToRender = data.annotations.filter(annotation =>
      annotation.isValid === 1 &&
      annotation.startLine >= visibleLineRange.minLine &&
      annotation.endLine <= visibleLineRange.maxLine
    );

    if (annotationsToRender.length === 0) return;

    this.renderer.setAnnotations(annotationsToRender);
    const result = this.renderer.renderByText(this.currentView.previewMode.containerEl);

    if (result.updatedContexts.length > 0) {
      for (const update of result.updatedContexts) {
        await this.dataManager.updateAnnotation(this.currentFilePath, update.id, {
          contextBefore: update.contextBefore,
          contextAfter: update.contextAfter,
          startLine: update.startLine,
          endLine: update.endLine,
          startOffset: update.startOffset,
          endOffset: update.endOffset,
        });
      }
    }

    if (result.lostAnnotations.length > 0) {

    }
  }

  private calculateVisibleLineRange(elements: Element[]): { minLine: number; maxLine: number } {
    let minLine = Infinity;
    let maxLine = -Infinity;

    for (const el of elements) {
      const context = this.elementContextMap.get(el as HTMLElement);
      if (context) {
        const sectionInfo = context.getSectionInfo(el as HTMLElement);
        if (sectionInfo) {
          minLine = Math.min(minLine, sectionInfo.lineStart);
          maxLine = Math.max(maxLine, sectionInfo.lineEnd);
        }
      }
    }

    return {
      minLine: minLine === Infinity ? 0 : minLine,
      maxLine: maxLine === -Infinity ? 0 : maxLine
    };
  }

  private handleMouseUp(e: MouseEvent): void {


    if (!this.isActive || !this.currentView || !this.currentFilePath) {

      return;
    }

    if (this.currentView.getMode() === "source") {

      this.deactivate();
      return;
    }

    const previewEl = this.currentView.previewMode.containerEl;
    if (!previewEl.contains(e.target as Node)) return;

    const target = e.target as HTMLElement;
    if (target.classList.contains("annotation-highlight") || target.closest(".annotation-card-menu")) return;

    setTimeout(async () => {


      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {

        return;
      }

      const range = selection.getRangeAt(0);
      let selectedText = this.getCleanTextFromRange(range).trim();

      if (!selectedText) {

        return;
      }



      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;

      if (!anchorNode || !focusNode) return;

      const startElement = this.findRegisteredElement(anchorNode);
      const endElement = this.findRegisteredElement(focusNode);

      if (!startElement || !endElement) {

        return;
      }



      if (startElement !== endElement) {

        new Notice("暂不支持跨段落添加标注");
        return;
      }

      const startListItem = anchorNode.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element).closest('li[data-line]')
        : (anchorNode.parentElement?.closest('li[data-line]'));

      const endListItem = focusNode.nodeType === Node.ELEMENT_NODE
        ? (focusNode as Element).closest('li[data-line]')
        : (focusNode.parentElement?.closest('li[data-line]'));

      if (startListItem && endListItem && startListItem !== endListItem) {

        new Notice("暂不支持跨列表项添加标注");
        return;
      }

      // 检测跨表格单元格选择
      const startTableCell = anchorNode.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element).closest('td, th')
        : (anchorNode.parentElement?.closest('td, th'));

      const endTableCell = focusNode.nodeType === Node.ELEMENT_NODE
        ? (focusNode as Element).closest('td, th')
        : (focusNode.parentElement?.closest('td, th'));

      if (startTableCell && endTableCell && startTableCell !== endTableCell) {

        new Notice("暂不支持跨表格单元格添加标注");
        return;
      }

      const context = this.elementContextMap.get(startElement);
      if (!context) {

        return;
      }

      const sectionInfo = context.getSectionInfo(startElement);

      if (!sectionInfo) {

        return;
      }

      const startLine = sectionInfo.lineStart || 0;
      const endLine = sectionInfo.lineEnd || 0;

      const startOffset = this.calculateStartOffsetInElement(anchorNode, selection.anchorOffset, startElement) || 0;
      const endOffset = this.calculateEndOffsetInElement(focusNode, selection.focusOffset, startElement);



      const extractedRubyInfo = this.extractRubyInfoFromSelection(range, selectedText);


      const partialAnnotationInfo = await this.extractPartialAnnotationInfo(range, selectedText, previewEl);


      const containedAnnotationIds = this.extractAnnotationIdsFromRange(range, previewEl);


      const originalRubies = this.extractOriginalRubiesFromRange(range, previewEl);


      const contextInfo = this.extractContextFromSelection(startElement, startOffset, endOffset);

      if (contextInfo) {


        const selectedRange = selection.getRangeAt(0);
        const rect = selectedRange.getBoundingClientRect();



        const selectionRects = Array.from(selectedRange.getClientRects()).map((clientRect) => ({
          left: clientRect.left,
          top: clientRect.top,
          width: clientRect.width,
          height: clientRect.height,
        }));

        this.selectionMenu.show(
          rect.right,
          rect.bottom,
          selectedText,
          startLine,
          endLine,
          startOffset,
          endOffset,
          this.currentFilePath!,
          selectionRects,
          async () => {
            await this.loadAndRenderAnnotations();
          },
          extractedRubyInfo || undefined,
          partialAnnotationInfo || undefined,
          previewEl,
          this.renderer,
          contextInfo.contextBefore,
          contextInfo.contextAfter,
          containedAnnotationIds || undefined,
          originalRubies || undefined
        );
      }
    }, 10);
  }

  private handleClick(e: MouseEvent): void {
    if (!this.isActive || !this.currentView || !this.currentFilePath || !this.renderer) return;

    if (this.currentView.getMode() === "source") {
      this.deactivate();
      return;
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    const target = e.target as HTMLElement;
    const highlightTarget = target.closest("[data-annotation-id]") as HTMLElement;
    if (!highlightTarget) return;

    e.preventDefault();
    e.stopPropagation();

    const annotationId = highlightTarget.dataset.annotationId;
    if (!annotationId) return;

    this.showAnnotationMenu(annotationId, e.clientX, e.clientY);
  }

  private showAnnotationMenu(annotationId: string, x: number, y: number): void {
    if (!this.currentFilePath) return;

    const data = this.dataManager.loadAnnotations(this.currentFilePath);
    data?.then((d) => {
      if (!d) return;
      const annotation = d.annotations.find((a) => a.id === annotationId);
      if (annotation) {
        this.annotationMenu.show(x, y, annotation, annotationId, this.currentFilePath!, async () => {
          await this.loadAndRenderAnnotations();
        }, this.annotationMode);
      }
    });
  }

  private getCleanTextFromRange(range: Range): string {
    const container = range.cloneContents();

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      if (textNode.textContent && textNode.textContent.trim().length > 0) {
        const parent = textNode.parentElement;

        let shouldInclude = true;

        if (!parent) {
          shouldInclude = true;
        } else {
          if (parent.tagName === "RT") {
            shouldInclude = false;
          } else if (parent.closest("div.inline-title")) {
            shouldInclude = false;
          } else if (parent.closest("[class*='metadata-']")) {
            shouldInclude = false;
          } else if (parent.closest("div.multi-select-pill-content")) {
            shouldInclude = false;
          } else if (parent.closest("div.metadata-content")) {
            shouldInclude = false;
          } else if (parent.closest("div.mod-header")) {
            shouldInclude = false;
          } else if (parent.closest("div.mod-ui")) {
            shouldInclude = false;
          } else if (parent.closest("div.math-block")) {
            shouldInclude = false;
          } else if (parent.closest("span.math-inline")) {
            shouldInclude = false;
          } else if (parent.closest("span.MathJax")) {
            shouldInclude = false;
          } else if (parent.closest(".math")) {
            shouldInclude = false;
          } else if (parent.closest(".MathJax")) {
            shouldInclude = false;
          } else if (parent.closest(".annotation-icon")) {
            shouldInclude = false;
          } else if (parent.closest(".annotation-list-btn")) {
            shouldInclude = false;
          } else if (parent.closest(".annotation-list-panel")) {
            shouldInclude = false;
          }
        }

        if (shouldInclude) {
          textNodes.push(textNode);
        }
      }
      node = walker.nextNode();
    }

    const text = textNodes.map(n => n.textContent ?? "").join("");

    return text;
  }

  private extractOriginalRubiesFromRange(range: Range, container: Element): Array<{ startIndex: number; length: number; rt: string; rubyHTML: string }> {
    const originalRubies: Array<{ startIndex: number; length: number; rt: string; rubyHTML: string }> = [];

    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    const allTextNodes: Text[] = [];
    const nodePositions: Map<Text, number> = new Map();
    let currentPos = 0;
    let inRange = false;

    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.tagName === "RT") return NodeFilter.FILTER_REJECT;
        if (parent.closest("div.inline-title")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("[class*='metadata-']")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("div.multi-select-pill-content")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("div.metadata-content")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("div.mod-header")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("div.mod-ui")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("div.math-block")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("span.math-inline")) return NodeFilter.FILTER_REJECT;
        if (parent.closest("span.MathJax")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".math")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".MathJax")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".annotation-icon")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".annotation-list-btn")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".annotation-list-panel")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const textLength = textNode.textContent?.length || 0;

      const isStartNode = textNode === startContainer;
      const isEndNode = textNode === endContainer;

      if (isStartNode && isEndNode) {
        const startPos = startOffset;
        const endPos = endOffset;
        if (startPos < endPos) {
          nodePositions.set(textNode, currentPos);
          allTextNodes.push(textNode);
          currentPos += (endPos - startPos);
        }
        inRange = true;
      } else if (isStartNode) {
        const startPos = startOffset;
        if (startPos < textLength) {
          nodePositions.set(textNode, currentPos);
          allTextNodes.push(textNode);
          currentPos += (textLength - startPos);
        }
        inRange = true;
      } else if (isEndNode) {
        const endPos = endOffset;
        if (endPos > 0) {
          nodePositions.set(textNode, currentPos);
          allTextNodes.push(textNode);
          currentPos += endPos;
        }
        inRange = false;
      } else if (inRange) {
        nodePositions.set(textNode, currentPos);
        allTextNodes.push(textNode);
        currentPos += textLength;
      }

      node = walker.nextNode();
    }

    const commonAncestor = range.commonAncestorContainer;
    const allRubies = commonAncestor instanceof Element 
      ? Array.from(commonAncestor.querySelectorAll("ruby"))
      : [];

    for (const ruby of allRubies) {
      if (ruby.hasAttribute("data-annotation-ruby")) {
        continue;
      }

      const rtElement = ruby.querySelector("rt");
      if (!rtElement) {
        continue;
      }

      if (!range.intersectsNode(ruby)) {
        continue;
      }

      let rubyStartPos = -1;
      let rubyEndPos = -1;

      for (const textNode of allTextNodes) {
        const nodePos = nodePositions.get(textNode) || 0;
        const textLength = textNode.textContent?.length || 0;

        if (ruby.contains(textNode)) {
          if (rubyStartPos === -1) {
            rubyStartPos = nodePos;
          }
          rubyEndPos = nodePos + textLength;
        }
      }

      if (rubyStartPos >= 0 && rubyEndPos > rubyStartPos) {
        const rubyText = this.getCleanTextFromElement(ruby);
        const rt = rtElement.textContent || "";

        const rubyHTML = ruby.outerHTML;

        originalRubies.push({
          startIndex: rubyStartPos,
          length: rubyText.length,
          rt: rt,
          rubyHTML: rubyHTML
        });
      }
    }

    return originalRubies;
  }

  private mergeAdjacentTextNodes(container: Element): void {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }

    let mergeCount = 0;
    for (const textNode of textNodes) {
      let current = textNode;
      while (current.nextSibling && current.nextSibling.nodeType === Node.TEXT_NODE) {
        const nextText = current.nextSibling as Text;
        if (current.textContent && nextText.textContent) {
          current.textContent += nextText.textContent;
          nextText.remove();
          mergeCount++;
        } else {
          current = nextText;
        }
      }
    }
  }

  private extractContextFromSelection(
    startElement: HTMLElement,
    startOffset: number,
    endOffset: number
  ): { contextBefore: string; contextAfter: string } | null {



    if (this.extractedElementTexts.size === 0) {

      return null;
    }

    const elements = Array.from(this.extractedElementTexts.keys());
    const currentIndex = elements.indexOf(startElement);

    if (currentIndex === -1) {

      return null;
    }

    const currentText = this.extractedElementTexts.get(startElement) || '';


    let contextBefore = '';
    let contextAfter = '';

    if (startOffset <= currentText.length) {
      const beforeInCurrent = currentText.substring(
        Math.max(0, startOffset - CONTEXT_LENGTH_BEFORE),
        startOffset
      );
      contextBefore = beforeInCurrent;

    }

    if (contextBefore.length < CONTEXT_LENGTH_BEFORE) {

      let needed = CONTEXT_LENGTH_BEFORE - contextBefore.length;
      for (let i = currentIndex - 1; i >= 0 && needed > 0; i--) {
        const prevElement = elements[i];
        if (!prevElement) continue;

        if (this.shouldSkipElement(prevElement)) {

          continue;
        }

        const prevText = this.extractedElementTexts.get(prevElement) || '';
        const prevTextFromEnd = prevText.substring(Math.max(0, prevText.length - needed));
        contextBefore = prevTextFromEnd + contextBefore;
        needed = CONTEXT_LENGTH_BEFORE - contextBefore.length;

      }

    }

    if (endOffset <= currentText.length) {
      const afterInCurrent = currentText.substring(
        endOffset,
        Math.min(currentText.length, endOffset + CONTEXT_LENGTH_AFTER)
      );
      contextAfter = afterInCurrent;

    }

    if (contextAfter.length < CONTEXT_LENGTH_AFTER) {

      let needed = CONTEXT_LENGTH_AFTER - contextAfter.length;
      for (let i = currentIndex + 1; i < elements.length && needed > 0; i++) {
        const nextElement = elements[i];
        if (!nextElement) continue;

        if (this.shouldSkipElement(nextElement)) {

          continue;
        }

        const nextText = this.extractedElementTexts.get(nextElement) || '';
        const nextTextPortion = nextText.substring(0, needed);
        contextAfter = contextAfter + nextTextPortion;
        needed = CONTEXT_LENGTH_AFTER - contextAfter.length;

      }

    }



    return { contextBefore, contextAfter };
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

  private getAllTextNodes(container: Element): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      if (textNode.textContent && textNode.textContent.trim().length > 0) {
        const parent = textNode.parentElement;
        // 排除 RT 标签、文件名、笔记属性、多选标签、标题栏、数学公式、UI 元素、插件相关元素
        // 包含标注元素（mark[data-annotation-id]）
        if (parent && parent.tagName !== "RT" &&
            !parent.closest("div.inline-title") &&
            !parent.closest("[class*='metadata-']") &&
            !parent.closest("div.multi-select-pill-content") &&
            !parent.closest("div.metadata-content") &&
            !parent.closest("div.mod-header") &&
            !parent.closest("div.mod-ui") &&
            !parent.closest("div.math-block") &&
            !parent.closest("span.math-inline") &&
            !parent.closest("span.MathJax") &&
            !parent.closest(".math") &&
            !parent.closest(".MathJax") &&
            !parent.closest(".annotation-icon") &&
            !parent.closest(".annotation-list-btn") &&
            !parent.closest(".annotation-list-panel")) {
          textNodes.push(textNode);
        }
      }
      node = walker.nextNode();
    }

    return textNodes;
  }

  private async extractPartialAnnotationInfo(
    range: Range,
    selectedText: string,
    container: Element
  ): Promise<PartialAnnotationInfo | null> {
    const startContainer = range.startContainer;
    const annotatedElement = startContainer.nodeType === Node.TEXT_NODE
      ? startContainer.parentElement?.closest("mark[data-annotation-id]")
      : (startContainer as Element).closest("mark[data-annotation-id]");

    if (!annotatedElement) {
      return null;
    }

    const annotationId = annotatedElement.getAttribute("data-annotation-id");
    if (!annotationId) {
      return null;
    }

    if (!this.currentFilePath) {
      return null;
    }

    const data = await this.dataManager.loadAnnotations(this.currentFilePath);
    if (!data) {
      return null;
    }

    const annotation = data.annotations.find(a => a.id === annotationId);
    if (!annotation) {
      return null;
    }

    const startIndex = this.calculateOffsetRelativeToAnnotationText(range, annotation.text, annotatedElement);

    if (startIndex === -1) {
      return null;
    }

    return {
      annotationId,
      startIndex,
      length: selectedText.length,
      rubyText: ""
    };
  }

  private calculateOffsetRelativeToAnnotationText(range: Range, annotationText: string, annotatedElement: Element): number {
    const selectedText = this.getCleanTextFromRange(range.cloneRange());
    const annotatedText = this.getCleanTextFromElement(annotatedElement);

    if (!selectedText) {
      return -1;
    }

    const annotatedTextTrimmed = annotatedText.trim();
    const annotationTextTrimmed = annotationText.trim();

    if (annotatedTextTrimmed === annotationTextTrimmed) {
      const offsetInElement = this.calculateOffsetFromRange(range, annotatedElement);
      return offsetInElement;
    }

    if (annotationTextTrimmed.includes(annotatedTextTrimmed)) {
      const offsetInElement = this.calculateOffsetFromRange(range, annotatedElement);

      if (offsetInElement === -1) {
        return -1;
      }

      const segmentStartInAnnotation = this.findSegmentStartInAnnotation(annotationText, annotatedText);

      if (segmentStartInAnnotation !== -1) {
        const result = segmentStartInAnnotation + offsetInElement;
        return result;
      }
    }

    if (selectedText && annotationTextTrimmed.includes(selectedText.trim())) {
      const index = annotationTextTrimmed.indexOf(selectedText.trim());
      return index;
    }

    const offsetInElement = this.calculateOffsetFromRange(range, annotatedElement);
    return offsetInElement;
  }

  private findSegmentStartInAnnotation(annotationText: string, annotatedText: string): number {
    for (let i = 0; i < annotationText.length; i++) {
      const segment = annotationText.substring(i, i + annotatedText.length);
      if (segment === annotatedText || segment.trim() === annotatedText.trim()) {
        return i;
      }
    }

    return -1;
  }

  private calculateOffsetFromRange(range: Range, annotatedElement: Element): number {
    let offset = 0;
    const walker = document.createTreeWalker(annotatedElement, NodeFilter.SHOW_TEXT, null);

    const startContainer = range.startContainer;

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const parentElement = textNode.parentElement;
      const text = textNode.textContent || "";

      if (parentElement && parentElement.tagName !== "RT") {
        if (textNode === startContainer) {
          const result = offset + range.startOffset;
          return result;
        }
        offset += text.length;
      }

      node = walker.nextNode();
    }

    return -1;
  }

  private getCleanTextFromElement(element: Element): string {
    let text = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const parentElement = textNode.parentElement;
      if (parentElement && parentElement.tagName !== "RT") {
        text += textNode.textContent || "";
      }
      node = walker.nextNode();
    }
    return text;
  }

  private extractRubyInfoFromSelection(range: Range, selectedText: string): ExtractedRubyInfo | null {
    const rubyInfo: ExtractedRubyInfo = {
      annotationIds: [],
      rubyTexts: []
    };

    const allRubyElements = Array.from(document.querySelectorAll("ruby[data-annotation-ruby]"));
    if (allRubyElements.length === 0) return null;

    for (const ruby of allRubyElements) {
      if (!range.intersectsNode(ruby)) {
        continue;
      }

      let rubyReading = "";
      let rubyFullText = "";

      const span = ruby.querySelector("span");
      const rb = ruby.querySelector("rb");
      const rt = ruby.querySelector("rt");

      if (span && rt) {
        rubyFullText = span.textContent || "";
        rubyReading = rt.textContent || "";
      } else if (rb && rt) {
        rubyFullText = rb.textContent || "";
        rubyReading = rt.textContent || "";
      } else {
        const textNodes = Array.from(ruby.childNodes).filter(n => n.nodeType === Node.TEXT_NODE) as Text[];
        const rtNodes = Array.from(ruby.querySelectorAll("rt"));
        if (textNodes.length > 0 && rtNodes.length > 0) {
          rubyFullText = textNodes.map(n => n.textContent || "").join("");
          const firstRt = rtNodes[0];
          if (firstRt) {
            rubyReading = firstRt.textContent || "";
          }
        }
      }

      if (!rubyFullText || !rubyReading) {
        continue;
      }

      const rubyRange = document.createRange();
      rubyRange.selectNodeContents(ruby);

      const intersectionRange = this.getIntersectionRange(range, rubyRange);
      if (!intersectionRange) {
        continue;
      }

      let intersectedRubyText = rubyFullText;

      const compareStart = range.compareBoundaryPoints(Range.START_TO_START, rubyRange);
      const compareEnd = range.compareBoundaryPoints(Range.END_TO_END, rubyRange);

      if (compareStart > 0 || compareEnd < 0) {
        intersectedRubyText = "";

        const textNodes = Array.from(ruby.childNodes).filter(n => {
          if (n.nodeType !== Node.TEXT_NODE) return false;
          const parent = n.parentElement;
          return !!parent && parent.tagName !== "RT";
        }) as Text[];

        for (const textNode of textNodes) {
          const nodeRange = document.createRange();
          nodeRange.selectNodeContents(textNode);

          const nodeIntersection = this.getIntersectionRange(range, nodeRange);
          if (nodeIntersection) {
            const clonedNode = nodeIntersection.cloneContents();
            const nodeText = Array.from(clonedNode.childNodes)
              .filter((n): n is Text => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent || "")
              .join("");
            intersectedRubyText += nodeText;
          }
        }
      }

      intersectedRubyText = intersectedRubyText.trim();

      if (!intersectedRubyText) {
        continue;
      }

      const container = this.findContainerForOffsetCalculation(ruby);
      if (!container) {
        continue;
      }

      const textNodes = this.getAllTextNodes(container);
      const nodeStartOffsets: Map<Text, number> = new Map();
      let fullText = "";

      for (const node of textNodes) {
        const parent = node.parentElement;
        if (parent && parent.tagName === "RT") {
          continue;
        }
        nodeStartOffsets.set(node, fullText.length);
        fullText += node.textContent ?? "";
      }

      let startGlobalOffset = -1;

      const startContainer = range.startContainer;
      const startOffset = range.startOffset;

      if (startContainer.nodeType === Node.TEXT_NODE) {
        const parent = startContainer.parentElement;
        if (parent && parent.tagName !== "RT") {
          const startOffsetInFullText = nodeStartOffsets.get(startContainer as Text);
          if (startOffsetInFullText !== undefined) {
            startGlobalOffset = startOffsetInFullText + startOffset;
          }
        }
      } else {
        const startRange = document.createRange();
        startRange.setStart(range.startContainer, range.startOffset);
        startRange.setEnd(range.startContainer, range.startOffset);

        for (const [node, offset] of nodeStartOffsets) {
          const nodeRange = document.createRange();
          nodeRange.selectNodeContents(node);
          if (startRange.intersectsNode(node)) {
            startGlobalOffset = offset;
            break;
          }
        }
      }

      if (startGlobalOffset === -1) {
        continue;
      }

      let rubyGlobalOffset = -1;
      const rubyTextElement = span || rb || ruby;

      if (rubyTextElement === ruby) {
        const textNodes = Array.from(ruby.childNodes).filter(n => {
          if (n.nodeType !== Node.TEXT_NODE) return false;
          const parent = n.parentElement;
          return !!parent && parent.tagName !== "RT";
        }) as Text[];

        if (textNodes.length > 0) {
          const firstTextNode = textNodes[0]!;
          const offset = nodeStartOffsets.get(firstTextNode);
          if (offset !== undefined) {
            rubyGlobalOffset = offset;
          }
        }
      } else {
        const firstChild = rubyTextElement.firstChild;
        if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
          const offset = nodeStartOffsets.get(firstChild as Text);
          if (offset !== undefined) {
            rubyGlobalOffset = offset;
          }
        }
      }

      if (rubyGlobalOffset === -1) {
        continue;
      }

      let startIndexInSelected = rubyGlobalOffset - startGlobalOffset;

      if (compareStart > 0) {
        const intersectionStartContainer = intersectionRange.startContainer;
        const intersectionStartOffset = intersectionRange.startOffset;

        if (intersectionStartContainer.nodeType === Node.TEXT_NODE) {
          const offsetInNode = nodeStartOffsets.get(intersectionStartContainer as Text);
          if (offsetInNode !== undefined) {
            const intersectionGlobalOffset = offsetInNode + intersectionStartOffset;
            startIndexInSelected = intersectionGlobalOffset - startGlobalOffset;
          }
        }
      }

      if (startIndexInSelected < 0) {
        continue;
      }

      rubyInfo.rubyTexts.push({
        startIndex: startIndexInSelected,
        length: intersectedRubyText.length,
        ruby: rubyReading
      });

      const markedAncestor = ruby.closest("mark[data-annotation-id]");
      if (markedAncestor) {
        const annotationId = markedAncestor.getAttribute("data-annotation-id");
        if (annotationId && !rubyInfo.annotationIds.includes(annotationId)) {
          rubyInfo.annotationIds.push(annotationId);
        }
      }
    }

    return rubyInfo.rubyTexts.length > 0 ? rubyInfo : null;
  }

  private extractAnnotationIdsFromRange(range: Range, container: Element): string[] {
    const annotationIds: Set<string> = new Set();

    const allMarkedElements = Array.from(container.querySelectorAll("mark[data-annotation-id]"));

    for (const markedElement of allMarkedElements) {
      if (!range.intersectsNode(markedElement)) {
        continue;
      }

      const annotationId = markedElement.getAttribute("data-annotation-id");
      if (annotationId) {
        annotationIds.add(annotationId);
      }
    }


    return Array.from(annotationIds);
  }

  private findContainerForOffsetCalculation(ruby: Element): Element | null {
    let container: Element | null = ruby;

    while (container && container.tagName !== "BODY") {
      if (container.classList.contains("markdown-preview-view")) {
        return container;
      }
      if (container.parentElement && container.parentElement.tagName === "BODY") {
        return container;
      }
      container = container.parentElement;
    }

    return ruby.parentElement;
  }

  private extractRubyTextFromContainer(container: DocumentFragment): string {
    const clonedRubyElements = Array.from(container.querySelectorAll("ruby"));

    if (clonedRubyElements.length > 0) {
      for (const clonedRuby of clonedRubyElements) {
        const clonedSpan = clonedRuby.querySelector("span");
        if (clonedSpan) {
          return clonedSpan.textContent || "";
        }

        const clonedRb = clonedRuby.querySelector("rb");
        if (clonedRb) {
          return clonedRb.textContent || "";
        }

        const textNodes = Array.from(clonedRuby.childNodes).filter((n): n is Text => n.nodeType === Node.TEXT_NODE);
        if (textNodes.length > 0) {
          return textNodes.map(n => n.textContent || "").join("");
        }
      }
    }

    const textNodes = Array.from(container.childNodes).filter((n): n is Text => {
      if (n.nodeType !== Node.TEXT_NODE) return false;
      const parent = n.parentElement;
      return !!parent && parent.tagName !== "RT";
    });

    if (textNodes.length > 0) {
      return textNodes.map(n => n.textContent || "").join("");
    }

    return "";
  }

  private extractTextFromContainer(container: DocumentFragment): string | null {
    const rubyElement = container.querySelector("ruby");
    if (rubyElement) {
      const span = rubyElement.querySelector("span");
      if (span) {
        return span.textContent || "";
      }

      const textNodes = Array.from(rubyElement.childNodes).filter(n => n.nodeType === Node.TEXT_NODE) as Text[];
      if (textNodes.length > 0) {
        return textNodes.map(n => n.textContent || "").join("");
      }
    }

    const textNodes = Array.from(container.childNodes).filter(n => n.nodeType === Node.TEXT_NODE) as Text[];
    if (textNodes.length > 0) {
      return textNodes.map(n => n.textContent || "").join("");
    }

    return null;
  }

  private findCommonSubstring(str1: string, str2: string): string | null {
    const len1 = str1.length;
    const len2 = str2.length;
    let result = "";

    for (let i = 0; i < len1; i++) {
      for (let j = i + 1; j <= len1; j++) {
        const substr = str1.substring(i, j);
        if (str2.includes(substr) && substr.length > result.length) {
          result = substr;
        }
      }
    }

    return result.length > 0 ? result : null;
  }

  private getIntersectionRange(rangeA: Range, rangeB: Range): Range | null {
    const compareA = rangeA.compareBoundaryPoints(Range.START_TO_START, rangeB);
    const compareB = rangeA.compareBoundaryPoints(Range.END_TO_END, rangeB);

    if (compareA >= 0 && compareB <= 0) {
      return rangeB.cloneRange();
    }

    if (compareA <= 0 && compareB >= 0) {
      return rangeA.cloneRange();
    }

    if (compareA >= 0) {
      return null;
    }

    if (compareB <= 0) {
      return null;
    }

    const result = document.createRange();
    result.setStart(rangeB.startContainer, rangeB.startOffset);
    result.setEnd(rangeA.endContainer, rangeA.endOffset);
    return result;
  }

  getIsActive(): boolean {
    return this.isActive;
  }
}

export class AnnotationMode {
  private app: App;
  private dataManager: DataManager;
  private plugin: any;
  private leafStates: Map<WorkspaceLeaf, LeafAnnotationState> = new Map();

  // 全局元素缓存，按文件路径分组存储
  private globalElementContextMap: WeakMap<HTMLElement, MarkdownPostProcessorContext> = new WeakMap();
  private globalProcessedElements: Set<HTMLElement> = new Set();
  private globalElementsByFilePath: Map<string, Set<HTMLElement>> = new Map();

  private fileOpenHandler: ((file: TFile | null) => void) | null = null;
  private layoutChangeHandler: (() => void) | null = null;

  constructor(app: App, dataManager: DataManager, plugin: any) {
    this.app = app;
    this.dataManager = dataManager;
    this.plugin = plugin;
    this.setupGlobalEventListeners();
  }

  toggle(file: TFile | null): void {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;

    const state = this.leafStates.get(leaf);

    if (state?.isActive && state.currentFilePath === file?.path) {
      this.deactivateForLeaf(leaf);
    } else if (file) {
      this.activateForLeaf(leaf, file);
    } else {
      new Notice("请先打开一个Markdown文件");
    }
  }

  /**
   * 全局 post processor 调用的方法，将元素路由到对应的 LeafAnnotationState
   */
  processMarkdownElement(element: HTMLElement, context: MarkdownPostProcessorContext): void {
    // 将元素注册到全局缓存
    this.globalElementContextMap.set(element, context);
    this.globalProcessedElements.add(element);

    // 按文件路径分组存储元素
    const filePath = context.sourcePath;
    if (!this.globalElementsByFilePath.has(filePath)) {
      this.globalElementsByFilePath.set(filePath, new Set());
    }
    this.globalElementsByFilePath.get(filePath)!.add(element);
  }

  /**
   * 获取指定文件路径的所有元素
   */
  getElementsForFilePath(filePath: string): Set<HTMLElement> {
    return this.globalElementsByFilePath.get(filePath) || new Set();
  }

  /**
   * 获取元素的 context
   */
  getContextForElement(element: HTMLElement): MarkdownPostProcessorContext | undefined {
    return this.globalElementContextMap.get(element);
  }

  private async activateForLeaf(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    let state = this.leafStates.get(leaf);

    if (!state) {
      state = new LeafAnnotationState(leaf, this.app, this.dataManager, this.plugin, this);
      this.leafStates.set(leaf, state);
    } else {
      if (state.currentFilePath !== file.path) {
        state.deactivate();
      }
    }

    await state.activate(file);
  }

  deactivateForLeaf(leaf: WorkspaceLeaf): void {
    const state = this.leafStates.get(leaf);
    if (state) {
      state.deactivate();
      this.leafStates.delete(leaf);
    }
  }

  deactivate(): void {
    for (const [leaf] of this.leafStates) {
      this.deactivateForLeaf(leaf);
    }
  }

  private setupGlobalEventListeners(): void {
    this.fileOpenHandler = (file: TFile | null) => {
      const leaf = this.app.workspace.activeLeaf;
      if (!leaf) return;
      
      const state = this.leafStates.get(leaf);
      if (!state?.isActive) return;
      
      if (file && file.path !== state.currentFilePath && file.extension === "md") {
        this.deactivateForLeaf(leaf);
      } else if (!file || file.extension !== "md") {
        this.deactivateForLeaf(leaf);
      }
    };
    
    this.app.workspace.on("file-open", this.fileOpenHandler);
    
    this.layoutChangeHandler = () => {
      this.cleanupInactiveLeaves();
    };
    
    this.app.workspace.on("layout-change", this.layoutChangeHandler);
  }

  private cleanupInactiveLeaves(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const activeLeafSet = new Set(leaves);
    
    for (const [leaf] of this.leafStates) {
      if (!activeLeafSet.has(leaf)) {
        this.deactivateForLeaf(leaf);
      }
    }
  }

  private removeGlobalEventListeners(): void {
    if (this.fileOpenHandler) {
      this.app.workspace.off("file-open", this.fileOpenHandler);
      this.fileOpenHandler = null;
    }
    if (this.layoutChangeHandler) {
      this.app.workspace.off("layout-change", this.layoutChangeHandler);
      this.layoutChangeHandler = null;
    }
  }

  async updateFilePaths(oldPath: string, newPath: string): Promise<void> {
    // 更新全局元素缓存中的文件路径映射
    const elements = this.globalElementsByFilePath.get(oldPath);
    if (elements) {
      this.globalElementsByFilePath.delete(oldPath);
      this.globalElementsByFilePath.set(newPath, elements);

      // 更新元素的 context sourcePath
      for (const element of elements) {
        const context = this.globalElementContextMap.get(element);
        if (context && (context as any).sourcePath === oldPath) {
          (context as any).sourcePath = newPath;
        }
      }
    }

    for (const [leaf, state] of this.leafStates) {
      if (state.currentFilePath === oldPath && state.isActive) {
        state.deactivate();
        state.currentFilePath = newPath;
        const file = this.app.vault.getAbstractFileByPath(newPath);
        if (file && file instanceof TFile) {
          await state.activate(file);
        }
      } else if (state.currentFilePath === oldPath && state.currentFilePath) {
        state.currentFilePath = newPath;
      }
    }
  }

  deactivateForFile(filePath: string): void {
    for (const [leaf, state] of this.leafStates) {
      if (state.currentFilePath === filePath) {
        this.deactivateForLeaf(leaf);
      }
    }
  }

  async reRenderAnnotation(annotationId: string): Promise<void> {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;

    const state = this.leafStates.get(leaf);
    if (state) {
      await state.reRenderAnnotation(annotationId);
    }
  }

  getIsActive(): boolean {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return false;
    const state = this.leafStates.get(leaf);
    return state ? state.getIsActive() : false;
  }
}
