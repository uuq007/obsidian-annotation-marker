import { MarkdownView } from "obsidian";

/**
 * 安全恢复编辑器焦点
 * 用于插件操作（菜单关闭、标注变更等）后确保编辑器不失焦
 */
export function restoreEditorFocus(view: MarkdownView): void {
  requestAnimationFrame(() => {
    // @ts-expect-error — Obsidian 官方文档推荐的 CM6 访问方式
    const editorView = view.editor?.cm;
    if (!editorView?.dom?.isConnected) return;

    const activeEl = document.activeElement;
    // 焦点在 body 或不在编辑器内时，恢复焦点
    if (!activeEl || activeEl === document.body || !editorView.dom.contains(activeEl)) {
      editorView.contentDOM.focus({ preventScroll: true });
    }
  });
}
