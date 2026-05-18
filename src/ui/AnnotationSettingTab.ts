import { PluginSettingTab, Setting } from "obsidian";
import type AnnotationPlugin from "../main";
import { COLOR_NUMBERS } from "../types";
import { t } from "../i18n";

export class AnnotationSettingTab extends PluginSettingTab {
  private plugin: AnnotationPlugin;

  constructor(plugin: AnnotationPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const loc = t();

    containerEl.createEl("h2", { text: loc.settingsTitle });

    new Setting(containerEl)
      .setName(loc.settingsDefaultColor)
      .setDesc(loc.settingsDefaultColorDesc)
      .addDropdown((dd) => {
        for (const n of COLOR_NUMBERS) {
          dd.addOption(n, (this.plugin.settings as any)[`colorLabel${n}`] ?? loc.colorLabel(n));
        }
        dd.addOption("none", loc.none);
        dd.setValue(this.plugin.settings.defaultColor);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultColor = v as any;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: loc.settingsColorCustom });

    for (const n of COLOR_NUMBERS) {
      new Setting(containerEl)
        .setName((this.plugin.settings as any)[`colorLabel${n}`] ?? loc.colorLabel(n))
        .addColorPicker((cp) => {
          cp.setValue((this.plugin.settings as any)[`color${n}`]);
          cp.onChange(async (v) => {
            (this.plugin.settings as any)[`color${n}`] = v;
            this.plugin.updateDynamicStyles();
            await this.plugin.saveSettings();
          });
        })
        .addText((txt) => {
          txt.setPlaceholder(loc.settingsColorPlaceholder)
            .setValue((this.plugin.settings as any)[`colorLabel${n}`])
            .onChange(async (v) => {
              (this.plugin.settings as any)[`colorLabel${n}`] = v || loc.colorLabel(n);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    }

    containerEl.createEl("h3", { text: loc.settingsNoteStyle });

    new Setting(containerEl)
      .setName(loc.settingsNoteEffect)
      .setDesc(loc.settingsNoteEffectDesc)
      .addDropdown((dd) => {
        dd.addOption("none", loc.none);
        dd.addOption("underline-thick", loc.settingsNoteEffectThick);
        dd.addOption("underline-dashed", loc.settingsNoteEffectDashed);
        dd.addOption("underline-wavy", loc.settingsNoteEffectWavy);
        dd.addOption("underline-double", loc.settingsNoteEffectDouble);
        dd.setValue(this.plugin.settings.noteEffect);
        dd.onChange(async (v) => {
          this.plugin.settings.noteEffect = v as any;
          this.plugin.updateDynamicStyles();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(loc.settingsMaxNoteLength)
      .setDesc(loc.settingsMaxNoteLengthDesc)
      .addText((txt) => {
        txt.setValue(String(this.plugin.settings.maxNoteLength));
        txt.onChange(async (v) => {
          const num = parseInt(v, 10);
          this.plugin.settings.maxNoteLength = isNaN(num) ? 500 : num;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: loc.settingsRubyStyle });

    new Setting(containerEl)
      .setName(loc.settingsRubyFontSize)
      .setDesc(loc.settingsRubyFontSizeDesc)
      .addText((txt) => {
        txt.setValue(this.plugin.settings.rubyFontSize);
        txt.onChange(async (v) => {
          this.plugin.settings.rubyFontSize = v || "0.7em";
          this.plugin.updateDynamicStyles();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(loc.settingsRubyColor)
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
