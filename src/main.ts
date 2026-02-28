import { Plugin, TFile, Notice } from "obsidian";
import { AnnotationPluginSettings, DEFAULT_SETTINGS } from "./types";
import { DataManager } from "./dataManager";
import { AnnotationMode } from "./annotationMode";

export default class MarkdownAnnotationPlugin extends Plugin {
  settings: AnnotationPluginSettings;
  private dataManager: DataManager;
  private annotationMode: AnnotationMode;
  private fileRenameEventRef: any;
  private fileDeleteEventRef: any;

  async onload(): Promise<void> {
    await this.loadSettings();

    const pluginDir = this.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
    this.dataManager = new DataManager(this.app, pluginDir);
    this.annotationMode = new AnnotationMode(this.app, this.dataManager);

    this.fileRenameEventRef = this.app.vault.on("rename", async (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") {
        const success = await this.dataManager.migrateAnnotation(oldPath, file.path);
        if (success) {
          new Notice(`标注数据已自动迁移`);
          await this.annotationMode.updateFilePaths(oldPath, file.path);
        }
      }
    });

    this.fileDeleteEventRef = this.app.vault.on("delete", async (file) => {
      if (file instanceof TFile && file.extension === "md") {
        const success = await this.dataManager.deleteAnnotationData(file.path);
        if (success) {
          new Notice(`标注数据已自动删除`);
          this.annotationMode.deactivateForFile(file.path);
        }
      }
    });

    this.addRibbonIcon("highlighter", "标注模式", async () => {
      const file = this.app.workspace.getActiveFile();
      this.annotationMode.toggle(file);
    });

    this.addCommand({
      id: "toggle-annotation-mode",
      name: "切换标注模式",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            this.annotationMode.toggle(file);
          }
          return true;
        }
        return false;
      },
    });
  }

  onunload(): void {
    this.annotationMode.deactivate();
    this.dataManager.clearCache();

    if (this.fileRenameEventRef) {
      this.app.vault.offref(this.fileRenameEventRef);
    }

    if (this.fileDeleteEventRef) {
      this.app.vault.offref(this.fileDeleteEventRef);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
