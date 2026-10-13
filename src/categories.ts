/**
 * The 32 built-in categories, and the keywords that make the local rule engine pick one.
 *
 * **32 is the default size of this list, not a limit on it.** Adding your own categories is
 * expected, and there is no cap — an earlier version enforced one and it was wrong: the built-in
 * vocabulary is a starting point meant to be extended, not a closed set.
 *
 * A category's `icon` is a plain **IconPark name (without the `icon-park:` prefix)**, not a `"source:key"` reference and not a
 * free-text field. Style is a separate global setting, so switching the whole vault from outline to
 * solid is one dropdown instead of 32 edits — and there is no string left for a user to mistype.
 * Every name below was verified to exist in the bundled 1512-icon set.
 */

export interface Category {
  id: string;
  name: string;
  description: string;
  /** IconPark name (without the `icon-park:` prefix), drawn from the bundled set. Chosen through a picker, never typed. */
  icon: string;
  /**
   * Match terms, lower-cased. Compared as substrings against the note's tags, title, heading and
   * folder. Deliberately short and overlapping — the scorer weights each hit, so a vague term costs
   * less by virtue of matching fewer notes than a precise one.
   */
  keywords: string[];
}

/** Row shape for `DEFAULT_CATEGORIES`, kept compact because there are 32 of them. */
type Row = [
  id: string,
  name: string,
  icon: string,
  description: string,
  keywords: string,
];

const ROWS: Row[] = [
  [
    "inbox",
    "收件箱",
    "inbox",
    "还没归类的笔记",
    "inbox 收件箱 待整理 unfiled quick",
  ],
  [
    "project",
    "项目",
    "folder-open",
    "有明确目标和结束时间的多步工作",
    "project 项目 proj 里程碑 milestone roadmap",
  ],
  [
    "task",
    "任务",
    "checklist",
    "要动手做的事",
    "task todo to-do 任务 待办 行动项 action item",
  ],
  [
    "decision",
    "决策",
    "industrial-scales",
    "做过某个选择，并记录了理由",
    "decision 决策 决定 adr 取舍 结论",
  ],
  [
    "meeting",
    "会议",
    "people",
    "会议记录与讨论",
    "meeting 会议 纪要 minutes standup 评审会 同步会",
  ],
  [
    "report",
    "报告",
    "trending-up",
    "周期性汇总与汇报",
    "report 报告 日报 周报 月报 summary 汇报 kpi",
  ],
  [
    "research",
    "研究",
    "microscope",
    "调研、竞品分析、可行性论证",
    "research 研究 调研 竞品 competitive 分析 analysis feasibility",
  ],
  [
    "reference",
    "资料",
    "book-open",
    "查得到就用的参考资料",
    "reference 资料 参考 手册 manual 文档库",
  ],
  [
    "requirement",
    "需求",
    "magic",
    "功能需求与用户故事",
    "requirement 需求 prd user story 用户故事 spec",
  ],
  [
    "design",
    "设计",
    "shopping",
    "界面、交互、视觉方案",
    "design 设计 ui ux 原型 prototype 视觉 交互",
  ],
  [
    "development",
    "开发",
    "code",
    "写代码、做实现",
    "dev development 开发 code coding 实现 implementation",
  ],
  [
    "bug",
    "缺陷",
    "bug",
    "问题、故障、异常",
    "bug 缺陷 问题 issue 故障 error 异常 incident regression",
  ],
  [
    "testing",
    "测试",
    "test-tube",
    "测试用例与质量验证",
    "test testing 测试 qa 用例 覆盖率",
  ],
  [
    "deployment",
    "部署",
    "rocket",
    "发布、上线、交付",
    "deploy deployment 部署 发布 release 上线 go-live 发布说明",
  ],
  [
    "operations",
    "运维",
    "hard-disk-one",
    "线上服务、监控、稳定性",
    "ops operations 运维 监控 monitoring 告警 alert sre oncall",
  ],
  [
    "documentation",
    "文档",
    "file-text",
    "说明性、面向人的文档",
    "doc docs 文档 documentation 说明 readme howto",
  ],
  [
    "process",
    "流程",
    "share",
    "SOP、工作流、步骤",
    "process 流程 sop workflow 工作流 步骤 procedure checklist",
  ],
  [
    "standard",
    "规范",
    "ruler",
    "标准、约定、原则",
    "standard 规范 标准 约定 convention principle policy 原则 guideline",
  ],
  [
    "template",
    "模板",
    "copy",
    "可复用的骨架",
    "template 模板 样板 boilerplate 骨架 起稿",
  ],
  [
    "archive",
    "归档",
    "folder-block",
    "已结束、不再活跃",
    "archive 归档 存档 已完成 done closed 历史 history",
  ],
  [
    "finance",
    "财务",
    "wallet",
    "预算、成本、账目",
    "finance 财务 预算 budget 成本 cost 账 invoice 对账",
  ],
  [
    "contract",
    "合同",
    "order",
    "协议、法务文件",
    "contract 合同 协议 签署 agreement nda 法务 legal",
  ],
  [
    "customer",
    "客户",
    "cooperative-handshake",
    "客户相关沟通与记录",
    "customer 客户 甲方 client 商单 续约 商务",
  ],
  [
    "vendor",
    "供应商",
    "truck",
    "外部供应商与采购",
    "vendor 供应商 采购 procurement 外包 outsource sourcing",
  ],
  [
    "hiring",
    "招聘",
    "add-user",
    "职位、渠道、招聘流程",
    "hiring 招聘 职位 job jd headcount 渠道 人才",
  ],
  [
    "interview",
    "面试",
    "comment",
    "面试记录与评价",
    "interview 面试 候选人 candidate 评价 offer 终面 一面",
  ],
  [
    "training",
    "培训",
    "book-one",
    "课程、学习、分享",
    "training 培训 课程 学习 course 分享 workshop 教程",
  ],
  [
    "strategy",
    "战略",
    "trend",
    "方向、目标、规划",
    "strategy 战略 规划 roadmap okr 目标 vision 北极星",
  ],
  [
    "risk",
    "风险",
    "shield",
    "风险、隐患、预案",
    "risk 风险 隐患 预案 contingency 危机 合规 compliance",
  ],
  [
    "idea",
    "想法",
    "thinking-problem",
    "灵感、点子、待验证的假设",
    "idea 想法 点子 灵感 brainstorm 头脑风暴 假设 hypothesis",
  ],
  [
    "secret",
    "敏感",
    "key",
    "密码、密钥、凭证",
    "secret 敏感 密码 password 密钥 key token credential 凭证 confidential",
  ],
  [
    "bookmark",
    "收藏",
    "bookmark",
    "值得留着以后看的",
    "bookmark 收藏 稍后读 read later starred",
  ],
];

export const DEFAULT_CATEGORIES: readonly Category[] = ROWS.map(
  ([id, name, icon, description, keywords]) => ({
    id,
    name,
    description,
    icon,
    keywords: keywords.split(/\s+/).filter(Boolean),
  }),
);

/** Fresh copies, so settings edits never mutate the shipped defaults. */
export function cloneCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, keywords: [...c.keywords] }));
}

/** How many categories ship by default. Not a limit — add as many as you like. */
export const DEFAULT_CATEGORY_COUNT = DEFAULT_CATEGORIES.length;
