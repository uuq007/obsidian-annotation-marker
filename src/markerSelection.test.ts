import { describe, expect, it } from "vitest";
import type { Marker } from "./types";
import { buildCreationMarkerSelection, buildExistingMarkerSelection } from "./markerSelection";

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

describe("markerSelection", () => {
  it("builds creation selection from active markers and defaults to the first active marker", () => {
    const markers = [
      createMarker({ id: "a", order: 0, name: "黄色" }),
      createMarker({ id: "b", order: 1, name: "红色", state: "soft-deleted" }),
      createMarker({ id: "c", order: 2, name: "绿色" }),
    ];

    const selection = buildCreationMarkerSelection(markers);

    expect(selection.selectedMarkerId).toBe("a");
    expect(selection.options.map((option) => option.marker.id)).toEqual(["a", "c"]);
    expect(selection.options.every((option) => option.disabled === false)).toBe(true);
  });

  it("includes the current soft-deleted marker in existing annotation selection and marks it disabled", () => {
    const markers = [
      createMarker({ id: "a", order: 0, name: "黄色" }),
      createMarker({ id: "b", order: 1, name: "红色", state: "soft-deleted" }),
      createMarker({ id: "c", order: 2, name: "绿色" }),
    ];

    const selection = buildExistingMarkerSelection(markers, "b");

    expect(selection.selectedMarkerId).toBe("b");
    expect(selection.options.map((option) => option.marker.id)).toEqual(["a", "c", "b"]);
    expect(selection.options.find((option) => option.marker.id === "b")?.disabled).toBe(true);
  });
});
