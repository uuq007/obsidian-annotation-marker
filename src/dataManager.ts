import { App, normalizePath, Notice } from "obsidian";
import { Annotation, FileAnnotationData } from "./types";
import { generateId } from "./utils/helpers";

const ANNOTATIONS_FOLDER = "annotations";

export class DataManager {
  private app: App;
  private pluginDir: string;
  private cache: Map<string, FileAnnotationData> = new Map();

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.pluginDir = pluginDir;
  }

  private getAnnotationsDir(): string {
    return normalizePath(`${this.pluginDir}/${ANNOTATIONS_FOLDER}`);
  }

  private getAnnotationFilePath(filePath: string): string {
    const pathWithoutExt = filePath.replace(/\.md$/i, '');
    const safeName = pathWithoutExt.replace(/[\\/:*?"<>|]/g, ".");
    return normalizePath(`${this.getAnnotationsDir()}/${safeName}.json`);
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
      const data = JSON.parse(content) as FileAnnotationData;

      data.annotations = this.migrateAnnotations(data.annotations);
      this.cache.set(filePath, data);
      return data;
    } catch (e) {
      console.error("加载标注数据失败:", e);
      return null;
    }
  }

  private migrateAnnotations(annotations: any[]): any[] {
    let migrated = false;
    const result = annotations.map((annotation) => {
      if (annotation.rubyText && !annotation.rubyTexts) {
        migrated = true;
        return {
          ...annotation,
          rubyTexts: [{
            startIndex: 0,
            length: annotation.text.length,
            ruby: annotation.rubyText
          }],
          rubyText: undefined
        };
      }
      return annotation;
    });

    if (migrated) {
      console.log("已迁移旧版本的注音数据到新格式");
    }

    return result;
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

    const existingIndex = data.annotations.findIndex(a => {
      const textMatch = a.text.trim().toLowerCase() === annotation.text.trim().toLowerCase();
      const positionMatch = Math.abs(a.positionPercent - annotation.positionPercent) < 5;
      return textMatch && positionMatch;
    });

    if (existingIndex !== -1) {
      const existing = data.annotations[existingIndex];
      if (existing && existing.id && existing.id.trim()) {
        await this.deleteAnnotation(filePath, existing.id);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      data = await this.loadAnnotations(filePath) || data;
    }

    const newAnnotation: Annotation = {
      id: generateId(),
      text: annotation.text,
      contextBefore: annotation.contextBefore,
      contextAfter: annotation.contextAfter,
      positionPercent: annotation.positionPercent,
      color: annotation.color,
      note: annotation.note,
      rubyTexts: annotation.rubyTexts,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    data.annotations.push(newAnnotation);
    await this.saveAnnotations(filePath, data);
    return newAnnotation;
  }

  async updateAnnotation(filePath: string, annotationId: string, updates: Partial<Omit<Annotation, "id" | "createdAt">>): Promise<Annotation | null> {
    const data = await this.loadAnnotations(filePath);
    if (!data) return null;

    const index = data.annotations.findIndex((a) => a.id === annotationId);
    if (index === -1) return null;

    const existing = data.annotations[index];
    if (!existing) return null;

    const updated: Annotation = {
      id: existing.id,
      text: existing.text,
      contextBefore: updates.contextBefore ?? existing.contextBefore,
      contextAfter: updates.contextAfter ?? existing.contextAfter,
      positionPercent: updates.positionPercent ?? existing.positionPercent,
      color: updates.color ?? existing.color,
      note: updates.note ?? existing.note,
      rubyTexts: updates.rubyTexts ?? existing.rubyTexts,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    data.annotations[index] = updated;

    await this.saveAnnotations(filePath, data);
    return updated;
  }

  async deleteAnnotation(filePath: string, annotationId: string): Promise<boolean> {
    const data = await this.loadAnnotations(filePath);
    if (!data) return false;

    const index = data.annotations.findIndex((a) => a.id === annotationId);
    if (index === -1) return false;

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

  clearCache(): void {
    this.cache.clear();
  }
}
