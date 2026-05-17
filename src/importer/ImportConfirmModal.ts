import { App, Modal } from "obsidian";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { importOldAnnotations, type ImportResult } from "./oldAnnotationImporter";

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

    contentEl.createEl("h3", { text: "导入旧版标注数据" });

    const info = contentEl.createDiv({ cls: "annotation-import-info" });
    info.createEl("p", { text: `发现 ${this.scan.fileCount} 个标注文件` });
    info.createEl("p", { text: `共 ${this.scan.annotationCount} 条有效标注` });

    const warning = contentEl.createDiv({ cls: "annotation-import-warning" });
    warning.createEl("p", { text: "⚠ 导入不会删除原有数据" });
    warning.createEl("p", { text: "⚠ 重复标注将被自动跳过" });

    const buttons = contentEl.createDiv({ cls: "annotation-modal-buttons" });

    buttons.createEl("button", {
      text: "取消",
      cls: "annotation-btn annotation-btn-secondary",
    }).addEventListener("click", () => this.close());

    const confirmBtn = buttons.createEl("button", {
      text: "确认导入",
      cls: "annotation-btn annotation-btn-primary",
    });

    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "正在导入...";
      buttons.querySelector(".annotation-btn-secondary")?.setAttribute("disabled", "true");

      try {
        const result = await importOldAnnotations(this.app, this.fileManager, this.pluginDir);
        this.showResult(contentEl, result);
      } catch (e) {
        contentEl.empty();
        contentEl.addClass("annotation-import-modal");
        contentEl.createEl("h3", { text: "导入失败" });
        contentEl.createEl("p", { text: e instanceof Error ? e.message : String(e) });
        this.createCloseButton(contentEl);
      }
    });
  }

  private showResult(contentEl: HTMLElement, result: ImportResult): void {
    contentEl.empty();
    contentEl.addClass("annotation-import-modal");

    contentEl.createEl("h3", { text: "导入完成" });

    const stats = contentEl.createDiv({ cls: "annotation-import-stats" });
    stats.createEl("p", { text: `成功导入：${result.imported} 条` });
    if (result.skippedInvalid > 0) {
      stats.createEl("p", { text: `无效跳过：${result.skippedInvalid} 条` });
    }
    if (result.skippedNotFound > 0) {
      stats.createEl("p", { text: `文件不存在：${result.skippedNotFound} 条` });
    }
    if (result.failed > 0) {
      stats.createEl("p", { text: `匹配失败：${result.failed} 条` });
    }

    if (result.errors.length > 0) {
      const errorSection = contentEl.createDiv({ cls: "annotation-import-errors" });
      errorSection.createEl("p", { text: "错误详情：", cls: "annotation-import-error-title" });
      for (const err of result.errors.slice(0, 10)) {
        errorSection.createEl("p", { text: err });
      }
      if (result.errors.length > 10) {
        errorSection.createEl("p", { text: `...还有 ${result.errors.length - 10} 条错误` });
      }
    }

    this.createCloseButton(contentEl);
  }

  private createCloseButton(contentEl: HTMLElement): void {
    const buttons = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttons.createEl("button", {
      text: "确定",
      cls: "annotation-btn annotation-btn-primary",
    }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
