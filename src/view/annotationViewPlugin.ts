// 多层光标守卫：防止标注 Widget 展开

import { EditorView, ViewPlugin, Decoration, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { Prec, StateField, RangeSetBuilder, type Extension } from "@codemirror/state";
import { scanAnnotationTags, hasAnnotationTags, type AnnotationBlock } from "./annotationTagParser";

// StateField 缓存标注范围
const annotationRangesField = StateField.define<AnnotationBlock[]>({
  create(state) {
    const text = state.doc.toString();
    if (!hasAnnotationTags(text)) {
      return [];
    }
    return scanAnnotationTags(text, 0, text);
  },
  update(blocks, tr) {
    if (!tr.docChanged) return blocks;

    // 快速路径：插入文本、删除文本及拼接边界窗口均不含 "<" 时，本次变更
    // 不可能新增或销毁标注标签，直接把旧范围按 changes 映射过去，
    // 避免大文档下每次击键都全量 toString + 正则扫描
    const TAG_WINDOW = 7; // 最长标签 token "</mark>" 的长度
    let boundarySafe = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (!boundarySafe) return;
      const oldDoc = tr.startState.doc;
      if (inserted.length && inserted.toString().includes("<")) { boundarySafe = false; return; }
      if (oldDoc.sliceString(fromA, toA).includes("<")) { boundarySafe = false; return; }
      const before = oldDoc.sliceString(Math.max(0, fromA - TAG_WINDOW), fromA);
      const after = oldDoc.sliceString(toA, Math.min(oldDoc.length, toA + TAG_WINDOW));
      if (before.includes("<") || after.includes("<")) boundarySafe = false;
    });
    if (boundarySafe) {
      return blocks
        .map(b => ({
          ...b,
          markOpenFrom: tr.changes.mapPos(b.markOpenFrom),
          markOpenTo: tr.changes.mapPos(b.markOpenTo),
          markCloseFrom: tr.changes.mapPos(b.markCloseFrom),
          markCloseTo: tr.changes.mapPos(b.markCloseTo),
        }))
        .filter(b => b.markOpenFrom >= 0 && b.markCloseTo > b.markOpenFrom);
    }

    const text = tr.newDoc.toString();
    if (!hasAnnotationTags(text)) return [];
    return scanAnnotationTags(text, 0, text);
  }
});

// markOpenFrom 和 markCloseTo 都是 Widget 边缘，光标到达任一边都会触发展开
function isInAnnotationRange(blocks: AnnotationBlock[], pos: number): AnnotationBlock | null {
  for (const block of blocks) {
    if (block.markOpenFrom <= pos && pos <= block.markCloseTo) {
      return block;
    }
  }
  return null;
}

function getBlocks(view: EditorView): AnnotationBlock[] {
  const blocks = view.state.field(annotationRangesField, false);
  return blocks && blocks.length > 0 ? blocks : [];
}

// 用 Prec.highest + domEventHandlers 拦截方向键和鼠标点击
const annotationGuard = Prec.highest(EditorView.domEventHandlers({
  keydown(event: KeyboardEvent, view: EditorView) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return false;

    const pos = view.state.selection.main.head;
    const blocks = getBlocks(view);
    if (blocks.length === 0) return false;

    const docLen = view.state.doc.length;

    if (event.key === "ArrowRight") {
      for (const p of [pos, pos + 1]) {
        const block = isInAnnotationRange(blocks, p);
        if (block) {
          const target = Math.min(docLen, block.markCloseTo + 1);
          event.preventDefault();
          event.stopPropagation();
          view.dispatch({ selection: { anchor: target } });
          return true;
        }
      }
    } else {
      for (const p of [pos, pos - 1]) {
        if (p < 0) continue;
        const block = isInAnnotationRange(blocks, p);
        if (block) {
          const target = Math.max(0, block.markOpenFrom - 1);
          event.preventDefault();
          event.stopPropagation();
          view.dispatch({ selection: { anchor: target } });
          return true;
        }
      }
    }

    return false;
  },

  mousedown(event: MouseEvent, view: EditorView) {
    const target = event.target as HTMLElement;
    const embed = target.closest(".cm-html-embed");
    if (!embed) return false;
    if (!embed.querySelector("[data-annotation-id]")) return false;

    // 保存当前光标位置
    const savedAnchor = view.state.selection.main.anchor;

    event.preventDefault();
    event.stopPropagation();

    // 拦截后主动恢复编辑器焦点，防止光标消失
    window.requestAnimationFrame(() => {
      if (!view.dom?.isConnected) return;
      view.dispatch({
        selection: { anchor: savedAnchor },
      });
      view.contentDOM.focus({ preventScroll: true });
    });

    return true;
  }
}));

// ViewPlugin 回退（ArrowUp/Down 等）
class CursorGuardPlugin implements PluginValue {
  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (update.transactions.some(tr => tr.isUserEvent("annotation.cursorGuard"))) return;
    if (!update.selectionSet) return;

    const blocks = update.state.field(annotationRangesField, false);
    if (!blocks || blocks.length === 0) return;

    const head = update.state.selection.main.head;
    const block = isInAnnotationRange(blocks, head);
    if (!block) return;

    const distStart = Math.abs(head - block.markOpenFrom);
    const distEnd = Math.abs(head - block.markCloseTo);
    const target = distStart <= distEnd
      ? Math.max(0, block.markOpenFrom - 1)
      : Math.min(update.state.doc.length, block.markCloseTo + 1);
    const view = this.view;
    window.setTimeout(() => {
      if (!view.dom?.isConnected) return;
      view.dispatch({
        selection: { anchor: target },
        userEvent: "annotation.cursorGuard"
      });
      // dispatch 后确保编辑器有焦点
      if (!view.hasFocus) {
        view.contentDOM.focus({ preventScroll: true });
      }
    }, 0);
  }

  destroy() {}
}

const cursorGuardPlugin = ViewPlugin.fromClass(CursorGuardPlugin);

// atomicRanges 兜底
function buildAtomicRanges(view: EditorView) {
  const blocks = view.state.field(annotationRangesField, false);
  if (!blocks || blocks.length === 0) return Decoration.none;

  const doc = view.state.doc;
  const sorted = blocks
    .filter(b => b.markCloseTo <= doc.length)
    .sort((a, b) => a.markOpenFrom - b.markOpenFrom);

  const builder = new RangeSetBuilder<Decoration>();
  for (const block of sorted) {
    builder.add(block.markOpenFrom, block.markCloseTo, Decoration.mark({}));
  }
  return builder.finish();
}

export function createAnnotationViewExtension(): Extension {
  return [
    annotationRangesField,
    annotationGuard,
    cursorGuardPlugin,
    EditorView.atomicRanges.of(buildAtomicRanges)
  ];
}
