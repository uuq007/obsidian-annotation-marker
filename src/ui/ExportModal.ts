import { App, FuzzySuggestModal, Modal, normalizePath, TFolder } from "obsidian";
import { t } from "../i18n";

// 文件夹选择对话框
export class FolderSuggestModal extends FuzzySuggestModal<string> {
  private onSelect: (folderPath: string) => void;

  constructor(app: App, onSelect: (folderPath: string) => void) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder(t().exportFolderPlaceholder);
    this.setTitle(t().exportFolderSuggestTitle);
  }

  getItems(): string[] {
    const folderSet = new Set<string>();
    folderSet.add("/");
    for (const file of this.app.vault.getFiles()) {
      let current: TFolder | null = file.parent;
      while (current) {
        folderSet.add(current.path);
        current = current.parent;
      }
    }
    return Array.from(folderSet).sort();
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string, _evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(item);
  }

  onOpen(): void {
    super.onOpen();
    // 支持输入新文件夹路径
    this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Enter") {
        const query = this.inputEl.value.trim();
        if (!query) return;

        const items = this.getItems();
        if (items.some((f) => f === query)) return;

        evt.preventDefault();
        evt.stopPropagation();
        this.close();
        this.onSelect(normalizePath(query));
      }
    });
  }
}

// 覆盖确认对话框
export class ConfirmOverwriteModal extends Modal {
  private message: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const loc = t();
    this.contentEl.createDiv({
      text: this.message,
      attr: { style: "margin-bottom: 16px; white-space: pre-line;" },
    });

    const btnContainer = this.contentEl.createDiv({
      attr: { style: "display: flex; justify-content: flex-end; gap: 8px;" },
    });

    btnContainer.createEl("button", { text: loc.cancel }).addEventListener("click", () => this.close());
    btnContainer.createEl("button", {
      text: loc.exportConfirmOverwrite,
      cls: "mod-cta",
    }).addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// 不合法文件名字符
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

// 文件名输入对话框
export class FileNameModal extends Modal {
  private onConfirm: (fileName: string) => void;
  private noteName: string;

  constructor(app: App, noteName: string, onConfirm: (fileName: string) => void) {
    super(app);
    this.noteName = noteName;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const loc = t();
    this.titleEl.setText(loc.exportFileNameTitle);

    const input = this.contentEl.createEl("input", {
      type: "text",
      placeholder: loc.exportFileNamePlaceholder,
    });
    input.style.width = "100%";
    input.style.marginBottom = "4px";
    input.style.padding = "6px 8px";

    const errorEl = this.contentEl.createDiv({
      cls: "export-filename-error",
      attr: { style: "color: var(--text-error); font-size: 12px; min-height: 18px; margin-bottom: 8px;" },
    });

    const validate = (): boolean => {
      const name = input.value.trim();
      if (!name) {
        errorEl.setText("");
        return false;
      }
      if (INVALID_FILENAME_CHARS.test(name)) {
        errorEl.setText(loc.exportFileNameInvalid);
        return false;
      }
      errorEl.setText("");
      return true;
    };

    input.addEventListener("input", () => validate());

    const btnContainer = this.contentEl.createDiv({
      cls: "modal-button-container",
      attr: { style: "display: flex; justify-content: flex-end; gap: 8px;" },
    });

    const autoBtn = btnContainer.createEl("button", { text: loc.exportAutoName });
    autoBtn.addEventListener("click", () => {
      const autoName = `【导出标注】${this.noteName}`;
      input.value = autoName;
      validate();
      input.focus();
    });

    const spacer = btnContainer.createEl("div", { attr: { style: "flex: 1;" } });

    const cancelBtn = btnContainer.createEl("button", { text: loc.cancel });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = btnContainer.createEl("button", {
      text: loc.save,
      cls: "mod-cta",
    });

    const submit = () => {
      const name = input.value.trim();
      if (!name || !validate()) return;
      const fileName = name.endsWith(".md") ? name : name + ".md";
      this.close();
      this.onConfirm(fileName);
    };

    confirmBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
    });

    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
