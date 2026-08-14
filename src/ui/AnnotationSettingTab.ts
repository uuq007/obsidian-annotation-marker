import { PluginSettingTab, Setting, requireApiVersion, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
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

  // 1.13+ 声明式设置定义：供新版设置界面渲染与设置搜索索引；
  // 每次打开设置都会重新调用，颜色相关的动态项（激活颜色、下拉选项）在此实时构建。
  // 1.13 之前的版本不调用此方法，回退到下方的 display()。
  getSettingDefinitions(): SettingDefinitionItem[] {
    const loc = t();
    const s = this.plugin.settings;

    // 默认颜色下拉选项：仅激活颜色 + 无色（与 renderDefaultColorSetting 一致）
    const defaultColorOptions: Record<string, string> = {};
    for (const n of getActiveColorNumbers(s)) {
      defaultColorOptions[n] = this.getColorLabel(n);
    }
    defaultColorOptions["none"] = loc.none;

    // 颜色自定义区：每色一行（色盘/显示名/删除图标同行），用 render 保持与 display() 相同的行布局
    const colorItems: SettingGroupItem[] = getActiveColorNumbers(s).map((n) => ({
      name: this.getColorLabel(n),
      aliases: [loc.settingsColorCustom],
      render: (colorSetting: Setting) => this.setupColorRow(colorSetting, n),
    }));
    if (s.activeColors.length < MAX_COLOR_COUNT) {
      colorItems.push({
        name: loc.settingsAddColor,
        render: (btnRow: Setting) => {
          btnRow.addButton((btn) => {
            btn.setIcon("lucide-plus")
              .setTooltip(loc.settingsAddColor)
              .onClick(() => void this.addColor());
          });
        },
      });
    }

    return [
      {
        type: "group",
        heading: loc.settingsTitle,
        items: [
          {
            name: loc.settingsDefaultColor,
            desc: loc.settingsDefaultColorDesc,
            control: { type: "dropdown", key: "defaultColor", options: defaultColorOptions, defaultValue: "3" },
          },
        ],
      },
      { type: "group", heading: loc.settingsColorCustom, items: colorItems },
      {
        type: "group",
        heading: loc.settingsNoteStyle,
        items: [
          {
            name: loc.settingsNoteEffect,
            desc: loc.settingsNoteEffectDesc,
            control: {
              type: "dropdown",
              key: "noteEffect",
              options: {
                none: loc.none,
                "underline-thick": loc.settingsNoteEffectThick,
                "underline-dashed": loc.settingsNoteEffectDashed,
                "underline-wavy": loc.settingsNoteEffectWavy,
                "underline-double": loc.settingsNoteEffectDouble,
              },
              defaultValue: "none",
            },
          },
          {
            name: loc.settingsMaxNoteLength,
            desc: loc.settingsMaxNoteLengthDesc,
            control: { type: "number", key: "maxNoteLength", defaultValue: 500 },
          },
        ],
      },
      {
        type: "group",
        heading: loc.settingsRubyStyle,
        items: [
          {
            name: loc.settingsRubyFontSize,
            desc: loc.settingsRubyFontSizeDesc,
            control: { type: "text", key: "rubyFontSize", placeholder: "0.7em", defaultValue: "0.7em" },
          },
          { name: loc.settingsRubyColor, control: { type: "color", key: "rubyColor" } },
        ],
      },
      {
        type: "group",
        heading: loc.settingsAnnotationMode,
        items: [
          {
            name: loc.settingsDefaultViewMode,
            desc: loc.settingsDefaultViewModeDesc,
            control: {
              type: "dropdown",
              key: "defaultViewMode",
              options: {
                preview: loc.settingsViewModePreview,
                source: loc.settingsViewModeSource,
              },
              defaultValue: "preview",
            },
          },
          {
            name: loc.settingsAutoOpenAnnotation,
            desc: loc.settingsAutoOpenAnnotationDesc,
            control: { type: "toggle", key: "autoOpenAnnotation" },
          },
        ],
      },
      {
        type: "group",
        heading: loc.settingsExportFolder,
        items: [
          {
            name: loc.settingsExportFolder,
            desc: loc.settingsExportFolderDesc,
            control: { type: "text", key: "exportFolder", placeholder: loc.settingsExportFolder },
          },
        ],
      },
    ];
  }

  // 声明式设置的写入回调：基类默认实现只写 plugin.settings 并持久化，
  // 这里补充动态样式注入与颜色命令的联动刷新
  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = value;

    if (key.startsWith("color") || key === "rubyFontSize" || key === "rubyColor" || key === "noteEffect") {
      this.plugin.updateDynamicStyles();
    }
    if (key.startsWith("colorLabel")) {
      // 显示名变化需同步颜色命令
      this.plugin.refreshAnnotateColorCommands();
    }
    await this.plugin.saveSettings();
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

  // 颜色自定义区（display() 回退模式）：复用 setupColorRow 逐行构建
  private renderColorCustomSection(): void {
    this.colorCustomEl.empty();
    const loc = t();
    const activeNumbers = getActiveColorNumbers(this.plugin.settings);

    for (const n of activeNumbers) {
      this.setupColorRow(new Setting(this.colorCustomEl), n);
    }

    if (activeNumbers.length < MAX_COLOR_COUNT) {
      new Setting(this.colorCustomEl).addButton((btn) => {
        btn.setButtonText(loc.settingsAddColor)
          .setIcon("lucide-plus")
          .onClick(() => void this.addColor());
      });
    }
  }

  // 在一行 Setting 上构建单个颜色的编辑控件：色盘 + 显示名输入框 + 删除/对齐占位图标（同一行）。
  // 声明式模式（render 回调）与 display() 回退模式共用此构建逻辑
  private setupColorRow(colorSetting: Setting, n: string): void {
    const loc = t();
    const colorSettings = this.getColorSettings();

    colorSetting.setName(this.getColorLabel(n))
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
            // 局部更新该项名称，替代整页重渲
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

  // 保存 + 注入变量 + 同步颜色命令 + 刷新两个颜色区
  private async saveAndRefresh(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.updateDynamicStyles();
    this.plugin.refreshAnnotateColorCommands();
    if (this.defaultColorEl) {
      // display() 回退模式（1.13 前）：局部重渲两个颜色区
      this.renderDefaultColorSetting();
      this.renderColorCustomSection();
    } else if (requireApiVersion("1.13.0")) {
      // 声明式模式（1.13+）：重建设置定义并刷新渲染与搜索索引
      this.update();
    }
  }
}
