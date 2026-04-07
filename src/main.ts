import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, MarkdownPostProcessorContext } from "obsidian";
import { AnnotationPluginSettings, DEFAULT_SETTINGS, MARKER_PRESET_LABELS, MarkerPreset } from "./types";
import { DataManager } from "./dataManager";
import { AnnotationMode } from "./annotationMode";
import { MarkerManager } from "./markerManager";
import { buildMarkerCssRule } from "./markerPresentation";
import { buildMarkerSettingsRows } from "./markerSettingsState";

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
    this.addSettingTab(new AnnotationSettingTab(this.app, this));



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

  getMarkerManager(): MarkerManager {
    return this.markerManager;
  }
}

class AnnotationSettingTab extends PluginSettingTab {
  private plugin: MarkdownAnnotationPlugin;

  constructor(app: App, plugin: MarkdownAnnotationPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "标注设置" });
    containerEl.createEl("h3", { text: "记号管理" });

    new Setting(containerEl)
      .setName("新增记号")
      .setDesc("插入一条带默认值的可编辑记号。")
      .addButton((button) =>
        button.setButtonText("新增").onClick(async () => {
          await this.plugin.getMarkerManager().createMarker();
          this.display();
        })
      );

    const list = containerEl.createDiv({ cls: "annotation-marker-settings-list" });
    const rows = buildMarkerSettingsRows(this.plugin.getMarkerManager().getMarkers());
    rows.forEach((row) => {
      this.renderRow(list, row);
    });
  }

  private renderRow(container: HTMLElement, row: ReturnType<typeof buildMarkerSettingsRows>[number]): void {
    const item = container.createDiv({
      cls: `annotation-marker-settings-item${row.readOnly ? " is-deleted" : ""}`,
    });

    const preview = item.createDiv({ cls: "annotation-marker-settings-preview" });
    preview.style.setProperty("--marker-preview-color", row.marker.color);
    preview.createSpan({ cls: `annotation-marker-preview-chip marker-preset-${row.marker.preset}` });

    const fields = item.createDiv({ cls: "annotation-marker-settings-fields" });

    new Setting(fields)
      .setName("名称")
      .addText((text) => {
        text.setValue(row.marker.name);
        text.setDisabled(row.readOnly);
        text.onChange(async (value) => {
          await this.plugin.getMarkerManager().updateMarker(row.marker.id, { name: value || "新记号" });
        });
      });

    new Setting(fields)
      .setName("记号样式")
      .addDropdown((dropdown) => {
        (Object.keys(MARKER_PRESET_LABELS) as MarkerPreset[]).forEach((preset) => {
          dropdown.addOption(preset, MARKER_PRESET_LABELS[preset]);
        });
        dropdown.setValue(row.marker.preset);
        dropdown.setDisabled(row.readOnly);
        dropdown.onChange(async (value: MarkerPreset) => {
          await this.plugin.getMarkerManager().updateMarker(row.marker.id, { preset: value });
          this.display();
        });
      });

    new Setting(fields)
      .setName("颜色")
      .addColorPicker((picker) => {
        picker.setValue(row.marker.color);
        picker.setDisabled(row.readOnly);
        picker.onChange(async (value) => {
          await this.plugin.getMarkerManager().updateMarker(row.marker.id, { color: value });
          preview.style.setProperty("--marker-preview-color", value);
        });
      });

    const actions = item.createDiv({ cls: "annotation-marker-settings-actions" });

    if (row.readOnly) {
      item.createDiv({ cls: "annotation-marker-settings-status", text: "已删除，当前不可编辑" });
      const restore = actions.createEl("button", { text: "恢复", cls: "mod-cta" });
      restore.addEventListener("click", async () => {
        await this.plugin.getMarkerManager().restoreMarker(row.marker.id);
        this.display();
      });
      return;
    }

    const moveUp = actions.createEl("button", { text: "上移", cls: "mod-cta" });
    moveUp.disabled = !row.canMoveUp;
    moveUp.addEventListener("click", async () => {
      await this.plugin.getMarkerManager().moveMarker(row.marker.id, "up");
      this.display();
    });

    const moveDown = actions.createEl("button", { text: "下移" });
    moveDown.disabled = !row.canMoveDown;
    moveDown.addEventListener("click", async () => {
      await this.plugin.getMarkerManager().moveMarker(row.marker.id, "down");
      this.display();
    });

    const remove = actions.createEl("button", { text: "删除", cls: "mod-warning" });
    remove.disabled = !row.canDelete;
    remove.addEventListener("click", async () => {
      await this.plugin.getMarkerManager().softDeleteMarker(row.marker.id);
      this.display();
    });
  }
}
