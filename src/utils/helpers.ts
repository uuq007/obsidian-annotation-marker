import { PATH_SEPARATOR } from "../constants";

// 生成唯一 ID（时间戳）
export function generateId(): string {
  return Date.now().toString() + "-" + Math.random().toString(36).substring(2, 11);
}

// 将笔记路径转换为标注文件路径
// 例：pluginDir=".obsidian/plugins/obsidian-annotation-marker", notePath="00-inbox/测试.md"
// → ".obsidian/plugins/obsidian-annotation-marker/annotations/00-inbox&.测试.md"
export function notePathToAnnotationPath(pluginDir: string, notePath: string): string {
  const normalizedPath = notePath.replace(/[/\\]/g, PATH_SEPARATOR);
  return `${pluginDir}/annotations/${normalizedPath}`;
}

// 将标注文件路径还原为笔记路径
export function annotationPathToNotePath(pluginDir: string, annotationPath: string): string {
  const prefix = `${pluginDir}/annotations/`;
  if (!annotationPath.startsWith(prefix)) return annotationPath;
  const relativePath = annotationPath.substring(prefix.length);
  return relativePath.replace(new RegExp(escapeRegex(PATH_SEPARATOR), "g"), "/");
}

// 转义正则特殊字符
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 对字符串进行 HTML 属性编码（用于 data-note 等属性）
export function encodeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

// 对 HTML 属性值进行解码
export function decodeAttr(str: string): string {
  return str
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// 计算 DOM Range 在元素内的字符偏移量
export function calculateRangeOffsetInElement(
  range: Range,
  element: HTMLElement
): { start: number; end: number } | null {
  let start = 0;
  let end = 0;
  let foundStart = false;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const nodeLength = textNode.textContent?.length || 0;

    if (!foundStart) {
      if (textNode === range.startContainer) {
        start += range.startOffset;
        foundStart = true;

        if (range.endContainer === textNode) {
          end = start + (range.endOffset - range.startOffset);
          return { start, end };
        }
      } else if (textNode === range.endContainer) {
        end = start + range.endOffset;
        return { start: 0, end };
      } else {
        start += nodeLength;
      }
    } else {
      if (textNode === range.endContainer) {
        end = start + range.endOffset;
        return { start, end };
      } else {
        start += nodeLength;
      }
    }

    node = walker.nextNode();
  }

  return null;
}

// 计算选中文本在 section 文本中是第几次出现（0-indexed）
// 找到所有出现位置，返回离 offset 最近的那个的索引
export function countOccurrenceIndex(text: string, searchText: string, offset: number): number {
  const positions: number[] = [];
  let pos = 0;
  while (true) {
    const idx = text.indexOf(searchText, pos);
    if (idx < 0) break;
    positions.push(idx);
    pos = idx + 1;
  }
  if (positions.length === 0) return 0;

  let bestIdx = 0;
  let bestDist = Math.abs(positions[0]! - offset);
  for (let i = 1; i < positions.length; i++) {
    const dist = Math.abs(positions[i]! - offset);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
