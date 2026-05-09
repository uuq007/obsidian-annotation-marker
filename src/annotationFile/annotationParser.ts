import type { AnnotationColor, AnnotationRuby, ParsedAnnotation } from "../types";
import { COLOR_MAP } from "../constants";
import { decodeAttr } from "../utils/helpers";

// 从属性字符串中提取指定属性值
function getAttr(attrs: string, name: string): string | null {
  const regex = new RegExp(`${name}="([^"]*)"`, "i");
  const match = attrs.match(regex);
  return match ? match[1]! : null;
}

// 从 <mark> 标签的 style 属性中提取颜色名称
function extractColorFromStyle(style: string): AnnotationColor {
  for (const [color, { bg }] of Object.entries(COLOR_MAP)) {
    if (style.includes(bg)) {
      return color as AnnotationColor;
    }
  }
  return "yellow";
}

// 剥离所有 HTML 标签，只保留文本
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

// 从标注文件内容中剥离所有标注标签，只保留纯文本
// 使用深度计数法正确处理嵌套 <mark> 和 <ruby> 标签
export function stripAnnotationTags(content: string): string {
  // 先处理 <ruby> 标签：只保留 <span> 中的文字
  let result = content.replace(
    /<ruby\s+[^>]*><span\s+[^>]*>([\s\S]*?)<\/span><rt\s+[^>]*>([\s\S]*?)<\/rt><\/ruby>/g,
    "$1"
  );
  // 用深度计数法处理嵌套 <mark> 标签
  result = stripNestedMarks(result);
  return result;
}

// 用深度计数法剥离嵌套的 <mark> 标签，保留文字内容
function stripNestedMarks(content: string): string {
  const openRe = /<mark\s+[^>]*>/g;
  const closeRe = /<\/mark>/g;
  const segments: Array<{ text: string; isTag: boolean; index: number }> = [];

  // 收集所有开标签和闭标签的位置
  const tags: Array<{ index: number; length: number; isOpen: boolean }> = [];
  let m: RegExpExecArray | null;

  openRe.lastIndex = 0;
  while ((m = openRe.exec(content)) !== null) {
    tags.push({ index: m.index, length: m[0].length, isOpen: true });
  }
  closeRe.lastIndex = 0;
  while ((m = closeRe.exec(content)) !== null) {
    tags.push({ index: m.index, length: m[0].length, isOpen: false });
  }

  // 按位置排序
  tags.sort((a, b) => a.index - b.index);

  // 遍历内容，跳过所有 <mark> 和 </mark> 标签
  let lastIdx = 0;
  for (const tag of tags) {
    if (tag.index > lastIdx) {
      segments.push({ text: content.substring(lastIdx, tag.index), isTag: false, index: lastIdx });
    }
    lastIdx = tag.index + tag.length;
  }
  if (lastIdx < content.length) {
    segments.push({ text: content.substring(lastIdx), isTag: false, index: lastIdx });
  }

  return segments.map(s => s.text).join("");
}

// 标记结构（解析过程中的中间结果）
interface MarkSegment {
  id: string;
  attrs: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

// 用深度计数法找到配对的 </mark> 闭标签
function findMatchingCloseMark(content: string, openTagEnd: number): number {
  let depth = 1;
  let pos = openTagEnd;

  while (depth > 0 && pos < content.length) {
    const nextOpen = content.indexOf("<mark ", pos);
    const nextOpenSelf = content.indexOf("<mark>", pos);
    const nextClose = content.indexOf("</mark>", pos);

    // 考虑自闭合形式 <mark>
    let effectiveOpen = -1;
    if (nextOpen !== -1) effectiveOpen = nextOpen;
    if (nextOpenSelf !== -1 && (effectiveOpen === -1 || nextOpenSelf < effectiveOpen)) {
      effectiveOpen = nextOpenSelf;
    }

    if (nextClose === -1) break;

    if (effectiveOpen !== -1 && effectiveOpen < nextClose) {
      depth++;
      pos = effectiveOpen + 6; // "<mark " 或 "<mark>" 的长度
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + 7; // "</mark>" 的长度
    }
  }

  return -1;
}

// 从 <mark> 标签内容中解析 <ruby> 子标签
function parseRubyTags(content: string, _parentAnnotationId: string): AnnotationRuby[] {
  const rubies: AnnotationRuby[] = [];
  const rubyRegex = /<ruby\s+[^>]*>([\s\S]*?)<\/ruby>/g;
  let match: RegExpExecArray | null;

  while ((match = rubyRegex.exec(content)) !== null) {
    const rubyContent = match[1]!;

    // 从 <ruby> 中提取 <rt> 标签
    const rtMatch = rubyContent.match(/<rt[^>]*data-annotation-id="[^"]*"[^>]*>([\s\S]*?)<\/rt>/);
    const rtText = rtMatch ? rtMatch[1]! : "";

    // 从 <ruby> 中提取 <span> 标签的文本内容
    const spanMatch = rubyContent.match(/<span[^>]*data-annotation-id="[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const spanText = spanMatch ? spanMatch[1]! : "";

    if (spanText && rtText) {
      // 计算 <span> 文本在 <mark> 内容中的 startIndex
      const beforeRuby = content.substring(0, match.index);
      // 剥离 beforeRuby 中的其他标签来计算纯文本偏移
      const plainBefore = stripTags(beforeRuby);

      rubies.push({
        startIndex: plainBefore.length,
        length: spanText.length,
        ruby: rtText,
      });
    }
  }

  return rubies;
}

// 解析标注文件中的所有标注（栈式解析器，支持嵌套）
export function parseAnnotations(content: string): ParsedAnnotation[] {
  const segments: MarkSegment[] = [];

  // 扫描所有 <mark> 开标签
  const openRegex = /<mark\s+([^>]*)>/g;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openRegex.exec(content)) !== null) {
    const attrs = openMatch[1]!;
    const id = getAttr(attrs, "data-annotation-id");
    if (!id) continue;

    const openTagStart = openMatch.index;
    const openTagEnd = openTagStart + openMatch[0].length;

    // 用深度计数找配对的闭标签
    const closeTagStart = findMatchingCloseMark(content, openTagEnd);
    if (closeTagStart === -1) continue;

    const innerContent = content.substring(openTagEnd, closeTagStart);

    segments.push({
      id,
      attrs,
      content: innerContent,
      startIndex: openTagStart,
      endIndex: closeTagStart + 7, // "</mark>" 的长度
    });
  }

  // 按 ID 分组
  const groupMap = new Map<string, MarkSegment[]>();
  for (const seg of segments) {
    let group = groupMap.get(seg.id);
    if (!group) {
      group = [];
      groupMap.set(seg.id, group);
    }
    group.push(seg);
  }

  // 构建每个标注的 ParsedAnnotation
  const annotations: ParsedAnnotation[] = [];

  for (const [id, group] of groupMap) {
    const first = group[0]!;

    const style = getAttr(first.attrs, "style") || "";
    const color = extractColorFromStyle(style);
    const note = decodeAttr(getAttr(first.attrs, "data-annotation-note") || "");
    const createdAt = getAttr(first.attrs, "data-annotation-created") || new Date().toISOString();

    // 拼接所有段的纯文本
    const text = group.map(seg => stripTags(seg.content)).join("");

    // 解析第一段中的 ruby 标签
    const rubyTexts = parseRubyTags(first.content, id);

    // 收集所有位置
    const positions = group.map(seg => ({
      start: seg.startIndex,
      end: seg.endIndex,
    }));

    // 判断是否为全文标注（同一 ID 出现多次）
    const isFullText = group.length > 1;

    annotations.push({
      id,
      color,
      note,
      text,
      rubyTexts,
      createdAt,
      positions,
      isFullText,
    });
  }

  return annotations;
}

// 根据 ID 查找特定标注
export function findAnnotationById(content: string, id: string): ParsedAnnotation | null {
  const annotations = parseAnnotations(content);
  return annotations.find((a) => a.id === id) ?? null;
}
