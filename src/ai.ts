import type { Category } from "./categories";
import type { Classification, NoteClassifier, NoteSignals } from "./classifier";

/**
 * Optional AI classifier.
 *
 * Off by default, and the plugin is fully functional without it — this is an *addition* to the local
 * rule engine, not a replacement. Two consequences shape the design:
 *
 * 1. **Every failure degrades to the rules.** A bad key, a rate limit, a model that answers in
 *    prose, a network timeout — all of them fall back to `RuleClassifier` and surface a warning,
 *    rather than leaving a note without an icon or throwing mid-scan.
 * 2. **Any OpenAI-compatible endpoint works**, so this is not tied to one vendor. Base URL, key and
 *    model are all user settings.
 *
 * The API key lives in the plugin's own `data.json` inside `.obsidian/`, which is the same place
 * every other Obsidian plugin keeps credentials. It never leaves the machine except in the request
 * the user configured.
 */

/** Mutable: this is the user's configured AI block, edited in place by the settings UI. */
export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0,
  timeoutMs: 30000,
};

export const MAX_AI_EXCERPT = 800;

interface AiAnswer {
  categoryId: string;
  confidence: number;
}

/** Fetch signature, injected so tests do not need a network. */
export type Fetcher = (
  url: string,
  init: RequestInit,
  timeoutMs: number,
) => Promise<unknown>;

export const defaultFetcher: Fetcher = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
};

export class AiClassifier implements NoteClassifier {
  readonly id = "ai";

  constructor(
    private readonly config: AiConfig,
    private readonly fallback: NoteClassifier,
    private readonly fetcher: Fetcher = defaultFetcher,
    private readonly onWarning: (message: string) => void = () => {},
  ) {}

  async classify(
    signals: NoteSignals,
    categories: readonly Category[],
  ): Promise<Classification> {
    const safe = await this.fallback.classify(signals, categories);
    if (
      !this.config.enabled ||
      !this.config.apiKey.trim() ||
      !this.config.model.trim()
    ) {
      return safe;
    }

    try {
      const raw = await this.request(
        signalPayload(signals, categories, this.config),
      );
      const answer = parseAnswer(raw);
      if (!answer) throw new Error("模型没有返回可解析的 JSON");

      const match = categories.find((c) => c.id === answer.categoryId);
      if (!match) throw new Error(`模型返回了未知类别：${answer.categoryId}`);

      return {
        categoryId: match.id,
        // Scaled so an AI answer outranks a keyword hit but still shows a real confidence.
        score: 40 + Math.max(0, Math.min(1, answer.confidence)) * 40,
        runnerUp: safe.score,
        reasons: [
          `AI: ${match.name} (${Math.round(answer.confidence * 100)}%)`,
        ],
      };
    } catch (error) {
      this.onWarning(`AI 分类失败，已回退到本地规则：${describe(error)}`);
      return safe;
    }
  }

  private async request(payload: unknown): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    return this.fetcher(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      this.config.timeoutMs,
    );
  }
}

function signalPayload(
  signals: NoteSignals,
  categories: readonly Category[],
  config: AiConfig,
): unknown {
  const catalogue = categories
    .map((c) => `- ${c.id}：${c.name}（${c.description}）`)
    .join("\n");

  const user = [
    `路径：${signals.path}`,
    `标签：${signals.tags.length > 0 ? signals.tags.join(", ") : "（无）"}`,
    `标题：${signals.headings.slice(0, 8).join(" / ") || "（无）"}`,
    "正文节选：",
    signals.excerpt.slice(0, MAX_AI_EXCERPT),
  ].join("\n");

  return {
    model: config.model,
    temperature: config.temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是笔记分类助手。根据笔记内容，从给定类别中选出唯一最贴切的一个。" +
          '只输出 JSON，格式为 {"categoryId": "<类别 id>", "confidence": 0~1}。' +
          "若确实没有任何类别贴切，categoryId 设为空字符串。\n\n类别列表：\n" +
          catalogue,
      },
      { role: "user", content: user },
    ],
  };
}

/** Pull `{categoryId, confidence}` out of a chat-completions response. */
export function parseAnswer(raw: unknown): AiAnswer | null {
  const content = readContent(raw);
  if (!content) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const id =
    typeof record["categoryId"] === "string"
      ? (record["categoryId"] as string).trim()
      : "";
  const confidence =
    typeof record["confidence"] === "number"
      ? (record["confidence"] as number)
      : 0;
  return { categoryId: id, confidence };
}

function readContent(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const choices = (raw as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>)["content"];
  return typeof content === "string" ? content : null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
