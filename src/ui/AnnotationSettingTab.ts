import { PluginSettingTab, Setting } from "obsidian";
import type AnnotationPlugin from "../main";
import { COLOR_NUMBERS, type AnnotationColor, type NoteEffect } from "../types";
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

    // 颜色字段以动态键访问（color1~5 / colorLabel1~5），用 Record 收窄避免 any
    const colorSettings = this.plugin.settings as unknown as Record<string, unknown>;
    const getColor = (n: string): string =>
      typeof colorSettings[`color${n}`] === "string" ? (colorSettings[`color${n}`] as string) : "";
    const getColorLabel = (n: string): string =>
      typeof colorSettings[`colorLabel${n}`] === "string"
        ? (colorSettings[`colorLabel${n}`] as string)
        : loc.colorLabel(n);

    new Setting(containerEl).setName(loc.settingsTitle).setHeading();

    new Setting(containerEl)
      .setName(loc.settingsDefaultColor)
      .setDesc(loc.settingsDefaultColorDesc)
      .addDropdown((dd) => {
        for (const n of COLOR_NUMBERS) {
          dd.addOption(n, getColorLabel(n));
        }
        dd.addOption("none", loc.none);
        dd.setValue(this.plugin.settings.defaultColor);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultColor = v as AnnotationColor;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(loc.settingsColorCustom).setHeading();

    for (const n of COLOR_NUMBERS) {
      new Setting(containerEl)
        .setName(getColorLabel(n))
        .addColorPicker((cp) => {
          cp.setValue(getColor(n));
          cp.onChange(async (v) => {
            colorSettings[`color${n}`] = v;
            this.plugin.updateDynamicStyles();
            await this.plugin.saveSettings();
          });
        })
        .addText((txt) => {
          txt.setPlaceholder(loc.settingsColorPlaceholder)
            .setValue(getColorLabel(n))
            .onChange(async (v) => {
              colorSettings[`colorLabel${n}`] = v || loc.colorLabel(n);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    }

    new Setting(containerEl).setName(loc.settingsNoteStyle).setHeading();

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
          this.plugin.settings.noteEffect = v as NoteEffect;
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

    new Setting(containerEl).setName(loc.settingsRubyStyle).setHeading();

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

    new Setting(containerEl).setName(loc.settingsAnnotationMode).setHeading();

    new Setting(containerEl)
      .setName(loc.settingsDefaultViewMode)
      .setDesc(loc.settingsDefaultViewModeDesc)
      .addDropdown((dd) => {
        dd.addOption("preview", loc.settingsViewModePreview);
        dd.addOption("source", loc.settingsViewModeSource);
        dd.setValue(this.plugin.settings.defaultViewMode);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultViewMode = v as "preview" | "source";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(loc.settingsAutoOpenAnnotation)
      .setDesc(loc.settingsAutoOpenAnnotationDesc)
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoOpenAnnotation);
        toggle.onChange(async (v) => {
          this.plugin.settings.autoOpenAnnotation = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(loc.settingsExportFolder).setHeading();

    new Setting(containerEl)
      .setName(loc.settingsExportFolder)
      .setDesc(loc.settingsExportFolderDesc)
      .addText((txt) => {
        txt.setPlaceholder(loc.settingsExportFolder)
          .setValue(this.plugin.settings.exportFolder)
          .onChange(async (v) => {
            this.plugin.settings.exportFolder = v;
            await this.plugin.saveSettings();
          });
      });
  }
}
