import { PluginSettingTab, Setting } from "obsidian";
import type AnnotationPlugin from "../main";
import { COLOR_NUMBERS, type AnnotationColor, type NoteEffect } from "../types";
import { getActiveColorNumbers, MAX_COLOR_COUNT } from "../constants";
import { t } from "../i18n";

export class AnnotationSettingTab extends PluginSettingTab {
  private plugin: AnnotationPlugin;
  private defaultColorEl!: HTMLElement;
  private colorCustomEl!: HTMLElement;

  constructor(plugin: AnnotationPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  // 颜色字段以动态键访问（color1~10 / colorLabel1~10），用 Record 收窄避免 any
  private getColorSettings(): Record<string, unknown> {
    return this.plugin.settings as unknown as Record<string, unknown>;
  }

  private getColor(n: string): string {
    const colorSettings = this.getColorSettings();
    return typeof colorSettings[`color${n}`] === "string" ? (colorSettings[`color${n}`] as string) : "";
  }

  private getColorLabel(n: string): string {
    const colorSettings = this.getColorSettings();
    return typeof colorSettings[`colorLabel${n}`] === "string"
      ? (colorSettings[`colorLabel${n}`] as string)
      : t().colorLabel(n);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const loc = t();

    new Setting(containerEl).setName(loc.settingsTitle).setHeading();

    // 默认颜色与颜色自定义区需要随颜色数量增减局部重渲，抽成独立容器
    this.defaultColorEl = containerEl.createDiv();
    this.renderDefaultColorSetting();

    new Setting(containerEl).setName(loc.settingsColorCustom).setHeading();

    this.colorCustomEl = containerEl.createDiv();
    this.renderColorCustomSection();

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

  // 默认颜色下拉（仅列出激活颜色）
  private renderDefaultColorSetting(): void {
    this.defaultColorEl.empty();
    const loc = t();

    new Setting(this.defaultColorEl)
      .setName(loc.settingsDefaultColor)
      .setDesc(loc.settingsDefaultColorDesc)
      .addDropdown((dd) => {
        for (const n of getActiveColorNumbers(this.plugin.settings)) {
          dd.addOption(n, this.getColorLabel(n));
        }
        dd.addOption("none", loc.none);
        dd.setValue(this.plugin.settings.defaultColor);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultColor = v as AnnotationColor;
          await this.plugin.saveSettings();
        });
      });
  }

  // 颜色自定义区：原生 Setting 布局（左侧名称 + 右侧色盘/显示名输入框）。
  // 颜色 1~5 渲染与删除按钮等宽的隐形占位，保证 1~10 的色盘竖向对齐
  private renderColorCustomSection(): void {
    this.colorCustomEl.empty();
    const loc = t();
    const colorSettings = this.getColorSettings();
    const activeNumbers = getActiveColorNumbers(this.plugin.settings);

    for (const n of activeNumbers) {
      const colorSetting = new Setting(this.colorCustomEl)
        .setName(this.getColorLabel(n))
        .addColorPicker((cp) => {
          cp.setValue(this.getColor(n));
          cp.onChange(async (v) => {
            colorSettings[`color${n}`] = v;
            this.plugin.updateDynamicStyles();
            await this.plugin.saveSettings();
          });
        })
        .addText((txt) => {
          txt.setPlaceholder(loc.settingsColorPlaceholder)
            .setValue(this.getColorLabel(n))
            .onChange(async (v) => {
              colorSettings[`colorLabel${n}`] = v || loc.colorLabel(n);
              await this.plugin.saveSettings();
              // 同步更新颜色命令的显示名
              this.plugin.refreshAnnotateColorCommands();
              // 局部更新该项名称，替代整页重渲（避免使用已废弃的 display()）
              colorSetting.setName(v || loc.colorLabel(n));
            });
        });

      if (Number(n) > 5) {
        // 原有 5 色不可删，新增色（序号 > 5）可删除
        colorSetting.addExtraButton((btn) => {
          btn.setIcon("lucide-trash-2")
            .setTooltip(loc.settingsRemoveColor)
            .onClick(() => void this.removeColor(n));
        });
      } else {
        // 等宽隐形占位：与删除按钮同尺寸但不可见，保证各行色盘竖向对齐
        colorSetting.addExtraButton((btn) => {
          btn.setIcon("lucide-trash-2");
          btn.extraSettingsEl.setCssStyles({ visibility: "hidden" });
        });
      }
    }

    if (activeNumbers.length < MAX_COLOR_COUNT) {
      new Setting(this.colorCustomEl).addButton((btn) => {
        btn.setButtonText(loc.settingsAddColor)
          .setIcon("lucide-plus")
          .onClick(() => void this.addColor());
      });
    }
  }

  // 新增颜色：激活第一个未使用的序号（色值/显示名用该序号现有值，删除后加回即恢复）
  private async addColor(): Promise<void> {
    const s = this.plugin.settings;
    const slot = COLOR_NUMBERS.find((n) => !s.activeColors.includes(n));
    if (!slot) return;
    s.activeColors = [...s.activeColors, slot];
    await this.saveAndRefresh();
  }

  // 删除颜色：仅停用（从激活列表移除），色值/显示名字段保留，
  // 已用该色的存量标注引用的 CSS 变量仍由 updateDynamicStyles 全量注入，显示不受影响
  private async removeColor(n: string): Promise<void> {
    const s = this.plugin.settings;
    const idx = Number(n);
    // 前 5 色为不可删除的基础色
    if (idx <= 5 || !s.activeColors.includes(n)) return;
    s.activeColors = s.activeColors.filter((c) => c !== n);
    if (s.defaultColor === n) s.defaultColor = "3";
    await this.saveAndRefresh();
  }

  // 保存 + 注入变量 + 同步颜色命令 + 局部重渲两个颜色区
  private async saveAndRefresh(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.updateDynamicStyles();
    this.plugin.refreshAnnotateColorCommands();
    this.renderDefaultColorSetting();
    this.renderColorCustomSection();
  }
}
