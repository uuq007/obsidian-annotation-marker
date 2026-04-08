import type { Marker } from "./types";

export interface MarkerSelectionOption {
  marker: Marker;
  disabled: boolean;
}

export interface MarkerSelectionState {
  options: MarkerSelectionOption[];
  selectedMarkerId: string | null;
}

export function buildCreationMarkerSelection(markers: Marker[]): MarkerSelectionState {
  const activeMarkers = markers
    .filter((marker) => marker.state === "active")
    .sort((a, b) => a.order - b.order);

  return {
    options: activeMarkers.map((marker) => ({ marker, disabled: false })),
    selectedMarkerId: activeMarkers[0]?.id ?? null,
  };
}

export function buildExistingMarkerSelection(markers: Marker[], currentMarkerId?: string): MarkerSelectionState {
  const activeMarkers = markers
    .filter((marker) => marker.state === "active")
    .sort((a, b) => a.order - b.order)
    .map((marker) => ({ marker, disabled: false }));
  const currentMarker = currentMarkerId ? markers.find((marker) => marker.id === currentMarkerId) : undefined;

  if (currentMarker && currentMarker.state === "soft-deleted") {
    activeMarkers.push({ marker: currentMarker, disabled: true });
  }

  return {
    options: activeMarkers,
    selectedMarkerId: currentMarker?.id ?? activeMarkers[0]?.marker.id ?? null,
  };
}
