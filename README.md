# Auto Icon

根据笔记内容，自动在**左侧文件树**给每篇笔记配一个图标。32 个内置类别，本地规则引擎默认离线可用，AI 分类可选。

图标集是本地打包的 [Material Design Icons](https://github.com/Templarian/MaterialDesign)（Apache-2.0），7447 个图标，mXn 命名（`mdi:folder`、`mdi:folder-outline`），全部离线可用。

**笔记文件本身不会被修改。** 所有分配存在插件自己的 `data.json` 里，靠生成的样式表画出来。删掉插件，vault 一字不差。

---

## 为什么改成不碰文件

前两版都往笔记里写东西：先是 frontmatter 的 `icon:`，然后是正文第一行的 SVG 行。两次都被否掉了，理由是同一个——**图标应该出现在文件树上，而不是笔记里**。写在正文里，打开笔记看到的是「图标 → 标题」，视觉上像标题被顶下去了；而 Obsidian 的行内标题取的是第一个 H1，图标在它外面。

现在的做法：分配存在插件里，用一段生成的 CSS 画在文件树上。代价是这部分状态不进 Git、换设备不跟随——这是「不碰你的文件」的交换条件，说清楚在这儿。

---

## 怎么在文件树上画图标

用**生成的样式表**，不是插入 DOM 元素。

文件树在展开、折叠、重命名、同步、切 tab 时都会被 Obsidian 重建。任何往里插元素的方案都得侦测这些事件再重新插入——文件树插件的 bug 大多出在这里。CSS 不需要：一条 `<style>`、每个笔记一条规则，Obsidian 自己重绘时自动带上。没有观察器、没有状态跟踪、没有清理逻辑。

选择器用的是长期稳定的形式：

```css
.nav-file-title[data-path="会议/周会.md"] .nav-file-title-content::before {
  content: url("data:image/svg+xml,%3Csvg …%3E");
  width:16px; height:16px;
}
```

失败方式是安静的：哪天 Obsidian 改了元素名，选择器匹配不上，笔记少个图标，不会有别的问题。

---

## 图标：mXn 格式

**为什么是 mdi / mXn。** `mdi:folder-outline` 是一个你能直接查到、复制、或者从别的工具配置里读出来的名字。上一版 IconPark 用的是它自己的词表，每个图标都得靠翻才能找到——换了 mXn 之后，插件和生态里其它工具说同一种语言。

**样式是命名约定。** mdi 的填充和线性是成对的两个名字（`folder` 和 `folder-outline`），不是同一份图形的两种字重。所以「样式」就是「用不用 `-outline` 后缀」，两版都在发布包里，不需要下载任何东西。7447 个里 1889 个有线性孪生版本，缺的那个会自动回退到填充版本并在选择器上标出来，而不是假装有。

图标集是独立文件（2.80 MB），不是 `main.js` 的一部分——`main.js` 只有 **67 KB**，加载瞬时，图标集第一次用到时才读一次。

### 选择器

搜索接受人们真的会敲的每种写法：`folder-outline`、`folder outline` 都行。结果**排序**而不是只过滤——否则搜 `folder outline` 会按字母序返回两百多个 `folder-*`，真正要找的那个根本不在第一页。

每个格子渲染真实图标，hover 显示完整 mXn 名称，可以直接复制到别处用。

---

## 32 个类别

上限是硬性的，在 `assertCategoryLimit` 里强制。

设置里**内置类别在前，自定义在后**，各用一个分组标题隔开——自定义类别看起来就该和固定词表区分开。

### 内置类别的布局

每个类别是**一行**：名称 + id + mXn 名 + 词数 + 一个「编辑」按钮。图标选择、关键词编辑、删除、恢复默认都在点开后弹出的对话框里。

之前是一行塞四个控件（图标预览 + 关键词输入框 + 3 个按钮），把 Obsidian 的 `.setting-item` 撑高，32 行就变成一堵墙。一行只有一个控件才读得下去。

### 显式声明优先

frontmatter 里写 `type:` / `category:` / `kind:` 直接指定，权重 100，压过一切推断。

---

## 匹配是怎么算分的

七路信号加权，**每路每类别最多算一次命中**——否则一篇长文顺带提到 `bug issue error defect 故障 异常`，就能靠篇幅压过一条用户明确写的 `#task` 标签。

| 信号 | 权重 |
|---|---|
| frontmatter 声明 | 100 |
| 标签精确命中 | 10 |
| 文件夹 | 6 |
| 标签关键词 | 5 |
| 文件名 | 4 |
| 小标题 | 3 |
| 正文 | 1 |

**默认最低分 4**，卡在文件夹和正文之间：明确的标签或文件夹会配图标，正文里偶然一词不会。

中文没有词边界，所以关键词是**子串匹配**。每个判定都给出理由，预览窗口直接显示。

---

## 安全

- **预览**：保存前列出将给哪些笔记分配图标、判定依据是什么
- **不覆盖**：默认只给还没有图标的笔记分配，手动改过的不会被自动替换
- **不乱删**：分类失败的笔记**不会被清空图标**，只是不分配。匹配不上和该删是两回事
- **不留垃圾**：文件被改名或删除后，对应的分配会被清掉，不会无限增长
- **干净卸载**：`onunload` 会移除自己注入的样式表

### 一个例外

早期版本往正文里写过 SVG 行。插件提供一个显式命令**「清理正文中旧版本写入的图标行」**来处理它们——但它**不会自动执行**：那会修改文件，而这个插件的前提就是不碰文件。

---

## 命令

| 命令 | 作用 |
|---|---|
| 为当前笔记分配图标 | 单篇 |
| 扫描整个 vault 并分配图标 | 按设置范围 |
| 扫描当前文件夹并分配图标 | 当前笔记所在文件夹 |
| 重新扫描并覆盖已有图标 | 强制覆盖 |
| 手动为当前笔记设置图标 | 从 mXn 选择器挑 |
| 清除当前笔记的图标 | 移除单个 |
| 清除全部图标 | 清空所有分配 |
| 清理正文中旧版本写入的图标行 | 一次性清理，需手动触发 |

---

## 安装

```bash
cd code/obsidian-auto-icon
npm install
npm run build
```

产物：`main.js` + `manifest.json` + `styles.css` + `icons/mdi.json`。**四个文件都要。**

```bash
OUTDIR="/path/to/your/vault/.obsidian/plugins/auto-icon" npm run build
```

---

## 开发

```bash
npm run icons       # 重新生成 icons/mdi.json
npm run typecheck
npm test            # 143 个测试
npm run smoke       # 构建并真实加载 main.js + 读图标集 + 生成样式表
npm run dev
```

### 代码结构

| 文件 | 职责 |
|---|---|
| `src/store.ts` | 分配表（笔记路径 → 图标），插件的全部持久化状态 |
| `src/treeIcons.ts` | 由分配表生成 CSS 并注入 |
| `src/iconset.ts` | mXn 图标集加载（懒加载 + 并发去重）、名称解析、搜索排序 |
| `src/placement.ts` | 早期版本写入的 SVG 行的识别与清理 |
| `src/categories.ts` | 32 个默认类别、关键词、32 上限强制 |
| `src/classifier.ts` | 信号提取 + 本地规则打分（纯函数） |
| `src/ai.ts` | 可选 AI 分类器，实现同一个接口 |
| `src/planner.ts` | 生成可预览的改动计划 |
| `src/main.ts` | 命令、扫描流程 |
| `scripts/build-mdi.mjs` | 生成图标集 |
| `scripts/smoke.js` | 冒烟加载产物 |

分类和计划逻辑都是不依赖 Obsidian 的纯函数，可以脱离 vault 单测——风险本来就在这里。

### 测试

```
tests/
├── iconset.test.ts   # 读真实生成的 mdi.json
├── treeIcons.test.ts # CSS 生成、路径转义、data URI 编码
├── store.test.ts     # 分配表 diff / 清理
├── planner.test.ts   # 分配/覆盖/跳过策略
├── categories.test.ts
├── classifier.test.ts
└── ai.test.ts
```

`iconset.test.ts` 和 `categories.test.ts` 直接读**真实生成**的 `mdi.json`。「每个默认类别都能解析」是对**发布产物**的断言，必须对着它测。

`treeIcons.test.ts` 的 DOM 用十几行手写桩而不是 jsdom——jsdom 是纯 ESM，而这个测试跑在 CommonJS 下。

---

## 许可

MIT（图标集来自 Material Design Icons，Apache-2.0）