// 重叠标注的区间分割工具
// 将重叠的标注区间分割为不重叠的段，每段记录覆盖它的标注 ID 集合

import type { AnnotationColor } from "../types";
import { COLOR_BG_VARS, COLOR_ACCENT_VARS } from "../constants";

export interface Interval {
  id: string;
  start: number;
  end: number;
  annotationColor?: AnnotationColor;
  note?: string;
  rubyTexts?: Array<{ startIndex: number; length: number; ruby: string }>;
}

export interface Segment {
  ids: string[];
  start: number;
  end: number;
}

// 扫描线算法：将重叠区间分割为不重叠段
export function computeSegments(intervals: Interval[]): Segment[] {
  if (intervals.length === 0) return [];

  const points = new Set<number>();
  for (const iv of intervals) {
    points.add(iv.start);
    points.add(iv.end);
  }

  const sorted = Array.from(points).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]!;
    const segEnd = sorted[i + 1]!;

    const coveringIds = intervals
      .filter(iv => iv.start <= segStart && iv.end >= segEnd)
      .map(iv => iv.id);

    if (coveringIds.length > 0) {
      segments.push({ ids: coveringIds, start: segStart, end: segEnd });
    }
  }

  return segments;
}

// 从段重建 HTML
export function buildSegmentHtml(
  segments: Segment[],
  plainText: string,
  annotations: Map<string, Interval>
): string {
  const parts: string[] = [];
  let lastEnd = 0;

  for (const seg of segments) {
    if (seg.start > lastEnd) {
      parts.push(plainText.substring(lastEnd, seg.start));
    }

    let enrichedText = plainText.substring(seg.start, seg.end);

    // 收集此段内的注音信息
    const segmentRubies: Array<{ localStart: number; localEnd: number; ruby: string; annId: string }> = [];
    for (const id of seg.ids) {
      const ann = annotations.get(id);
      if (ann?.rubyTexts) {
        for (const ruby of ann.rubyTexts) {
          const absStart = ann.start + ruby.startIndex;
          const absEnd = absStart + ruby.length;
          if (absStart >= seg.start && absEnd <= seg.end) {
            segmentRubies.push({
              localStart: absStart - seg.start,
              localEnd: absEnd - seg.start,
              ruby: ruby.ruby,
              annId: id,
            });
          }
        }
      }
    }

    // 从后往前插入 <ruby> 标签
    segmentRubies.sort((a, b) => b.localStart - a.localStart);
    for (const sr of segmentRubies) {
      const before = enrichedText.substring(0, sr.localStart);
      const target = enrichedText.substring(sr.localStart, sr.localEnd);
      const after = enrichedText.substring(sr.localEnd);
      enrichedText = `${before}<ruby data-annotation-id="${sr.annId}">${target}<rt data-annotation-id="${sr.annId}">${sr.ruby}</rt></ruby>${after}`;
    }

    // 按 ID 排序确保一致的嵌套顺序
    const sortedIds = [...seg.ids].sort();

    // 从内到外包裹 <mark> 标签
    let wrapped = enrichedText;
    for (let i = sortedIds.length - 1; i >= 0; i--) {
      const id = sortedIds[i]!;
      const ann = annotations.get(id);
      const color = ann?.annotationColor ?? "3";
      const bgVar = COLOR_BG_VARS[color];
      const accentVar = COLOR_ACCENT_VARS[color] || "transparent";
      const noteAttr = ann?.note ? ` data-annotation-note="${ann.note}"` : "";

      wrapped = `<mark style="background:${bgVar};--annotation-accent:${accentVar}" data-annotation-id="${id}"${noteAttr}>${wrapped}</mark>`;
    }

    parts.push(wrapped);
    lastEnd = seg.end;
  }

  if (lastEnd < plainText.length) {
    parts.push(plainText.substring(lastEnd));
  }

  return parts.join("");
}

// 判断两个区间是否重叠
export function isOverlapping(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// 找到与目标区间重叠的所有标注
export function findOverlappingAnnotations(
  target: { start: number; end: number },
  annotations: Array<{ id: string; positions: Array<{ start: number; end: number }> }>
): string[] {
  const result: string[] = [];
  for (const ann of annotations) {
    for (const pos of ann.positions) {
      if (isOverlapping(target, pos)) {
        if (!result.includes(ann.id)) {
          result.push(ann.id);
        }
        break;
      }
    }
  }
  return result;
}
