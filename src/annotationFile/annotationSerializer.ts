import type { AnnotationColor, AnnotationRuby, NewAnnotation } from "../types";
import { COLOR_MAP } from "../constants";
import { generateId, encodeAttr } from "../utils/helpers";
import { findTextInSource, buildCleanedMap } from "../utils/contentMapper";
import { computeSegments, buildSegmentHtml } from "../utils/overlapUtils";
import type { Interval } from "../utils/overlapUtils";
import { parseAnnotations, stripAnnotationTags } from "./annotationParser";

// 清理原生 <ruby> 标签（非插件生成）：移除 <rt> 内容和 <ruby> 标签本身
function stripNativeRuby(text: string): string {
  return text
    .replace(/<rt[^>]*>[\s\S]*?<\/(?:rt|ruby)>/g, "")
    .replace(/<\/?ruby[^>]*>/g, "");
}

// 构建 <ruby> 标签
function buildRubyTag(annotationId: string, text: string, ruby: string): string {
  return `<ruby data-annotation-id="${annotationId}">${text}<rt data-annotation-id="${annotationId}">${ruby}</rt></ruby>`;
}

// 构建带有注音标注的文本内容
// 将 rubyTexts 应用到 text 中的对应位置
function buildAnnotatedText(text: string, annotationId: string, rubyTexts?: AnnotationRuby[]): string {
  if (!rubyTexts || rubyTexts.length === 0) return text;

  // 按 startIndex 倒序排列，从后往前替换，避免偏移
  const sorted = [...rubyTexts].sort((a, b) => b.startIndex - a.startIndex);
  let result = text;

  for (const ruby of sorted) {
    const before = result.substring(0, ruby.startIndex);
    const target = result.substring(ruby.startIndex, ruby.startIndex + ruby.length);
    const after = result.substring(ruby.startIndex + ruby.length);
    result = before + buildRubyTag(annotationId, target, ruby.ruby) + after;
  }

  return result;
}

// 构建完整的 <mark> 标签
export function buildMarkTag(
  id: string,
  text: string,
  color: AnnotationColor,
  note?: string,
  rubyTexts?: AnnotationRuby[],
  createdAt?: string,
  isFullText?: boolean
): string {
  const bg = COLOR_MAP[color].bg;
  const created = createdAt || new Date().toISOString();
  const noteAttr = note ? ` data-annotation-note="${encodeAttr(note)}"` : "";
  const fullTextAttr = isFullText ? ` data-annotation-fulltext="true"` : "";

  const annotatedText = buildAnnotatedText(text, id, rubyTexts);

  return `<mark style="background:${bg}" data-annotation-id="${id}" data-annotation-color="${color}"${noteAttr} data-annotation-created="${created}"${fullTextAttr}>${annotatedText}</mark>`;
}

// 在标注文件内容中插入新标注
// 优先使用精确位置，否则通过文本搜索定位
// 支持与已有标注重叠（分割并嵌套 <mark> 标签）
export function insertAnnotation(content: string, annotation: NewAnnotation): { content: string; id: string } {
  const id = generateId();

  let start = -1;
  let end = -1;

  // 优先使用精确位置
  if (annotation.position) {
    start = annotation.position.start;
    end = annotation.position.end;
  } else {
    // 通过文本搜索定位（含行号范围和出现序号）
    const found = findTextInSource(
      content, annotation.text,
      annotation.contextBefore, annotation.contextAfter,
      annotation.startLine, annotation.endLine,
      annotation.occurrence
    );
    if (found) {
      start = found.start;
      end = found.end;
    }
  }

  if (start < 0) {
    // 未找到位置，返回原内容
    return { content, id };
  }

  // 如果没有 end（精确位置模式），用 text.length 计算
  if (end < 0) {
    end = start + annotation.text.length;
  }

  // 获取源码切片
  const sourceSlice = content.substring(start, end);

  // 检查源码切片是否包含标注标签（带 data-annotation-id）或 </mark> 闭标签
  // 不含这些标签时，无论是否在已有 <mark> 内部，都可以安全地简单插入（<mark> 允许嵌套）
  const needsRebuild = /<(?:mark|ruby|rt)\s[^>]*data-annotation-id|<\/mark>/i.test(sourceSlice);

  if (!needsRebuild) {
    // 简单插入：用 <mark> 包裹源码切片（原生 <ruby> 等标签一并包裹）
    const tag = (sourceSlice === annotation.text)
      ? buildMarkTag(id, sourceSlice, annotation.color, annotation.note, annotation.rubyTexts)
      : buildMarkTag(id, sourceSlice, annotation.color, annotation.note);

    return {
      content: content.substring(0, start) + tag + content.substring(end),
      id,
    };
  }

  // 有重叠：重建受影响区域
  return rebuildOverlapRegion(content, start, end, id, annotation);
}

// 重建受重叠影响的区域
function rebuildOverlapRegion(
  content: string,
  newStart: number,
  newEnd: number,
  newId: string,
  annotation: NewAnnotation
): { content: string; id: string } {
  // 1. 解析已有标注，找到与插入范围重叠的标注
  const existingAnnotations = parseAnnotations(content);
  const involvedAnnotations = existingAnnotations.filter(a =>
    a.positions.some(p => p.start < newEnd && p.end > newStart)
  );

  // 2. 先用 probe 区域找到嵌套标注，再用完整集合计算真实受影响区域
  const probeStarts = [newStart, ...involvedAnnotations.flatMap(a => a.positions.map(p => p.start))];
  const probeEnds = [newEnd, ...involvedAnnotations.flatMap(a => a.positions.map(p => p.end))];
  const probeStart = Math.min(...probeStarts);
  const probeEnd = Math.max(...probeEnds);

  // 查找受影响区域内但不直接与插入范围重叠的嵌套标注
  const nestedAnnotations = existingAnnotations.filter(a =>
    !involvedAnnotations.includes(a) &&
    a.positions.some(p => p.start >= probeStart && p.end <= probeEnd)
  );
  const allExistingToRebuild = [...involvedAnnotations, ...nestedAnnotations];

  // 真实受影响区域包含所有参与重建标注的全部位置（确保 plainRegion 包含完整 text）
  const allStarts = [newStart, ...allExistingToRebuild.flatMap(a => a.positions.map(p => p.start))];
  const allEnds = [newEnd, ...allExistingToRebuild.flatMap(a => a.positions.map(p => p.end))];
  const affectedStart = Math.min(...allStarts);
  const affectedEnd = Math.max(...allEnds);

  // 3. 提取受影响区域并剥离所有标注标签和原生 ruby 标签
  const affectedRegion = content.substring(affectedStart, affectedEnd);
  const plainRegion = stripNativeRuby(stripAnnotationTags(affectedRegion));

  // 4. 收集所有参与标注（已有 + 新增）
  const allInvolved = [
    ...allExistingToRebuild.map(a => ({
      id: a.id,
      text: a.text,
      color: a.color,
      note: a.note,
      created: a.createdAt,
      rubyTexts: a.rubyTexts,
    })),
    {
      id: newId,
      text: annotation.text,
      color: annotation.color,
      note: annotation.note,
      created: new Date().toISOString(),
      rubyTexts: annotation.rubyTexts,
    },
  ];

  // 5. 在 plainRegion 中找到每个标注的位置
  const intervals: Interval[] = [];
  for (const ann of allInvolved) {
    const idx = plainRegion.indexOf(ann.text);
    if (idx >= 0) {
      intervals.push({
        id: ann.id,
        start: idx,
        end: idx + ann.text.length,
        color: COLOR_MAP[ann.color].bg,
        annotationColor: ann.color,
        note: ann.note ? encodeAttr(ann.note) : undefined,
        created: ann.created,
        rubyTexts: ann.rubyTexts,
      });
    }
  }

  // 6. 计算分割段并重建 HTML
  const segments = computeSegments(intervals);
  const annotationMap = new Map<string, Interval>();
  for (const iv of intervals) {
    annotationMap.set(iv.id, iv);
  }
  const rebuiltRegion = buildSegmentHtml(segments, plainRegion, annotationMap);

  // 7. 替换原内容中的受影响区域
  return {
    content: content.substring(0, affectedStart) + rebuiltRegion + content.substring(affectedEnd),
    id: newId,
  };
}

// 从标注文件内容中删除指定标注（移除 <mark> 和关联的 <ruby> 标签，保留文字内容）
// 用栈匹配深度计数法正确处理嵌套，只移除目标 ID 的标签
export function removeAnnotationTag(content: string, annotationId: string): string {
  // 1. 移除该标注关联的 <ruby> 标签（保留文字，去除 <rt> 内容）
  let result = removeRubyById(content, annotationId);

  // 2. 用深度计数法移除 <mark> 标签（兼容嵌套，保留其他标注和原生 HTML）
  result = removeMarkById(result, annotationId);

  // 3. 合并相邻的同 ID mark 段（重叠分割后的残留）
  result = mergeAdjacentMarks(result);

  return result;
}

// 合并相邻的同 ID <mark> 段（重叠分割后的残留）
// 用栈匹配开闭标签，当 </mark> 紧邻同 ID 的 <mark> 时跳过边界
function mergeAdjacentMarks(content: string): string {
  const openRe = /<mark\s+([^>]*)>/g;
  const closeRe = /<\/mark>/g;

  interface TagInfo {
    index: number;
    length: number;
    type: "open" | "close";
    id: string;
    isFullText: boolean;
  }

  const tags: TagInfo[] = [];
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(content)) !== null) {
    const attrs = m[1]!;
    const id = attrs.match(/data-annotation-id="([^"]*)"/)?.[1] || "";
    const isFullText = attrs.includes('data-annotation-fulltext="true"');
    tags.push({ index: m.index, length: m[0].length, type: "open", id, isFullText });
  }

  while ((m = closeRe.exec(content)) !== null) {
    tags.push({ index: m.index, length: 7, type: "close", id: "", isFullText: false });
  }

  tags.sort((a, b) => a.index - b.index);

  // 用栈匹配并找到可合并的边界
  const stack: number[] = [];
  const skipSet = new Set<number>();

  for (let i = 0; i < tags.length; i++) {
    if (skipSet.has(i)) continue;
    const tag = tags[i]!;
    if (tag.type === "open") {
      stack.push(i);
    } else {
      const openIdx = stack.pop();
      if (openIdx === undefined) continue;
      const openTag = tags[openIdx]!;

      const nextIdx = i + 1;
      const nextTag = tags[nextIdx];
      if (
        nextTag &&
        nextTag.type === "open" &&
        nextTag.id === openTag.id &&
        !nextTag.isFullText &&
        openTag.id &&
        tag.index + tag.length === nextTag.index
      ) {
        skipSet.add(i);
        skipSet.add(nextIdx);
        stack.push(openIdx);
      }
    }
  }

  if (skipSet.size === 0) return content;

  // 重建内容
  const parts: string[] = [];
  let lastIdx = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.index > lastIdx) {
      parts.push(content.substring(lastIdx, tag.index));
    }
    if (!skipSet.has(i)) {
      parts.push(content.substring(tag.index, tag.index + tag.length));
    }
    lastIdx = tag.index + tag.length;
  }
  if (lastIdx < content.length) {
    parts.push(content.substring(lastIdx));
  }

  return parts.join("");
}

// 移除指定标注关联的 <ruby> 标签（保留文字，去除 <rt> 内容）
function removeRubyById(content: string, annotationId: string): string {
  const rubyRegex = new RegExp(
    `<ruby\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>([\\s\\S]*?)<rt\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>[\\s\\S]*?<\\/rt><\\/ruby>`,
    "g"
  );
  return content.replace(rubyRegex, "$1");
}

// 用栈匹配 + 深度计数法移除指定 ID 的 <mark> 标签（保留内部文字和其他标注的标签）
// 解决正则非贪婪匹配在嵌套 mark 时匹配错闭标签的问题
function removeMarkById(content: string, annotationId: string): string {
  const openRe = /<mark\s+([^>]*)>/g;
  const closeRe = /<\/mark>/g;

  interface MarkTag { index: number; length: number; type: "open" | "close"; id: string }
  const tags: MarkTag[] = [];

  let m: RegExpExecArray | null;
  while ((m = openRe.exec(content)) !== null) {
    const id = m[1]!.match(/data-annotation-id="([^"]*)"/)?.[1] || "";
    tags.push({ index: m.index, length: m[0].length, type: "open", id });
  }
  while ((m = closeRe.exec(content)) !== null) {
    tags.push({ index: m.index, length: 7, type: "close", id: "" });
  }

  tags.sort((a, b) => a.index - b.index);

  // 用栈匹配：闭标签弹出栈顶的开标签，如果该开标签 ID 匹配目标则标记移除
  const stack: number[] = [];
  const removeSet = new Set<number>();

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.type === "open") {
      stack.push(i);
    } else {
      const openIdx = stack.pop();
      if (openIdx !== undefined && tags[openIdx]!.id === annotationId) {
        removeSet.add(openIdx);
        removeSet.add(i);
      }
    }
  }

  if (removeSet.size === 0) return content;

  // 重建内容，跳过被标记的标签
  const parts: string[] = [];
  let lastIdx = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.index > lastIdx) {
      parts.push(content.substring(lastIdx, tag.index));
    }
    if (!removeSet.has(i)) {
      parts.push(content.substring(tag.index, tag.index + tag.length));
    }
    lastIdx = tag.index + tag.length;
  }
  if (lastIdx < content.length) {
    parts.push(content.substring(lastIdx));
  }

  return parts.join("");
}

// 更新指定标注的属性（颜色、批注）
export function updateAnnotationTag(
  content: string,
  annotationId: string,
  updates: {
    color?: AnnotationColor;
    note?: string;
    rubyTexts?: AnnotationRuby[];
  }
): string {
  const regex = new RegExp(
    `(<mark\\s+)([^>]*data-annotation-id="${annotationId}"[^>]*)(>)([\\s\\S]*?)(<\\/mark>)`,
    "g"
  );

  return content.replace(regex, (_match, prefix: string, attrs: string, open: string, innerContent: string, close: string) => {
    let newAttrs = attrs;

    if (updates.color) {
      const bg = COLOR_MAP[updates.color].bg;
      // 替换 style 中的 background
      newAttrs = newAttrs.replace(
        /style="background:[^"]*"/,
        `style="background:${bg}"`
      );
      // 替换 data-annotation-color
      newAttrs = newAttrs.replace(
        /data-annotation-color="[^"]*"/,
        `data-annotation-color="${updates.color}"`
      );
    }

    if (updates.note !== undefined) {
      if (updates.note) {
        if (newAttrs.includes("data-annotation-note=")) {
          newAttrs = newAttrs.replace(
            /data-annotation-note="[^"]*"/,
            `data-annotation-note="${encodeAttr(updates.note)}"`
          );
        } else {
          newAttrs += ` data-annotation-note="${encodeAttr(updates.note)}"`;
        }
      } else {
        newAttrs = newAttrs.replace(/\s*data-annotation-note="[^"]*"/, "");
      }
    }

    // 如果更新了 rubyTexts，需要重新构建内部内容
    if (updates.rubyTexts !== undefined) {
      // 先剥离已有的 <ruby> 标签（保留文字，去除 <rt> 内容）
      const plainText = innerContent.replace(/<ruby\s+[^>]*>([\s\S]*?)<rt\s+[^>]*>[\s\S]*?<\/rt><\/ruby>/g, "$1");

      const newInnerContent = buildAnnotatedText(plainText, annotationId, updates.rubyTexts);
      return `${prefix}${newAttrs}${open}${newInnerContent}${close}`;
    }

    return `${prefix}${newAttrs}${open}${innerContent}${close}`;
  });
}

// 在标注文件内容中对选中文本的所有出现位置插入标注
// 全文标注模式：同一 ID 的 <mark> 标签出现在所有匹配位置
export function insertFullTextAnnotation(
  content: string,
  annotation: NewAnnotation
): { content: string; id: string; count: number } {
  const id = generateId();
  const map = buildCleanedMap(content);

  // 找到所有匹配位置
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = map.cleaned.indexOf(annotation.text, searchFrom);
    if (idx < 0) break;
    occurrences.push(idx);
    searchFrom = idx + 1;
  }

  if (occurrences.length === 0) return { content, id, count: 0 };

  // 从后往前插入（避免位置偏移）
  let newContent = content;
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const cleanStart = occurrences[i]!;
    const cleanEnd = cleanStart + annotation.text.length;
    const srcStart = map.cleanedToSource[cleanStart] ?? 0;
    const srcEnd = (map.cleanedToSource[cleanEnd - 1] ?? srcStart) + 1;
    const sourceSlice = newContent.substring(srcStart, srcEnd);

    // 全文标注不支持注音（每次出现的 markdown 语法可能不同）
    const tag = buildMarkTag(id, sourceSlice, annotation.color, annotation.note, undefined, undefined, true);
    newContent = newContent.substring(0, srcStart) + tag + newContent.substring(srcEnd);
  }

  return { content: newContent, id, count: occurrences.length };
}
