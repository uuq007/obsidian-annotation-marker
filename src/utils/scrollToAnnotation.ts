import { App, MarkdownView, Notice } from "obsidian";
import type { ParsedAnnotation } from "../types";
import type { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { scanAnnotationTags } from "../view/annotationTagParser";

// 跳转到指定标注位置并高亮（编辑模式和阅读模式通用）
export async function scrollToAnnotation(
  app: App,
  fileManager: AnnotationFileManager,
  view: MarkdownView,
  notePath: string,
  annotation: ParsedAnnotation,
  options?: { delayBeforeScroll?: number }
): Promise<void> {
  if (options?.delayBeforeScroll) {
    await new Promise((resolve) => window.setTimeout(resolve, options.delayBeforeScroll));
  }

  if (!view) return;

  // 编辑模式
  if (view.getMode() === "source") {
    scrollToAnnotationInEditor(view, annotation);
    return;
  }

  // 阅读模式
  await scrollToAnnotationInPreview(app, fileManager, view, notePath, annotation);
}

// 编辑模式：通过 scanAnnotationTags 精确定位
function scrollToAnnotationInEditor(
  view: MarkdownView,
  annotation: ParsedAnnotation
): void {
  const doc = view.editor.getValue();
  const blocks = scanAnnotationTags(doc, 0, doc);
  const target = blocks.find((b) => b.id === annotation.id);
  if (!target) {
    new Notice("未能定位到标注，可能文档内容已更改");
    return;
  }
  const pos = view.editor.offsetToPos(target.markOpenFrom);
  view.editor.setCursor(pos);
  view.editor.scrollIntoView({ from: pos, to: pos }, true);

  // 等待渲染后高亮
  window.setTimeout(() => {
    highlightAnnotationElements(view.containerEl, annotation.id);
  }, 300);
}

// 阅读模式：计算行号滚动，含脚注处理
async function scrollToAnnotationInPreview(
  app: App,
  fileManager: AnnotationFileManager,
  view: MarkdownView,
  notePath: string,
  annotation: ParsedAnnotation
): Promise<void> {
  try {
    const content = await fileManager.readAnnotationFile(notePath);
    const lineIndex =
      content.substring(0, annotation.positions[0]!.start).split("\n").length - 1;

    const previewMode = view.previewMode as unknown as {
      renderer?: { applyScroll?: (line: number, opts?: { center?: boolean }) => void };
    };
    if (previewMode?.renderer?.applyScroll) {
      // 判断是否为脚注区域
      const currentFile = view.file;
      const cache = currentFile ? app.metadataCache.getFileCache(currentFile) : null;
      const isFootnote = cache?.footnotes?.some(
        (fn: { position: { start: { line: number }; end: { line: number } } }) =>
          lineIndex >= fn.position.start.line && lineIndex <= fn.position.end.line
      );

      if (isFootnote) {
        const sections = cache?.sections;
        if (sections && sections.length > 0) {
          const lastLine = sections[sections.length - 1]!.position.end.line;
          previewMode.renderer.applyScroll(lastLine, { center: true });
        }
      } else {
        previewMode.renderer.applyScroll(lineIndex, { center: true });
      }
    }
  } catch {
    // 读取或滚动失败，忽略
  }

  // 等待渲染后高亮
  const containerEl = view.previewMode?.containerEl ?? view.containerEl;
  window.setTimeout(() => {
    highlightAnnotationElements(containerEl, annotation.id);
  }, 300);
}

// 高亮标注元素（蓝色边框 2 秒后消失）
function highlightAnnotationElements(
  containerEl: HTMLElement,
  annotationId: string
): void {
  const els = containerEl.querySelectorAll(
    `mark[data-annotation-id="${annotationId}"]`
  );
  if (!els || els.length === 0) return;

  for (const el of Array.from(els) as HTMLElement[]) {
    el.addClass("annotation-scroll-highlight");
  }
  window.setTimeout(() => {
    for (const el of Array.from(els) as HTMLElement[]) {
      el.removeClass("annotation-scroll-highlight");
    }
  }, 2000);
}
