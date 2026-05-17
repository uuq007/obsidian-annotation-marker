import { App, normalizePath } from "obsidian";
import type { AnnotationColor, NewAnnotation } from "../types";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { insertAnnotation } from "../annotationFile/annotationSerializer";
import { buildCleanedMap } from "../utils/contentMapper";

// ── 旧版标注数据类型 ──

interface OldAnnotation {
  id: string;
  text: string;
  contextBefore: string;
  contextAfter: string;
  color: string;
  note: string;
  markerId?: string;
  markerLabel?: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  isValid: number;
  createdAt: string;
  updatedAt: string;
  rubyTexts?: Array<{ startIndex: number; length: number; ruby: string }>;
}

interface OldFileAnnotationData {
  filePath: string;
  annotations: OldAnnotation[];
  version?: number;
}

// ── 导入结果 ──

export interface ImportResult {
  totalFiles: number;
  totalAnnotations: number;
  imported: number;
  skippedInvalid: number;
  skippedNotFound: number;
  failed: number;
  errors: string[];
}

// ── 颜色映射 ──

const OLD_TO_NEW_COLOR: Record<string, AnnotationColor> = {
  "red": "1",
  "blue": "2",
  "yellow": "3",
  "green": "4",
  "purple": "5",
  "none": "none",
};

// ── 预扫描 ──

export async function preScanOldAnnotations(
  app: App,
  pluginDir: string
): Promise<{ fileCount: number; annotationCount: number }> {
  const annotationsDir = normalizePath(`${pluginDir}/annotations`);
  if (!(await app.vault.adapter.exists(annotationsDir))) {
    return { fileCount: 0, annotationCount: 0 };
  }

  const listed = await app.vault.adapter.list(annotationsDir);
  const jsonFiles = listed.files.filter((f) => f.endsWith(".json"));

  let annotationCount = 0;
  for (const file of jsonFiles) {
    try {
      const raw = await app.vault.adapter.read(file);
      const data: OldFileAnnotationData = JSON.parse(raw);
      if (data.annotations) {
        annotationCount += data.annotations.filter((a) => a.isValid === 1).length;
      }
    } catch {
      // 解析失败，跳过
    }
  }

  return { fileCount: jsonFiles.length, annotationCount };
}

// ── 执行导入 ──

export async function importOldAnnotations(
  app: App,
  fileManager: AnnotationFileManager,
  pluginDir: string
): Promise<ImportResult> {
  const result: ImportResult = {
    totalFiles: 0,
    totalAnnotations: 0,
    imported: 0,
    skippedInvalid: 0,
    skippedNotFound: 0,
    failed: 0,
    errors: [],
  };

  const annotationsDir = normalizePath(`${pluginDir}/annotations`);
  if (!(await app.vault.adapter.exists(annotationsDir))) {
    return result;
  }

  const listed = await app.vault.adapter.list(annotationsDir);
  const jsonFiles = listed.files.filter((f) => f.endsWith(".json"));
  result.totalFiles = jsonFiles.length;

  for (const jsonPath of jsonFiles) {
    try {
      const raw = await app.vault.adapter.read(jsonPath);
      const data: OldFileAnnotationData = JSON.parse(raw);
      if (!data.filePath || !Array.isArray(data.annotations)) {
        result.errors.push(`无效数据格式: ${jsonPath}`);
        continue;
      }

      const notePath = data.filePath;

      // 检查源文件是否存在
      const sourceFile = app.vault.getAbstractFileByPath(notePath);
      if (!sourceFile) {
        result.skippedNotFound += data.annotations.filter((a) => a.isValid === 1).length;
        result.totalAnnotations += data.annotations.length;
        continue;
      }

      // 确保标注文件存在
      const ensured = await fileManager.ensureAnnotationFile(notePath);
      if (!ensured) {
        result.errors.push(`无法创建标注文件: ${notePath}`);
        result.skippedNotFound += data.annotations.filter((a) => a.isValid === 1).length;
        result.totalAnnotations += data.annotations.length;
        continue;
      }

      // 读取标注文件内容（单次）
      let content = await fileManager.readAnnotationFile(notePath);

      for (const oldAnn of data.annotations) {
        result.totalAnnotations++;

        if (oldAnn.isValid !== 1) {
          result.skippedInvalid++;
          continue;
        }

        const color = OLD_TO_NEW_COLOR[oldAnn.color] ?? "none";

        // 先计算 occurrence（用于消歧）
        const occurrence = resolveOccurrence(
          content,
          oldAnn.text,
          oldAnn.contextBefore,
          oldAnn.startLine,
          oldAnn.endLine
        );

        const newAnnotation: NewAnnotation = {
          text: oldAnn.text,
          color,
          note: oldAnn.note || undefined,
          startLine: oldAnn.startLine,
          endLine: oldAnn.endLine,
          contextBefore: oldAnn.contextBefore,
          contextAfter: oldAnn.contextAfter,
          occurrence: occurrence ?? undefined,
        };

        // 如果有注音，转换格式
        if (oldAnn.rubyTexts && oldAnn.rubyTexts.length > 0) {
          newAnnotation.rubyTexts = oldAnn.rubyTexts;
        }

        const createdTimestamp = new Date(oldAnn.createdAt).getTime().toString();
        const importId = createdTimestamp + "-" + Math.random().toString(36).substring(2, 11);
        const insertResult = insertAnnotation(content, newAnnotation, importId);

        if (insertResult.content !== content) {
          content = insertResult.content;
          result.imported++;
        } else {
          // 文本未匹配，尝试无行号范围搜索
          const fallbackAnn: NewAnnotation = {
            text: oldAnn.text,
            color,
            note: oldAnn.note || undefined,
            contextBefore: oldAnn.contextBefore,
            contextAfter: oldAnn.contextAfter,
          };

          const fallbackResult = insertAnnotation(content, fallbackAnn, importId);
          if (fallbackResult.content !== content) {
            content = fallbackResult.content;
            result.imported++;
          } else {
            result.failed++;
          }
        }
      }

      // 单次写入最终内容
      await fileManager.writeAnnotationFile(notePath, content);
    } catch (e) {
      result.errors.push(`处理失败: ${jsonPath} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

// ── 消歧：确定 text 在 section 内的出现序号 ──

function resolveOccurrence(
  content: string,
  text: string,
  contextBefore: string,
  startLine: number,
  endLine: number
): number | null {
  if (!contextBefore) return null;

  // 截取 section 内容
  const lines = content.split("\n");
  const sLine = Math.max(0, startLine);
  const eLine = Math.min(lines.length - 1, endLine);
  const sectionContent = lines.slice(sLine, eLine + 1).join("\n");

  // 清理 markdown 语法，得到与 DOM 渲染一致的文本
  const map = buildCleanedMap(sectionContent);
  const cleaned = map.cleaned;

  // 找到 text 的所有出现位置
  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = cleaned.indexOf(text, searchFrom);
    if (idx < 0) break;
    occurrences.push(idx);
    searchFrom = idx + 1;
  }

  if (occurrences.length <= 1) return null;

  // 用 contextBefore 定位最近的匹配
  // contextBefore 的最后部分应该紧挨着 text，所以在 cleaned 中搜索 contextBefore 尾部
  const ctxTail = contextBefore.slice(-30);
  const ctxIdx = cleaned.lastIndexOf(ctxTail);
  if (ctxIdx < 0) return null;

  // 找到离 contextBefore 结束位置最近的 occurrence
  const ctxEnd = ctxIdx + ctxTail.length;
  let bestIdx = 0;
  let bestDist = Math.abs(occurrences[0]! - ctxEnd);
  for (let i = 1; i < occurrences.length; i++) {
    const dist = Math.abs(occurrences[i]! - ctxEnd);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}
