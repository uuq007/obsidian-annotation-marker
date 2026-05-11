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
  const tagRegex = /<(?:mark|ruby|rt)\s+[^>]*data-annotation-id="[^"]*"[^>]*>|<\/(?:mark|ruby|rt)>/g;

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
// 通过清理 HTML/markdown 语法后的内容进行搜索，再映射回源文件位置
// 可选行号范围用于缩小搜索区域，occurrence 用于选择第几个匹配
export function findTextInSource(
  sourceContent: string,
  searchText: string,
  contextBefore?: string,
  contextAfter?: string,
  searchStartLine?: number,
  searchEndLine?: number,
  occurrence?: number
): { start: number; end: number } | null {
  if (!searchText) return null;

  // 如果有行号范围，截取对应区域搜索
  let searchContent = sourceContent;
  let lineOffset = 0;

  if (searchStartLine !== undefined && searchEndLine !== undefined) {
    const lines = sourceContent.split("\n");
    const startLine = Math.max(0, searchStartLine);
    const endLine = Math.min(lines.length - 1, searchEndLine);
    searchContent = lines.slice(startLine, endLine + 1).join("\n");
    lineOffset = lines.slice(0, startLine).join("\n").length;
    if (startLine > 0) lineOffset += 1;
  }

  const map = buildCleanedMap(searchContent);
  const { cleaned, cleanedToSource } = map;

  // 找到所有匹配位置
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = cleaned.indexOf(searchText, searchFrom);
    if (idx < 0) break;
    occurrences.push(idx);
    searchFrom = idx + 1;
  }

  if (occurrences.length === 0) return null;

  // 选择目标匹配
  const targetCleanedIdx = (occurrence !== undefined && occurrence < occurrences.length)
    ? occurrences[occurrence]!
    : occurrences[0]!;

  const cleanedStart = targetCleanedIdx;
  const cleanedEnd = targetCleanedIdx + searchText.length;

  if (cleanedEnd > cleanedToSource.length) return null;

  return {
    start: (cleanedToSource[cleanedStart] ?? 0) + lineOffset,
    end: (cleanedToSource[cleanedEnd - 1] ?? 0) + 1 + lineOffset,
  };
}

// 构建清理后的文本内容及其到源码的位置映射
// 剥离 HTML 标签和 markdown 内联语法，使清理结果与渲染视图的文本内容一致
export interface CleanedMap {
  cleaned: string;
  // cleaned[i] 对应的源文件位置
  cleanedToSource: number[];
}

export function buildCleanedMap(source: string): CleanedMap {
  const cleanedChars: string[] = [];
  const cleanedToSource: number[] = [];

  // 按优先级排列：先匹配的特殊模式优先
  const syntaxRegex = new RegExp([
    '<rt[^>]*>[\\s\\S]*?<\\/(?:rt|ruby)>',                // <rt>内容</rt> 或 <rt>内容</ruby> 整体去除
    '|<[^<>]+>',                                           // HTML 标签去除（保留标签间文本）
    '|\\*\\*\\*([^\\*]+)\\*\\*\\*',                        // ***粗斜体*** → 保留内文本
    '|\\*\\*([^\\*]+)\\*\\*',                              // **粗体** → 保留内文本
    '|\\*([^\\*]+)\\*',                                    // *斜体* → 保留内文本
    '|``([^`]+)``',                                        // ``代码`` → 保留内文本
    '|`([^`]+)`',                                          // `代码` → 保留内文本
    '|_([^_]+)_',                                          // _斜体_ → 保留内文本
    '|==([^=]+)==',                                        // ==高亮== → 保留内文本
    '|~~([^~]+)~~',                                        // ~~删除线~~ → 保留内文本
    '|!\\[\\[[^\\[\\]]+\\]\\]',                            // ![[图片]] 整体去除
    '|\\[\\[(?:[^\\[\\]\\|]*\\|)?([^\\[\\]]+)\\]\\]',     // [[链接]] 或 [[目标|显示]] → 保留显示文本
    '|!\\[[^\\[\\]\\(\\)]*\\]\\([^)]+\\)',                 // ![图片](url) 整体去除
    '|\\[([^\\[\\]\\(\\)]+)\\]\\([^)]+\\)',                // [链接](url) → 保留链接文本
    '|^#{1,6}\\s*',                                        // 标题标记去除
    '|^\\>\\s?',                                           // 引用标记去除
    '|^[-*+]\\s(?:\\[[ x]\\]\\s)?',                        // 列表标记去除
    '|^\\d+\\.\\s',                                        // 有序列表标记去除
    '|^-{3,}$',                                            // --- 水平线整体去除
    '|^\\*{3,}$',                                          // *** 水平线整体去除
  ].join(''), 'gm');

  // 各捕获组对应的语法前缀长度（用于计算内文本的源码起始位置）
  // 组号: 1=***  2=**  3=*  4=``  5=`  6=_  7===  8=~~  9=[[  10=[]
  const prefixLengths: Record<number, number> = {
    1: 3,  // ***
    2: 2,  // **
    3: 1,  // *
    4: 2,  // ``
    5: 1,  // `
    6: 1,  // _
    7: 2,  // ==
    8: 2,  // ~~
  };

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = syntaxRegex.exec(source)) !== null) {
    // 匹配之前的文本 → 原样保留
    if (match.index > lastIndex) {
      const text = source.substring(lastIndex, match.index);
      for (let i = 0; i < text.length; i++) {
        cleanedChars.push(text.charAt(i));
        cleanedToSource.push(lastIndex + i);
      }
    }

    // 判断是否有捕获组匹配（需要保留内文本）
    let keptText: string | null = null;
    let keptSourceStart = 0;

    if (match[1] !== undefined) {
      keptText = match[1]!;
      keptSourceStart = match.index + 3;
    } else if (match[2] !== undefined) {
      keptText = match[2]!;
      keptSourceStart = match.index + 2;
    } else if (match[3] !== undefined) {
      keptText = match[3]!;
      keptSourceStart = match.index + 1;
    } else if (match[4] !== undefined) {
      keptText = match[4]!;
      keptSourceStart = match.index + 2;
    } else if (match[5] !== undefined) {
      keptText = match[5]!;
      keptSourceStart = match.index + 1;
    } else if (match[6] !== undefined) {
      keptText = match[6]!;
      keptSourceStart = match.index + 1;
    } else if (match[7] !== undefined) {
      keptText = match[7]!;
      keptSourceStart = match.index + 2;
    } else if (match[8] !== undefined) {
      keptText = match[8]!;
      keptSourceStart = match.index + 2;
    } else if (match[9] !== undefined) {
      // [[wiki link]] — 显示文本前有 [[ 或 [[target|，需计算偏移
      keptText = match[9]!;
      const fullMatch = match[0];
      const displayOffset = fullMatch.indexOf(keptText);
      keptSourceStart = match.index + displayOffset;
    } else if (match[10] !== undefined) {
      // [text](url) — 显示文本前有 [
      keptText = match[10]!;
      keptSourceStart = match.index + 1;
    }

    // 将保留的内文本添加到清理结果
    if (keptText) {
      for (let i = 0; i < keptText.length; i++) {
        cleanedChars.push(keptText.charAt(i));
        cleanedToSource.push(keptSourceStart + i);
      }
    }

    lastIndex = syntaxRegex.lastIndex;
  }

  // 最后一段文本
  if (lastIndex < source.length) {
    const text = source.substring(lastIndex);
    for (let i = 0; i < text.length; i++) {
      cleanedChars.push(text.charAt(i));
      cleanedToSource.push(lastIndex + i);
    }
  }

  return {
    cleaned: cleanedChars.join(""),
    cleanedToSource,
  };
}

// 用 TreeWalker 计算选区起点在元素内的精确字符偏移（跳过 <rt> 节点）
export function calculateOffsetInBlock(range: Range, block: HTMLElement): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.tagName === "RT") continue;
    if (node === range.startContainer) {
      return offset + range.startOffset;
    }
    offset += node.textContent?.length ?? 0;
  }
  return offset;
}

// 从 DOM 选区中提取选中文本和上下文
// 用 TreeWalker 遍历文本节点并跳过 <rt> 节点，确保提取的文本不含注音内容
export function extractSelectionContext(selection: Selection): {
  text: string;
  contextBefore: string;
  contextAfter: string;
} | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  // 找到最近的块级容器
  const container = range.commonAncestorContainer;
  const block = (container instanceof HTMLElement ? container : container.parentElement);
  if (!block) return null;

  // 用 TreeWalker 收集块内非 <rt> 文本节点，同时记录选区起止位置
  const cleanParts: string[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  let selStart = -1;
  let selEnd = -1;
  let currentOffset = 0;
  let foundFirst = false;

  while ((node = walker.nextNode())) {
    if (node.parentElement?.tagName === "RT") continue;
    const len = node.textContent?.length ?? 0;

    // 用 intersectsNode 判断文本节点是否在选区内（兼容 startContainer 为元素节点的情况）
    const inRange = range.intersectsNode(node);

    if (inRange) {
      if (!foundFirst) {
        foundFirst = true;
        selStart = (node === range.startContainer)
          ? currentOffset + range.startOffset
          : currentOffset;
      }
      selEnd = (node === range.endContainer)
        ? currentOffset + range.endOffset
        : currentOffset + len;
    }

    cleanParts.push(node.textContent || "");
    currentOffset += len;
  }

  const cleanBlockText = cleanParts.join("");

  if (selStart < 0 || selEnd < 0) {
    // 无法精确定位选区，回退
    const text = selection.toString().trim();
    if (!text) return null;
    return { text, contextBefore: "", contextAfter: "" };
  }

  const text = cleanBlockText.substring(selStart, selEnd).trim();
  if (!text) return null;

  const CONTEXT_LEN = 50;
  const contextBefore = cleanBlockText.substring(Math.max(0, selStart - CONTEXT_LEN), selStart);
  const contextAfter = cleanBlockText.substring(
    selEnd,
    selEnd + CONTEXT_LEN
  );

  return { text, contextBefore, contextAfter };
}
