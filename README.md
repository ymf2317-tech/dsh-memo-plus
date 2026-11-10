# dsh-memo-plus

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
