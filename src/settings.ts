import type { Plugin } from "obsidian";
import type { Category } from "./categories";
import type { SignalWeights } from "./classifier";
import { DEFAULT_AI_CONFIG, type AiConfig } from "./ai";
import type { UserIconSource } from "./sources";

/**
 * Plugin settings.
 *
 * Everything the user can change lives here, including the categories themselves and any icon
 * sources they added. Persisted to `data.json` inside the plugin's own folder, which is also where
 * the optional AI key goes.
 */

export interface AutoIconSettings {
  categories: Category[];
  /** Sources the user added, on top of the built-in `lucide` and `emoji` pools. */
  userSources: UserIconSource[];
  /** Overwrite an icon that already exists in frontmatter. */
  overwriteExisting: boolean;
  /** Folder the scan is limited to. Empty means the whole vault. */
  scopeFolder: string;
  includeSubfolders: boolean;
  /** Show proposed changes before anything is written. */
  previewBeforeWrite: boolean;
  /**
   * Minimum score required to assign an icon.
   *
   * Default 4 sits just below the folder weight (6) and equal to the filename weight, and above the
   * heading (3) and body (1). So a deliberate signal — an explicit `#task` tag, or a folder named
   * after the category — assigns an icon, while a passing word in the prose does not. That is the
   * line between a useful auto-icon and a vault where every note carries an arbitrary glyph.
   */
  minScore: number;
  weights: SignalWeights;
  ai: AiConfig;
  /** Shown once on first load: the one-line hint that starts the whole thing. */
  activationHintDismissed: boolean;
}

export const DEFAULT_SETTINGS: AutoIconSettings = {
  categories: [],
  userSources: [],
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
  "Auto Icon 已就绪 —— 运行命令「为当前笔记分配图标」，或在设置里点「扫描整个 vault」即可开始。";

/** Settings as stored, filling in anything a older/newer `data.json` is missing. */
export function withDefaults(raw: unknown): AutoIconSettings {
  const stored = (raw ?? {}) as Partial<AutoIconSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    categories: Array.isArray(stored.categories) ? stored.categories : [],
    userSources: Array.isArray(stored.userSources) ? stored.userSources : [],
    weights: { ...DEFAULT_SETTINGS.weights, ...(stored.weights ?? {}) },
    ai: { ...DEFAULT_AI_CONFIG, ...(stored.ai ?? {}) },
  };
}

/** Key written into note frontmatter. */
export const FRONTMATTER_KEY = "icon";

/**
 * The slice of the plugin the settings tab needs.
 *
 * Declared here rather than imported from `main.ts` so the settings tab does not pull in the entry
 * point, which would make the module graph circular.
 */
export interface AutoIconHost extends Plugin {
  settings: AutoIconSettings;
  saveSettings(): Promise<void>;
  showActivationHint(): void;
  readonly remainingCategorySlots: number;
  pickIconForCurrentNote(): Promise<void>;
  clearCurrentNoteIcon(): Promise<void>;
}