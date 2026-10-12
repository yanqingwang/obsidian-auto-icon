import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, relative, sep } from "path";
import { DEFAULT_CATEGORIES } from "../src/categories";
import { classifyByRules, extractSignals, RuleClassifier } from "../src/classifier";
import { buildPlan, type ScanInput } from "../src/planner";
import { resolveIcon, type SourceContext } from "../src/sources";

/**
 * End-to-end over a directory shaped like a real vault: Chinese paths, mixed frontmatter forms,
 * nested folders, and notes that genuinely have no category.
 *
 * The point is to confirm the default settings produce sensible assignments on realistic content —
 * and, just as importantly, that they stay silent on notes that carry no signal at all. A plugin
 * that icons everything is worse than one that icons nothing.
 */

const VAULT_FILES: Record<string, string> = {
  "工作/2026预算.md": "---\ntags: [finance]\n---\n\n2026 年的部门预算和成本拆分。\n",
  "工作/合同/框架协议.md": "---\ntags:\n  - contract\n---\n\n甲乙双方签署的框架协议。\n",
  "会议/2026-10-12 周会.md": "---\ntags: meeting\n---\n\n## 纪要\n\n讨论了上线时间。\n",
  "项目/小程序重构/里程碑.md": "---\ntags: [project, roadmap]\n---\n\n## 里程碑\n\nQ4 完成。\n",
  "归档/2024 旧总结.md": "---\ntags: archive\n---\n\n已结束。\n",
  "notes.md": "随手记的一段话，没有任何标签。\n",
  "招聘/候选人-张三.md": "---\ntags:\n  - interview\n  - candidate\n---\n\n面试评价与 offer 沟通。\n",
  "运维/告警处理.md": "---\ntype: operations\n---\n\n监控告警的处理流程。\n",
  "深度/被显式声明的笔记.md": "---\ntype: bug\n---\n\n虽然放在这里，但声明了类别。\n",
  "空的/没有frontmatter.md": "就是一段普通文字。\n",
};

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "auto-icon-e2e-"));
  for (const [path, content] of Object.entries(VAULT_FILES)) {
    const full = join(root, path);
    mkDir(join(full, ".."));
    writeFile(full, content);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function mkDir(dir: string): void {
  const { mkdirSync } = require("fs") as typeof import("fs");
  mkdirSync(dir, { recursive: true });
}

function writeFile(path: string, content: string): void {
  const { writeFileSync } = require("fs") as typeof import("fs");
  writeFileSync(path, content, "utf8");
}

/** Walk the directory and return vault-relative paths, matching Obsidian's `/` separator. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
  return out.sort();
}

/** Minimal frontmatter split, mirroring what the metadata cache would hand the plugin. */
function frontmatterOf(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Record<string, unknown> = {};
  // Good enough for the flat `key: value` and `- item` shapes this fixture uses.
  let currentKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s*-\s+(.*)$/.exec(line)?.[1] !== undefined && currentKey) {
      // `tags:` with no value parses as "", not as a missing key — so Array.isArray, not `?? []`.
      const existing = fm[currentKey];
      const list = Array.isArray(existing) ? (existing as string[]) : [];
      list.push(RegExp.$1.trim());
      fm[currentKey] = list;
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      fm[currentKey] = kv[2].trim();
    }
  }
  return { frontmatter: fm, body: content.slice(match[0].length) };
}

/** Lucide names this Obsidian build would report; a realistic subset. */
const LUCIDE: SourceContext = {
  lucideIds: new Set([
    "inbox", "folder-kanban", "list-checks", "scale", "users", "file-chart-column",
    "flask-conical", "book-open", "wand-sparkles", "palette", "code", "bug", "flask-round",
    "rocket", "server", "file-text", "workflow", "gauge", "copy", "archive", "wallet",
    "file-pen", "handshake", "truck", "user-plus", "messages-square", "graduation-cap",
    "trending-up", "triangle-alert", "lightbulb", "key-round", "bookmark",
  ]),
  userSources: [],
};

async function runScan() {
  const classifier = new RuleClassifier({ minScore: 4 });
  const inputs: ScanInput[] = [];

  for (const path of walk(root)) {
    if (!path.endsWith(".md")) continue;
    const content = readFileSync(join(root, path), "utf8");
    const { frontmatter, body } = frontmatterOf(content);

    const signals = extractSignals({ path, frontmatter, body });
    const classification = await classifier.classify(signals, DEFAULT_CATEGORIES);
    const category = DEFAULT_CATEGORIES.find((c) => c.id === classification.categoryId);
    const resolved = category ? resolveIcon(category.icon, category.fallbackIcon, LUCIDE) : null;

    inputs.push({
      path,
      currentIcon: typeof frontmatter["icon"] === "string" ? (frontmatter["icon"] as string) : null,
      classification,
      icon: resolved ? `${resolved.ref.source}:${resolved.ref.key}` : null,
    });
  }
  return { inputs, plan: buildPlan(inputs, { overwriteExisting: false }) };
}

describe("scanning a realistic vault", () => {
  it("assigns the expected category to each tagged note", async () => {
    const { plan } = await runScan();
    const byPath = new Map(plan.changes.map((c) => [c.path, c]));

    const expectCategory = (path: string, categoryId: string): void => {
      expect(byPath.get(path)?.categoryId).toBe(categoryId);
    };

    expectCategory("工作/2026预算.md", "finance");
    expectCategory("工作/合同/框架协议.md", "contract");
    expectCategory("会议/2026-10-12 周会.md", "meeting");
    expectCategory("项目/小程序重构/里程碑.md", "project");
    expectCategory("归档/2024 旧总结.md", "archive");
    expectCategory("招聘/候选人-张三.md", "interview");
    expectCategory("运维/告警处理.md", "operations");
  });

  it("honours an explicit frontmatter declaration over the folder", async () => {
    const { plan } = await runScan();
    // Lives under 深度/ but declares `type: bug`.
    expect(plan.changes.find((c) => c.path === "深度/被显式声明的笔记.md")?.categoryId).toBe("bug");
  });

  it("writes an icon reference that actually resolves", async () => {
    const { plan } = await runScan();
    for (const change of plan.changes) {
      expect(change.after).toMatch(/^lucide:/);
      expect(LUCIDE.lucideIds.has(change.after!.split(":")[1])).toBe(true);
    }
  });

  it("leaves genuinely uncategorisable notes alone", async () => {
    const { plan } = await runScan();
    const touched = new Set(plan.changes.map((c) => c.path));
    expect(touched.has("notes.md")).toBe(false);
    expect(touched.has("空的/没有frontmatter.md")).toBe(false);
    expect(plan.unmatched).toBeGreaterThanOrEqual(2);
  });

  it("touches exactly the notes that carry a signal", async () => {
    const { plan } = await runScan();
    // A ratio assertion would be meaningless here: the fixture is 8 tagged notes out of 10, so a
    // correct classifier *should* icon 8. What matters is that the touched set is exactly right.
    const touched = plan.changes.map((c) => c.path);
    // Sorted on both sides: code-point order, not the reading order a human would choose.
    expect(touched.sort()).toEqual(
      [
        "工作/2026预算.md",
        "工作/合同/框架协议.md",
        "会议/2026-10-12 周会.md",
        "项目/小程序重构/里程碑.md",
        "招聘/候选人-张三.md",
        "归档/2024 旧总结.md",
        "深度/被显式声明的笔记.md",
        "运维/告警处理.md",
      ].sort()
    );
    expect(touched).toHaveLength(8);
  });

  it("explains every decision", async () => {
    const { plan } = await runScan();
    for (const change of plan.changes) {
      expect(change.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("fallback when an Obsidian build lacks an icon", () => {
  it("falls back to emoji rather than writing a broken reference", async () => {
    const category = DEFAULT_CATEGORIES.find((c) => c.id === "task")!;
    const sparse: SourceContext = { lucideIds: new Set(), userSources: [] };

    const resolved = resolveIcon(category.icon, category.fallbackIcon, sparse);
    expect(resolved?.usedFallback).toBe(true);
    expect(resolved?.render).toEqual({ kind: "emoji", glyph: "✅" });
  });
});