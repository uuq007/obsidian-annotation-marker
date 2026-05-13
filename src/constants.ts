import type { AnnotationColor } from "./types";
import { COLOR_NUMBERS } from "./types";

// 颜色序号 → CSS 背景变量引用
export const COLOR_BG_VARS: Record<AnnotationColor, string> = {
  "1": "var(--annotation-bg-color1)",
  "2": "var(--annotation-bg-color2)",
  "3": "var(--annotation-bg-color3)",
  "4": "var(--annotation-bg-color4)",
  "5": "var(--annotation-bg-color5)",
  none: "transparent",
};

// 颜色序号 → CSS 强调色变量引用（用于批注效果的 border 等）
export const COLOR_ACCENT_VARS: Record<string, string> = {
  "1": "var(--annotation-accent-color1)",
  "2": "var(--annotation-accent-color2)",
  "3": "var(--annotation-accent-color3)",
  "4": "var(--annotation-accent-color4)",
  "5": "var(--annotation-accent-color5)",
};

// 颜色序号 → CSS 类名（用于 UI 圆点等非 sanitizer 区域）
export const COLOR_CLASSES: Record<AnnotationColor, string> = {
  "1": "ac-1",
  "2": "ac-2",
  "3": "ac-3",
  "4": "ac-4",
  "5": "ac-5",
  none: "ac-none",
};

// 所有可选颜色（含 none）
export const ALL_COLORS: AnnotationColor[] = [...COLOR_NUMBERS, "none"] as AnnotationColor[];

// 标注文件存储路径中使用的路径分隔符（替换 / 和 \）
export const PATH_SEPARATOR = "&.";
