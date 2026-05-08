import type { AnnotationColor, AnnotationRuby, ParsedAnnotation } from "../types";
import { COLOR_MAP } from "../constants";
import { decodeAttr } from "../utils/helpers";

// 匹配 <mark> 标签的正则（支持多行内容）
const MARK_REGEX = /<mark\s+([^>]*)>([\s\S]*?)<\/mark>/g;

// 匹配 <ruby> 标签的正则
const RUBY_REGEX = /<ruby\s+([^>]*)>([\s\S]*?)<\/ruby>/g;

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

// 从 <mark> 标签内容中解析 <ruby> 子标签
function parseRubyTags(content: string, parentAnnotationId: string): AnnotationRuby[] {
  const rubies: AnnotationRuby[] = [];
  let match: RegExpExecArray | null;

  RUBY_REGEX.lastIndex = 0;
  while ((match = RUBY_REGEX.exec(content)) !== null) {
    const rubyAttrs = match[1]!;
    const rubyContent = match[2]!;

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

// 剥离所有 HTML 标签，只保留文本
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

// 从标注文件内容中剥离所有标注标签，只保留纯文本
export function stripAnnotationTags(content: string): string {
  // 先处理 <ruby> 标签：只保留 <span> 中的文字
  let result = content.replace(
    /<ruby\s+[^>]*><span\s+[^>]*>([\s\S]*?)<\/span><rt\s+[^>]*>([\s\S]*?)<\/rt><\/ruby>/g,
    "$1"
  );
  // 再处理 <mark> 标签：只保留内容
  result = result.replace(/<mark\s+[^>]*>([\s\S]*?)<\/mark>/g, "$1");
  return result;
}

// 解析标注文件中的所有标注
export function parseAnnotations(content: string): ParsedAnnotation[] {
  const annotations: ParsedAnnotation[] = [];
  let match: RegExpExecArray | null;

  MARK_REGEX.lastIndex = 0;
  while ((match = MARK_REGEX.exec(content)) !== null) {
    const attrs = match[1]!;
    const innerContent = match[2]!;
    const fullMatch = match[0]!;
    const startIndex = match.index;

    const id = getAttr(attrs, "data-annotation-id");
    if (!id) continue;

    const style = getAttr(attrs, "style") || "";
    const color = extractColorFromStyle(style);
    const note = decodeAttr(getAttr(attrs, "data-annotation-note") || "");
    const createdAt = getAttr(attrs, "data-annotation-created") || new Date().toISOString();

    // 提取纯文本（剥离内部 <ruby> 等标签）
    const text = stripTags(innerContent);

    // 解析内部的 <ruby> 标签
    const rubyTexts = parseRubyTags(innerContent, id);

    annotations.push({
      id,
      color,
      note,
      text,
      rubyTexts,
      createdAt,
      position: {
        start: startIndex,
        end: startIndex + fullMatch.length,
      },
    });
  }

  return annotations;
}

// 根据 ID 查找特定标注
export function findAnnotationById(content: string, id: string): ParsedAnnotation | null {
  const annotations = parseAnnotations(content);
  return annotations.find((a) => a.id === id) ?? null;
}
