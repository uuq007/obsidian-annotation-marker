import { zhCN } from "./zh";
import { en } from "./en";

export interface LocaleDict {
  // 通用
  save: string;
  cancel: string;
  copy: string;
  copied: string;
  delete: string;
  edit: string;
  open: string;
  close: string;
  add: string;
  all: string;
  none: string;
  noData: string;
  noRuby: string;
  noNote: string;
  noteContent: string;

  // main.ts — 功能区 & 命令
  ribbonTooltip: string;
  commandToggleView: string;
  commandSidebar: string;
  commandImport: string;

  // main.ts — Notice
  noticeNoFile: string;
  noticeFileCreateFailed: string;
  noticeOpenFailed: string;
  noticeOriginalMissing: string;
  noticeNoCrossCallout: string;
  noticeNoLegacyData: string;

  // 设置
  settingsTitle: string;
  settingsDefaultColor: string;
  settingsDefaultColorDesc: string;
  settingsColorCustom: string;
  settingsColorPlaceholder: string;
  settingsNoteStyle: string;
  settingsNoteEffect: string;
  settingsNoteEffectDesc: string;
  settingsNoteEffectThick: string;
  settingsNoteEffectDashed: string;
  settingsNoteEffectWavy: string;
  settingsNoteEffectDouble: string;
  settingsMaxNoteLength: string;
  settingsMaxNoteLengthDesc: string;
  settingsRubyStyle: string;
  settingsRubyFontSize: string;
  settingsRubyFontSizeDesc: string;
  settingsRubyColor: string;
  settingsAnnotationMode: string;
  settingsDefaultViewMode: string;
  settingsDefaultViewModeDesc: string;
  settingsViewModePreview: string;
  settingsViewModeSource: string;
  settingsAutoOpenAnnotation: string;
  settingsAutoOpenAnnotationDesc: string;

  // 选择菜单 (SelectionMenu)
  menuAddAnnotation: string;
  menuSelectColor: string;
  menuOrAddNote: string;
  menuFullText: string;
  menuRuby: string;
  menuRubySelectText: string;
  menuRubyContent: string;
  menuRubyPlaceholder: string;
  menuRubyAdded: string;
  noticeCopied: string;
  noticeRubySelect: string;
  noticeRubyInput: string;
  noticeRubySelectAndInput: string;
  noticeAnnotationAdded: string;
  noticeAnnotationAndNoteAdded: string;
  noticeTextNotFound: string;
  noticeAddFailed: string;
  noticePartialWikiLink: string;

  // 编辑批注模态框 (EditNoteModal)
  modalEditNote: string;
  modalAddNote: string;
  modalAnnotationText: string;
  modalAnnotationColor: string;
  modalNoteLabel: (n: number) => string;
  modalNotePlaceholder: string;

  // 标注详情菜单 (AnnotationMenu)
  menuAnnotationDetail: string;
  menuEditNote: string;
  menuCopyOriginal: string;
  noticeColorChanged: string;
  noticeOriginalCopied: string;
  noticeNoteUpdated: string;
  noticeDeleted: string;

  // 标注列表面板 (AnnotationListPanel)
  panelTitle: string;
  panelSortContentAsc: string;
  panelSortContentDesc: string;
  panelSortTimeAsc: string;
  panelSortTimeDesc: string;
  panelSortColorAsc: string;
  panelSortColorDesc: string;
  panelDeleteAnnotation: string;
  panelViewAnnotation: string;

  // 侧边栏 (AnnotationSidebarView)
  sidebarTitle: string;
  sidebarCurrentNote: string;
  sidebarAllNotes: string;
  sidebarSearchPlaceholder: string;
  sidebarSortContent: string;
  sidebarSortContentDesc: string;
  sidebarSortTimeAsc: string;
  sidebarSortTimeDesc: string;
  sidebarSortColor: string;
  sidebarSortColorDesc: string;
  sidebarSortByNote: string;
  sidebarLoadFailed: string;
  sidebarNoMatch: string;
  sidebarNoAnnotations: string;
  sidebarDetailTitle: string;
  sidebarAnnotationText: string;
  sidebarAnnotationColor: string;
  sidebarNoteSection: string;
  sidebarNoteEditPlaceholder: string;
  sidebarNoteCopy: string;
  sidebarNoteCopied: string;
  sidebarNoteCopyRestore: string;
  sidebarNoteEmpty: string;
  sidebarRubySection: string;
  sidebarOpenNote: string;
  sidebarDeleteAnnotation: string;
  noticeAnnotationUpdated: string;
  noticeNoteFileNotFound: string;

  // 标注卡片 (AnnotationCard)
  cardOpen: string;
  cardDelete: string;

  // 提示框 (TooltipManager)
  tooltipLabel: string;

  // 导入 (ImportConfirmModal)
  importTitle: string;
  importScanFiles: (n: number) => string;
  importScanAnnotations: (n: number) => string;
  importWarningNoDelete: string;
  importWarningSkipDup: string;
  importConfirm: string;
  importImporting: string;
  importFailed: string;
  importComplete: string;
  importResultImported: (n: number) => string;
  importResultSkippedInvalid: (n: number) => string;
  importResultSkippedNotFound: (n: number) => string;
  importResultFailed: (n: number) => string;
  importErrorDetails: string;
  importMoreErrors: (n: number) => string;
  importOk: string;

  // 导出
  commandExport: string;
  sidebarExportBtn: string;
  exportModalTitle: string;
  exportModalPlaceholder: string;
  noticeExportSuccess: (n: number) => string;
  noticeExportFailed: string;
  noticeExportNoFile: string;
  exportConfirmOverwrite: string;
  exportConfirmOverwriteDesc: string;
  exportFolderPlaceholder: string;
  exportFolderSuggestTitle: string;
  exportFileNameTitle: string;
  exportFileNamePlaceholder: string;
  exportFileNameInvalid: string;
  exportAutoName: string;
  settingsExportFolder: string;
  settingsExportFolderDesc: string;

  // 带参数
  colorLabel: (n: string) => string;
  fullTextAnnotation: (n: number) => string;
  crossBlockAnnotation: (n: number) => string;
  fullTextBadge: (n: number) => string;
  crossBlockBadge: (n: number) => string;
  noteTooLong: (n: number) => string;
  notePlaceholder: (n: number) => string;
  charCount: (current: number, max: number) => string;
  confirmDeleteMulti: (n: number) => string;
  confirmDelete: string;
}

let currentLocale: LocaleDict | null = null;

export function initLocale(): void {
  const lang = localStorage.getItem("language") || "en";
  if (lang === "zh" || lang.startsWith("zh-")) {
    currentLocale = zhCN;
  } else {
    currentLocale = en;
  }
}

export function t(): LocaleDict {
  return currentLocale!;
}
