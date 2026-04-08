import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, MarkdownPostProcessorContext, setIcon } from "obsidian";
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

  getDataManager(): DataManager {
    return this.dataManager;
  }
}

class AnnotationSettingTab extends PluginSettingTab {
  private plugin: MarkdownAnnotationPlugin;
  private editingMarkerIds = new Set<string>();
  private lastMovedMarkerId: string | null = null;
  private lastMoveDirection: "up" | "down" | null = null;
  private listEl: HTMLElement | null = null;
  private isShellReady = false;
  private rowElements = new Map<string, HTMLElement>();
  private rowSignatures = new Map<string, string>();

  constructor(app: App, plugin: MarkdownAnnotationPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    void this.renderDisplay(false);
  }

  private async renderDisplay(refreshListOnly: boolean): Promise<void> {
    const { containerEl } = this;
    const scrollHost = this.getScrollHost();
    const previousScrollTop = scrollHost?.scrollTop ?? 0;
    if (!refreshListOnly || !this.isShellReady || !this.listEl) {
      containerEl.empty();
      containerEl.addClass("annotation-settings-root");

      containerEl.createEl("h2", { text: "标注设置" });
      containerEl.createEl("h3", { text: "记号管理" });

      new Setting(containerEl)
        .setName("新增记号")
        .setDesc("插入一条带默认值的可编辑记号。")
        .addButton((button) =>
          button.setButtonText("新增").onClick(async () => {
            await this.plugin.getMarkerManager().createMarker();
            await this.refreshMarkerList();
          })
        );

      this.listEl = containerEl.createDiv({ cls: "annotation-marker-settings-list" });
      this.isShellReady = true;
    }

    if (!this.listEl) {
      return;
    }

    const usageCounts = await this.plugin.getDataManager().getMarkerUsageCounts();
    const rows = buildMarkerSettingsRows(this.plugin.getMarkerManager().getMarkers());
    const nextIds = new Set(rows.map((row) => row.marker.id));

    for (const [markerId, element] of this.rowElements) {
      if (!nextIds.has(markerId)) {
        element.remove();
        this.rowElements.delete(markerId);
        this.rowSignatures.delete(markerId);
      }
    }

    rows.forEach((row, index) => {
      const usageCount = usageCounts.get(row.marker.id) ?? 0;
      const signature = this.buildRowSignature(row, usageCount);
      let element = this.rowElements.get(row.marker.id);

      if (!element || this.rowSignatures.get(row.marker.id) !== signature) {
        const nextElement = this.renderRow(row, usageCount);
        nextElement.dataset.markerId = row.marker.id;
        if (element) {
          element.replaceWith(nextElement);
        }
        element = nextElement;
        this.rowElements.set(row.marker.id, element);
        this.rowSignatures.set(row.marker.id, signature);
      }

      const currentChild = this.listEl!.children[index];
      if (currentChild !== element) {
        this.listEl!.insertBefore(element, currentChild ?? null);
      }
    });

    // Only let the move hint animation apply to the render immediately following the move.
    this.lastMovedMarkerId = null;
    this.lastMoveDirection = null;

    if (scrollHost) {
      requestAnimationFrame(() => {
        scrollHost.scrollTop = previousScrollTop;
      });
    }
  }

  private async refreshMarkerList(): Promise<void> {
    await this.renderDisplay(true);
  }

  private getScrollHost(): HTMLElement | null {
    return (
      (this.containerEl.closest(".vertical-tab-content-container") as HTMLElement | null) ??
      this.containerEl
    );
  }

  private buildRowSignature(row: ReturnType<typeof buildMarkerSettingsRows>[number], usageCount: number): string {
    const isEditing = this.editingMarkerIds.has(row.marker.id) && !row.readOnly;
    const moveStateClass =
      this.lastMovedMarkerId === row.marker.id && this.lastMoveDirection
        ? ` is-just-moved-${this.lastMoveDirection}`
        : "";
    return JSON.stringify({
      id: row.marker.id,
      name: row.marker.name,
      preset: row.marker.preset,
      color: row.marker.color,
      readOnly: row.readOnly,
      canMoveUp: row.canMoveUp,
      canMoveDown: row.canMoveDown,
      canDelete: row.canDelete,
      usageCount,
      isEditing,
      moveStateClass,
    });
  }

  private renderRow(row: ReturnType<typeof buildMarkerSettingsRows>[number], usageCount: number): HTMLElement {
    const isEditing = this.editingMarkerIds.has(row.marker.id) && !row.readOnly;
    const moveStateClass =
      this.lastMovedMarkerId === row.marker.id && this.lastMoveDirection
        ? ` is-just-moved-${this.lastMoveDirection}`
        : "";
    const item = document.createElement("div");
    item.className = `annotation-marker-settings-item${row.readOnly ? " is-deleted" : ""}${isEditing ? " is-editing" : ""}${moveStateClass}`;

    const preview = item.createDiv({ cls: "annotation-marker-settings-preview" });
    preview.style.setProperty("--marker-preview-color", row.marker.color);
    preview.createSpan({
      cls: `annotation-marker-preview-chip marker-preset-${row.marker.preset}`,
      text: "Aa",
    });

    const fields = item.createDiv({ cls: "annotation-marker-settings-fields" });
    const usageMeta = fields.createDiv({ cls: "annotation-marker-settings-usage" });
    usageMeta.createSpan({
      cls: `annotation-marker-settings-usage-badge${usageCount > 0 ? " is-used" : " is-unused"}`,
      text: `${usageCount} 处记号`,
    });
    const rowMain = fields.createDiv({ cls: "annotation-marker-settings-main-row" });
    const rowControls = rowMain.createDiv({ cls: "annotation-marker-settings-inline-row" });

    const nameField = rowControls.createDiv({ cls: "annotation-marker-settings-inline-field is-name" });
    nameField.createEl("label", { text: "名称", cls: "annotation-marker-settings-inline-label" });
    const nameInput = nameField.createEl("input", { type: "text" });
    nameInput.value = row.marker.name;
    nameInput.disabled = row.readOnly || !isEditing;
    nameInput.addEventListener("change", async () => {
      await this.plugin.getMarkerManager().updateMarker(row.marker.id, { name: nameInput.value || "新记号" });
    });

    const presetField = rowControls.createDiv({ cls: "annotation-marker-settings-inline-field is-preset" });
    presetField.createEl("label", { text: "样式", cls: "annotation-marker-settings-inline-label" });
    const presetSelect = presetField.createEl("select");
    (Object.keys(MARKER_PRESET_LABELS) as MarkerPreset[]).forEach((preset) => {
      presetSelect.createEl("option", { value: preset, text: MARKER_PRESET_LABELS[preset] });
    });
    presetSelect.value = row.marker.preset;
    presetSelect.disabled = row.readOnly || !isEditing;
    presetSelect.addEventListener("change", async () => {
      await this.plugin.getMarkerManager().updateMarker(row.marker.id, { preset: presetSelect.value as MarkerPreset });
      await this.refreshMarkerList();
    });

    const colorField = rowControls.createDiv({ cls: "annotation-marker-settings-inline-field is-color" });
    colorField.createEl("label", { text: "颜色", cls: "annotation-marker-settings-inline-label" });
    const colorInput = colorField.createEl("input", { type: "color" });
    colorInput.value = row.marker.color;
    colorInput.disabled = row.readOnly || !isEditing;
    colorInput.addEventListener("change", async () => {
      await this.plugin.getMarkerManager().updateMarker(row.marker.id, { color: colorInput.value });
      preview.style.setProperty("--marker-preview-color", colorInput.value);
    });

    const actions = rowMain.createDiv({ cls: "annotation-marker-settings-actions" });

    if (row.readOnly) {
      item.createDiv({ cls: "annotation-marker-settings-status", text: "已禁用" });
      const restore = this.createIconButton(actions, "undo-2", "恢复记号", ["mod-cta"]);
      restore.addEventListener("click", async () => {
        await this.plugin.getMarkerManager().restoreMarker(row.marker.id);
        await this.refreshMarkerList();
      });
      return item;
    }

    const edit = this.createIconButton(actions, isEditing ? "check" : "pencil", isEditing ? "完成编辑" : "编辑记号", [
      "annotation-marker-settings-action",
      isEditing ? "is-active" : "",
    ]);
    edit.addEventListener("click", () => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      if (isEditing) {
        this.editingMarkerIds.delete(row.marker.id);
      } else {
        this.editingMarkerIds.add(row.marker.id);
      }
      void this.refreshMarkerList();
    });

    const moveUp = this.createIconButton(actions, "arrow-up", "上移", ["annotation-marker-settings-action"]);
    moveUp.disabled = !row.canMoveUp;
    moveUp.addEventListener("click", async () => {
      this.lastMovedMarkerId = row.marker.id;
      this.lastMoveDirection = "up";
      await this.plugin.getMarkerManager().moveMarker(row.marker.id, "up");
      await this.refreshMarkerList();
    });

    const moveDown = this.createIconButton(actions, "arrow-down", "下移", ["annotation-marker-settings-action"]);
    moveDown.disabled = !row.canMoveDown;
    moveDown.addEventListener("click", async () => {
      this.lastMovedMarkerId = row.marker.id;
      this.lastMoveDirection = "down";
      await this.plugin.getMarkerManager().moveMarker(row.marker.id, "down");
      await this.refreshMarkerList();
    });

    const canHardDelete = row.canDelete && usageCount === 0;
    const remove = this.createIconButton(
      actions,
      canHardDelete ? "trash-2" : "ban",
      canHardDelete ? "删除" : "禁用",
      [
        "annotation-marker-settings-action",
        canHardDelete ? "mod-warning" : "is-disabled-state",
      ]
    );
      remove.addEventListener("click", async () => {
      this.editingMarkerIds.delete(row.marker.id);
      if (canHardDelete) {
        await this.plugin.getMarkerManager().deleteMarker(row.marker.id);
      } else {
        await this.plugin.getMarkerManager().softDeleteMarker(row.marker.id);
      }
      await this.refreshMarkerList();
    });

    return item;
  }

  private createIconButton(container: HTMLElement, icon: string, title: string, classes: string[] = []): HTMLButtonElement {
    const button = container.createEl("button", {
      cls: classes.filter(Boolean).join(" "),
      attr: { type: "button", "aria-label": title },
    });
    setIcon(button, icon);
    return button;
  }
}
