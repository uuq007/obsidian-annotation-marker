// 弹出标注菜单时，焦点移入批注输入框会导致浏览器把 DOM 选区移进输入框内，
// 笔记区原选区的视觉高亮随之消失。这里在聚焦前克隆选区 Range，用
// CSS Custom Highlight API 在原位置渲染临时背景（纯视觉层，不改动 DOM 结构）
const HIGHLIGHT_NAME = "annotation-selection-active";

// 手写最小类型：CSS / Highlight 在 lib.dom 中是全局声明而非 Window 属性，
// 且不依赖较新的 Highlight 类型定义，兼容旧版 TypeScript
interface HighlightCtor {
  new (...ranges: Range[]): unknown;
}
interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

// CSS Custom Highlight API 需要 Chromium 105+；不支持的运行环境（如旧版移动端
// WebView）返回 null，调用方静默降级（只是没有临时高亮，不影响功能）
function getHighlightApi(): { Highlight: HighlightCtor; highlights: HighlightRegistryLike } | null {
  const win = activeDocument.defaultView;
  if (!win) return null;
  const api = win as unknown as {
    Highlight?: HighlightCtor;
    CSS?: { highlights?: HighlightRegistryLike };
  };
  if (typeof api.Highlight !== "function" || !api.CSS?.highlights) return null;
  return { Highlight: api.Highlight, highlights: api.CSS.highlights };
}

export function showSelectionHighlight(range: Range): void {
  const api = getHighlightApi();
  if (!api) return;
  api.highlights.set(HIGHLIGHT_NAME, new api.Highlight(range));
}

export function clearSelectionHighlight(): void {
  getHighlightApi()?.highlights.delete(HIGHLIGHT_NAME);
}
