# dsh-memo-plus（ymf2317-tech 自用 fork）

> fork of [`@adamcjm/dsh-memo@0.2.11`](https://github.com/adamcjm/dsh-memo) · MIT
> 落盘位置：`D:\dsh-workspace\packages\dsh-memo-plus`
> 包名与面板 id **保持 `@adamcjm/dsh-memo` / `memo` 不变**，这样 bundle patch、面板 key、数据目录（`~/.dsh/memo`）、同步仓库全都不动，只换代码。

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

## 安装形态

`C:\Users\Administrator\.dsh\profiles\web\node_modules\@adamcjm\dsh-memo` 是一个 **junction**，指向本目录；
profile `package.json` 里登记为 `"@adamcjm/dsh-memo": "link:D:/dsh-workspace/packages/dsh-memo-plus"`。

改完 `lib/client.js` 后刷新浏览器即可；改 `lib/index.js`（host 半侧）需要重启 dsh web。

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
