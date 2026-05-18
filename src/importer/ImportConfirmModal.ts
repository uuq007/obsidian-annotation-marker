import { App, Modal } from "obsidian";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { importOldAnnotations, type ImportResult } from "./oldAnnotationImporter";
import { t } from "../i18n";

type ScanResult = { fileCount: number; annotationCount: number };

export class ImportConfirmModal extends Modal {
  private fileManager: AnnotationFileManager;
  private pluginDir: string;
  private scan: ScanResult;

  constructor(
    app: App,
    fileManager: AnnotationFileManager,
    pluginDir: string,
    scan: ScanResult
  ) {
    super(app);
    this.fileManager = fileManager;
    this.pluginDir = pluginDir;
    this.scan = scan;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("annotation-import-modal");
    const loc = t();

    contentEl.createEl("h3", { text: loc.importTitle });

    const info = contentEl.createDiv({ cls: "annotation-import-info" });
    info.createEl("p", { text: loc.importScanFiles(this.scan.fileCount) });
    info.createEl("p", { text: loc.importScanAnnotations(this.scan.annotationCount) });

    const warning = contentEl.createDiv({ cls: "annotation-import-warning" });
    warning.createEl("p", { text: loc.importWarningNoDelete });
    warning.createEl("p", { text: loc.importWarningSkipDup });

    const buttons = contentEl.createDiv({ cls: "annotation-modal-buttons" });

    buttons.createEl("button", {
      text: loc.cancel,
      cls: "annotation-btn annotation-btn-secondary",
    }).addEventListener("click", () => this.close());

    const confirmBtn = buttons.createEl("button", {
      text: loc.importConfirm,
      cls: "annotation-btn annotation-btn-primary",
    });

    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = loc.importImporting;
      buttons.querySelector(".annotation-btn-secondary")?.setAttribute("disabled", "true");

      try {
        const result = await importOldAnnotations(this.app, this.fileManager, this.pluginDir);
        this.showResult(contentEl, result);
      } catch (e) {
        contentEl.empty();
        contentEl.addClass("annotation-import-modal");
        contentEl.createEl("h3", { text: loc.importFailed });
        contentEl.createEl("p", { text: e instanceof Error ? e.message : String(e) });
        this.createCloseButton(contentEl);
      }
    });
  }

  private showResult(contentEl: HTMLElement, result: ImportResult): void {
    contentEl.empty();
    contentEl.addClass("annotation-import-modal");
    const loc = t();

    contentEl.createEl("h3", { text: loc.importComplete });

    const stats = contentEl.createDiv({ cls: "annotation-import-stats" });
    stats.createEl("p", { text: loc.importResultImported(result.imported) });
    if (result.skippedInvalid > 0) {
      stats.createEl("p", { text: loc.importResultSkippedInvalid(result.skippedInvalid) });
    }
    if (result.skippedNotFound > 0) {
      stats.createEl("p", { text: loc.importResultSkippedNotFound(result.skippedNotFound) });
    }
    if (result.failed > 0) {
      stats.createEl("p", { text: loc.importResultFailed(result.failed) });
    }

    if (result.errors.length > 0) {
      const errorSection = contentEl.createDiv({ cls: "annotation-import-errors" });
      errorSection.createEl("p", { text: loc.importErrorDetails, cls: "annotation-import-error-title" });
      for (const err of result.errors.slice(0, 10)) {
        errorSection.createEl("p", { text: err });
      }
      if (result.errors.length > 10) {
        errorSection.createEl("p", { text: loc.importMoreErrors(result.errors.length - 10) });
      }
    }

    this.createCloseButton(contentEl);
  }

  private createCloseButton(contentEl: HTMLElement): void {
    const buttons = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttons.createEl("button", {
      text: t().importOk,
      cls: "annotation-btn annotation-btn-primary",
    }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
