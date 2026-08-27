import type { AnnotationColor, AnnotationRuby, ParsedAnnotation } from "../types";
import { decodeAttr } from "../utils/helpers";

// 从属性字符串中提取指定属性值
function getAttr(attrs: string, name: string): string | null {
  const regex = new RegExp(`${name}="([^"]*)"`, "i");
  const match = attrs.match(regex);
  return match ? match[1]! : null;
}

// 从 style 属性中的 CSS 变量提取颜色序号（如 "var(--annotation-bg-color3)" → "3"）
function extractColorFromStyle(style: string): AnnotationColor {
  const match = style.match(/var\(--annotation-bg-color(\d+)\)/);
  if (match) return match[1]! as AnnotationColor;
  // 兼容：检查是否为 transparent（none）
  if (style.includes("transparent")) return "none";
  return "3";
}

// 剥离所有 HTML 标签，只保留文本
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

// 剥离注音内容：先移除 <rt> 标签及其文字，再移除其他 HTML 标签
function stripRubyText(html: string): string {
  const noRt = html.replace(/<rt[^>]*>[\s\S]*?<\/(?:rt|ruby)>/g, "");
  return stripTags(noRt);
}

// 从标注文件内容中剥离插件生成的标注标签，只保留纯文本。
// 必须只匹配带 data-annotation-id 的插件标签：用户手写的原生 <mark>/<ruby>
// 若被误剥，回写原笔记时会静默丢失（与 diffSync 的 scanAllTags 口径对齐）
export function stripAnnotationTags(content: string): string {
  let result = content.replace(
    /<ruby\s+[^>]*data-annotation-id=[^>]*>([\s\S]*?)<rt\s+[^>]*data-annotation-id=[^>]*>([\s\S]*?)<\/rt><\/ruby>/g,
    "$1"
  );
  result = stripNestedMarks(result);
  return result;
}

// 用深度配对法剥离插件生成的嵌套 <mark> 标签（开闭成对移除），保留文字内容；
// 用户手写的无 id <mark>/<ruby> 标签原样保留
function stripNestedMarks(content: string): string {
  const openRe = /<mark\s+[^>]*data-annotation-id=[^>]*>/g;
  // 收集需要移除的区间：每个插件 mark 的开标签 + 与之深度配对的闭标签
  const removals: Array<[number, number]> = [];

  let m: RegExpExecArray | null;
  openRe.lastIndex = 0;
  while ((m = openRe.exec(content)) !== null) {
    const openStart = m.index;
    const openEnd = openStart + m[0].length;
    const closeStart = findMatchingCloseMark(content, openEnd);
    if (closeStart === -1) continue;
    removals.push([openStart, openEnd], [closeStart, closeStart + 7]);
  }

  if (removals.length === 0) return content;
  removals.sort((a, b) => a[0] - b[0]);

  let out = "";
  let last = 0;
  for (const [s, e] of removals) {
    // 畸形嵌套时的重叠区间保护
    if (s < last) continue;
    out += content.slice(last, s);
    last = e;
  }
  out += content.slice(last);
  return out;
}

// 标记结构（解析过程中的中间结果）
interface MarkSegment {
  id: string;
  attrs: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

// 用深度计数法找到配对的 </mark> 闭标签（serializer 的标注更新也依赖此配对逻辑）
export function findMatchingCloseMark(content: string, openTagEnd: number): number {
  let depth = 1;
  let pos = openTagEnd;

  while (depth > 0 && pos < content.length) {
    const nextOpen = content.indexOf("<mark ", pos);
    const nextOpenSelf = content.indexOf("<mark>", pos);
    const nextClose = content.indexOf("</mark>", pos);

    let effectiveOpen = -1;
    if (nextOpen !== -1) effectiveOpen = nextOpen;
    if (nextOpenSelf !== -1 && (effectiveOpen === -1 || nextOpenSelf < effectiveOpen)) {
      effectiveOpen = nextOpenSelf;
    }

    if (nextClose === -1) break;

    if (effectiveOpen !== -1 && effectiveOpen < nextClose) {
      depth++;
      pos = effectiveOpen + 6;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + 7;
    }
  }

  return -1;
}

// 从 <mark> 标签内容中解析属于指定标注的 <ruby> 子标签
function parseRubyTags(content: string, parentAnnotationId: string): AnnotationRuby[] {
  const rubies: AnnotationRuby[] = [];
  const rubyRegex = new RegExp(
    `<ruby\\s+[^>]*data-annotation-id="${parentAnnotationId}"[^>]*>([\\s\\S]*?)<\\/ruby>`, "g"
  );
  let match: RegExpExecArray | null;

  while ((match = rubyRegex.exec(content)) !== null) {
    const rubyContent = match[1]!;

    const rtMatch = rubyContent.match(/<rt[^>]*data-annotation-id="[^"]*"[^>]*>([\s\S]*?)<\/rt>/);
    const rtText = rtMatch ? rtMatch[1]! : "";

    const baseTextMatch = rubyContent.match(/^([\s\S]*?)<rt/);
    const baseText = baseTextMatch ? baseTextMatch[1]! : "";

    if (baseText && rtText) {
      const beforeRuby = content.substring(0, match.index);
      const plainBefore = stripRubyText(beforeRuby);

      rubies.push({
        startIndex: plainBefore.length,
        length: baseText.length,
        // 写入时经 encodeAttr 转义，读取端对称解码
        ruby: decodeAttr(rtText),
      });
    }
  }

  return rubies;
}

// 解析标注文件中的所有标注（栈式解析器，支持嵌套）
export function parseAnnotations(content: string): ParsedAnnotation[] {
  const segments: MarkSegment[] = [];

  const openRegex = /<mark\s+([^>]*)>/g;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openRegex.exec(content)) !== null) {
    const attrs = openMatch[1]!;
    const id = getAttr(attrs, "data-annotation-id");
    if (!id) continue;

    const openTagStart = openMatch.index;
    const openTagEnd = openTagStart + openMatch[0].length;

    const closeTagStart = findMatchingCloseMark(content, openTagEnd);
    if (closeTagStart === -1) continue;

    const innerContent = content.substring(openTagEnd, closeTagStart);

    segments.push({
      id,
      attrs,
      content: innerContent,
      startIndex: openTagStart,
      endIndex: closeTagStart + 7,
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

    // 从 style 属性提取颜色（通过 CSS 变量名）
    const style = getAttr(first.attrs, "style") || "";
    const color = extractColorFromStyle(style);
    const note = decodeAttr(getAttr(first.attrs, "data-annotation-note") || "");

    const isFullText = getAttr(first.attrs, "data-annotation-fulltext") === "true";
    const isCrossBlock = getAttr(first.attrs, "data-annotation-crossblock") === "true";

    const text = isFullText
      ? stripRubyText(first.content)
      : group.map(seg => stripRubyText(seg.content)).join("");

    const rubyTexts: AnnotationRuby[] = [];
    if (isFullText) {
      rubyTexts.push(...parseRubyTags(first.content, id));
    } else {
      let offset = 0;
      for (const seg of group) {
        const segRubies = parseRubyTags(seg.content, id);
        for (const r of segRubies) {
          rubyTexts.push({
            startIndex: offset + r.startIndex,
            length: r.length,
            ruby: r.ruby,
          });
        }
        offset += stripRubyText(seg.content).length;
      }
    }

    const positions = group.map(seg => ({
      start: seg.startIndex,
      end: seg.endIndex,
    }));

    annotations.push({
      id,
      color,
      note,
      text,
      rubyTexts,
      positions,
      isFullText,
      isCrossBlock,
    });
  }

  return annotations;
}
