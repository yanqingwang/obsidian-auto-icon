import { AiClassifier, DEFAULT_AI_CONFIG, parseAnswer, type AiConfig } from "../src/ai";
import { DEFAULT_CATEGORIES } from "../src/categories";
import { RuleClassifier, type NoteSignals } from "../src/classifier";

const categories = DEFAULT_CATEGORIES;

const signals: NoteSignals = {
  path: "notes/a.md",
  basename: "a",
  tags: [],
  headings: [],
  excerpt: "some body",
  declared: null,
};

const aiConfig = (over: Partial<AiConfig> = {}): AiConfig => ({
  ...DEFAULT_AI_CONFIG,
  enabled: true,
  apiKey: "sk-test",
  model: "gpt-4o-mini",
  ...over,
});

/** Minimal chat-completions response shape. */
const reply = (content: string): unknown => ({
  choices: [{ message: { content } }],
});

class StubRules {
  classify(): Promise<{ categoryId: string | null; score: number; runnerUp: number; reasons: string[] }> {
    return Promise.resolve({ categoryId: "task", score: 10, runnerUp: 0, reasons: ["规则"] });
  }
}

describe("parseAnswer", () => {
  it("reads a well-formed answer", () => {
    expect(parseAnswer(reply('{"categoryId":"meeting","confidence":0.9}'))).toEqual({
      categoryId: "meeting",
      confidence: 0.9,
    });
  });

  it("rejects prose, which is the common LLM failure", () => {
    expect(parseAnswer(reply("我认为这是会议记录"))).toBeNull();
  });

  it("rejects malformed structures", () => {
    expect(parseAnswer(null)).toBeNull();
    expect(parseAnswer({})).toBeNull();
    expect(parseAnswer({ choices: [] })).toBeNull();
    expect(parseAnswer({ choices: [{}] })).toBeNull();
  });

  it("tolerates a missing confidence", () => {
    expect(parseAnswer(reply('{"categoryId":"meeting"}'))).toEqual({
      categoryId: "meeting",
      confidence: 0,
    });
  });
});

describe("AiClassifier", () => {
  it("does nothing extra when disabled", async () => {
    let called = false;
    const ai = new AiClassifier(
      aiConfig({ enabled: false }),
      new StubRules(),
      async () => {
        called = true;
        return reply("{}");
      }
    );
    const result = await ai.classify(signals, categories);
    expect(called).toBe(false);
    expect(result.categoryId).toBe("task");
  });

  it("does nothing extra when there is no key", async () => {
    const ai = new AiClassifier(
      aiConfig({ apiKey: "" }),
      new StubRules(),
      async () => {
        throw new Error("should not be called");
      }
    );
    expect((await ai.classify(signals, categories)).categoryId).toBe("task");
  });

  it("uses the model's answer when it names a real category", async () => {
    const ai = new AiClassifier(
      aiConfig(),
      new StubRules(),
      async () => reply('{"categoryId":"meeting","confidence":0.85}')
    );
    const result = await ai.classify(signals, categories);
    expect(result.categoryId).toBe("meeting");
    expect(result.reasons[0]).toContain("85%");
  });

  it("outranks the rule result, since a semantic read is stronger evidence", async () => {
    const ai = new AiClassifier(aiConfig(), new StubRules(), async () => reply('{"categoryId":"idea","confidence":0.6}'));
    const result = await ai.classify(signals, categories);
    expect(result.score).toBeGreaterThan(10);
  });

  it("posts to the configured endpoint with the key", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | null = null;
    const ai = new AiClassifier(
      aiConfig({ baseUrl: "https://example.test/v1/" }),
      new StubRules(),
      async (url, init) => {
        seenUrl = url;
        seenInit = init;
        return reply('{"categoryId":"idea","confidence":1}');
      }
    );
    await ai.classify(signals, categories);

    expect(seenUrl).toBe("https://example.test/v1/chat/completions");
    const headers = (seenInit as unknown as { headers: Record<string, string> }).headers;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("offers the model the full category list", async () => {
    let body = "";
    const ai = new AiClassifier(
      aiConfig(),
      new StubRules(),
      async (_url, init) => {
        body = (init as { body: string }).body;
        return reply('{"categoryId":"idea","confidence":1}');
      }
    );
    await ai.classify(signals, categories);
    for (const category of categories) expect(body).toContain(category.id);
  });
});

describe("failing over to the rules", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["a network error", async () => {
      throw new Error("ECONNREFUSED");
    }],
    ["a non-JSON reply", async () => reply("抱歉，我不知道")],
    ["an unknown category", async () => reply('{"categoryId":"unicorn","confidence":1}')],
    ["a garbage response", async () => ({ nonsense: true })],
  ];

  it.each(cases)("falls back on %s", async (_label, fetcher) => {
    const warnings: string[] = [];
    const ai = new AiClassifier(aiConfig(), new StubRules(), fetcher, (m) => warnings.push(m));
    const result = await ai.classify(signals, categories);

    expect(result.categoryId).toBe("task");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("回退");
  });
});

describe("interoperability", () => {
  it("degrades to the real RuleClassifier, not to a stand-in", async () => {
    const ai = new AiClassifier(aiConfig(), new RuleClassifier({ minScore: 4 }), async () => {
      throw new Error("offline");
    });
    expect((await ai.classify({ ...signals, tags: ["meeting"] }, categories)).categoryId).toBe("meeting");
    expect((await ai.classify({ ...signals, tags: ["contract"] }, categories)).categoryId).toBe("contract");
  });

  it("is off by default", () => {
    expect(DEFAULT_AI_CONFIG.enabled).toBe(false);
    expect(DEFAULT_AI_CONFIG.apiKey).toBe("");
  });
});