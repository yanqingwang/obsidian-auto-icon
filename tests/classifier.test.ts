import { DEFAULT_CATEGORIES } from "../src/categories";
import {
  basenameOf,
  classifyByRules,
  DEFAULT_WEIGHTS,
  extractSignals,
  type NoteSignals,
} from "../src/classifier";

const categories = DEFAULT_CATEGORIES;
const opts = { minScore: 4 }; // the shipped default

// basename is derived from path unless given explicitly, so overriding `path` alone is enough —
// the classifier reads `basename` as a field, and a stale one would silently disable filename
// matching.
const signals = (over: Partial<NoteSignals> = {}): NoteSignals => {
  const path = over.path ?? "notes/a.md";
  return {
    path,
    basename: basenameOf(path),
    tags: [],
    headings: [],
    excerpt: "",
    declared: null,
    ...over,
  };
};

describe("signal extraction", () => {
  it("reads a bare filename", () => {
    expect(basenameOf("a/b/Note.md")).toBe("Note");
    expect(basenameOf("Note.MD")).toBe("Note");
    expect(basenameOf("Note")).toBe("Note");
  });

  it("normalises tags from an array or a comma string", () => {
    expect(extractSignals({ path: "a.md", frontmatter: { tags: ["Task", "#Bug"] }, body: "" }).tags).toEqual([
      "task",
      "bug",
    ]);
    expect(extractSignals({ path: "a.md", frontmatter: { tags: "task, bug" }, body: "" }).tags).toEqual([
      "task",
      "bug",
    ]);
  });

  it("copes with a missing or malformed frontmatter", () => {
    expect(extractSignals({ path: "a.md", frontmatter: null, body: "" }).tags).toEqual([]);
    expect(extractSignals({ path: "a.md", frontmatter: { tags: 42 }, body: "" }).tags).toEqual([]);
  });

  it("reads headings, capped", () => {
    const body = Array.from({ length: 30 }, (_, i) => `## H${i}`).join("\n");
    expect(extractSignals({ path: "a.md", frontmatter: null, body }).headings).toHaveLength(12);
  });

  it("prefers the explicit declaration keys, in priority order", () => {
    expect(extractSignals({ path: "a.md", frontmatter: { type: "task", category: "bug" }, body: "" }).declared).toBe(
      "task"
    );
    expect(extractSignals({ path: "a.md", frontmatter: { category: "bug" }, body: "" }).declared).toBe("bug");
    expect(extractSignals({ path: "a.md", frontmatter: { unrelated: "x" }, body: "" }).declared).toBeNull();
  });

  it("lower-cases the excerpt", () => {
    expect(extractSignals({ path: "a.md", frontmatter: null, body: "TASK list" }).excerpt).toContain("task");
  });
});

describe("explicit declaration", () => {
  it("wins over everything else", () => {
    const result = classifyByRules(
      signals({ declared: "meeting", tags: ["task", "bug"], excerpt: "report research meeting" }),
      categories,
      opts
    );
    expect(result.categoryId).toBe("meeting");
  });

  it("accepts the Chinese display name", () => {
    expect(classifyByRules(signals({ declared: "会议" }), categories, opts).categoryId).toBe("meeting");
  });

  it("is ignored when it names no known category", () => {
    const result = classifyByRules(signals({ declared: "nonsense", tags: ["task"] }), categories, opts);
    expect(result.categoryId).toBe("task");
  });
});

describe("tag matching", () => {
  it("scores an exact id match highly", () => {
    expect(classifyByRules(signals({ tags: ["task"] }), categories, opts).categoryId).toBe("task");
  });

  it("scores an exact display-name match", () => {
    expect(classifyByRules(signals({ tags: ["任务"] }), categories, opts).categoryId).toBe("task");
  });

  it("matches a keyword inside a longer tag", () => {
    expect(classifyByRules(signals({ tags: ["meeting-notes-2026"] }), categories, opts).categoryId).toBe(
      "meeting"
    );
  });

  it("matches Chinese substrings, which have no word boundaries", () => {
    expect(classifyByRules(signals({ tags: ["本周周报汇总"] }), categories, opts).categoryId).toBe("report");
  });

  it("prefers the exact match over a substring match", () => {
    // `bug` exactly, plus `bug-report` which also contains "report"
    const result = classifyByRules(signals({ tags: ["bug", "bug-report"] }), categories, opts);
    expect(result.categoryId).toBe("bug");
  });
});

describe("other signals", () => {
  it("uses the folder", () => {
    const result = classifyByRules(signals({ path: "工作/contract/a.md" }), categories, opts);
    expect(result.categoryId).toBe("contract");
  });

  it("uses the filename", () => {
    expect(classifyByRules(signals({ path: "x/2026-budget.md" }), categories, opts).categoryId).toBe("finance");
  });

  it("uses a heading, but not at the default threshold", () => {
    // Weight 3 is deliberately below the default of 4: a heading alone is suggestive, not decisive.
    const atDefault = classifyByRules(signals({ headings: ["上线检查清单"] }), categories, opts);
    expect(atDefault.categoryId).toBeNull();

    const lowered = classifyByRules(signals({ headings: ["上线检查清单"] }), categories, { minScore: 3 });
    expect(lowered.categoryId).toBe("deployment");
  });

  it("uses the body as weak evidence", () => {
    // Weight 1: on its own it never clears the default, which is the point. It only breaks ties
    // once a stronger signal has already put a category in contention.
    const result = classifyByRules(
      signals({ excerpt: "这段话提到了 bug 和 issue" }),
      categories,
      { minScore: 1 }
    );
    expect(result.categoryId).toBe("bug");
    expect(result.score).toBeLessThan(DEFAULT_WEIGHTS.tagExact);
  });

  it("counts at most one hit per category per text field", () => {
    const one = classifyByRules(signals({ excerpt: "bug" }), categories, opts);
    const many = classifyByRules(signals({ excerpt: "bug issue error defect 故障 异常" }), categories, opts);
    expect(many.score).toBe(one.score);
  });
});

describe("threshold", () => {
  it("assigns nothing when no signal fires", () => {
    const result = classifyByRules(signals({ excerpt: "完全无关的内容" }), categories, opts);
    expect(result.categoryId).toBeNull();
  });

  it("assigns nothing below the minimum", () => {
    // A body-only hit is worth 1, well under the default threshold of 8.
    const result = classifyByRules(signals({ excerpt: "bug" }), categories, opts);
    expect(result.score).toBeLessThan(opts.minScore);
    expect(result.categoryId).toBeNull();
  });

  it("assigns when the threshold is lowered", () => {
    const result = classifyByRules(signals({ excerpt: "bug" }), categories, { minScore: 1 });
    expect(result.categoryId).toBe("bug");
  });
});

describe("report shape", () => {
  it("reports the runner-up so confidence is visible", () => {
    // `task` is an exact tag match (10); `bug-report` only contains the keyword (5).
    const result = classifyByRules(signals({ tags: ["task", "bug-report"] }), categories, opts);
    expect(result.categoryId).toBe("task");
    expect(result.runnerUp).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(result.runnerUp);
  });

  it("explains itself", () => {
    const result = classifyByRules(signals({ tags: ["task"] }), categories, opts);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toContain("task");
  });

  it("dedupes reasons", () => {
    const result = classifyByRules(signals({ tags: ["task", "task"] }), categories, opts);
    expect(new Set(result.reasons).size).toBe(result.reasons.length);
  });

  it("is deterministic when scores tie", () => {
    const a = classifyByRules(signals({ tags: ["task", "bug"] }), categories, opts);
    const b = classifyByRules(signals({ tags: ["bug", "task"] }), categories, opts);
    expect(a.categoryId).toBe(b.categoryId);
  });
});

describe("custom weights", () => {
  it("can lean on the folder instead of tags", () => {
    const weights = { tagExact: 0, tagKeyword: 0, folder: 20 };
    expect(classifyByRules(signals({ tags: ["task"] }), categories, { minScore: 1, weights }).categoryId).toBeNull();
    expect(
      classifyByRules(signals({ path: "task/x.md" }), categories, { minScore: 1, weights }).categoryId
    ).toBe("task");
  });
});