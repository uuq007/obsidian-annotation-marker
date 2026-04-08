import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import { MarkerManager } from "./markerManager";
import { DataManager } from "./dataManager";

describe("MarkerManager", () => {
  it("initializes a default marker set when settings do not have markers", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };

    const manager = new MarkerManager(settings, async () => {});

    await manager.ensureInitialized();

    expect(manager.getMarkers()).toHaveLength(6);
    expect(manager.getMarkers().map((marker) => marker.name)).toEqual([
      "黄色",
      "红色",
      "绿色",
      "蓝色",
      "紫色",
      "无色",
    ]);
  });

  it("maps legacy color annotations to default markers when annotations are loaded", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };

    const writes: Array<{ path: string; content: string }> = [];
    const files = new Map<string, string>();
    const adapter = {
      exists: async (path: string) => files.has(path),
      mkdir: async () => {},
      read: async (path: string) => {
        const content = files.get(path);
        if (!content) {
          throw new Error(`missing file: ${path}`);
        }
        return content;
      },
      write: async (path: string, content: string) => {
        files.set(path, content);
        writes.push({ path, content });
      },
      remove: async (path: string) => {
        files.delete(path);
      },
    };
    const app = {
      vault: {
        adapter,
      },
    } as any;

    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();

    files.set(
      ".obsidian/plugins/obsidian-annotation-marker/annotations/folder.note.json",
      JSON.stringify({
        filePath: "folder/note.md",
        annotations: [
          {
            id: "a1",
            text: "legacy",
            contextBefore: "",
            contextAfter: "",
            color: "red",
            note: "",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
            startLine: 1,
            endLine: 1,
            startOffset: 0,
            endOffset: 6,
            isValid: 1,
          },
        ],
      })
    );

    const dataManager = new DataManager(app, ".obsidian/plugins/obsidian-annotation-marker", manager);
    const loaded = await dataManager.loadAnnotations("folder/note.md");

    expect(loaded?.annotations[0]?.markerId).toBe(manager.getMarkerForLegacyColor("red")?.id);
    expect(loaded?.annotations[0]?.markerLabel).toBe("红色");
    expect(writes).toHaveLength(1);
  });

  it("persists marker fields when annotations are added and updated", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };

    const files = new Map<string, string>();
    const adapter = {
      exists: async (path: string) => files.has(path),
      mkdir: async () => {},
      read: async (path: string) => {
        const content = files.get(path);
        if (!content) {
          throw new Error(`missing file: ${path}`);
        }
        return content;
      },
      write: async (path: string, content: string) => {
        files.set(path, content);
      },
      remove: async (path: string) => {
        files.delete(path);
      },
    };
    const app = {
      vault: {
        adapter,
      },
    } as any;

    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();
    const dataManager = new DataManager(app, ".obsidian/plugins/obsidian-annotation-marker", manager);

    const created = await dataManager.addAnnotation("folder/note.md", {
      text: "new",
      contextBefore: "",
      contextAfter: "",
      color: "blue",
      note: "",
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 3,
      isValid: 1,
    });

    expect(created?.markerId).toBe(manager.getMarkerForLegacyColor("blue")?.id);
    expect(created?.markerLabel).toBe("蓝色");

    const updated = await dataManager.updateAnnotation("folder/note.md", created!.id, {
      color: "green",
    });

    expect(updated?.markerId).toBe(manager.getMarkerForLegacyColor("green")?.id);
    expect(updated?.markerLabel).toBe("绿色");
  });

  it("creates a new active marker with default values at the end of active markers", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };
    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();

    const created = await manager.createMarker();
    const markers = manager.getMarkers();

    expect(created.name).toBe("新记号");
    expect(created.preset).toBe("solid");
    expect(created.color).toBe("#ffd43b");
    expect(markers).toHaveLength(7);
    expect(markers[6]?.id).toBe(created.id);
    expect(markers[6]?.state).toBe("active");
  });

  it("soft deletes a marker by moving it to the end of the list and marking it unavailable", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };
    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();

    const initialMarkers = manager.getMarkers();
    const markerToDelete = initialMarkers[1]!;

    await manager.softDeleteMarker(markerToDelete.id);

    const markers = manager.getMarkers();
    expect(markers[markers.length - 1]?.id).toBe(markerToDelete.id);
    expect(markers[markers.length - 1]?.state).toBe("soft-deleted");
  });

  it("restores a soft-deleted marker to the end of active markers instead of its original position", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };
    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();

    const markerToRestore = manager.getMarkers()[1]!;
    await manager.softDeleteMarker(markerToRestore.id);
    await manager.restoreMarker(markerToRestore.id);

    const markers = manager.getMarkers();
    expect(markers[markers.length - 1]?.id).toBe(markerToRestore.id);
    expect(markers[markers.length - 1]?.state).toBe("active");
  });

  it("keeps explicit marker fields when a new annotation is created", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };
    const files = new Map<string, string>();
    const adapter = {
      exists: async (path: string) => files.has(path),
      mkdir: async () => {},
      read: async (path: string) => {
        const content = files.get(path);
        if (!content) {
          throw new Error(`missing file: ${path}`);
        }
        return content;
      },
      write: async (path: string, content: string) => {
        files.set(path, content);
      },
      remove: async (path: string) => {
        files.delete(path);
      },
    };
    const app = {
      vault: {
        adapter,
      },
    } as any;
    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();
    const selectedMarker = manager.getMarkers()[2]!;
    const dataManager = new DataManager(app, ".obsidian/plugins/obsidian-annotation-marker", manager);

    const created = await dataManager.addAnnotation("folder/note.md", {
      text: "selected",
      contextBefore: "",
      contextAfter: "",
      color: "yellow",
      markerId: selectedMarker.id,
      markerLabel: selectedMarker.name,
      note: "",
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 8,
      isValid: 1,
    });

    expect(created?.markerId).toBe(selectedMarker.id);
    expect(created?.markerLabel).toBe(selectedMarker.name);
  });

  it("keeps explicit marker fields when an annotation is switched to another marker", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
    };
    const files = new Map<string, string>();
    const adapter = {
      exists: async (path: string) => files.has(path),
      mkdir: async () => {},
      read: async (path: string) => {
        const content = files.get(path);
        if (!content) {
          throw new Error(`missing file: ${path}`);
        }
        return content;
      },
      write: async (path: string, content: string) => {
        files.set(path, content);
      },
      remove: async (path: string) => {
        files.delete(path);
      },
    };
    const app = {
      vault: {
        adapter,
      },
    } as any;
    const manager = new MarkerManager(settings, async () => {});
    await manager.ensureInitialized();
    const dataManager = new DataManager(app, ".obsidian/plugins/obsidian-annotation-marker", manager);
    const created = await dataManager.addAnnotation("folder/note.md", {
      text: "selected",
      contextBefore: "",
      contextAfter: "",
      color: "yellow",
      note: "",
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 8,
      isValid: 1,
    });
    const targetMarker = manager.getMarkers()[4]!;

    const updated = await dataManager.updateAnnotation("folder/note.md", created!.id, {
      markerId: targetMarker.id,
      markerLabel: targetMarker.name,
      color: "purple",
    });

    expect(updated?.markerId).toBe(targetMarker.id);
    expect(updated?.markerLabel).toBe(targetMarker.name);
  });
});
