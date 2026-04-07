export type AnnotationColor = "red" | "blue" | "yellow" | "green" | "purple" | "none";
export type MarkerPreset = "solid" | "double-underline" | "half-highlight" | "wavy-underline";
export type MarkerState = "active" | "soft-deleted";

export interface Marker {
  id: string;
  name: string;
  color: string;
  preset: MarkerPreset;
  state: MarkerState;
  order: number;
  createdAt: string;
  updatedAt: string;
  legacyColor?: AnnotationColor;
}

export interface AnnotationRuby {
  startIndex: number;
  length: number;
  ruby: string;
}

export interface ExtractedRubyInfo {
  annotationIds: string[];
  rubyTexts: Array<{ startIndex: number; length: number; ruby: string }>;
}

export interface OriginalRuby {
  startIndex: number;
  length: number;
  rt: string;
  rubyHTML: string;
}

export interface Annotation {
  id: string;
  text: string;
  contextBefore: string;
  contextAfter: string;
  color: AnnotationColor;
  markerId?: string;
  markerLabel?: string;
  note: string;
  rubyText?: string;
  rubyTexts?: AnnotationRuby[];
  originalRubies?: OriginalRuby[];
  createdAt: string;
  updatedAt: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  isValid: number;
}

export interface FileAnnotationData {
  filePath: string;
  annotations: Annotation[];
}

export interface AnnotationPluginSettings {
  defaultColor: AnnotationColor;
  maxNoteLength: number;
  markers?: Marker[];
}

export const DEFAULT_SETTINGS: AnnotationPluginSettings = {
  defaultColor: "yellow",
  maxNoteLength: 500,
  markers: [],
};

export const COLOR_MAP: Record<AnnotationColor, { bg: string; border: string }> = {
  red: { bg: "rgba(255, 107, 107, 0.35)", border: "#ff6b6b" },
  blue: { bg: "rgba(84, 160, 255, 0.35)", border: "#54a0ff" },
  yellow: { bg: "rgba(255, 212, 59, 0.45)", border: "#ffd43b" },
  green: { bg: "rgba(38, 194, 129, 0.35)", border: "#26c281" },
  purple: { bg: "rgba(155, 89, 182, 0.35)", border: "#9b59b6" },
  none: { bg: "transparent", border: "#999" },
};

export const COLOR_LABELS: Record<AnnotationColor, string> = {
  red: "红色",
  blue: "蓝色",
  yellow: "黄色",
  green: "绿色",
  purple: "紫色",
  none: "无色",
};

export const CONTEXT_LENGTH_BEFORE = 50;
export const CONTEXT_LENGTH_AFTER = 50;
export const MATCH_THRESHOLD = 0.5;

export interface PartialAnnotationInfo {
  annotationId: string;
  startIndex: number;
  length: number;
  rubyText: string;
}
