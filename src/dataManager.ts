import { App, normalizePath, Notice } from "obsidian";
import { Annotation, FileAnnotationData } from "./types";
import { generateId } from "./utils/helpers";
import { MarkerManager } from "./markerManager";

const ANNOTATIONS_FOLDER = "annotations";

export class DataManager {
  private app: App;
  private pluginDir: string;
  private markerManager: MarkerManager;
  private cache: Map<string, FileAnnotationData> = new Map();

  constructor(app: App, pluginDir: string, markerManager: MarkerManager) {
    this.app = app;
    this.pluginDir = pluginDir;
    this.markerManager = markerManager;
  }

  private getAnnotationsDir(): string {
    return normalizePath(`${this.pluginDir}/${ANNOTATIONS_FOLDER}`);
  }

  private getAnnotationFilePath(filePath: string): string {
    const pathWithoutExt = filePath.replace(/\.md$/i, '');
    const safeName = pathWithoutExt.replace(/[\\/:*?"<>|]/g, ".");
    return normalizePath(`${this.getAnnotationsDir()}/${safeName}.json`);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async ensureAnnotationsDir(): Promise<void> {
    const dir = this.getAnnotationsDir();
    const exists = await this.app.vault.adapter.exists(dir);
    if (!exists) {
      await this.app.vault.adapter.mkdir(dir);
    }
  }

  async loadAnnotations(filePath: string): Promise<FileAnnotationData | null> {


    if (this.cache.has(filePath)) {

      return this.cache.get(filePath) ?? null;
    }

    const annotationFilePath = this.getAnnotationFilePath(filePath);


    const exists = await this.app.vault.adapter.exists(annotationFilePath);

    if (!exists) {

      return null;
    }

    try {
      const content = await this.app.vault.adapter.read(annotationFilePath);


      const parsed = JSON.parse(content) as FileAnnotationData;
      const { data, changed } = this.normalizeAnnotationData(parsed, filePath);
      this.cache.set(filePath, data);

      if (changed) {
        await this.saveAnnotations(filePath, data);
      }

      return data;
    } catch (e) {
      console.error('[❌ DataManager] 加载标注数据失败:', e);
      return null;
    }
  }



  async saveAnnotations(filePath: string, data: FileAnnotationData): Promise<void> {



    await this.ensureAnnotationsDir();
    const annotationFilePath = this.getAnnotationFilePath(filePath);
    const content = JSON.stringify(data, null, 2);




    await this.app.vault.adapter.write(annotationFilePath, content);
    this.cache.set(filePath, data);

  }

  async migrateAnnotation(oldPath: string, newPath: string): Promise<boolean> {
    const oldAnnotationPath = this.getAnnotationFilePath(oldPath);
    const newAnnotationPath = this.getAnnotationFilePath(newPath);

    if (oldAnnotationPath === newAnnotationPath) {
      return false;
    }

    const oldExists = await this.app.vault.adapter.exists(oldAnnotationPath);
    if (!oldExists) {
      return false;
    }

    try {
      const content = await this.app.vault.adapter.read(oldAnnotationPath);
      const data = JSON.parse(content) as FileAnnotationData;
      data.filePath = newPath;
      await this.saveAnnotations(newPath, data);
      await this.app.vault.adapter.remove(oldAnnotationPath);
      this.cache.delete(oldPath);
      return true;
    } catch (e) {
      console.error("迁移标注数据失败:", e);
      return false;
    }
  }

  async deleteAnnotationData(filePath: string): Promise<boolean> {
    const annotationFilePath = this.getAnnotationFilePath(filePath);

    const exists = await this.app.vault.adapter.exists(annotationFilePath);
    if (!exists) {
      return false;
    }

    try {
      await this.app.vault.adapter.remove(annotationFilePath);
      this.cache.delete(filePath);
      return true;
    } catch (e) {
      console.error("删除标注数据失败:", e);
      return false;
    }
  }

  async addAnnotation(filePath: string, annotation: Omit<Annotation, "id" | "createdAt" | "updatedAt">): Promise<Annotation | null> {



    let data = await this.loadAnnotations(filePath);

    if (!data) {

      data = {
        filePath,
        annotations: [],
      };
    }

    const draftAnnotation: Annotation = {
      id: generateId(),
      text: annotation.text,
      contextBefore: annotation.contextBefore,
      contextAfter: annotation.contextAfter,
      color: annotation.color,
      markerId: annotation.markerId,
      markerLabel: annotation.markerLabel,
      note: annotation.note,
      rubyTexts: annotation.rubyTexts,
      originalRubies: annotation.originalRubies,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startLine: annotation.startLine,
      endLine: annotation.endLine,
      startOffset: annotation.startOffset,
      endOffset: annotation.endOffset,
      isValid: annotation.isValid,
    };
    const { annotation: newAnnotation } = this.markerManager.normalizeAnnotation(draftAnnotation);



    data.annotations.push(newAnnotation);
    await this.saveAnnotations(filePath, data);

    return newAnnotation;
  }

  async updateAnnotation(filePath: string, annotationId: string, updates: Partial<Omit<Annotation, "id" | "createdAt">>): Promise<Annotation | null> {



    const data = await this.loadAnnotations(filePath);
    if (!data) {

      return null;
    }

    const index = data.annotations.findIndex((a) => a.id === annotationId);
    if (index === -1) {

      return null;
    }

    const existing = data.annotations[index];
    if (!existing) return null;



    const shouldRemapMarkerFromColor =
      updates.color !== undefined &&
      updates.markerId === undefined &&
      updates.markerLabel === undefined;

    const draftUpdated: Annotation = {
      id: existing.id,
      text: updates.text ?? existing.text,
      contextBefore: updates.contextBefore ?? existing.contextBefore,
      contextAfter: updates.contextAfter ?? existing.contextAfter,
      color: updates.color ?? existing.color,
      markerId: shouldRemapMarkerFromColor ? undefined : (updates.markerId ?? existing.markerId),
      markerLabel: shouldRemapMarkerFromColor ? undefined : (updates.markerLabel ?? existing.markerLabel),
      note: updates.note ?? existing.note,
      rubyTexts: updates.rubyTexts ?? existing.rubyTexts,
      originalRubies: updates.originalRubies ?? existing.originalRubies,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      startLine: updates.startLine ?? existing.startLine,
      endLine: updates.endLine ?? existing.endLine,
      startOffset: updates.startOffset ?? existing.startOffset,
      endOffset: updates.endOffset ?? existing.endOffset,
      isValid: updates.isValid ?? existing.isValid,
    };
    const { annotation: updated } = this.markerManager.normalizeAnnotation(draftUpdated);



    data.annotations[index] = updated;

    await this.saveAnnotations(filePath, data);

    return updated;
  }

  async deleteAnnotation(filePath: string, annotationId: string): Promise<boolean> {


    const data = await this.loadAnnotations(filePath);
    if (!data) {

      return false;
    }

    const index = data.annotations.findIndex((a) => a.id === annotationId);
    if (index === -1) {

      return false;
    }


    data.annotations.splice(index, 1);
    await this.saveAnnotations(filePath, data);

    return true;
  }

  private hasDuplicateText(annotations: Annotation[], text: string, contextBefore: string, contextAfter: string): boolean {
    const normalizedText = text.trim().toLowerCase();
    return annotations.some(
      (a) =>
        a.text.trim().toLowerCase() === normalizedText &&
        a.contextBefore === contextBefore &&
        a.contextAfter === contextAfter
    );
  }

  private normalizeAnnotationData(data: FileAnnotationData, filePath: string): { data: FileAnnotationData; changed: boolean } {
    let changed = data.filePath !== filePath;
    const annotations = data.annotations.map((annotation) => {
      const normalized = this.markerManager.normalizeAnnotation(annotation);
      if (normalized.changed) {
        changed = true;
      }
      return normalized.annotation;
    });

    return {
      changed,
      data: {
        filePath,
        annotations,
      },
    };
  }
}
