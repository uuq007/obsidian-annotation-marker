import type { AnnotationColor, AnnotationPluginSettings } from "./types";
import { COLOR_NUMBERS } from "./types";

// 颜色序号 → CSS 背景变量引用
export const COLOR_BG_VARS: Record<AnnotationColor, string> = {
  "1": "var(--annotation-bg-color1)",
  "2": "var(--annotation-bg-color2)",
  "3": "var(--annotation-bg-color3)",
  "4": "var(--annotation-bg-color4)",
  "5": "var(--annotation-bg-color5)",
  "6": "var(--annotation-bg-color6)",
  "7": "var(--annotation-bg-color7)",
  "8": "var(--annotation-bg-color8)",
  "9": "var(--annotation-bg-color9)",
  "10": "var(--annotation-bg-color10)",
  none: "transparent",
};

// 颜色序号 → CSS 强调色变量引用（用于批注效果的 border 等）
export const COLOR_ACCENT_VARS: Record<AnnotationColor, string> = {
  "1": "var(--annotation-accent-color1)",
  "2": "var(--annotation-accent-color2)",
  "3": "var(--annotation-accent-color3)",
  "4": "var(--annotation-accent-color4)",
  "5": "var(--annotation-accent-color5)",
  "6": "var(--annotation-accent-color6)",
  "7": "var(--annotation-accent-color7)",
  "8": "var(--annotation-accent-color8)",
  "9": "var(--annotation-accent-color9)",
  "10": "var(--annotation-accent-color10)",
  none: "transparent",
};

// 颜色序号 → CSS 类名（用于 UI 圆点等非 sanitizer 区域）
export const COLOR_CLASSES: Record<AnnotationColor, string> = {
  "1": "ac-1",
  "2": "ac-2",
  "3": "ac-3",
  "4": "ac-4",
  "5": "ac-5",
  "6": "ac-6",
  "7": "ac-7",
  "8": "ac-8",
  "9": "ac-9",
  "10": "ac-10",
  none: "ac-none",
};

export const MIN_COLOR_COUNT = 5;
export const MAX_COLOR_COUNT = 10;

// 激活的颜色序号（按序号升序、过滤非法值），供 UI 遍历
export function getActiveColorNumbers(settings: AnnotationPluginSettings): string[] {
  const active = Array.isArray(settings.activeColors) ? settings.activeColors : [];
  return COLOR_NUMBERS.filter((n) => active.includes(n));
}

// 激活的全部可选颜色（含 none）
export function getActiveColors(settings: AnnotationPluginSettings): AnnotationColor[] {
  return [...getActiveColorNumbers(settings), "none"] as AnnotationColor[];
}

// 标注文件存储路径中使用的路径分隔符（替换 / 和 \）
export const PATH_SEPARATOR = "&.";
