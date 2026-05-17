import { PluginSettingTab, Setting } from "obsidian";
import type AnnotationPlugin from "../main";
import { COLOR_NUMBERS } from "../types";

export class AnnotationSettingTab extends PluginSettingTab {
  private plugin: AnnotationPlugin;

  constructor(plugin: AnnotationPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "标注插件设置" });

    // 默认颜色
    new Setting(containerEl)
      .setName("默认标注颜色")
      .setDesc("创建新标注时默认使用的颜色")
      .addDropdown((dd) => {
        for (const n of COLOR_NUMBERS) {
          dd.addOption(n, (this.plugin.settings as any)[`colorLabel${n}`] ?? `颜色${n}`);
        }
        dd.addOption("none", "无色");
        dd.setValue(this.plugin.settings.defaultColor);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultColor = v as any;
          await this.plugin.saveSettings();
        });
      });

    // 颜色自定义
    containerEl.createEl("h3", { text: "颜色自定义" });

    for (const n of COLOR_NUMBERS) {
      new Setting(containerEl)
        .setName((this.plugin.settings as any)[`colorLabel${n}`] ?? `颜色${n}`)
        .addColorPicker((cp) => {
          cp.setValue((this.plugin.settings as any)[`color${n}`]);
          cp.onChange(async (v) => {
            (this.plugin.settings as any)[`color${n}`] = v;
            this.plugin.updateDynamicStyles();
            await this.plugin.saveSettings();
          });
        })
        .addText((txt) => {
          txt.setPlaceholder("显示名")
            .setValue((this.plugin.settings as any)[`colorLabel${n}`])
            .onChange(async (v) => {
              (this.plugin.settings as any)[`colorLabel${n}`] = v || `颜色${n}`;
              await this.plugin.saveSettings();
              this.display();
            });
        });
    }

    // 批注效果
    containerEl.createEl("h3", { text: "批注样式" });

    new Setting(containerEl)
      .setName("批注效果")
      .setDesc("有批注内容的标注的显示效果")
      .addDropdown((dd) => {
        dd.addOption("none", "无");
        dd.addOption("underline-thick", "粗下划线");
        dd.addOption("underline-dashed", "虚线下划线");
        dd.addOption("underline-wavy", "波浪线");
        dd.addOption("underline-double", "双下划线");
        dd.setValue(this.plugin.settings.noteEffect);
        dd.onChange(async (v) => {
          this.plugin.settings.noteEffect = v as any;
          this.plugin.updateDynamicStyles();
          await this.plugin.saveSettings();
        });
      });

    // 批注最大长度
    new Setting(containerEl)
      .setName("批注最大长度")
      .setDesc("批注内容允许的最大字符数")
      .addText((txt) => {
        txt.setValue(String(this.plugin.settings.maxNoteLength));
        txt.onChange(async (v) => {
          const num = parseInt(v, 10);
          this.plugin.settings.maxNoteLength = isNaN(num) ? 500 : num;
          await this.plugin.saveSettings();
        });
      });

    // 注音样式
    containerEl.createEl("h3", { text: "注音样式" });

    new Setting(containerEl)
      .setName("注音字体大小")
      .setDesc("例如 0.7em、0.6em")
      .addText((txt) => {
        txt.setValue(this.plugin.settings.rubyFontSize);
        txt.onChange(async (v) => {
          this.plugin.settings.rubyFontSize = v || "0.7em";
          this.plugin.updateDynamicStyles();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("注音文字颜色")
      .addColorPicker((cp) => {
        cp.setValue(this.plugin.settings.rubyColor);
        cp.onChange(async (v) => {
          this.plugin.settings.rubyColor = v;
          this.plugin.updateDynamicStyles();
          await this.plugin.saveSettings();
        });
      });
  }
}
