import { App, TFile, normalizePath } from "obsidian";
import type { NewAnnotation, ParsedAnnotation, AnnotationUpdates } from "../types";
import { notePathToAnnotationPath } from "../utils/helpers";
import { parseAnnotations, stripAnnotationTags } from "./annotationParser";
import { insertAnnotation, insertFullTextAnnotation, insertCrossBlockAnnotation, removeAnnotationTag, updateAnnotationTag } from "./annotationSerializer";

export class AnnotationFileManager {
  private app: App;
  private pluginDir: string;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.pluginDir = pluginDir;
  }

  // 获取标注文件路径
  getAnnotationFilePath(notePath: string): string {
    return notePathToAnnotationPath(this.pluginDir, notePath);
  }

  // 检查标注文件是否存在
  async hasAnnotationFile(notePath: string): Promise<boolean> {
    const path = normalizePath(this.getAnnotationFilePath(notePath));
    return this.app.vault.adapter.exists(path);
  }

  // 确保标注文件存在（不存在则从原文件复制创建）
  async ensureAnnotationFile(notePath: string): Promise<boolean> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));

    if (await this.app.vault.adapter.exists(annotationPath)) {
      await this.syncFromOriginal(notePath);
      return true;
    }

    // 读取原文件内容
    const originalFile = this.app.vault.getAbstractFileByPath(notePath);
    if (!(originalFile instanceof TFile)) return false;
    const content = await this.app.vault.read(originalFile);

    // 确保目录存在
    const dir = annotationPath.substring(0, annotationPath.lastIndexOf("/"));
    if (dir && !(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }

    await this.app.vault.adapter.write(annotationPath, content);
    return true;
  }

  // 读取标注文件内容
  async readAnnotationFile(notePath: string): Promise<string> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));
    return this.app.vault.adapter.read(annotationPath);
  }

  // 写入标注文件内容
  async writeAnnotationFile(notePath: string, content: string): Promise<void> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));
    await this.app.vault.adapter.write(annotationPath, content);
  }

  // 同步原文件更新到标注文件
  async syncFromOriginal(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;

    const originalContent = await this.app.vault.read(file);
    const annotatedContent = await this.readAnnotationFile(notePath);
    const strippedContent = stripAnnotationTags(annotatedContent);

    if (strippedContent === originalContent) return;

    const syncedContent = this.simpleSync(originalContent, annotatedContent, strippedContent);
    await this.writeAnnotationFile(notePath, syncedContent);
  }

  private simpleSync(
    originalContent: string,
    annotatedContent: string,
    strippedContent: string
  ): string {
    if (!originalContent || !annotatedContent) return originalContent;

    const segments = this.buildContentMap(annotatedContent);
    const stripped = segments.filter((s) => !s.isTag).map((s) => s.text).join("");

    if (stripped === originalContent) return annotatedContent;

    return annotatedContent;
  }

  private buildContentMap(content: string): Array<{ text: string; isTag: boolean; offset: number }> {
    const segments: Array<{ text: string; isTag: boolean; offset: number }> = [];
    const tagRegex = /<(?:mark|ruby|rt)\s+[^>]*data-annotation-id="[^"]*"[^>]*>|<\/(?:mark|ruby|rt)>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: content.substring(lastIndex, match.index), isTag: false, offset: lastIndex });
      }
      segments.push({ text: match[0], isTag: true, offset: match.index });
      lastIndex = tagRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      segments.push({ text: content.substring(lastIndex), isTag: false, offset: lastIndex });
    }

    return segments;
  }

  // 同步标注文件编辑回原文件
  async syncToOriginal(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;

    const annotatedContent = await this.readAnnotationFile(notePath);
    const pureContent = stripAnnotationTags(annotatedContent);

    const currentContent = await this.app.vault.read(file);
    if (currentContent !== pureContent) {
      await this.app.vault.modify(file, pureContent);
    }
  }

  // 文件重命名时迁移标注文件
  async migrateAnnotationFile(oldPath: string, newPath: string): Promise<void> {
    const oldAnnotationPath = normalizePath(this.getAnnotationFilePath(oldPath));
    if (!(await this.app.vault.adapter.exists(oldAnnotationPath))) return;

    const content = await this.app.vault.adapter.read(oldAnnotationPath);

    const newAnnotationPath = normalizePath(this.getAnnotationFilePath(newPath));
    const dir = newAnnotationPath.substring(0, newAnnotationPath.lastIndexOf("/"));
    if (dir && !(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }

    await this.app.vault.adapter.write(newAnnotationPath, content);
    await this.app.vault.adapter.remove(oldAnnotationPath);

    await this.cleanupEmptyDirs(oldAnnotationPath);
  }

  // 文件删除时清理标注文件
  async deleteAnnotationFile(notePath: string): Promise<void> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));
    if (await this.app.vault.adapter.exists(annotationPath)) {
      await this.app.vault.adapter.remove(annotationPath);
      await this.cleanupEmptyDirs(annotationPath);
    }
  }

  // 清理空的父目录
  private async cleanupEmptyDirs(filePath: string): Promise<void> {
    const annotationsDir = normalizePath(`${this.pluginDir}/annotations`);
    let dir = filePath.substring(0, filePath.lastIndexOf("/"));

    while (dir.length > annotationsDir.length) {
      if (!(await this.app.vault.adapter.exists(dir))) break;
      const listed = await this.app.vault.adapter.list(dir);
      if (listed.files.length > 0 || listed.folders.length > 0) break;
      await this.app.vault.adapter.rmdir(dir, false);
      dir = dir.substring(0, dir.lastIndexOf("/"));
    }
  }

  // 解析标注文件中的所有标注
  async getAnnotations(notePath: string): Promise<ParsedAnnotation[]> {
    const content = await this.readAnnotationFile(notePath);
    return parseAnnotations(content);
  }

  // 添加标注
  async addAnnotation(notePath: string, annotation: NewAnnotation): Promise<ParsedAnnotation> {
    const content = await this.readAnnotationFile(notePath);
    const { content: newContent, id } = insertAnnotation(content, annotation);
    await this.writeAnnotationFile(notePath, newContent);

    const result = parseAnnotations(newContent).find((a) => a.id === id);
    return result!;
  }

  // 添加全文标注（所有匹配位置共享同一 ID）
  async addFullTextAnnotation(notePath: string, annotation: NewAnnotation): Promise<ParsedAnnotation | null> {
    const content = await this.readAnnotationFile(notePath);
    const result = insertFullTextAnnotation(content, annotation);
    if (result.count === 0) return null;
    await this.writeAnnotationFile(notePath, result.content);

    const annotations = parseAnnotations(result.content);
    return annotations.find(a => a.id === result.id) ?? null;
  }

  // 添加跨段标注（多个文本块分别插入同 ID 的 <mark> 标签）
  async addCrossBlockAnnotation(notePath: string, annotation: NewAnnotation): Promise<ParsedAnnotation | null> {
    const content = await this.readAnnotationFile(notePath);
    const result = insertCrossBlockAnnotation(content, annotation);
    if (result.blockCount === 0) return null;
    await this.writeAnnotationFile(notePath, result.content);

    const annotations = parseAnnotations(result.content);
    return annotations.find(a => a.id === result.id) ?? null;
  }

  // 删除标注
  async removeAnnotation(notePath: string, annotationId: string): Promise<void> {
    const content = await this.readAnnotationFile(notePath);
    const newContent = removeAnnotationTag(content, annotationId);
    await this.writeAnnotationFile(notePath, newContent);
  }

  // 更新标注
  async updateAnnotation(
    notePath: string,
    annotationId: string,
    updates: AnnotationUpdates
  ): Promise<void> {
    const content = await this.readAnnotationFile(notePath);
    const newContent = updateAnnotationTag(content, annotationId, updates);
    await this.writeAnnotationFile(notePath, newContent);
  }
}
