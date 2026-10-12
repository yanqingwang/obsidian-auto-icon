import type { Plugin } from "obsidian";
import type { AiConfig } from "./ai";
import { DEFAULT_AI_CONFIG } from "./ai";
import type { Category } from "./categories";
import type { SignalWeights } from "./classifier";
import type { IconStyle } from "./placement";

/**
 * Plugin settings.
 *
 * Two things are deliberately absent. There is no frontmatter key: notes are never modified, so the
 * assignment lives in `icons` here. And there is no free-text icon field — the previous version let
 * a user type `lucide:folder-kanban` by hand, which is a typo waiting to happen and gives no way to
 * see the icon before committing. Icons are chosen from a rendered mXn picker.
 */

export interface AutoIconSettings {
  categories: Category[];
  /** Filled or outline. In mXn these are paired names, so both ship together. */
  iconStyle: IconStyle;
  /** Note path -> icon assignment. The plugin's whole persisted state; notes are never modified. */
  icons: Record<string, { categoryId: string; icon: string; style: string; size: number }>;
  /** Rendered icon height in pixels. */
  iconSize: number;
  /** Overwrite an icon that is already at the top of a note. */
  overwriteExisting: boolean;
  /** Folder the scan is limited to. Empty means the whole vault. */
  scopeFolder: string;
  includeSubfolders: boolean;
  /** Show proposed changes before anything is written. */
  previewBeforeWrite: boolean;
  /** Minimum score for a rule match to be applied. */
  minScore: number;
  weights: SignalWeights;
  ai: AiConfig;
  /** Shown once on first load: the one-line hint that starts the whole thing. */
  activationHintDismissed: boolean;
}

export const DEFAULT_SETTINGS: AutoIconSettings = {
  categories: [],
  iconStyle: "filled",
  iconSize: 16,
  icons: {},
  overwriteExisting: false,
  scopeFolder: "",
  includeSubfolders: true,
  previewBeforeWrite: true,
  minScore: 4,
  weights: {
    declared: 100,
    tagExact: 10,
    tagKeyword: 5,
    folder: 6,
    basename: 4,
    heading: 3,
    excerpt: 1,
  },
  ai: DEFAULT_AI_CONFIG,
  activationHintDismissed: false,
};

/** The one sentence the user is shown to turn auto-icon on. */
export const ACTIVATION_HINT =
  "Auto Icon 已就绪 —— 点下面的「开始」，或在文件树里右键任意笔记选「配图标」。图标显示在文件树里，笔记文件不会被修改。";

/** Settings as stored, filling in anything an older or newer `data.json` is missing. */
export function withDefaults(raw: unknown): AutoIconSettings {
  const stored = (raw ?? {}) as Partial<AutoIconSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    categories: Array.isArray(stored.categories) ? stored.categories : [],
    weights: { ...DEFAULT_SETTINGS.weights, ...(stored.weights ?? {}) },
    ai: { ...DEFAULT_AI_CONFIG, ...(stored.ai ?? {}) },
  };
}

/**
 * The slice of the plugin the settings tab needs.
 *
 * Declared here rather than imported from `main.ts` so the settings tab does not pull in the entry
 * point, which would make the module graph circular.
 */
export interface AutoIconHost extends Plugin {
  settings: AutoIconSettings;
  /** Loaded icon set, or null before the first read. Callers render nothing until it arrives. */
  readonly set: import("./iconset").IconSetMeta | null;
  saveSettings(): Promise<void>;
  showActivationHint(): void;
  loadIconSet(): Promise<import("./iconset").IconSetMeta>;
  readonly iconSetMeta: import("./iconset").IconSetMeta | null;
  pickIconForCategory(categoryId: string): Promise<void>;
  clearCurrentNoteIcon(): Promise<void>;
  /** Start a scan using whatever scope is configured — the button in the settings header. */
  startScan(): Promise<void>;
  scanCurrentFolder(): Promise<void>;
}