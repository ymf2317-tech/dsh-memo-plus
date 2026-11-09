# 变更日志

本项目是从 [`@adamcjm/dsh-memo@0.2.11`](https://github.com/adamcjm/dsh-memo) 分出来的自用 fork，
版本号形如 `<上游语义版本>-ymfd.<修订号>`：前半段对齐"我基于哪一版上游"，后半段是本 fork 自己的修订。

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
