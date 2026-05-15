// Diff 同步算法：将原文件的变更同步到标注文件，保留标注标签
import { diffChars, type Change } from "diff";

export interface DiffSyncResult {
  content: string;
  changed: boolean;
}

// 标签区间信息
interface TagSpan {
  start: number;
  end: number;
}

// 需要应用到 annotatedContent 的变更操作
interface SourceChange {
  sourceStart: number;
  sourceEnd: number;
  replacement: string;
}

// buildDiffContentMap 的返回结构
interface DiffContentMap {
  strippedContent: string;
  strippedToSource: number[];
  // 所有被剥离的标签本身的字符区间（不含标签内文字）
  tagSpans: TagSpan[];
  // 标签配对信息（用于判断插入点是否在标签内容区域内）
  tagPairs: TagPair[];
}

// 扫描到的标签信息（配对前）
interface RawTag {
  index: number;
  length: number;
  tagName: string;
  isOpen: boolean;
}

// 配对后的标签对
interface TagPair {
  // 开标签的字符区间
  openStart: number;
  openEnd: number;
  // 闭标签的字符区间
  closeStart: number;
  closeEnd: number;
  tagName: string;
}

// 主入口：将原文件的变更同步到标注文件
export function diffSync(
  originalContent: string,
  annotatedContent: string
): DiffSyncResult {
  if (!originalContent && !annotatedContent) {
    return { content: annotatedContent, changed: false };
  }
  if (!annotatedContent) {
    return { content: originalContent, changed: true };
  }

  // 构建正确的 strippedContent 和位置映射
  const map = buildDiffContentMap(annotatedContent);
  const { strippedContent, strippedToSource, tagSpans, tagPairs } = map;

  // 快速路径：无变更
  if (strippedContent === originalContent) {
    return { content: annotatedContent, changed: false };
  }

  // 计算字符级 diff
  const diffs: Change[] = diffChars(strippedContent, originalContent);

  // 将 diff 转换为 source 坐标系的变更操作
  const changes: SourceChange[] = [];
  let strippedPos = 0;

  for (const change of diffs) {
    if (change.added) {
      const sourcePos = mapStrippedToSource(strippedPos, strippedToSource);
      let safePos = ensureOutsideTags(sourcePos, tagSpans);
      safePos = ensureInsertOutsideElement(strippedPos, safePos, strippedToSource, tagPairs);
      changes.push({ sourceStart: safePos, sourceEnd: safePos, replacement: change.value });
    } else if (change.removed) {
      const sourceStart = mapStrippedToSource(strippedPos, strippedToSource);
      const sourceEnd = mapStrippedToSource(strippedPos + change.value.length - 1, strippedToSource) + 1;
      const { start: safeStart, end: safeEnd } = expandToTagBoundaries(sourceStart, sourceEnd, tagSpans);
      changes.push({ sourceStart: safeStart, sourceEnd: safeEnd, replacement: "" });
      strippedPos += change.value.length;
    } else {
      strippedPos += change.value.length;
    }
  }

  // 合并相邻的删除+添加为替换操作
  const mergedChanges = mergeAdjacentChanges(changes);

  if (mergedChanges.length === 0) {
    return { content: annotatedContent, changed: false };
  }

  // 从后往前应用变更
  const result = applyChangesBackward(annotatedContent, mergedChanges);
  return { content: result, changed: true };
}

// ========== 标签剥离与位置映射 ==========

// 构建正确的 strippedContent 和位置映射
// 用栈配对方式识别插件生成的标签，<rt> 内容整体丢弃
function buildDiffContentMap(annotatedContent: string): DiffContentMap {
  // 第一步：扫描所有开标签（含 data-annotation-id）和所有闭标签
  const rawTags = scanAllTags(annotatedContent);

  // 第二步：用栈配对，找出插件生成的标签对
  const tagPairs = pairTags(rawTags);

  // 第三步：生成跳过区间（标签本身的字符范围 + rt 内容的字符范围）
  const skipRanges = buildSkipRanges(tagPairs, annotatedContent);

  // 第四步：根据跳过区间生成 strippedContent 和位置映射
  const strippedChars: string[] = [];
  const strippedToSource: number[] = [];

  let i = 0;
  let skipIdx = 0;

  while (i < annotatedContent.length) {
    // 跳过当前所在的 skip 区间
    while (skipIdx < skipRanges.length && skipRanges[skipIdx]!.end <= i) {
      skipIdx++;
    }

    if (skipIdx < skipRanges.length && i >= skipRanges[skipIdx]!.start) {
      // 当前字符在跳过区间内
      i = skipRanges[skipIdx]!.end;
      skipIdx++;
      continue;
    }

    // 当前字符保留
    strippedChars.push(annotatedContent.charAt(i));
    strippedToSource.push(i);
    i++;
  }

  // 收集 tagSpans（仅标签本身的字符范围，用于标签边界安全处理）
  const tagSpans: TagSpan[] = [];
  for (const pair of tagPairs) {
    tagSpans.push({ start: pair.openStart, end: pair.openEnd });
    tagSpans.push({ start: pair.closeStart, end: pair.closeEnd });
  }

  return {
    strippedContent: strippedChars.join(""),
    strippedToSource,
    tagSpans,
    tagPairs,
  };
}

// 扫描所有开标签（含 data-annotation-id）和闭标签
function scanAllTags(content: string): RawTag[] {
  const tags: RawTag[] = [];

  // 开标签：必须含 data-annotation-id
  const openRe = /<(mark|ruby|rt)\s+[^>]*data-annotation-id="[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(content)) !== null) {
    tags.push({
      index: m.index,
      length: m[0].length,
      tagName: m[1]!.toLowerCase(),
      isOpen: true,
    });
  }

  // 闭标签：匹配 mark/ruby/rt
  const closeRe = /<\/(mark|ruby|rt)>/gi;
  while ((m = closeRe.exec(content)) !== null) {
    tags.push({
      index: m.index,
      length: m[0].length,
      tagName: m[1]!.toLowerCase(),
      isOpen: false,
    });
  }

  tags.sort((a, b) => a.index - b.index);
  return tags;
}

// 用栈配对开闭标签
function pairTags(tags: RawTag[]): TagPair[] {
  const pairs: TagPair[] = [];
  const stack: RawTag[] = [];

  for (const tag of tags) {
    if (tag.isOpen) {
      stack.push(tag);
    } else {
      // 从栈顶向下找同类型的开标签
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tagName === tag.tagName) {
          const open = stack[i]!;
          pairs.push({
            openStart: open.index,
            openEnd: open.index + open.length,
            closeStart: tag.index,
            closeEnd: tag.index + tag.length,
            tagName: open.tagName,
          });
          stack.splice(i, 1);
          break;
        }
      }
    }
  }

  return pairs;
}

// 构建需要跳过的字符区间
// mark/ruby：跳过开标签和闭标签本身
// rt：跳过开标签 + 内容 + 闭标签（整体丢弃）
function buildSkipRanges(pairs: TagPair[], _content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const pair of pairs) {
    if (pair.tagName === "rt") {
      // rt 整体跳过（开标签 + 内容 + 闭标签）
      ranges.push({ start: pair.openStart, end: pair.closeEnd });
    } else {
      // mark/ruby：只跳过开标签和闭标签本身
      ranges.push({ start: pair.openStart, end: pair.openEnd });
      ranges.push({ start: pair.closeStart, end: pair.closeEnd });
    }
  }

  // 按起始位置排序
  ranges.sort((a, b) => a.start - b.start);

  // 合并重叠区间
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    if (merged.length > 0 && merged[merged.length - 1]!.end >= range.start) {
      merged[merged.length - 1]!.end = Math.max(merged[merged.length - 1]!.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }

  return merged;
}

// ========== 坐标映射 ==========

// strippedContent 偏移 → annotatedContent 偏移
function mapStrippedToSource(strippedOffset: number, strippedToSource: number[]): number {
  if (strippedOffset < 0) return 0;
  if (strippedOffset >= strippedToSource.length) {
    const last = strippedToSource[strippedToSource.length - 1];
    return last !== undefined ? last + 1 : 0;
  }
  return strippedToSource[strippedOffset] ?? 0;
}

// 确保插入点不在标签内部（尖括号范围内）
function ensureOutsideTags(sourcePos: number, tagSpans: TagSpan[]): number {
  for (const span of tagSpans) {
    if (sourcePos > span.start && sourcePos < span.end) {
      return span.end;
    }
  }
  return sourcePos;
}

// 确保插入点不在标签元素的内容区域内
// 如果当前 stripped 位置映射到标签内部，但前一个位置映射到标签外部，说明跨越了标签边界
// 此时应将插入点移到开标签之前，避免新文本被错误插入到标注内部
function ensureInsertOutsideElement(
  strippedPos: number,
  sourcePos: number,
  strippedToSource: number[],
  tagPairs: TagPair[]
): number {
  const prevSourcePos = strippedPos > 0
    ? strippedToSource[strippedPos - 1] ?? 0
    : 0;

  for (const pair of tagPairs) {
    // rt 内容已被跳过，不需要检查
    if (pair.tagName === "rt") continue;

    const inContent = sourcePos >= pair.openEnd && sourcePos <= pair.closeStart;
    const prevInContent = prevSourcePos >= pair.openEnd && prevSourcePos <= pair.closeStart;

    // 跨越标签边界：当前在标签内容区域内，前一个字符不在
    if (inContent && !prevInContent) {
      return pair.openStart;
    }
  }
  return sourcePos;
}

// 如果删除范围覆盖了标签，扩展到完整标签边界
function expandToTagBoundaries(
  sourceStart: number,
  sourceEnd: number,
  tagSpans: TagSpan[]
): { start: number; end: number } {
  let start = sourceStart;
  let end = sourceEnd;

  // 迭代扩展直到稳定
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const span of tagSpans) {
      // 如果部分覆盖了某个标签，扩展到完全包含
      if (start < span.end && end > span.start) {
        if (start > span.start || end < span.end) {
          const newStart = Math.min(start, span.start);
          const newEnd = Math.max(end, span.end);
          if (newStart !== start || newEnd !== end) {
            start = newStart;
            end = newEnd;
            expanded = true;
          }
        }
      }
    }
  }

  return { start, end };
}

// ========== 变更操作处理 ==========

// 合并相邻的删除+添加操作
function mergeAdjacentChanges(changes: SourceChange[]): SourceChange[] {
  if (changes.length === 0) return [];

  const merged: SourceChange[] = [];
  let current = { ...changes[0]! };

  for (let i = 1; i < changes.length; i++) {
    const next = changes[i]!;
    if (
      current.replacement === "" &&
      next.sourceStart === next.sourceEnd &&
      next.sourceStart >= current.sourceStart &&
      next.sourceStart <= current.sourceEnd
    ) {
      current = {
        sourceStart: current.sourceStart,
        sourceEnd: current.sourceEnd,
        replacement: next.replacement,
      };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

// 从后往前应用变更
function applyChangesBackward(
  content: string,
  changes: SourceChange[]
): string {
  const sorted = [...changes].sort((a, b) => b.sourceStart - a.sourceStart);

  let result = content;
  for (const change of sorted) {
    result =
      result.substring(0, change.sourceStart) +
      change.replacement +
      result.substring(change.sourceEnd);
  }

  return result;
}
