import { MarkdownView, Platform } from "obsidian";
import type { EditorView } from "@codemirror/view";

/**
 * 安全恢复编辑器焦点
 * 用于插件操作（菜单关闭、标注变更等）后确保编辑器不失焦
 */
export function restoreEditorFocus(view: MarkdownView): void {
  // 移动端强制聚焦编辑器会拉起软键盘、打断当前阅读/滑动流；跳过恢复，
  // 用户点击编辑器时会自然回焦
  if (Platform.isMobile) return;
  window.requestAnimationFrame(() => {
    // 通过非公开的 cm 属性访问 CM6 EditorView（Obsidian 官方文档推荐方式）
    const editorView = (view.editor as unknown as { cm: EditorView }).cm;
    if (!editorView.dom.isConnected) return;

    const activeEl = activeDocument.activeElement;
    // 焦点在 body 或不在编辑器内时，恢复焦点
    if (!activeEl || activeEl === activeDocument.body || !editorView.dom.contains(activeEl)) {
      editorView.contentDOM.focus({ preventScroll: true });
    }
  });
}
