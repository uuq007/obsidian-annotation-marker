import { Annotation, AnnotationColor, AnnotationPluginSettings, COLOR_LABELS, Marker, MarkerPreset } from "./types";
import { generateId } from "./utils/helpers";

type SaveSettings = () => Promise<void>;

interface DefaultMarkerDefinition {
  name: string;
  color: string;
  preset: MarkerPreset;
  legacyColor: AnnotationColor;
}

const DEFAULT_MARKERS: DefaultMarkerDefinition[] = [
  { name: COLOR_LABELS.yellow, color: "#ffd43b", preset: "solid", legacyColor: "yellow" },
  { name: COLOR_LABELS.red, color: "#ff6b6b", preset: "solid", legacyColor: "red" },
  { name: COLOR_LABELS.green, color: "#26c281", preset: "solid", legacyColor: "green" },
  { name: COLOR_LABELS.blue, color: "#54a0ff", preset: "solid", legacyColor: "blue" },
  { name: COLOR_LABELS.purple, color: "#9b59b6", preset: "solid", legacyColor: "purple" },
  { name: COLOR_LABELS.none, color: "#999999", preset: "solid", legacyColor: "none" },
];

export class MarkerManager {
  private settings: AnnotationPluginSettings;
  private saveSettings: SaveSettings;

  constructor(settings: AnnotationPluginSettings, saveSettings: SaveSettings) {
    this.settings = settings;
    this.saveSettings = saveSettings;
  }

  async ensureInitialized(): Promise<void> {
    if (Array.isArray(this.settings.markers) && this.settings.markers.length > 0) {
      return;
    }

    this.settings.markers = this.createDefaultMarkers();
    await this.saveSettings();
  }

  getMarkers(): Marker[] {
    return [...(this.settings.markers ?? [])].sort((a, b) => a.order - b.order);
  }

  getMarkerForLegacyColor(color: AnnotationColor): Marker | null {
    return this.getMarkers().find((marker) => marker.legacyColor === color) ?? null;
  }

  normalizeAnnotation(annotation: Annotation): { annotation: Annotation; changed: boolean } {
    const marker = this.getMarkerForLegacyColor(annotation.color);
    const markerId = annotation.markerId ?? marker?.id;
    const markerLabel = annotation.markerLabel ?? marker?.name ?? COLOR_LABELS[annotation.color];
    const changed = markerId !== annotation.markerId || markerLabel !== annotation.markerLabel;

    return {
      changed,
      annotation: {
        ...annotation,
        markerId,
        markerLabel,
      },
    };
  }

  private createDefaultMarkers(): Marker[] {
    const now = new Date().toISOString();
    return DEFAULT_MARKERS.map((marker, index) => ({
      id: generateId(),
      name: marker.name,
      color: marker.color,
      preset: marker.preset,
      state: "active",
      order: index,
      createdAt: now,
      updatedAt: now,
      legacyColor: marker.legacyColor,
    }));
  }
}
