import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
} from "obsidian";
import { AnnotationFileManager } from "./annotationFile/AnnotationFileManager";
import { DEFAULT_SETTINGS, type AnnotationPluginSettings } from "./types";

export default class AnnotationPlugin extends Plugin {
  settings: AnnotationPluginSettings;
  fileManager: AnnotationFileManager;

  // 原始文件路径 → 标注文件路径的映射
  activeAnnotationSessions: Map<string, string> = new Map();

  async onload() {
    await this.loadSettings();

    const pluginDir = this.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
    this.fileManager = new AnnotationFileManager(this.app, pluginDir);

    this.registerEvents();
    this.registerCommands();
    this.registerCacheListeners();

    this.addRibbonIcon("lucide-highlighter", "标注模式", () => {
      this.toggleAnnotationView();
    });
  }

  onunload() {
    // 清理所有假文件和元数据缓存
    for (const [, annotationPath] of this.activeAnnotationSessions) {
      this.removeFakeTFile(annotationPath);
      this.removeMetadataCache(annotationPath);
    }
    this.activeAnnotationSessions.clear();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // 构造假 TFile 并注入 vault 的 fileMap
  private createFakeTFile(path: string): TFile {
    const vault = this.app.vault;
    const anyFile = vault.getFiles()[0];
    if (!anyFile) throw new Error("Vault is empty");

    const TFileConstructor = Object.getPrototypeOf(anyFile).constructor;
    const fakeFile = new TFileConstructor(vault, path);

    // 不能标记为 deleted，否则视图拒绝打开
    (fakeFile as any).deleted = false;

    // 注入 vault 的文件字典，让 getAbstractFileByPath 能找到它
    (vault as any).fileMap[path] = fakeFile;

    return fakeFile;
  }

  // 从 vault.fileMap 中移除假文件
  private removeFakeTFile(path: string) {
    delete (this.app.vault as any).fileMap[path];
  }

  // 为标注文件注入原笔记的元数据缓存，使内部链接和大纲视图正常工作
  private injectMetadataCache(annotationPath: string, originalPath: string, fakeTFile: TFile) {
    const cacheInternal = this.app.metadataCache as any;

    // 从原笔记路径获取已有的 CachedMetadata，注入到标注文件路径
    const originalCache = cacheInternal.metadataCache[originalPath];
    if (originalCache) {
      cacheInternal.metadataCache[annotationPath] = originalCache;
    }

    // 同时注入 fileCache 条目（hash/mtime/size）
    const originalFileCache = cacheInternal.fileCache[originalPath];
    if (originalFileCache) {
      cacheInternal.fileCache[annotationPath] = originalFileCache;
    }

    // 触发 changed 事件，让大纲视图等原生插件同步
    if (originalCache) {
      this.app.metadataCache.trigger("changed", fakeTFile, "", originalCache);
    }
  }

  // 清理标注文件的元数据缓存
  private removeMetadataCache(annotationPath: string) {
    const cacheInternal = this.app.metadataCache as any;
    delete cacheInternal.metadataCache[annotationPath];
    delete cacheInternal.fileCache[annotationPath];
  }

  // 注册元数据缓存相关的全局事件监听
  private registerCacheListeners() {
    // 编辑时重新注入缓存
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const filePath = (info as any).file?.path;
        if (!filePath) return;
        const originalPath = this.getOriginalPathByAnnotationPath(filePath);
        if (originalPath) {
          this.injectMetadataCache(filePath, originalPath, (info as any).file);
        }
      })
    );

    // 标签页关闭时清理假文件和缓存
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        for (const [originalPath, annotationPath] of this.activeAnnotationSessions) {
          let isStillOpen = false;
          this.app.workspace.iterateAllLeaves((l) => {
            if ((l.view as any)?.file?.path === annotationPath) {
              isStillOpen = true;
            }
          });

          if (!isStillOpen) {
            this.removeFakeTFile(annotationPath);
            this.removeMetadataCache(annotationPath);
            this.activeAnnotationSessions.delete(originalPath);
          }
        }
      })
    );
  }

  // 根据标注文件路径查找原始文件路径
  private getOriginalPathByAnnotationPath(annotationPath: string): string | null {
    for (const [originalPath, aPath] of this.activeAnnotationSessions) {
      if (aPath === annotationPath) return originalPath;
    }
    return null;
  }

  // 切换标注视图
  async toggleAnnotationView() {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;

    const currentFile = (leaf.view as any)?.file;
    if (!currentFile) {
      new Notice("请先打开一个 Markdown 文件");
      return;
    }

    // 检查当前是否在标注视图中
    const originalPath = this.getOriginalPathByAnnotationPath(currentFile.path);
    if (originalPath) {
      // 当前在标注视图 → 切回原文件
      await this.closeAnnotationView(leaf, originalPath);
    } else if (currentFile.extension === "md") {
      // 当前在普通视图 → 打开标注视图
      await this.openAnnotationView(leaf, currentFile.path);
    }
  }

  // 打开标注视图
  async openAnnotationView(leaf: any, notePath: string) {
    // 确保标注文件存在
    const ok = await this.fileManager.ensureAnnotationFile(notePath);
    if (!ok) {
      new Notice("标注文件创建失败");
      return;
    }

    const annotationPath = normalizePath(this.fileManager.getAnnotationFilePath(notePath));
    console.log("[标注] annotationPath:", annotationPath);

    // 构造假 TFile 并用原生 MarkdownView 打开
    const fakeTFile = this.createFakeTFile(annotationPath);
    console.log("[标注] fakeTFile:", fakeTFile.path, "basename:", fakeTFile.basename, "ext:", fakeTFile.extension, "deleted:", (fakeTFile as any).deleted);

    // 记录会话
    this.activeAnnotationSessions.set(notePath, annotationPath);

    try {
      // 注入原笔记的元数据缓存，使内部链接跳转和大纲视图正常工作
      this.injectMetadataCache(annotationPath, notePath, fakeTFile);

      await leaf.openFile(fakeTFile, { state: { mode: "preview" } });
      console.log("[标注] openFile 完成, 当前 view:", (leaf.view as any)?.constructor?.name);
    } catch (e) {
      console.error("[标注] openFile 失败:", e);
      new Notice("打开标注文件失败: " + e);
    }
  }

  // 关闭标注视图，切回原文件
  async closeAnnotationView(leaf: any, originalPath: string) {
    const annotationPath = this.activeAnnotationSessions.get(originalPath);

    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
    if (!(originalFile instanceof TFile)) {
      new Notice("原始文件不存在");
      if (annotationPath) {
        this.removeFakeTFile(annotationPath);
        this.removeMetadataCache(annotationPath);
      }
      this.activeAnnotationSessions.delete(originalPath);
      return;
    }

    await leaf.openFile(originalFile);

    // 清理假文件和元数据缓存
    if (annotationPath) {
      this.removeFakeTFile(annotationPath);
      this.removeMetadataCache(annotationPath);
    }
    this.activeAnnotationSessions.delete(originalPath);
  }

  // 注册事件
  registerEvents() {
    // 文件重命名时迁移标注文件
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          try {
            await this.fileManager.migrateAnnotationFile(oldPath, file.path);
          } catch (e) {
            console.error("迁移标注文件失败:", e);
          }
        }
      })
    );

    // 文件删除时清理标注文件
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFile && file.extension === "md") {
          try {
            await this.fileManager.deleteAnnotationFile(file.path);
          } catch (e) {
            console.error("删除标注文件失败:", e);
          }
        }
      })
    );
  }

  // 注册命令
  registerCommands() {
    this.addCommand({
      id: "toggle-annotation-view",
      name: "切换标注视图",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        const file = (leaf.view as any)?.file;
        if (!file || file.extension !== "md") return false;

        if (!checking) {
          this.toggleAnnotationView();
        }
        return true;
      },
    });
  }
}
