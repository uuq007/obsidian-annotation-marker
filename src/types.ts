export type AnnotationColor = "1" | "2" | "3" | "4" | "5" | "none";

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

export type NoteEffect = "none" | "underline-thick" | "underline-dashed" | "underline-wavy" | "underline-double";

export interface AnnotationPluginSettings {
  defaultColor: AnnotationColor;
  maxNoteLength: number;
  // 颜色自定义（十六进制，通过调色盘设置）
  color1: string;
  color2: string;
  color3: string;
  color4: string;
  color5: string;
  // 颜色显示名
  colorLabel1: string;
  colorLabel2: string;
  colorLabel3: string;
  colorLabel4: string;
  colorLabel5: string;
  // 带批注标注的效果
  noteEffect: NoteEffect;
  // 注音样式
  rubyFontSize: string;
  rubyColor: string;
  // 标注模式
  defaultViewMode: "preview" | "source";
  autoOpenAnnotation: boolean;
}

export const DEFAULT_SETTINGS: AnnotationPluginSettings = {
  defaultColor: "3",
  maxNoteLength: 500,
  color1: "#ff6b6b",
  color2: "#54a0ff",
  color3: "#ffd43b",
  color4: "#26c281",
  color5: "#9b59b6",
  colorLabel1: "颜色1",
  colorLabel2: "颜色2",
  colorLabel3: "颜色3",
  colorLabel4: "颜色4",
  colorLabel5: "颜色5",
  noteEffect: "none",
  rubyFontSize: "0.7em",
  rubyColor: "#999999",
  defaultViewMode: "preview",
  autoOpenAnnotation: false,
};

// 所有颜色序号（不含 none）
export const COLOR_NUMBERS: string[] = ["1", "2", "3", "4", "5"];
