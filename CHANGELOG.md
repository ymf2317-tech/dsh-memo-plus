# 变更日志

本项目是从 [`@adamcjm/dsh-memo@0.2.11`](https://github.com/adamcjm/dsh-memo) 分出来的自用 fork，
版本号形如 `<上游语义版本>-ymfd.<修订号>`：前半段对齐"我基于哪一版上游"，后半段是本 fork 自己的修订。

## 0.3.3-ymfd.4

两处手感优化，只改 `lib/client.js`，刷新浏览器即生效，不用重启宿主。

- **新增 紧凑模式**：筛选条右侧多一个「紧凑」开关。打开后每张卡片只留首行（正文压成单行省略号，缩略图与「展开全文」隐藏），分组标题同步收窄，一屏能扫十几条；再点一次恢复。开关状态记在 localStorage，下次打开还是同一个选择。
- **新增 手机底部输入条**：窄屏（≤720px）下把输入区移到面板最下方固定，拇指够得着，列表占满上方剩余高度；桌面端布局不变。只改 flex 的 `order`，DOM 结构与宽高规则一行没动。

## 0.3.2-ymfd.3

把「写笔记」这条路做显眼，并加上写 / 预览切换。

- **新增** 笔记列表顶部常驻一个整宽的「＋ 新建笔记」按钮（原来只有右上角一个小按钮，手机上不好找）。
- **新增** 编辑器里的「写 / 预览」切换：预览按钮按当前草稿即时渲染，不用先保存再退出看效果。
- **优化** 进入编辑器时文本框自动获得焦点；占位提示写明「第一行写 `# 标题` 即笔记名」「纯文本也能存」。
- **验证** 写入通路（create → list → update → hard remove）已用真实 HTTP 接口往返自检通过。

## 0.3.1-ymfd.2

修 Markdown 渲染器加载失败后的永久降级。

- **修**：`loadMarked()` 曾把 rejected promise 缓存在模块作用域里，一次加载失败（例如宿主正在重启时页面还在拉脚本）
  之后每次调用都返回同一个失败结果，于是整个面板永久退化成纯文本，只能整页刷新才能恢复。
  现在失败不缓存，并支持 `loadMarked(true)` 强制重载。
- **修**：挂载时自动重试 3 次（0.6s / 1.2s 退避），重试 URL 带 `?t=<时间戳>`，绕开浏览器对脚本 404 的缓存。
- **修**：笔记阅读视图在渲染器仍不可用时显示「Markdown 渲染器未就绪：<原因>」+ 重试按钮，不再静默降级。
- **修**：笔记标题从单行 `ellipsis` 改为最多两行（`-webkit-line-clamp:2`），窄面板下不再被挤成「我提过的 1...」。

## 0.3.0-ymfd.1

首个 fork 版本，基于上游 0.2.11。

- **新增** Markdown 渲染：`marked.parse(gfm, breaks)` + `sanitizeHtml()`；渲染器由 host 路由 `GET /memo/vendor/marked.js`
  提供（复用宿主里已有的 `marked`，零新增依赖），拿不到时降级为纯文本。
- **新增** 笔记本（笔记区）：面板顶部 `备忘 / 笔记` 切换；用保留标签 `笔记本` 区分长文档，
  数据仍落在同一个 `notes/*.md` 事实源，无数据库迁移。
- **新增** 长文折叠：正文超过 320 字或 10 行时折叠为 9 行 + 渐隐 +「展开全文 / 收起」。
- **优化** 布局：输入区默认单行、聚焦展开；标签云默认收起；筛选条单行横滚；`max-width:720px` 下压缩头部。
- **修** 触屏：SortableJS 加 `delay:220 / delayOnTouchOnly / touchStartThreshold:6` 与 `touch-action:pan-y`，
  正常上下滚动不再被抢成拖拽。

## 上游

- [`@adamcjm/dsh-memo`](https://github.com/adamcjm/dsh-memo)（MIT）—— 数据模型、SQLite + `notes/*.md` 双写、
  GitHub 同步、附件处理、tag 与搜索都来自上游。

## 0.3.3-ymfd.4（改名版：dsh-memo-plus）

**包名从 `@adamcjm/dsh-memo` 改为 `dsh-memo-plus`。** 原因是上游 scope 不归本人所有，沿用上游包名无法 `npm publish`（registry 返回 `E404 Not Found - PUT`）。同时发布到 npm，因此有了真正的「一行安装」。

- 面板 id 仍是 `memo`，数据目录默认仍是 `~/.dsh/memo`，**已有备忘不受影响**。
- `cordis.patch.yml` 的 patch 条目名同步改为 `dsh-memo-plus`（否则宿主找不到 entry）。
- `lib/client.js` 的模块 id、`lib/index.js` 的 route-disposers Symbol 同步改名。
- 与旧包同时安装会抢同一个 `memo` 面板 id，迁移时先删旧的。

功能层面与上一版（0.3.3-ymfd.4 未改名版）一致：紧凑模式 + 手机底部输入条。

