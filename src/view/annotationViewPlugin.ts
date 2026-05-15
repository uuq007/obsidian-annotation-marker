// 多层光标守卫（诊断版）：防止标注 Widget 展开
// 添加 console.log 诊断日志，用于定位问题根因

import { EditorView, ViewPlugin, Decoration, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { Prec, StateField, EditorSelection, RangeSetBuilder, type Extension } from "@codemirror/state";
import { scanAnnotationTags, hasAnnotationTags, type AnnotationBlock } from "./annotationTagParser";

const DEBUG = false;
function log(...args: unknown[]) { if (DEBUG) console.log("[annotation-guard]", ...args); }

// StateField 缓存标注范围
const annotationRangesField = StateField.define<AnnotationBlock[]>({
  create(state) {
    const text = state.doc.toString();
    if (!hasAnnotationTags(text)) {
      log("StateField.create: no annotation tags found, text length:", text.length);
      return [];
    }
    const blocks = scanAnnotationTags(text, 0, text);
    log("StateField.create: found", blocks.length, "blocks");
    for (const b of blocks) {
      log(`  block id=${b.id} range=[${b.markOpenFrom},${b.markCloseTo}]`);
    }
    return blocks;
  },
  update(blocks, tr) {
    if (tr.docChanged) {
      const text = tr.newDoc.toString();
      if (!hasAnnotationTags(text)) return [];
      const newBlocks = scanAnnotationTags(text, 0, text);
      log("StateField.update: doc changed, found", newBlocks.length, "blocks");
      return newBlocks;
    }
    return blocks;
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
    const blockInfo = blocks.length > 0
      ? `blocks=${blocks.length} first=[${blocks[0]!.markOpenFrom},${blocks[0]!.markCloseTo}]`
      : "blocks=0";
    const docPreview = view.state.doc.sliceString(Math.max(0, pos - 20), Math.min(view.state.doc.length, pos + 20));
    log(`keydown: key=${event.key} pos=${pos} ${blockInfo}`);
    log(`  doc@pos: ...${docPreview}...`);

    if (blocks.length === 0) return false;

    const docLen = view.state.doc.length;

    if (event.key === "ArrowRight") {
      for (const p of [pos, pos + 1]) {
        const block = isInAnnotationRange(blocks, p);
        if (block) {
          const target = Math.min(docLen, block.markCloseTo + 1);
          log(`  ArrowRight: pos=${p} in block [${block.markOpenFrom},${block.markCloseTo}], skip to ${target}`);
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
          log(`  ArrowLeft: pos=${p} in block [${block.markOpenFrom},${block.markCloseTo}], skip to ${target}`);
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
    log("mousedown: blocked click on annotation embed");
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
}));

// ViewPlugin 回退（ArrowUp/Down 等）+ 诊断
class CursorGuardPlugin implements PluginValue {
  constructor(readonly view: EditorView) {
    log("CursorGuardPlugin created");
  }

  update(update: ViewUpdate) {
    if (update.transactions.some(tr => tr.isUserEvent("annotation.cursorGuard"))) return;
    if (!update.selectionSet) return;

    const blocks = update.state.field(annotationRangesField, false);
    if (!blocks || blocks.length === 0) return;

    const head = update.state.selection.main.head;
    const block = isInAnnotationRange(blocks, head);
    if (!block) return;

    log(`ViewPlugin.update: head=${head} in block [${block.markOpenFrom},${block.markCloseTo}]`);
    const distStart = Math.abs(head - block.markOpenFrom);
    const distEnd = Math.abs(head - block.markCloseTo);
    const target = distStart <= distEnd
      ? Math.max(0, block.markOpenFrom - 1)
      : Math.min(update.state.doc.length, block.markCloseTo + 1);
    const view = this.view;
    setTimeout(() => {
      if (!view.dom?.isConnected) return;
      view.dispatch({
        selection: { anchor: target },
        userEvent: "annotation.cursorGuard"
      });
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
