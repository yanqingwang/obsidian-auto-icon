import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative, sep } from "path";
import { DEFAULT_CATEGORIES } from "../src/categories";
import { extractSignals, RuleClassifier } from "../src/classifier";
import { applyIcon, detectIcon, stripIcon } from "../src/placement";
import { buildPlan, type ScanInput } from "../src/planner";
import { shapeFor, type IconSetMeta } from "../src/iconset";

/**
 * End-to-end over a directory shaped like a real vault: Chinese paths, both frontmatter forms,
 * nested folders, notes with no category, and a note whose icon the user edited by hand.
 *
 * The contract being checked is the one the redesign promised — the icon lives at the top of the
 * note body, writing is reversible, and a note with no signal is left completely alone.
 */

const SET = JSON.parse(readFileSync(join(__dirname, "..", "icons", "iconpark.json"), "utf8")) as IconSetMeta;

const VAULT_FILES: Record<string, string> = {
  "工作/2026预算.md": "---\ntags: [finance]\n---\n\n2026 年的部门预算和成本拆分。\n",
  "工作/合同/框架协议.md": "---\ntags:\n  - contract\n---\n\n甲乙双方签署的框架协议。\n",
  "会议/2026-10-12 周会.md": "---\ntags: meeting\n---\n\n## 纪要\n\n讨论了上线时间。\n",
  "项目/小程序重构/里程碑.md": "---\ntags: [project, roadmap]\n---\n\n## 里程碑\n\nQ4 完成。\n",
  "归档/2024 旧总结.md": "---\ntags: archive\n---\n\n已结束。\n",
  "招聘/候选人-张三.md": "---\ntags:\n  - interview\n  - candidate\n---\n\n面试评价与 offer 沟通。\n",
  "运维/告警处理.md": "---\ntype: operations\n---\n\n监控告警的处理流程。\n",
  "深度/被显式声明的笔记.md": "---\ntype: bug\n---\n\n虽然放在这里，但声明了类别。\n",
  "notes.md": "随手记的一段话，没有任何标签。\n",
  "空的/没有frontmatter.md": "就是一段普通文字。\n",
};

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "auto-icon-e2e-"));
  for (const [path, content] of Object.entries(VAULT_FILES)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out.sort();
}

/** Split a note the way the plugin does, keeping the frontmatter text byte for byte. */
function splitNote(raw: string): { frontmatterText: string; body: string; frontmatter: Record<string, unknown> } {
  const match = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?)/.exec(raw);
  const frontmatterText = match ? match[1] : "";
  const body = match ? raw.slice(match[1].length) : raw;

  const fm: Record<string, unknown> = {};
  let key: string | null = null;
  for (const line of frontmatterText.split(/\r?\n/).slice(1, -1)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const existing = fm[key];
      fm[key] = Array.isArray(existing) ? [...(existing as string[]), item[1].trim()] : [item[1].trim()];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      fm[key] = kv[2].trim();
    }
  }
  return { frontmatterText, body, frontmatter: fm };
}

async function runScan(overwrite = false) {
  const classifier = new RuleClassifier({ minScore: 4 });
  const theme = "outline";
  const size = 20;
  const inputs: ScanInput[] = [];

  for (const path of walk(root)) {
    if (!path.endsWith(".md")) continue;
    const { body, frontmatter } = splitNote(readFileSync(join(root, path), "utf8"));
    const signals = extractSignals({ path, frontmatter, body });
    const classification = await classifier.classify(signals, DEFAULT_CATEGORIES);
    const category = DEFAULT_CATEGORIES.find((c) => c.id === classification.categoryId);

    inputs.push({
      path,
      current: detectIcon(body),
      classification,
      categoryId: category?.id ?? null,
      icon: category?.icon ?? null,
      shape: category ? shapeFor(SET, category.icon, theme) : null,
      theme,
      size,
    });
  }
  return { inputs, plan: buildPlan(inputs, { overwriteExisting: overwrite }) };
}

/** Apply the plan the way the plugin does: rewrite the body, keep frontmatter verbatim. */
function applyToDisk(plan: Awaited<ReturnType<typeof runScan>>["plan"]): void {
  for (const change of plan.changes) {
    const full = join(root, change.path);
    const { frontmatterText, body } = splitNote(readFileSync(full, "utf8"));
    const next =
      change.shape === null
        ? stripIcon(body)
        : applyIcon(body, change.shape, change.after as string, change.theme, change.size);
    writeFileSync(full, frontmatterText + next, "utf8");
  }
}

describe("classifying a realistic vault", () => {
  it("assigns the expected category to each tagged note", async () => {
    const { plan } = await runScan();
    const byPath = new Map(plan.changes.map((c) => [c.path, c]));

    const expectCategory = (path: string, id: string): void => {
      expect(byPath.get(path)?.categoryId).toBe(id);
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
    expect(plan.changes.find((c) => c.path === "深度/被显式声明的笔记.md")?.categoryId).toBe("bug");
  });

  it("leaves genuinely uncategorisable notes alone", async () => {
    const { plan } = await runScan();
    const touched = new Set(plan.changes.map((c) => c.path));
    expect(touched.has("notes.md")).toBe(false);
    expect(touched.has("空的/没有frontmatter.md")).toBe(false);
  });

  it("writes icon references that resolve against the shipped set", async () => {
    const { plan } = await runScan();
    for (const change of plan.changes) {
      expect(SET.icons[change.after as string]).toBeDefined();
    }
  });
});

describe("writing icons to disk", () => {
  it("puts the icon at the top of the body, not in frontmatter", async () => {
    const { plan } = await runScan();
    applyToDisk(plan);

    const full = join(root, "会议/2026-10-12 周会.md");
    const raw = readFileSync(full, "utf8");
    const { frontmatterText, body } = splitNote(raw);

    // Frontmatter is byte-for-byte what it was: no `icon` key, no other change.
    expect(frontmatterText).toBe("---\ntags: meeting\n---\n");

    // The icon is the first line of the body, and the heading still follows it.
    expect(body.split("\n")[0]).toMatch(/^<svg class="auto-icon"/);
    expect(detectIcon(body)).toMatchObject({ theme: "outline", size: 20 });
    expect(body).toContain("## 纪要");
  });

  it("produces no colour sentinels in the written file", async () => {
    const { plan } = await runScan();
    applyToDisk(plan);
    for (const path of walk(root)) {
      if (!path.endsWith(".md")) continue;
      const { body } = splitNote(readFileSync(join(root, path), "utf8"));
      const line = /^<svg class="auto-icon"[^\n]*$/m.exec(body)?.[0];
      if (line) expect(line).not.toMatch(/C[0-3]/);
    }
  });

  it("round trips exactly: clearing restores the original bytes", async () => {
    const before = Object.fromEntries(
      walk(root).filter((p) => p.endsWith(".md")).map((p) => [p, readFileSync(join(root, p), "utf8")])
    );

    const { plan } = await runScan();
    applyToDisk(plan);
    // Clearing is what the plugin does with `change.shape === null`, i.e. stripIcon.
    for (const change of plan.changes) {
      const full = join(root, change.path);
      const { frontmatterText, body } = splitNote(readFileSync(full, "utf8"));
      writeFileSync(full, frontmatterText + stripIcon(body), "utf8");
    }

    for (const [path, original] of Object.entries(before)) {
      expect(readFileSync(join(root, path), "utf8")).toBe(original);
    }
  });

  it("is idempotent: a second scan finds nothing left to do", async () => {
    const first = await runScan();
    applyToDisk(first.plan);

    const second = await runScan();
    expect(second.plan.changes).toEqual([]);
    expect(second.plan.unchanged).toBeGreaterThan(0);
  });

  it("does not accumulate blank lines when run twice", async () => {
    const { plan } = await runScan();
    applyToDisk(plan);

    const full = join(root, "会议/2026-10-12 周会.md");
    const { frontmatterText, body } = splitNote(readFileSync(full, "utf8"));
    const detection = detectIcon(body);
    const category = DEFAULT_CATEGORIES.find((c) => c.id === "meeting")!;
    const again = applyIcon(body, shapeFor(SET, category.icon, "outline")!, detection!.icon, detection!.theme, detection!.size);

    expect(again).toBe(body);
    expect(frontmatterText.length).toBeGreaterThan(0);
  });
});

describe("respecting a hand-edited icon", () => {
  it("leaves it alone by default", async () => {
    const full = join(root, "会议/2026-10-12 周会.md");
    const { frontmatterText, body } = splitNote(readFileSync(full, "utf8"));
    const handPicked = shapeFor(SET, "star", "outline")!;
    writeFileSync(full, frontmatterText + applyIcon(body, handPicked, "star", "filled", 32), "utf8");

    const { plan } = await runScan();
    expect(plan.changes.some((c) => c.path === "会议/2026-10-12 周会.md")).toBe(false);

    // Restore so later assertions in this file see a predictable state.
    writeFileSync(full, frontmatterText + stripIcon(body), "utf8");
  });

  it("replaces it when overwrite is on", async () => {
    const full = join(root, "会议/2026-10-12 周会.md");
    const { frontmatterText, body } = splitNote(readFileSync(full, "utf8"));
    writeFileSync(full, frontmatterText + applyIcon(body, shapeFor(SET, "star", "outline")!, "star", "filled", 32), "utf8");

    const { plan } = await runScan(true);
    expect(plan.changes.some((c) => c.path === "会议/2026-10-12 周会.md")).toBe(true);

    writeFileSync(full, frontmatterText + stripIcon(body), "utf8");
  });
});