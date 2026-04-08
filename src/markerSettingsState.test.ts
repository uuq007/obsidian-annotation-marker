import { describe, expect, it } from "vitest";
import type { Marker } from "./types";
import { buildMarkerSettingsRows } from "./markerSettingsState";

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

describe("markerSettingsState", () => {
  it("builds a single list where deleted markers stay at the end and become read-only", () => {
    const rows = buildMarkerSettingsRows([
      createMarker({ id: "a", order: 0 }),
      createMarker({ id: "b", order: 1, state: "soft-deleted" }),
      createMarker({ id: "c", order: 2 }),
    ]);

    expect(rows.map((row) => row.marker.id)).toEqual(["a", "c", "b"]);
    expect(rows[2]?.readOnly).toBe(true);
    expect(rows[2]?.canRestore).toBe(true);
  });

  it("marks active rows with correct move controls within the active region only", () => {
    const rows = buildMarkerSettingsRows([
      createMarker({ id: "a", order: 0 }),
      createMarker({ id: "b", order: 1 }),
      createMarker({ id: "c", order: 2, state: "soft-deleted" }),
    ]);

    expect(rows[0]).toMatchObject({ canMoveUp: false, canMoveDown: true, canDelete: true });
    expect(rows[1]).toMatchObject({ canMoveUp: true, canMoveDown: false, canDelete: true });
    expect(rows[2]).toMatchObject({ canMoveUp: false, canMoveDown: false, canDelete: false, canRestore: true });
  });
});
