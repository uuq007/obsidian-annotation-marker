import { describe, expect, it } from "vitest";
import type { Annotation, Marker } from "./types";
import { buildListMarkerPreview, buildRenderedAnnotationAttrs } from "./markerPresentation";

const baseTime = "2026-04-08T00:00:00.000Z";

function createMarker(overrides: Partial<Marker>): Marker {
  return {
    id: overrides.id ?? "m1",
    name: overrides.name ?? "黄色",
    color: overrides.color ?? "#ffd43b",
    preset: overrides.preset ?? "solid",
    state: overrides.state ?? "active",
    order: overrides.order ?? 0,
    createdAt: overrides.createdAt ?? baseTime,
    updatedAt: overrides.updatedAt ?? baseTime,
    legacyColor: overrides.legacyColor,
  };
}

function createAnnotation(overrides: Partial<Annotation>): Annotation {
  return {
    id: overrides.id ?? "a1",
    text: overrides.text ?? "text",
    contextBefore: overrides.contextBefore ?? "",
    contextAfter: overrides.contextAfter ?? "",
    color: overrides.color ?? "yellow",
    markerId: overrides.markerId,
    markerLabel: overrides.markerLabel,
    note: overrides.note ?? "",
    createdAt: overrides.createdAt ?? baseTime,
    updatedAt: overrides.updatedAt ?? baseTime,
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 1,
    startOffset: overrides.startOffset ?? 0,
    endOffset: overrides.endOffset ?? 4,
    isValid: overrides.isValid ?? 1,
  };
}

describe("markerPresentation", () => {
  it("builds rendered annotation attributes from marker identity and note state", () => {
    const marker = createMarker({
      id: "m1",
      preset: "half-highlight",
      color: "#26c281",
    });
    const attrs = buildRenderedAnnotationAttrs(createAnnotation({
      markerId: "m1",
      note: "has note",
    }), marker);

    expect(attrs.classNames).toContain("annotation-marker");
    expect(attrs.classNames).toContain("marker-preset-half-highlight");
    expect(attrs.classNames).toContain("annotation-marker-has-note");
    expect(attrs.markerId).toBe("m1");
    expect(attrs.markerColor).toBe("#26c281");
  });

  it("builds list preview from marker label and marker preset", () => {
    const marker = createMarker({ id: "m2", name: "重点", preset: "wavy-underline", color: "#ff6b6b" });
    const preview = buildListMarkerPreview(createAnnotation({
      markerId: "m2",
      markerLabel: "重点",
    }), marker);

    expect(preview.dotClassName).toContain("marker-preset-wavy-underline");
    expect(preview.label).toBe("重点");
    expect(preview.deleted).toBe(false);
  });

  it("marks deleted marker previews so list and detail can surface the deleted state", () => {
    const marker = createMarker({ id: "m3", name: "旧记号", state: "soft-deleted" });
    const preview = buildListMarkerPreview(createAnnotation({
      markerId: "m3",
      markerLabel: "旧记号",
    }), marker);

    expect(preview.deleted).toBe(true);
  });

  it("still returns base attrs without marker metadata", () => {
    const attrs = buildRenderedAnnotationAttrs(createAnnotation({
      markerId: "m4",
    }), null);

    expect(attrs.classNames).toEqual(["annotation-marker"]);
    expect(attrs.markerColor).toBeUndefined();
  });
});
