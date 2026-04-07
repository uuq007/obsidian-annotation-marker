import { Plugin, TFile, Notice, MarkdownPostProcessorContext } from "obsidian";
import { AnnotationPluginSettings, DEFAULT_SETTINGS } from "./types";
import { DataManager } from "./dataManager";
import { AnnotationMode } from "./annotationMode";
import { MarkerManager } from "./markerManager";
import { buildMarkerCssRule } from "./markerPresentation";

export default class MarkdownAnnotationPlugin extends Plugin {
  settings: AnnotationPluginSettings;
  private dataManager: DataManager;
  private annotationMode: AnnotationMode;
  private markerManager: MarkerManager;
  private markerStyleEl: HTMLStyleElement | null = null;
  private fileRenameEventRef: any;
  private fileDeleteEventRef: any;
  private markdownPostProcessorRef: any;

  async onload(): Promise<void> {




    await this.loadSettings();
    this.markerManager = new MarkerManager(this.settings, async () => this.saveSettings());
    await this.markerManager.ensureInitialized();
    this.refreshMarkerStyles();


    const pluginDir = this.manifest.dir ?? ".obsidian/plugins/obsidian-annotation-marker";
    this.dataManager = new DataManager(this.app, pluginDir, this.markerManager);
    this.annotationMode = new AnnotationMode(this.app, this.dataManager, this);



    // 注册全局 Markdown 后处理器
    this.registerGlobalMarkdownPostProcessor();

    this.fileRenameEventRef = this.app.vault.on("rename", async (file, oldPath) => {

      if (file instanceof TFile && file.extension === "md") {
        const success = await this.dataManager.migrateAnnotation(oldPath, file.path);
        if (success) {

          new Notice(`标注数据已自动迁移`);
          await this.annotationMode.updateFilePaths(oldPath, file.path);
        } else {

        }
      }
    });

    this.fileDeleteEventRef = this.app.vault.on("delete", async (file) => {

      if (file instanceof TFile && file.extension === "md") {
        const success = await this.dataManager.deleteAnnotationData(file.path);
        if (success) {

          new Notice(`标注数据已自动删除`);
          this.annotationMode.deactivateForFile(file.path);
        } else {

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

  private registerGlobalMarkdownPostProcessor(): void {


    this.markdownPostProcessorRef = this.registerMarkdownPostProcessor(
      (element: HTMLElement, context: MarkdownPostProcessorContext) => {

        // 将元素处理路由到对应的 LeafAnnotationState
        this.annotationMode.processMarkdownElement(element, context);
      },
      -100
    );


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

    this.markerStyleEl?.remove();
    this.markerStyleEl = null;


  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshMarkerStyles();
  }

  private refreshMarkerStyles(): void {
    if (!this.markerStyleEl) {
      this.markerStyleEl = document.createElement("style");
      this.markerStyleEl.id = "annotation-marker-dynamic-styles";
      document.head.appendChild(this.markerStyleEl);
    }

    this.markerStyleEl.textContent = this.markerManager
      .getMarkers()
      .map((marker) => buildMarkerCssRule(marker))
      .join("\n");
  }
}
