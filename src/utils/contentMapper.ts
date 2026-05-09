// 标注文件内容的位置映射工具
// 解决「渲染视图中的选区」与「源文件中的字符位置」之间的映射问题

export interface ContentMap {
  // 分段信息（标签 vs 文本）
  segments: Array<{ text: string; isTag: boolean; sourceOffset: number }>;
  // 剥离标签后的纯文本
  strippedContent: string;
  // strippedContent[i] 对应的源文件位置
  strippedToSource: number[];
}

// 解析标注文件内容，构建标签/文本分段和位置映射
export function buildContentMap(content: string): ContentMap {
  const segments: ContentMap["segments"] = [];
  const strippedChars: string[] = [];
  const strippedToSource: number[] = [];

  // 匹配所有标注相关标签（带 data-annotation-id 的标签及其闭合标签）
  const tagRegex = /<(?:mark|ruby|rt|span)\s+[^>]*data-annotation-id="[^"]*"[^>]*>|<\/(?:mark|ruby|rt|span)>/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    // 标签之前的文本
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index);
      segments.push({ text, isTag: false, sourceOffset: lastIndex });
      for (let i = 0; i < text.length; i++) {
        strippedChars.push(text.charAt(i));
        strippedToSource.push(lastIndex + i);
      }
    }
    // 标签本身
    segments.push({ text: match[0], isTag: true, sourceOffset: match.index });
    lastIndex = tagRegex.lastIndex;
  }

  // 最后一段文本
  if (lastIndex < content.length) {
    const text = content.substring(lastIndex);
    segments.push({ text, isTag: false, sourceOffset: lastIndex });
    for (let i = 0; i < text.length; i++) {
      strippedChars.push(text.charAt(i));
      strippedToSource.push(lastIndex + i);
    }
  }

  return {
    segments,
    strippedContent: strippedChars.join(""),
    strippedToSource,
  };
}

// 在源文件内容中查找选中文本的位置
// 通过剥离标签后的内容进行搜索，再映射回源文件位置
export function findTextInSource(
  sourceContent: string,
  searchText: string,
  contextBefore?: string,
  contextAfter?: string
): { start: number; end: number } | null {
  if (!searchText) return null;

  const map = buildContentMap(sourceContent);
  const { strippedContent, strippedToSource } = map;

  let index = -1;

  // 策略1：用上下文辅助定位
  if (contextBefore) {
    const contextIndex = strippedContent.indexOf(contextBefore);
    if (contextIndex >= 0) {
      const searchStart = contextIndex + contextBefore.length;
      // 在上下文之后附近搜索
      const found = strippedContent.indexOf(searchText, Math.max(0, searchStart - searchText.length));
      if (found >= 0 && found <= searchStart + searchText.length) {
        index = found;
      }
    }
  }

  // 策略2：直接搜索
  if (index < 0) {
    index = strippedContent.indexOf(searchText);
  }

  if (index < 0) return null;

  const strippedStart = index;
  const strippedEnd = index + searchText.length;

  if (strippedEnd > strippedToSource.length) return null;

  return {
    start: strippedToSource[strippedStart] ?? 0,
    end: (strippedToSource[strippedEnd - 1] ?? 0) + 1,
  };
}

// 从 DOM 选区中提取选中文本和上下文
export function extractSelectionContext(selection: Selection): {
  text: string;
  contextBefore: string;
  contextAfter: string;
} | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  // 找到最近的块级容器
  const container = range.commonAncestorContainer;
  const block = (container instanceof HTMLElement ? container : container.parentElement);
  if (!block) return null;

  // 获取块的完整文本内容
  const blockText = block.textContent || "";

  // 在块文本中定位选中文本
  const selIndex = blockText.indexOf(text);
  if (selIndex < 0) return { text, contextBefore: "", contextAfter: "" };

  const CONTEXT_LEN = 50;
  const contextBefore = blockText.substring(Math.max(0, selIndex - CONTEXT_LEN), selIndex);
  const contextAfter = blockText.substring(
    selIndex + text.length,
    selIndex + text.length + CONTEXT_LEN
  );

  return { text, contextBefore, contextAfter };
}
