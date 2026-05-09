import type { AnnotationColor, AnnotationRuby, NewAnnotation } from "../types";
import { COLOR_MAP } from "../constants";
import { generateId, encodeAttr } from "../utils/helpers";
import { findTextInSource, buildCleanedMap } from "../utils/contentMapper";
import { computeSegments, buildSegmentHtml } from "../utils/overlapUtils";
import type { Interval } from "../utils/overlapUtils";
import { parseAnnotations, stripAnnotationTags } from "./annotationParser";

// 构建 <ruby> 标签
function buildRubyTag(annotationId: string, text: string, ruby: string): string {
  return `<ruby data-annotation-id="${annotationId}"><span data-annotation-id="${annotationId}">${text}</span><rt data-annotation-id="${annotationId}">${ruby}</rt></ruby>`;
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
  createdAt?: string
): string {
  const bg = COLOR_MAP[color].bg;
  const created = createdAt || new Date().toISOString();
  const noteAttr = note ? ` data-annotation-note="${encodeAttr(note)}"` : "";

  const annotatedText = buildAnnotatedText(text, id, rubyTexts);

  return `<mark style="background:${bg}" data-annotation-id="${id}" data-annotation-color="${color}"${noteAttr} data-annotation-created="${created}">${annotatedText}</mark>`;
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

  // 检查是否跨越了已有 <mark> 标签边界（即存在重叠）
  const hasOverlap = /<mark[\s>]|<\/mark>/.test(sourceSlice);

  if (!hasOverlap) {
    // 无重叠：正常插入
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

  // 2. 计算受影响区域的边界
  const allStarts = [newStart, ...involvedAnnotations.flatMap(a => a.positions.map(p => p.start))];
  const allEnds = [newEnd, ...involvedAnnotations.flatMap(a => a.positions.map(p => p.end))];
  const affectedStart = Math.min(...allStarts);
  const affectedEnd = Math.max(...allEnds);

  // 3. 提取受影响区域并剥离所有标注标签
  const affectedRegion = content.substring(affectedStart, affectedEnd);
  const plainRegion = stripAnnotationTags(affectedRegion);

  // 4. 收集所有参与标注（已有 + 新增）
  const allInvolved = [
    ...involvedAnnotations.map(a => ({
      id: a.id,
      text: a.text,
      color: a.color,
      note: a.note,
      created: a.createdAt,
    })),
    {
      id: newId,
      text: annotation.text,
      color: annotation.color,
      note: annotation.note,
      created: new Date().toISOString(),
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
        note: ann.note ? encodeAttr(ann.note) : undefined,
        created: ann.created,
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
// 如果标注参与重叠，重建受影响区域
export function removeAnnotationTag(content: string, annotationId: string): string {
  // 1. 解析所有标注，检查被删除标注是否参与重叠
  const allAnnotations = parseAnnotations(content);
  const targetAnnotation = allAnnotations.find(a => a.id === annotationId);

  if (!targetAnnotation) {
    // 标注不存在，直接返回
    return content;
  }

  // 检查是否有重叠
  const hasOverlap = allAnnotations.some(a =>
    a.id !== annotationId &&
    a.positions.some(ap =>
      targetAnnotation.positions.some(tp => ap.start < tp.end && tp.start < ap.end)
    )
  );

  if (!hasOverlap) {
    // 无重叠：简单移除
    return simpleRemoveAnnotationTag(content, annotationId);
  }

  // 有重叠：重建受影响区域
  return rebuildAfterRemoval(content, annotationId, targetAnnotation, allAnnotations);
}

// 简单移除标注标签（无重叠情况）
function simpleRemoveAnnotationTag(content: string, annotationId: string): string {
  // 先移除该标注关联的 <ruby> 标签（保留 <span> 中的文字）
  const rubyRegex = new RegExp(
    `<ruby\\s+[^>]*data-annotation-id="${annotationId}"[^>]*><span\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>([\\s\\S]*?)<\\/span><rt\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>[\\s\\S]*?<\\/rt><\\/ruby>`,
    "g"
  );
  let result = content.replace(rubyRegex, "$1");

  // 再移除 <mark> 标签（保留内部文字）
  const markRegex = new RegExp(
    `<mark\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>([\\s\\S]*?)<\\/mark>`,
    "g"
  );
  result = result.replace(markRegex, "$1");

  return result;
}

// 删除参与重叠的标注后重建受影响区域
function rebuildAfterRemoval(
  content: string,
  annotationId: string,
  targetAnnotation: { positions: Array<{ start: number; end: number }> },
  allAnnotations: Array<{ id: string; positions: Array<{ start: number; end: number }>; text: string; color: AnnotationColor; note: string; createdAt: string }>
): string {
  // 计算受影响区域
  const allStarts = targetAnnotation.positions.map(p => p.start);
  const allEnds = targetAnnotation.positions.map(p => p.end);
  // 包含与被删除标注重叠的其他标注的范围
  for (const ann of allAnnotations) {
    if (ann.id === annotationId) continue;
    for (const ap of ann.positions) {
      for (const tp of targetAnnotation.positions) {
        if (ap.start < tp.end && tp.start < ap.end) {
          allStarts.push(ap.start);
          allEnds.push(ap.end);
        }
      }
    }
  }

  const affectedStart = Math.min(...allStarts);
  const affectedEnd = Math.max(...allEnds);

  // 提取并剥离受影响区域
  const affectedRegion = content.substring(affectedStart, affectedEnd);
  const plainRegion = stripAnnotationTags(affectedRegion);

  // 收集剩余标注（排除被删除的）
  const remainingAnnotations = allAnnotations.filter(a =>
    a.id !== annotationId &&
    a.positions.some(ap =>
      allStarts.some(s => ap.end > s) && allEnds.some(e => ap.start < e)
    )
  );

  if (remainingAnnotations.length === 0) {
    // 没有剩余标注，直接用纯文本替换
    return content.substring(0, affectedStart) + plainRegion + content.substring(affectedEnd);
  }

  // 在 plainRegion 中找到每个剩余标注的位置
  const intervals: Interval[] = [];
  for (const ann of remainingAnnotations) {
    const idx = plainRegion.indexOf(ann.text);
    if (idx >= 0) {
      intervals.push({
        id: ann.id,
        start: idx,
        end: idx + ann.text.length,
        color: COLOR_MAP[ann.color].bg,
        note: ann.note ? encodeAttr(ann.note) : undefined,
        created: ann.createdAt,
      });
    }
  }

  // 计算分割段并重建
  const segments = computeSegments(intervals);
  const annotationMap = new Map<string, Interval>();
  for (const iv of intervals) {
    annotationMap.set(iv.id, iv);
  }
  const rebuiltRegion = buildSegmentHtml(segments, plainRegion, annotationMap);

  return content.substring(0, affectedStart) + rebuiltRegion + content.substring(affectedEnd);
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
      // 先剥离已有的 <ruby> 标签
      const plainText = innerContent.replace(/<ruby\s+[^>]*>[\s\S]*?<\/ruby>/g, (rubyMatch) => {
        const spanMatch = rubyMatch.match(/<span\s+[^>]*>([\s\S]*?)<\/span>/);
        return spanMatch ? spanMatch[1]! : "";
      });

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
    const tag = buildMarkTag(id, sourceSlice, annotation.color, annotation.note);
    newContent = newContent.substring(0, srcStart) + tag + newContent.substring(srcEnd);
  }

  return { content: newContent, id, count: occurrences.length };
}
