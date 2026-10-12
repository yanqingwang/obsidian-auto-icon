import {
  availableRefs,
  BUILT_IN_SOURCES,
  EMOJI_SOURCE,
  formatIconRef,
  LUCIDE_SOURCE,
  parseIconRef,
  resolveIcon,
  type SourceContext,
  type UserIconSource,
} from "../src/sources";

const ctx = (lucide: string[] = ["rocket", "bug"], userSources: UserIconSource[] = []): SourceContext => ({
  lucideIds: new Set(lucide),
  userSources,
});

describe("parsing references", () => {
  it("splits on the first colon only", () => {
    expect(parseIconRef("lucide:folder-kanban")).toEqual({ source: "lucide", key: "folder-kanban" });
  });

  it("keeps colons inside the key", () => {
    expect(parseIconRef("mine:a:b")).toEqual({ source: "mine", key: "a:b" });
  });

  it("rejects a bare string, which is almost always a paste mistake", () => {
    expect(parseIconRef("rocket")).toBeNull();
    expect(parseIconRef("")).toBeNull();
    expect(parseIconRef("  ")).toBeNull();
  });

  it("rejects a half-formed reference", () => {
    expect(parseIconRef(":rocket")).toBeNull();
    expect(parseIconRef("lucide:")).toBeNull();
  });

  it("round trips", () => {
    const ref = { source: "lucide", key: "rocket" };
    expect(parseIconRef(formatIconRef(ref))).toEqual(ref);
  });

  it("accepts an emoji as the key", () => {
    expect(parseIconRef("emoji:📁")).toEqual({ source: "emoji", key: "📁" });
  });
});

describe("resolving", () => {
  it("resolves a Lucide name this build knows", () => {
    const resolved = resolveIcon("lucide:rocket", "emoji:🚀", ctx(["rocket"]));
    expect(resolved).toEqual({
      ref: { source: "lucide", key: "rocket" },
      render: { kind: "lucide", name: "rocket" },
      usedFallback: false,
    });
  });

  it("falls back when the Lucide name is absent from this build", () => {
    // The case that motivates the whole fallback: `check-square` was renamed `square-check`.
    const resolved = resolveIcon("lucide:check-square", "emoji:✅", ctx(["square-check"]));
    expect(resolved?.usedFallback).toBe(true);
    expect(resolved?.render).toEqual({ kind: "emoji", glyph: "✅" });
  });

  it("accepts any emoji without needing a registry", () => {
    expect(resolveIcon("emoji:🦄", undefined, ctx([]))?.render).toEqual({ kind: "emoji", glyph: "🦄" });
  });

  it("returns null when neither reference resolves", () => {
    expect(resolveIcon("lucide:ghost", "lucide:phantom", ctx([]))).toBeNull();
  });

  it("does not treat the fallback as a fallback when it is identical", () => {
    expect(resolveIcon("lucide:ghost", "lucide:ghost", ctx([]))).toBeNull();
  });

  it("rejects an unparseable reference", () => {
    expect(resolveIcon("just-text", "emoji:📁", ctx([]))).not.toBeNull();
  });
});

describe("user sources", () => {
  const mine: UserIconSource = {
    id: "mine",
    name: "我的图标库",
    license: "CC0",
    icons: { rocket: "🚀", chart: "<path d=\"M0 0\"/>" },
  };

  it("resolves an icon from a user source", () => {
    const resolved = resolveIcon("mine:chart", "emoji:📊", ctx([], [mine]));
    expect(resolved?.render).toEqual({ kind: "glyph", glyph: '<path d="M0 0"/>' });
    expect(resolved?.usedFallback).toBe(false);
  });

  it("treats a user source exactly like a built-in one", () => {
    // No special-casing anywhere: the same resolve path handles both.
    expect(resolveIcon("mine:rocket", undefined, ctx([], [mine]))?.ref.source).toBe("mine");
  });

  it("returns null for an unknown source", () => {
    expect(resolveIcon("theirs:rocket", undefined, ctx([], [mine]))).toBeNull();
  });

  it("returns null for an unknown key inside a known source", () => {
    expect(resolveIcon("mine:nope", undefined, ctx([], [mine]))).toBeNull();
  });

  it("lists its icons among the available references", () => {
    const refs = availableRefs(ctx(["rocket"], [mine]));
    expect(refs).toContain("lucide:rocket");
    expect(refs).toContain("mine:chart");
  });
});

describe("built-in sources", () => {
  it("protects the built-in ids from being redefined", () => {
    expect(BUILT_IN_SOURCES.has(LUCIDE_SOURCE)).toBe(true);
    expect(BUILT_IN_SOURCES.has(EMOJI_SOURCE)).toBe(true);
    expect(BUILT_IN_SOURCES.has("mine")).toBe(false);
  });
});