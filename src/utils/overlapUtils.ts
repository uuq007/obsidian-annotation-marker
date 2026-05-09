// 重叠标注的区间分割工具
// 将重叠的标注区间分割为不重叠的段，每段记录覆盖它的标注 ID 集合

export interface Interval {
  id: string;
  start: number;
  end: number;
  color: string;
  note?: string;
  created?: string;
}

export interface Segment {
  ids: string[];
  start: number;
  end: number;
}

// 扫描线算法：将重叠区间分割为不重叠段
export function computeSegments(intervals: Interval[]): Segment[] {
  if (intervals.length === 0) return [];

  // 收集所有边界点
  const points = new Set<number>();
  for (const iv of intervals) {
    points.add(iv.start);
    points.add(iv.end);
  }

  const sorted = Array.from(points).sort((a, b) => a - b);

  // 相邻边界点之间形成段
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]!;
    const segEnd = sorted[i + 1]!;

    // 找出覆盖此段的所有标注
    const coveringIds = intervals
      .filter(iv => iv.start <= segStart && iv.end >= segEnd)
      .map(iv => iv.id);

    if (coveringIds.length > 0) {
      segments.push({ ids: coveringIds, start: segStart, end: segEnd });
    }
  }

  return segments;
}

// 从段重建 HTML：对每段文本，从内到外嵌套 <mark> 标签
export function buildSegmentHtml(
  segments: Segment[],
  plainText: string,
  annotations: Map<string, Interval>
): string {
  const parts: string[] = [];

  for (const seg of segments) {
    const text = plainText.substring(seg.start, seg.end);
    // 按 ID 排序确保一致的嵌套顺序
    const sortedIds = [...seg.ids].sort();

    // 从内到外包裹 <mark> 标签
    let wrapped = text;
    for (let i = sortedIds.length - 1; i >= 0; i--) {
      const id = sortedIds[i]!;
      const ann = annotations.get(id);
      const bg = ann?.color ?? "rgba(255, 212, 59, 0.45)";
      const noteAttr = ann?.note ? ` data-annotation-note="${ann.note}"` : "";
      const createdAttr = ann?.created ? ` data-annotation-created="${ann.created}"` : "";

      wrapped = `<mark style="background:${bg}" data-annotation-id="${id}"${noteAttr}${createdAttr}>${wrapped}</mark>`;
    }

    parts.push(wrapped);
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
