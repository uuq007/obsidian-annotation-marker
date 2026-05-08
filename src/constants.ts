import type { AnnotationColor } from "./types";

// 颜色映射
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

// 标注文件存储路径中使用的路径分隔符（替换 / 和 \）
export const PATH_SEPARATOR = "&.";
