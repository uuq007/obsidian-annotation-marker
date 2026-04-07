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

  getActiveMarkers(): Marker[] {
    return this.getMarkers().filter((marker) => marker.state === "active");
  }

  getMarkerById(markerId?: string): Marker | null {
    if (!markerId) {
      return null;
    }
    return this.getMarkers().find((marker) => marker.id === markerId) ?? null;
  }

  async createMarker(): Promise<Marker> {
    const now = new Date().toISOString();
    const marker: Marker = {
      id: generateId(),
      name: "新记号",
      color: "#ffd43b",
      preset: "solid",
      state: "active",
      order: this.getMarkers().length,
      createdAt: now,
      updatedAt: now,
    };

    this.settings.markers = [...this.getMarkers(), marker].map((item, index) => ({
      ...item,
      order: index,
    }));
    await this.saveSettings();
    return marker;
  }

  async updateMarker(markerId: string, updates: Partial<Pick<Marker, "name" | "color" | "preset">>): Promise<void> {
    let changed = false;
    this.settings.markers = this.getMarkers().map((marker) => {
      if (marker.id !== markerId || marker.state !== "active") {
        return marker;
      }

      changed = true;
      return {
        ...marker,
        name: updates.name ?? marker.name,
        color: updates.color ?? marker.color,
        preset: updates.preset ?? marker.preset,
        updatedAt: new Date().toISOString(),
      };
    });

    if (changed) {
      await this.saveSettings();
    }
  }

  async moveMarker(markerId: string, direction: "up" | "down"): Promise<void> {
    const activeMarkers = this.getActiveMarkers();
    const index = activeMarkers.findIndex((marker) => marker.id === markerId);
    if (index === -1) {
      return;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeMarkers.length) {
      return;
    }

    const swapped = [...activeMarkers];
    const current = swapped[index];
    swapped[index] = swapped[targetIndex]!;
    swapped[targetIndex] = current!;

    const deletedMarkers = this.getMarkers().filter((marker) => marker.state === "soft-deleted");
    this.settings.markers = [...swapped, ...deletedMarkers].map((marker, order) => ({
      ...marker,
      order,
    }));
    await this.saveSettings();
  }

  async softDeleteMarker(markerId: string): Promise<void> {
    const markers = this.getMarkers();
    const activeMarkers = markers.filter((marker) => marker.state === "active" && marker.id !== markerId);
    const deletedMarkers = markers
      .filter((marker) => marker.state === "soft-deleted" || marker.id === markerId)
      .map((marker) =>
        marker.id === markerId
          ? {
              ...marker,
              state: "soft-deleted" as const,
              updatedAt: new Date().toISOString(),
            }
          : marker
      );

    this.settings.markers = [...activeMarkers, ...deletedMarkers].map((item, index) => ({
      ...item,
      order: index,
    }));
    await this.saveSettings();
  }

  async deleteMarker(markerId: string): Promise<void> {
    const remainingMarkers = this.getMarkers().filter((marker) => marker.id !== markerId);
    this.settings.markers = remainingMarkers.map((marker, index) => ({
      ...marker,
      order: index,
    }));
    await this.saveSettings();
  }

  async restoreMarker(markerId: string): Promise<void> {
    const markers = this.getMarkers();
    const restoringMarker = markers.find((marker) => marker.id === markerId);
    if (!restoringMarker) {
      return;
    }

    const activeMarkers = markers.filter((marker) => marker.state === "active");
    const deletedMarkers = markers.filter((marker) => marker.state === "soft-deleted" && marker.id !== markerId);
    const restoredMarker: Marker = {
      ...restoringMarker,
      state: "active",
      updatedAt: new Date().toISOString(),
    };

    this.settings.markers = [...activeMarkers, restoredMarker, ...deletedMarkers].map((item, index) => ({
      ...item,
      order: index,
    }));
    await this.saveSettings();
  }

  getMarkerForLegacyColor(color: AnnotationColor): Marker | null {
    return this.getMarkers().find((marker) => marker.legacyColor === color) ?? null;
  }

  getLegacyColorForMarker(markerId?: string): AnnotationColor {
    return this.getMarkerById(markerId)?.legacyColor ?? this.settings.defaultColor;
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
