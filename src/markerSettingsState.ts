import type { Marker } from "./types";

export interface MarkerSettingsRow {
  marker: Marker;
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  canRestore: boolean;
}

export function buildMarkerSettingsRows(markers: Marker[]): MarkerSettingsRow[] {
  const active = markers.filter((marker) => marker.state === "active").sort((a, b) => a.order - b.order);
  const deleted = markers.filter((marker) => marker.state === "soft-deleted").sort((a, b) => a.order - b.order);
  const combined = [...active, ...deleted];
  const lastActiveIndex = active.length - 1;

  return combined.map((marker, index) => {
    const readOnly = marker.state === "soft-deleted";
    const isActiveRow = index <= lastActiveIndex && !readOnly;

    return {
      marker,
      readOnly,
      canMoveUp: isActiveRow && index > 0,
      canMoveDown: isActiveRow && index < lastActiveIndex,
      canDelete: isActiveRow,
      canRestore: readOnly,
    };
  });
}
