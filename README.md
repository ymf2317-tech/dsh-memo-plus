# dsh-memo-plus

[![npm](https://img.shields.io/npm/v/dsh-memo-plus.svg)](https://www.npmjs.com/package/dsh-memo-plus)
[![license](https://img.shields.io/npm/l/dsh-memo-plus.svg)](./LICENSE)

> DeepSeek Harness 备忘录插件的独立 fork：[`@adamcjm/dsh-memo@0.2.11`](https://github.com/adamcjm/dsh-memo) · MIT
> 包名 `dsh-memo-plus`，面板 id 仍是 `memo`。

```bash
npm i -g dsh   # 或已装 DSH 时直接下一步
dsh plugin --profile web add dsh-memo-plus
```

上游 0.2.11 是个称职的随手记，但对手机和长文不友好。这个 fork 只做三件事：**把 Markdown 渲染出来、把屏幕还给人、让手指能滚动**，再补一个「笔记本」区放长文档。

| 能力 | 上游 0.2.11 | 本 fork |
|---|---|---|
| 正文 | `white-space:pre-wrap` 纯文本 | **Markdown 渲染**（标题/表格/代码/引用/列表） |
| 长文 | 一条占满整屏 | **折叠 9 行 + 展开全文** |
| 手机布局 | 输入区 80px + 标签两三行 + 筛选换行 | 输入区单行聚焦展开、标签收起、筛选单行横滚 |
| 触屏 | 一滑就变拖拽 | **长按 220ms 才拖**，正常上下滚动 |
| 长文档 | 只能塞进备忘列表 | **「笔记」区**（正文首行 `# 标题` 即名称，全屏阅读） |

本机落盘位置：`D:\dsh-workspace\packages\dsh-memo-plus`

## 0.4.0 起：知识库改叫「随身书柜」

原来独立的右栏插件 `dsh-kb-sidebar` 已经并进来（归档在 `D:\dsh-workspace\scrapped\dsh-kb-sidebar\`）。

> **为什么叫「随身书柜」**：记忆插件 `@modusensus/dsh-mneme` 自带一个「知识库」入口，而且它的座位是无条件注册的（开关只管内容层），
> 顶栏管理里会出现两个同名项、没法分别折叠。所以 mneme 那个留作「知识库」（AI 的热/冷记忆），本插件这个叫「随身书柜」——
> 装的是扫描书、真题、背诵本，用来随时翻的。

**一个面板、两个入口、同名「随身书柜」**：右栏 tab 和底部面板都叫「随身书柜」，进去是三个页签：

| 页签 | 干什么 |
| --- | --- |
| **检索**（默认） | 搜本地知识库（`/kb-api`），结果直接跳到命中的那一段并标黄，`‹ 1/24 ›` 在结果间跳、文内「命中 k/n」逐个跳；按 教材 / 真题 / 背诵本 筛 |
| **备忘** | 原来的 memo 列表：一行一条，快进快出 |
| **笔记** | 长文档，正文首行 `# 标题` 即名称，全屏阅读 |

阅读视图的能力：

- **真 Markdown**：表格 / 标题 / 列表 / 引用 / 代码块都渲染（复用这里的 `renderMarkdown()`）。
- **LaTeX 还原**：`$\gamma$-Fe` → γ-Fe，`$300^{\circ}\mathrm{C}` → 300°C，`$M_n=\sum N_i M_i$` → Mₙ=Σ Nᵢ Mᵢ。不做 KaTeX 排版（OCR 出来的公式多是单符号，还原成可读符号就够）。
- **专注模式**：只留正文 + 字号 ± + 退出，手机一屏都是内容。
- **断点续读**：记住读到哪一段，下次列表页显示「继续读上次的位置」。
- **篇间连读**：正文末尾 ‹上一篇 / 下一篇›。
- **页锚点**：`· · 第 45 页 · ·` 保留原书页码，对图表时能定位回 PDF。
- **词级标黄与当前焦点**：命中词用黄底 `<mark>` 标出（`markHtmlWithCount()` 只处理文本节点、跳过 `code`/`pre`，渲染与计数共用同一数据源），当前定位到的那一处额外加橙色外框；整段只用左侧蓝竖条表示焦点段。
- **检索态 vs 纯阅读态分流**：检索态保留原始结果列表，支持「‹ 上一处 / 下一处 ›」对称跨篇连续查找（按去重文档序，不死循环、不串入无关章节），纯语义匹配时显示「上一条结果 / 下一条结果」；纯阅读态严格按同集合同资料类型（背诵本 / 真题 / 教材）的 章→节→分片 自然序连读，翻开未读新章自动归零回顶。
- **改错别字**：阅读视图的「编辑」（专注栏在 `A+` 与「目录」之间）打开等宽 textarea，改完点「保存」——
  走 `POST /kb-api/update`，服务端会重算 hash、重新切块、重建向量，旧正文留版本快照可回滚；
  草稿只剥 frontmatter、保留 `<!-- page N -->` 页锚点，超 4000 行文档自动分段拉全防止截断，保存后保留原检索/阅读上下文。

数据没有搬家：知识库仍在 `D:\dsh-workspace\vault`（`dsh-knowledge-base-local`），备忘/笔记仍在 memo 自己的库里。

### 检索态：Word 式「查找下一个」

从搜索结果点开一篇之后，优先按后端 `lineStart / lineEnd`（兜底剥离 `…` 后的 `snippet`）精准落位，底部是 `‹ 上一处 | 命中 k / N | 下一处 ›`——按**每一处**命中逐个居中滚动：

- 同一段里有多处命中也能一处一处过，手动上下滑动看上下文时指示器被动跟随，绝不反过来把页面弹回；
- 本篇走完自动接下一篇去重命中文档的第一处，`‹ 上一处` 对称跨回上一篇命中文档的最后一处；
- 顶部的 `‹ n/N ›`（专注模式同样保留）可在全部搜索结果片段间自由切换，原始片段锚点不丢失。

### 纯阅读态：按书本自然序连读

从文档列表或「继续读上次的位置」点进来时进入纯阅读态，底部是 `‹ 上一篇 / 下一篇 ›`：

- 文档列表自动分页拉全集合文档，按 章 → 节 → 分片 自然序排列（不再被 40 篇截断）；
- 底部翻页严格走同集合、同资料类型（背诵本 / 真题 / 教材）的书本顺序，不互相串线，未读新章自动回到顶部；
- 顶栏切换「检索 / 备忘 / 笔记」与点击「← 返回」均保留当前状态与滚动位置，不丢进度、不重复搜索。

## 为什么 fork

上游 0.2.11 有三个自用痛点：

1. **不渲染 Markdown** —— 正文是 `white-space:pre-wrap` 纯文本，粘进去的 `## 标题 / | 表格 |` 全是源码。
2. **列表可视区被挤到下半屏** —— 输入区默认 80px、标签云固定两三行、筛选会换行，手机上真正能看备忘的只剩一小块。
3. **触屏一滑就变成拖拽** —— SortableJS 没设长按门控，手指刚动就被抓成拖卡片，列表无法上下滚动，还容易误触把卡片拖出去。

## 改了什么

### 1. Markdown 渲染（client + host）

- host 半侧新增 `GET /memo/vendor/marked.js`：把 profile 里**已有**的 `marked@18.1.3`（`node_modules/marked/lib/marked.umd.js`）原样吐出去。不新增依赖、不自造渲染器，做法与 `dsh-antigravity` 一致。
- client 半侧 `loadMarked()` 按需注入该脚本，`renderMarkdown()` 用 `marked.parse(gfm:true, breaks:true)` 渲染，结果按正文文本缓存（>400 条清空）。
- 渲染前过 `sanitizeHtml()`：剥掉 `script/iframe/object/embed/link/style`、`on*` 属性、`javascript:` 协议。备忘是自己写的，但这层是防手滑粘贴。
- 拿不到 marked → 自动降级为上游的纯文本行为，不报错、不阻塞面板。
- 样式覆盖：标题层级、表格（`display:block;overflow-x:auto` 横向可滚）、行内代码/代码块、引用、列表、链接、分隔线。

### 2. 布局（纯 CSS + 一处状态）

- 输入框默认 **40px 单行**，`:focus-within` 才长到 104px（原来固定 80px 起）。
- 标签云默认 **收起**，只留一个 `标签 N ▸` chip，点开才展开（原来常驻两三行）。
- 筛选条 **单行横滚**（`flex-wrap:nowrap;overflow-x:auto`，隐藏滚动条），不再换两排。
- `@media (max-width:720px)`：头部内边距收紧、隐藏条数、缩小同步按钮、列表底部留 96px 安全区。
- `.dm-list` 保持 `flex:1;min-height:0`，吃掉剩余全部高度。

### 3. 触屏拖拽门控

```js
delay: 220,              // 按住 220ms 才算拖拽
delayOnTouchOnly: true,  // 鼠标端零延迟，不受影响
touchStartThreshold: 6,  // 按住期间移动超 6px 就判成滑动、交还原生滚动
fallbackTolerance: 4,
```

配合 `.dm-cards .dm-card{touch-action:pan-y}` 与 `.dm-list{overscroll-behavior:contain}`，手机上正常上下滑，长按才排序。

## 4. 笔记本（面板内第二区）

顶栏 `备忘 / 笔记` 两个 chip 切换。**不为笔记本单开数据表**：用保留标签「笔记本」把长文档和一行条目分开，数据仍然落在同一个 `notes/*.md` 事实源里，GitHub 同步、快照、附件全部照旧，升级和回滚都不需要迁移数据库。

- 备忘区：列表自动**排除**带「笔记本」标签的条目；「全部 / 待处理」计数也把这部分扣掉，不会出现「全部 6 却只显示 5 张卡」。
- 标签云：隐藏「笔记本」这个内部分类标记，不占用户可见标签位。
- 笔记列表：标题取正文第一个 `# 标题` 行（没有就取首行），摘要去掉 Markdown 记号后截 120 字，附更新时间与字数。
- 阅读：面板内全屏覆盖（`.dm-note`），正文按 Markdown 渲染，长文正常滚动。
- 编辑：等宽字体 textarea，`Ctrl / ⌘ + Enter` 保存；新建保存后落到阅读态。
- 删除：两次点击（先变「确认删除？」，再点才真删），避免手滑。
- 保存时显式传 `tags: ['笔记本', ...正文里的 #标签]`，所以归类标记不会被正文覆盖掉。

接口全部复用上游已有的 `create / update / remove / list / tags`，host 半侧一行没改。

## 写入路径：走接口，不要直接改文件

这个插件**没有注册任何 agent 工具**（刻意如此：AI 不该自动读写你的备忘），对 AI 来说唯一入口就是 host 暴露的 HTTP 接口：

| 动作 | 请求 | 说明 |
|---|---|---|
| 新建 | `POST /memo/api/create` `{body, tags?}` | 返回 `{item, stats}`；body 里的 `#标签` 会被抽成标签并从正文剥离 |
| 修改 | `POST /memo/api/update` `{id, patch:{body?,tags?}}` | `patch.tags` 显式给出则**完全替换**；不给则从正文增量合并 |
| 删除 | `POST /memo/api/remove` `{id, hard?}` | 默认软删（进 `notes/` 保留 + git 可追） |
| 查询 | `POST /memo/api/list` `{filter,q,tag,limit}` | `filter` ∈ all / todo / done / today / pinned |
| 笔记本 | 同上，但 `tags` 里带保留标签 `笔记本` | 备忘区会自动排除这些条目 |

**不要直接写 `notes/YYYY-MM/<ID>.md`** 再指望它生效：那样得自己拼完整 frontmatter（`id/created/updated/done/order/tags/source`）、ID 必须是 23 位大写十六进制、还要再 `POST /memo/api/rebuild` 重建索引；漏一步数据库和事实源就打架，下次 `rebuild` 会把你的改动覆盖回去。磁盘文件只用于**核对**，不用于写入。

写 `# 标题` 时井号后必须带空格，否则会被 `stripTags` 当标签吃掉。

## 安装

**A. 从 npm 安装（推荐）**

```bash
dsh plugin --profile web add dsh-memo-plus
```

装完重启一次 DSH Web（host 半侧在进程启动时加载），然后刷新浏览器。

**B. link 到本目录（改代码即时生效，自用调试）**

```bash
git clone https://github.com/ymf2317-tech/dsh-memo-plus.git
```

然后在你的 DSH profile（`~/.dsh/profiles/<profile>`）里：

1. `package.json` 的 `dependencies` 加一条：`"dsh-memo-plus": "link:<绝对路径>/dsh-memo-plus"`
2. 让 `<profile>/node_modules/dsh-memo-plus` 指向该目录（Windows 用 `New-Item -ItemType Junction`，其他平台用 `ln -s`）
3. `dsh.profile.bundles` 数组里加 `"dsh-memo-plus"`
4. 重启 DSH Web

**C. 覆盖已安装目录**

把本仓库的 `lib/`、`cordis.patch.yml`、`package.json` 覆盖进已安装的 `node_modules/dsh-memo-plus`。

改 `lib/client.js` 后刷新浏览器即生效；改 `lib/index.js`（host 半侧，含 `/memo/vendor/marked.js` 路由）必须重启 DSH Web。

### 从 `@adamcjm/dsh-memo` 迁过来要注意

这个 fork 早期沿用上游包名 `@adamcjm/dsh-memo` 做 drop-in 替换，**0.3.3 起改名为 `dsh-memo-plus`**（上游 scope 不归本人，无法 `npm publish`）。

改名后它是一个**独立插件**：

- 面板 id 仍是 `memo`，界面没变；
- 数据目录默认仍是 `~/.dsh/memo`，**已有备忘不会丢**；
- 但 profile 里别同时装两个（`@adamcjm/dsh-memo` 与 `dsh-memo-plus` 会抢同一个 `memo` 面板 id）。迁移时先把旧的删掉。

## 回滚

```powershell
# 1) 拿回上游原始目录（0.2.11，19 个文件）
Remove-Item "C:\Users\Administrator\.dsh\profiles\web\node_modules\@adamcjm\dsh-memo" -Force
Move-Item "C:\Users\Administrator\.dsh\backups\dsh-memo-0.2.11-20261110_002007" "C:\Users\Administrator\.dsh\profiles\web\node_modules\@adamcjm\dsh-memo"

# 2) profile package.json 还原（已备份）
Copy-Item "C:\Users\Administrator\.dsh\profiles\web\package.json.bak-before-memo-plus-20261110_002007" `
          "C:\Users\Administrator\.dsh\profiles\web\package.json" -Force

# 3) 重启
powershell -NoProfile -ExecutionPolicy Bypass -File D:\dsh-workspace\scripts\restart-dsh-web.ps1
```

数据在 `~/.dsh/memo`（SQLite + `notes/*.md` + 附件 + git 仓库），与代码无关，回滚不会丢任何备忘。
