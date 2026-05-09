import type { AnnotationColor, AnnotationRuby, NewAnnotation } from "../types";
import { COLOR_MAP } from "../constants";
import { generateId, encodeAttr } from "../utils/helpers";
import { findTextInSource } from "../utils/contentMapper";

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
export function insertAnnotation(content: string, annotation: NewAnnotation): { content: string; id: string } {
  const id = generateId();

  let start = -1;

  // 优先使用精确位置
  if (annotation.position) {
    start = annotation.position.start;
  } else {
    // 通过文本搜索定位
    const found = findTextInSource(content, annotation.text, annotation.contextBefore, annotation.contextAfter);
    if (found) {
      start = found.start;
    }
  }

  if (start < 0) {
    // 未找到位置，返回原内容
    return { content, id };
  }

  const tag = buildMarkTag(id, annotation.text, annotation.color, annotation.note, annotation.rubyTexts);

  return {
    content: content.substring(0, start) + tag + content.substring(start + annotation.text.length),
    id,
  };
}

// 从标注文件内容中删除指定标注（移除 <mark> 和关联的 <ruby> 标签，保留文字内容）
export function removeAnnotationTag(content: string, annotationId: string): string {
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
