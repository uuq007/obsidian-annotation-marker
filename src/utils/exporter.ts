import type { AnnotationColor, AnnotationRuby, ParsedAnnotation } from "../types";

type SortOption = "position-asc" | "position-desc" | "time-asc" | "time-desc" | "color-asc" | "color-desc" | "by-note";

// 将标注按排序选项排序（复用侧边栏排序逻辑）
export function sortAnnotations(annotations: ParsedAnnotation[], sortOption: SortOption): ParsedAnnotation[] {
  const sorted = [...annotations];
  switch (sortOption) {
    case "position-asc":
      sorted.sort((a, b) => a.positions[0]!.start - b.positions[0]!.start);
      break;
    case "position-desc":
      sorted.sort((a, b) => b.positions[0]!.start - a.positions[0]!.start);
      break;
    case "time-asc":
      sorted.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      break;
    case "time-desc":
      sorted.sort((a, b) => parseInt(b.id) - parseInt(a.id));
      break;
    case "color-asc":
      sorted.sort((a, b) => a.color.localeCompare(b.color));
      break;
    case "color-desc":
      sorted.sort((a, b) => b.color.localeCompare(a.color));
      break;
    case "by-note":
      sorted.sort((a, b) => a.positions[0]!.start - b.positions[0]!.start);
      break;
  }
  return sorted;
}

// 构建带注音的标注文本
export function buildAnnotatedText(text: string, rubyTexts: AnnotationRuby[]): string {
  if (!rubyTexts || rubyTexts.length === 0) return text;

  const sorted = [...rubyTexts].sort((a, b) => a.startIndex - b.startIndex);
  let result = "";
  let currentIndex = 0;

  for (const ruby of sorted) {
    if (ruby.startIndex > currentIndex) {
      result += text.substring(currentIndex, ruby.startIndex);
    }
    const baseText = text.substring(ruby.startIndex, ruby.startIndex + ruby.length);
    result += `<ruby>${baseText}<rt>${ruby.ruby}</rt></ruby>`;
    currentIndex = ruby.startIndex + ruby.length;
  }

  if (currentIndex < text.length) {
    result += text.substring(currentIndex);
  }

  return result;
}

// 颜色 → callout 类型名
function colorToCalloutType(color: AnnotationColor): string {
  return `annotation-${color}`;
}

// 生成完整导出内容
// 格式：
// > [!annotation-{color}] note
// > > 标注文本（含 ruby）
// >
// >
// > 批注内容
export function buildExportContent(annotations: ParsedAnnotation[]): string {
  const blocks: string[] = [];

  for (const annotation of annotations) {
    const calloutType = colorToCalloutType(annotation.color);
    const annotatedText = buildAnnotatedText(annotation.text, annotation.rubyTexts);
    const flatText = annotatedText.replace(/\n/g, " ");

    const blockLines: string[] = [];
    blockLines.push(`> [!${calloutType}] note`);
    blockLines.push(`> > ${flatText}`);

    if (annotation.note && annotation.note.trim()) {
      blockLines.push(">");
      blockLines.push(">");
      for (const line of annotation.note.split("\n")) {
        blockLines.push(`> ${line}`);
      }
    }

    blocks.push(blockLines.join("\n"));
  }

  return blocks.join("\n\n");
}
