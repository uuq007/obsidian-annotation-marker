import { App, Notice, TFile, MarkdownView, WorkspaceLeaf } from "obsidian";
import { DataManager } from "./dataManager";
import { AnnotationRenderer, RenderResult } from "./annotationRenderer";
import { SelectionMenu } from "./selectionMenu";
import { AnnotationMenu } from "./annotationMenu";
import { AnnotationListPanel } from "./annotationListPanel";
import { ExtractedRubyInfo, PartialAnnotationInfo } from "./types";

class LeafAnnotationState {
  private app: App;
  private dataManager: DataManager;
  
  public leaf: WorkspaceLeaf;
  public isActive: boolean = false;
  public currentView: MarkdownView | null = null;
  public currentFilePath: string | null = null;
  public currentFileContent: string = "";
  public renderer: AnnotationRenderer | null = null;
  
  public selectionMenu: SelectionMenu;
  public annotationMenu: AnnotationMenu;
  public annotationListPanel: AnnotationListPanel;
  
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  
  constructor(leaf: WorkspaceLeaf, app: App, dataManager: DataManager) {
    this.leaf = leaf;
    this.app = app;
    this.dataManager = dataManager;
    this.selectionMenu = new SelectionMenu(app, dataManager);
    this.annotationMenu = new AnnotationMenu(app, dataManager);
    this.annotationListPanel = new AnnotationListPanel(app, dataManager);
  }

  async activate(file: TFile): Promise<void> {
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
    this.currentFileContent = await this.app.vault.cachedRead(file);
    this.isActive = true;

    this.addAnnotationCursorStyle();

    this.renderer = new AnnotationRenderer(view);

    await this.loadAndRenderAnnotations();

    this.setupEventListeners();

    const previewContainer = this.currentView.previewMode.containerEl as HTMLElement;
    this.annotationListPanel.show(this.currentFilePath, previewContainer, async () => {
      this.renderer?.clear();
      await this.loadAndRenderAnnotations();
    });

    new Notice("标注模式已开启");
  }

  deactivate(): void {
    if (!this.isActive) return;

    this.removeEventListeners();
    this.removeAnnotationCursorStyle();

    if (this.renderer) {
      this.renderer.clear();
      this.renderer = null;
    }

    this.selectionMenu.hide();
    this.annotationMenu.hide();
    this.annotationListPanel.hide();

    this.currentView = null;
    this.currentFilePath = null;
    this.currentFileContent = "";
    this.isActive = false;

    new Notice("标注模式已关闭");
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

    const allMarks = Array.from(previewEl.querySelectorAll("mark[data-annotation-id]"));
    const allRubies = Array.from(previewEl.querySelectorAll("ruby"));

    if (allMarks.length > 0) {
      for (const mark of allMarks) {
        if (!document.contains(mark)) {
          continue;
        }

        const parent = mark.parentNode;
        if (parent) {
          let textContent = "";
          const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT, null);
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
          parent.replaceChild(textNode, mark);
        }
      }
    }

    const rubiesAfterMarks = Array.from(previewEl.querySelectorAll("ruby"));

    if (rubiesAfterMarks.length > 0) {

      for (const ruby of rubiesAfterMarks) {
        if (!document.contains(ruby)) {
          continue;
        }

        const parent = ruby.parentNode;
        if (parent) {
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

    await new Promise(resolve => setTimeout(resolve, 200));

    this.mergeAdjacentTextNodes(previewEl);

    const data = await this.dataManager.loadAnnotations(this.currentFilePath);
    if (!data || data.annotations.length === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    this.renderer.setAnnotations(data.annotations);
    const result: RenderResult = this.renderer.renderByText(previewEl);

    if (result.updatedContexts.length > 0) {
      for (const update of result.updatedContexts) {
        await this.dataManager.updateAnnotation(this.currentFilePath, update.id, {
          contextBefore: update.contextBefore,
          contextAfter: update.contextAfter,
          positionPercent: update.positionPercent,
        });
      }
    }

    if (result.lostAnnotations.length > 0) {
      new Notice(`${result.lostAnnotations.length} 条标注内容已丢失`, 5000);
    }
  }

  private setupEventListeners(): void {
    this.mouseUpHandler = (e: MouseEvent) => this.handleMouseUp(e);
    this.clickHandler = (e: MouseEvent) => this.handleClick(e);

    document.addEventListener("mouseup", this.mouseUpHandler);
    document.addEventListener("click", this.clickHandler, true);
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
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.isActive || !this.currentView || !this.currentFilePath) return;

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
      if (!selection || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      let selectedText = this.getCleanTextFromRange(range).trim();

      if (!selectedText) return;

      const extractedRubyInfo = this.extractRubyInfoFromSelection(range, selectedText);
      const partialAnnotationInfo = this.extractPartialAnnotationInfo(range, selectedText, previewEl);

      const contextInfo = this.extractContextFromSelection(range, previewEl);

      if (contextInfo) {
        this.selectionMenu.show(
          e.clientX,
          e.clientY,
          selectedText,
          contextInfo.contextBefore,
          contextInfo.contextAfter,
          contextInfo.positionPercent,
          this.currentFilePath!,
          async () => {
            const file = this.app.workspace.getActiveFile();
            if (file) {
              this.currentFileContent = await this.app.vault.cachedRead(file);
            }
            this.renderer?.clear();
            await this.loadAndRenderAnnotations();
          },
          extractedRubyInfo || undefined,
          partialAnnotationInfo || undefined
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
        this.annotationMenu.show(x, y, annotation, this.currentFilePath!, async () => {
          this.renderer?.clear();
          await this.loadAndRenderAnnotations();
        });
      }
    });
  }

  private getCleanTextFromRange(range: Range): string {
    const container = range.cloneContents();
    const rtElements = container.querySelectorAll("rt");
    rtElements.forEach(rt => rt.remove());
    return container.textContent || "";
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

  private extractContextFromSelection(range: Range, container: Element): { contextBefore: string; contextAfter: string; positionPercent: number } | null {
    const textNodes = this.getAllTextNodes(container, false);
    let fullText = "";
    const nodeStartOffsets: Map<Text, number> = new Map();

    for (const node of textNodes) {
      const parent = node.parentElement;
      if (parent && parent.tagName === "RT") {
        continue;
      }
      nodeStartOffsets.set(node, fullText.length);
      fullText += node.textContent ?? "";
    }

    let startGlobalOffset = -1;
    let endGlobalOffset = -1;
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    if (startContainer.nodeType === Node.TEXT_NODE) {
      const parent = startContainer.parentElement;
      if (parent && parent.tagName !== "RT") {
        const startOffsetInFullText = nodeStartOffsets.get(startContainer as Text);
        if (startOffsetInFullText !== undefined) {
          startGlobalOffset = startOffsetInFullText + startOffset;
        }
      }
    }

    if (endContainer.nodeType === Node.TEXT_NODE) {
      const parent = endContainer.parentElement;
      if (parent && parent.tagName !== "RT") {
        const endOffsetInFullText = nodeStartOffsets.get(endContainer as Text);
        if (endOffsetInFullText !== undefined) {
          endGlobalOffset = endOffsetInFullText + endOffset;
        }
      }
    }

    if (startGlobalOffset === -1 || endGlobalOffset === -1) {
      return null;
    }

    const textLength = fullText.length;
    const positionPercent = textLength > 0 ? ((startGlobalOffset + endGlobalOffset) / 2 / textLength) * 100 : 50;

    const contextBefore = fullText.substring(Math.max(0, startGlobalOffset - 50), startGlobalOffset);
    const contextAfter = fullText.substring(endGlobalOffset, Math.min(fullText.length, endGlobalOffset + 50));

    return { contextBefore, contextAfter, positionPercent };
  }

  private getAllTextNodes(container: Element, excludeAnnotated: boolean = true): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      if (textNode.textContent && textNode.textContent.trim().length > 0) {
        const parent = textNode.parentElement;
        // 排除 RT 标签、标注元素（可选）、文件名、笔记属性、多选标签、标题栏
        if (parent && parent.tagName !== "RT" &&
            (!excludeAnnotated || !parent.closest("[data-annotation-id]")) &&
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

  private extractPartialAnnotationInfo(
    range: Range,
    selectedText: string,
    container: Element
  ): PartialAnnotationInfo | null {
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

    const annotatedText = this.getCleanTextFromElement(annotatedElement);

    const startIndex = this.calculateOffsetFromRange(range, annotatedElement);

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

  private calculateOffsetFromRange(range: Range, annotatedElement: Element): number {
    let offset = 0;
    const walker = document.createTreeWalker(annotatedElement, NodeFilter.SHOW_TEXT, null);

    const startContainer = range.startContainer;

    let node = walker.nextNode();
    while (node) {
      const textNode = node as Text;
      const parentElement = textNode.parentElement;

      if (parentElement && parentElement.tagName !== "RT") {
        if (textNode === startContainer) {
          return offset + range.startOffset;
        }
        offset += (textNode.textContent || "").length;
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

    const allRubyElements = Array.from(document.querySelectorAll("ruby"));
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

      const textNodes = this.getAllTextNodes(container, false);
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
  private leafStates: Map<WorkspaceLeaf, LeafAnnotationState> = new Map();
  
  private fileOpenHandler: ((file: TFile | null) => void) | null = null;
  private layoutChangeHandler: (() => void) | null = null;

  constructor(app: App, dataManager: DataManager) {
    this.app = app;
    this.dataManager = dataManager;
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

  private async activateForLeaf(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    let state = this.leafStates.get(leaf);
    
    if (!state) {
      state = new LeafAnnotationState(leaf, this.app, this.dataManager);
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
    for (const [leaf, state] of this.leafStates) {
      if (state.currentFilePath === oldPath && state.isActive) {
        state.deactivate();
        state.currentFilePath = newPath;
        const file = this.app.vault.getAbstractFileByPath(newPath);
        if (file && file instanceof TFile) {
          await state.activate(file);
        }
      } else if (state.currentFilePath === oldPath) {
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

  getIsActive(): boolean {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return false;
    const state = this.leafStates.get(leaf);
    return state ? state.getIsActive() : false;
  }
}
