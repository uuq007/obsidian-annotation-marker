import type { Annotation, Marker } from "./types";

export interface RenderedAnnotationAttrs {
  classNames: string[];
  markerId?: string;
  markerColor?: string;
}

export interface ListMarkerPreview {
  dotClassName: string;
  color?: string;
  label: string;
  deleted: boolean;
}

export function buildRenderedAnnotationAttrs(annotation: Annotation, marker: Marker | null): RenderedAnnotationAttrs {
  const classNames = ["annotation-marker"];
  if (marker) {
    classNames.push(`marker-preset-${marker.preset}`);
  }
  if (annotation.note && annotation.note.trim()) {
    classNames.push("annotation-marker-has-note");
  }

  return {
    classNames,
    markerId: annotation.markerId,
    markerColor: marker?.color,
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
