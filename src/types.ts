export type AnnotationColor = "red" | "blue" | "yellow" | "green" | "purple" | "none";

export interface AnnotationRuby {
  startIndex: number;
  length: number;
  ruby: string;
}

// 标注文件中解析出的标注数据
export interface ParsedAnnotation {
  id: string;
  color: AnnotationColor;
  note: string;
  text: string;
  rubyTexts: AnnotationRuby[];
  createdAt: string;
  position: {
    start: number;
    end: number;
  };
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
  // 上下文辅助定位（position 为空时使用）
  contextBefore?: string;
  contextAfter?: string;
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
