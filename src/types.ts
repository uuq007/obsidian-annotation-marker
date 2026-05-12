export type AnnotationColor = "red" | "blue" | "yellow" | "green" | "purple" | "none";

export interface AnnotationRuby {
  startIndex: number;
  length: number;
  ruby: string;
}

// 跨段标注中每个文本块的信息
export interface BlockSegment {
  text: string;           // 该块中被选中的文本
  lineStart: number;      // 该块在源文件中的起始行
  lineEnd: number;        // 该块在源文件中的结束行
  fullTextOffset: number; // 该块文本在完整选中文本中的起始字符偏移
  occurrence?: number;    // 该文本在块行号范围内是第几次出现（0-indexed，用于重复文本定位）
}

// 标注文件中解析出的标注数据
export interface ParsedAnnotation {
  id: string;
  color: AnnotationColor;
  note: string;
  text: string;
  rubyTexts: AnnotationRuby[];
  createdAt: string;
  // 多位置支持（全文标注/重叠标注会产生同一 ID 的多个 <mark> 标签）
  positions: Array<{ start: number; end: number }>;
  // 全文标注标记
  isFullText?: boolean;
  // 跨段标注标记
  isCrossBlock?: boolean;
}

// 创建新标注时的参数
export interface NewAnnotation {
  text: string;
  color: AnnotationColor;
  note?: string;
  rubyTexts?: AnnotationRuby[];
  // 精确位置（可选，优先使用）
  position?: {
    start: number;
    end: number;
  };
  // 行号范围（辅助定位，缩小搜索范围）
  startLine?: number;
  endLine?: number;
  // 上下文辅助定位（position 为空时使用）
  contextBefore?: string;
  contextAfter?: string;
  // 选中文本在 section 内是第几次出现（0-indexed，用于同段落重复文本定位）
  occurrence?: number;
  // 全文标注模式
  isFullText?: boolean;
  // 跨段标注的每块信息（设置后替代 text + startLine/endLine/occurrence 定位方式）
  blockSegments?: BlockSegment[];
}

// 更新标注时的参数
export interface AnnotationUpdates {
  color?: AnnotationColor;
  note?: string;
  rubyTexts?: AnnotationRuby[];
}

export interface AnnotationPluginSettings {
  defaultColor: AnnotationColor;
  maxNoteLength: number;
}

export const DEFAULT_SETTINGS: AnnotationPluginSettings = {
  defaultColor: "yellow",
  maxNoteLength: 500,
};
