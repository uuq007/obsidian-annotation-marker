import type { Annotation, Marker } from "./types";

export interface RenderedAnnotationAttrs {
  classNames: string[];
  markerId?: string;
}

export interface ListMarkerPreview {
  dotClassName: string;
  color?: string;
  label: string;
  deleted: boolean;
}

export function buildRenderedAnnotationAttrs(annotation: Annotation): RenderedAnnotationAttrs {
  const classNames = ["annotation-marker"];
  if (annotation.note && annotation.note.trim()) {
    classNames.push("annotation-marker-has-note");
  }

  return {
    classNames,
    markerId: annotation.markerId,
  };
}

export function buildListMarkerPreview(annotation: Annotation, marker: Marker | null): ListMarkerPreview {
  return {
    dotClassName: marker ? `annotation-list-dot marker-preset-${marker.preset}` : `annotation-list-dot color-${annotation.color}`,
    color: marker?.color,
    label: annotation.markerLabel ?? marker?.name ?? "",
    deleted: marker?.state === "soft-deleted",
  };
}

export function buildMarkerCssRule(marker: Marker): string {
  const selector = `.markdown-rendered mark.annotation-marker[data-marker-id="${marker.id}"], .markdown-preview-view mark.annotation-marker[data-marker-id="${marker.id}"]`;
  const noteSelector = `${selector}.annotation-marker-has-note`;
  const noteBadgeStyle = `
  position: relative;
  --annotation-note-indicator-color: ${marker.color};
`;

  switch (marker.preset) {
    case "double-underline":
      return `
${selector} {
  background: transparent;
  text-decoration-line: underline;
  text-decoration-style: double;
  text-decoration-color: ${marker.color};
  text-decoration-thickness: 2px;
}
${noteSelector} {
${noteBadgeStyle}
}
`;
    case "half-highlight":
      return `
${selector} {
  background: linear-gradient(to top, color-mix(in srgb, ${marker.color} 45%, transparent) 0 58%, transparent 58% 100%);
}
${noteSelector} {
${noteBadgeStyle}
}
`;
    case "wavy-underline":
      return `
${selector} {
  background: transparent;
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: ${marker.color};
  text-decoration-thickness: 2px;
}
${noteSelector} {
${noteBadgeStyle}
}
`;
    case "solid":
    default:
      return `
${selector} {
  background: color-mix(in srgb, ${marker.color} 38%, transparent);
}
${noteSelector} {
${noteBadgeStyle}
}
`;
  }
}
