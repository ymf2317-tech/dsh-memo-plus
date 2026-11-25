// dsh-memo-plus 知识库区冒烟测试（迷你 hooks 运行时 + 假 ctx/fetch，真跑 KbPanel）
// 用法：node tools/kb-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.resolve(HERE, '../lib/client.js')
const src = fs.readFileSync(CLIENT, 'utf8')

/* ---------------- 迷你 React ---------------- */
let slots = []
let cursor = 0
let refs = []
let batch = []          // 本轮 render 收集的 effect
// effectDeps 记录上次依赖，模拟真 React 的 deps 比较
let dirty = false
let tree = null
let effectDeps = []
let cbStore = []

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false) }
  },
  useState(init) {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init
    return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; dirty = true }]
  },
  useEffect(fn, deps) {
    const i = cursor++
    const prev = effectDeps[i]
    const changed = !prev || !deps || deps.length !== prev.length || deps.some((d, k) => d !== prev[k])
    effectDeps[i] = deps ? deps.slice() : null
    if (changed) batch.push(fn)
  },
  useRef(init) { const i = cursor++; if (!(i in refs) || refs[i] === undefined) refs[i] = { current: init }; return refs[i] },
  useCallback(fn, deps) {
    const i = cursor++
    const prev = cbStore[i]
    const changed = !prev || !deps || deps.some((d, k) => d !== prev.deps[k])
    if (!prev || changed) cbStore[i] = { fn, deps: deps ? deps.slice() : [] }
    return cbStore[i].fn
  },
  useMemo(fn) { cursor++; return fn() },
}

/* ---------------- 假 window / fetch ---------------- */
const store = new Map()
const docText = String.raw`
---
title: 测试文档
---

# 第一章 原子结构与结合键

## 第一节 原子结构

材料的结构取决于原子间的结合键。$\gamma$-Fe 在 $300^{\circ}\mathrm{C}$ 时稳定。

| 元素 | 电子亲合能 |
| --- | --- |
| H | 72.8 |
| He | 0 |

· · 第 45 页 · ·

- 列表一
- 列表二
`
const hits = [
  { docId: 'd1', title: '材料科学基础-01-01', collection: 'kaoyan', heading: '第一节 原子结构', snippet: '材料的结构取决于原子间的结合键。', score: 0.71, chunk: 0 },
  { docId: 'd2', title: '背诵本 第1章', collection: 'kaoyan', heading: '第一章', snippet: '结合键的类型', score: 0.66, chunk: 1 },
]
const fetched = []

globalThis.window = {
  location: { origin: 'http://127.0.0.1:3081' },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
}
globalThis.localStorage = globalThis.window.localStorage
/* 假 marked：把表格/列表行压平，只为验证「走了 marked 路径」 */
globalThis.marked = { parse: (md) => (console.log('MARKED-IN>>', JSON.stringify(md.slice(0,50))),  "<p>" + md.split(String.fromCharCode(10)).join(' | ') + '</p>') }

globalThis.fetch = async (url, init) => {
  fetched.push(url)
  posts.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? String(init.body) : '' })
  const u = new URL(String(url), 'http://127.0.0.1:3081')
  const route = u.pathname.replace('/kb-api/', '')
  let body = {}
  if (route === 'status') body = { configured: true, root: 'D:/vault', docs: 2, chunks: 4, collections: [{ name: 'kaoyan', docs: 2 }] }
  else if (route === 'docs') body = { total: 3, offset: 1, limit: 200, docs: [
    { id: 'd1', title: '材料科学基础-01-01', collection: 'kaoyan', tags: ['教材', '考研'], chunkCount: 2, chars: 1200 },
    { id: 'd2', title: '背诵本 第1章', collection: 'kaoyan', tags: ['背诵本'], chunkCount: 1, chars: 800 },
    { id: 'd3', title: '材料科学基础-01-02', collection: 'kaoyan', tags: ['教材'], chunkCount: 1, chars: 600 },
  ] }
  else if (route === 'search') body = { query: u.searchParams.get('q'), mode: 'hybrid', total: hits.length, results: hits }
  else if (route === 'update') body = { ok: true, id: (JSON.parse((init && init.body) || '{}')).id, blocks: 3, chars: 100 }
  else if (route === 'doc') body = { id: u.searchParams.get('id'), title: '材料科学基础-01-01', collection: 'kaoyan', tags: ['教材'], path: 'docs/d1.md', content: docText, totalLines: 30, summary: '' }
  return { status: 200, ok: true, json: async () => body }
}

const posts = []
let mod = null
globalThis.window.__ModuleLoader__ = { load({ factory }) { mod = factory((n) => (n === 'react' ? React : null)) } }
new Function('window', 'globalThis', src)(globalThis.window, globalThis)

const T = mod.__test
if (!T || !T.KbPanel) throw new Error('缺少 exports.__test.KbPanel')

const ok = []
const fail = []
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (cond ? '' : '  ← ' + (extra ?? '')))

/* ---------------- 渲染与 effect 调度 ---------------- */
function render() {
  cursor = 0
  batch = []
  const next = T.KbPanel()
  tree = next
  return next
}
// 每轮：跑完本轮 render 收集到的 effect（它们可能 setState → dirty），再等一会儿让 debounce 到期后 render。
// 关键：debounce（280ms）需要真实时间过去，且 render 必须在 timer 触发之后才重跑 effect。
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    const effects = batch.slice()
    for (const fn of effects) {
      try { fn() } catch (err) { console.log('effect err:', err.message) }
    }
    await new Promise((r) => setTimeout(r, 120))
    dirty = false
    render()
  }
}
const findAll = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  ;(node.children || []).forEach((c) => findAll(c, pred, out))
  return out
}
const textsOf = (node, out = []) => {
  if (node == null) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (node.props && node.props.dangerouslySetInnerHTML) out.push(String(node.props.dangerouslySetInnerHTML.__html || ''))
  ;(node.children || []).forEach((c) => textsOf(c, out))
  return out
}
const text = () => textsOf(tree).join(' ')

/* ---------------- 纯函数 ---------------- */
check('latexToText γ-Fe', T.latexToText('\\gamma-Fe') === 'γ-Fe', T.latexToText('\\gamma-Fe'))
check('latexToText 300°C', T.latexToText('300^{\\circ}\\mathrm{C}') === '300°C', T.latexToText('300^{\\circ}\\mathrm{C}'))
check('latexToText Mₙ=ΣNᵢMᵢ', T.latexToText('M_n=\\sum N_i M_i').replace(/\s/g, '') === 'Mₙ=ΣNᵢMᵢ', T.latexToText('M_n=\\sum N_i M_i'))
check('latexToText ⟨111⟩', T.latexToText(String.raw`\frac{1}{2}a\langle 111\rangle`) === '1/2a⟨111⟩', T.latexToText(String.raw`\frac{1}{2}a\langle 111\rangle`))
check('latexToText Miller \bar{0}', T.latexToText(String.raw`\frac{1}{2}\bar{0}\rangle`) === '1/2' + '0\u0304⟩', T.latexToText(String.raw`\frac{1}{2}\bar{0}\rangle`))
check('latexToText c/2⟨0001⟩', T.latexToText(String.raw`c/2\langle 0001\rangle`) === 'c/2⟨0001⟩', T.latexToText(String.raw`c/2\langle 0001\rangle`))
check('noteMatch 命中标题', T.noteMatch('# 晶体缺陷\n位错与滑移', ['位错']) === true)
check('noteMatch 不命中', T.noteMatch('# 相图\n铁碳相图', ['位错']) === false)
check('noteMatch 英文不分大小写', T.noteMatch('Fe-C 相图与马氏体', ['fe-c']) === true)
check('noteMatch 多词全命中', T.noteMatch('位错 柏氏矢量', ['位错', '柏氏']) === true)
check('noteMatch 空词表放行', T.noteMatch('任意', []) === true)
// ---- 文档排序：第2章必须排在第10章前面（服务端 sort=title 是字符串序，10 会跑到 1 前面）----
const SORT_SAMPLE = [
  '第10章 材料的强韧化', '第1章 原子结构与结合键', '第2章 材料的结构', '第3章 晶体结构缺陷',
  '第4章 晶态固体中的扩散', '第5章 相平衡与相图', '第6章 材料的凝固',
  '第7章 晶态固体材料中的界面', '第8章 固态相变', '第9章 材料的变形与再结晶', '前言与目录',
]
const sorted = SORT_SAMPLE.slice().sort((a, b) => T.docCompare({ title: a }, { title: b }))
check('排序：前言排最前', sorted[0] === '前言与目录', sorted[0])
check('排序：第1章在第二位', sorted[1].indexOf('第1章') === 0, sorted[1])
check('排序：第2章排第3位、第10章末位', sorted[2].indexOf('第2章') === 0 && sorted[10].indexOf('第10章') === 0, sorted[2].slice(0, 8) + ' / ' + sorted[10].slice(0, 9))
check('排序：末位是第10章', sorted[sorted.length - 1].indexOf('第10章') === 0, sorted[sorted.length - 1])
check('章号解析：中文数字', T.docSortKey('第二章 材料的结构 第二节 常见的晶体结构').chapter === 2, String(T.docSortKey('第二章 材料的结构').chapter))
check('章号解析：阿拉伯数字', T.docSortKey('第10章 材料的强韧化').chapter === 10, String(T.docSortKey('第10章 材料的强韧化').chapter))
check('章号解析：真题按年份', T.docSortKey('2018 年硕士研究生入学考试试题').chapter === 2018, String(T.docSortKey('2018 年硕士研究生入学考试试题').chapter))
check('章号解析：无数字为 -1', T.docSortKey('前言与目录').chapter === -1, String(T.docSortKey('前言与目录').chapter))
check('分片序号：第8章 第三节（2/3）', T.docSortKey('第八章 固态相变 第三节 马氏体转变（2/3）').part === 2, String(T.docSortKey('第八章 固态相变 第三节 马氏体转变（2/3）').part))

check('tidy 剥 frontmatter', !T.tidy(docText).startsWith('---'))
check('tidy 页锚点', T.tidy(docText).includes('· · 第 45 页 · ·'))
const blocks = T.blocksOf(T.tidy(docText))
check('blocksOf 分段', blocks.length >= 6, 'got ' + blocks.length)
check('outlineOf 认出标题', T.outlineOf(blocks).length >= 2, JSON.stringify(T.outlineOf(blocks).map((o) => o.title)))

/* ---------------- 列表 ---------------- */
render()
await settle()
check('搜索框存在', findAll(tree, (n) => n.props && String(n.props.placeholder || '').includes('搜随身书柜')).length === 1)
check('集合 chip kaoyan', text().includes('kaoyan'), text().slice(0, 160))
check('标签 chip 出现', text().includes('#教材'), text().slice(0, 160))
check('文档列表 3 行', findAll(tree, (n) => n.props && n.props.className === 'kbs-row').length === 3)

/* ---------------- 阅读视图 ---------------- */
findAll(tree, (n) => n.props && n.props.className === 'kbs-row')[0].props.onClick()
await settle()
const md = findAll(tree, (n) => n.props && String(n.props.className || '').includes('kbs-md'))
check('阅读视图打开', findAll(tree, (n) => n.props && n.props.className === 'kbs-doc-head').length === 1 || text().includes('返回'))
check('正文走 marked', md.length >= 1, 'md blocks=' + md.length)
check('表格行进入 HTML', md.some((n) => /电子亲合能/.test(n.props.dangerouslySetInnerHTML.__html)), md.map(n=>n.props.dangerouslySetInnerHTML.__html.slice(0,80)).join(' /// '))
check('页锚点未被 marked 吞掉', findAll(tree, (n) => n.props && String(n.props.className || '').includes('kbs-pagelink')).length >= 1)
check('LaTeX 已简化', !text().includes('\\gamma'), text().slice(0, 200))
check('正文没有裸露的 $ 符号', !/材料的结构取决于原子间的结合键。\$/.test(text()))

/* ---------------- 专注模式 ---------------- */
const focusBtn = findAll(tree, (n) => n.props && String(n.props.title || '').includes('专注')).pop()
check('专注按钮存在', !!focusBtn)
if (focusBtn) {
  focusBtn.props.onClick()
  await settle(3)
  const fbars = findAll(tree, (n) => n.props && String(n.props.className || '').includes('kbs-focus'))
    check('专注模式出现细栏', fbars.some(n=>String(n.props.className).includes('kbs-focusbar')), text().slice(0, 120))
  const exit = findAll(tree, (n) => n.props && String(n.props.title || '').includes('退出')).pop()
  if (exit) { exit.props.onClick(); await settle(3) }
  check('退出专注后细栏消失', findAll(tree, (n) => n.props && String(n.props.className || '').includes('kbs-focusbar')).length === 0)
}

/* ---------------- 返回列表 + 搜索 ---------------- */
// 直接重挂：把 reading 状态清掉等价于点返回（组件内 closeDoc 只做 setDoc(null)），
// 但更可靠的验证是「重新挂载后能搜索」——这也正是用户实际路径：重开面板再搜。
function remount() {
  slots = []
  refs = []
  cursor = 0
  render()
}
remount()
await settle(4)
check('重挂后回到列表', text().includes('材料科学基础-01-01'), text().slice(0, 120))

const input = findAll(tree, (n) => n.props && String(n.props.placeholder || '').includes('搜随身书柜'))[0]
check('搜索框可取', !!input)
if (input) {
  input.props.onChange({ target: { value: '结合键' } })
  await settle(6)
}
check('搜索请求发出', fetched.some((u) => u.includes('/kb-api/search')), fetched.slice(-5).join(' | '))
check('搜索结果出现', text().includes('背诵本 第1章'), text().slice(0, 160))

const hitRows = findAll(tree, (n) => n.props && n.props.className === 'kbs-row')
if (hitRows.length > 1) { hitRows[1].props.onClick(); await settle(5) }
check('结果导航出现', findAll(tree, (n) => n.props && String(n.props.className || '') === 'kbs-nav').length >= 1, text().slice(0, 160))

/* ---------------- 编辑：改错别字 ---------------- */
const T3 = mod.__test
const RAW = '---' + String.fromCharCode(10) + 'title: x' + String.fromCharCode(10) + '---' + String.fromCharCode(10) + String.fromCharCode(10) + '# 正文' + String.fromCharCode(10) + '<!-- page 7 -->' + String.fromCharCode(10) + '· · 第 8 页 · ·'
check('stripFrontmatter 保留页锚点原文', T3.stripFrontmatter(RAW).includes('<!-- page 7 -->'), JSON.stringify(T3.stripFrontmatter(RAW)))
check('stripFrontmatter 剥掉 frontmatter', !T3.stripFrontmatter(RAW).startsWith('---') && T3.stripFrontmatter(RAW).startsWith('# 正文'), JSON.stringify(T3.stripFrontmatter(RAW).slice(0, 20)))

const editBtns = findAll(tree, (n) => n.props && typeof n.props.onClick === 'function' && (n.children || []).join('') === '编辑')
const editBtn = editBtns[0]
check('阅读视图有编辑按钮', !!editBtn, 'matches=' + editBtns.length + ' klass=' + (editBtn && editBtn.props.className) + ' ' + text().slice(0, 100))
if (editBtn) { editBtn.props.onClick(); await settle(3) }

const ta = findAll(tree, (n) => n.props && n.props.className === 'kbs-edit-ta')[0]
check('编辑框出现且是原文（保留页锚点）', !!ta && String(ta.props.value).includes('第 45 页'), ta ? String(ta.props.value).slice(0, 60) : '没有 textarea')
check('编辑框不含 frontmatter', !!ta && !String(ta.props.value).startsWith('---'), ta ? String(ta.props.value).slice(0, 40) : '')
if (ta) { ta.props.onChange({ target: { value: '订正' + ta.props.value } }); await settle(2) }

const saveBtn = findAll(tree, (n) => n.props && typeof n.props.onClick === 'function' && (n.children || []).join('') === '保存')[0]
check('编辑态有保存按钮', !!saveBtn, text().slice(0, 140))
if (saveBtn) { saveBtn.props.onClick(); await settle(5) }

const up = posts.filter((p) => p.method === 'POST' && p.url.includes('/kb-api/update'))
check('保存发出 POST /kb-api/update', up.length === 1, posts.map((p) => p.method + ' ' + p.url).join(' | '))
check('提交的是改后原文（无 frontmatter、有页锚点）', !!up[0] && up[0].body.includes('订正') && up[0].body.includes('第 45 页') && !up[0].body.includes('title: 测试文档'), up[0] ? up[0].body.slice(0, 90) : '')
const taLeft = findAll(tree, (n) => n.props && n.props.className === 'kbs-edit-ta').length
check('保存后退出编辑态', taLeft === 0, 'left=' + taLeft + ' ' + text().slice(0, 120))

/* ---------------- 词级标黄（markHtml） ---------------- */
check('markHtml 标记文本节点', T.markHtml('<p>置换固溶体与间隙固溶体</p>', ['固溶体']) === '<p>置换<mark class="kbs-mark">固溶体</mark>与间隙<mark class="kbs-mark">固溶体</mark></p>', T.markHtml('<p>置换固溶体</p>', ['固溶体']))
check('markHtml 不动标签属性', T.markHtml('<p class="固溶体">x</p>', ['固溶体']) === '<p class="固溶体">x</p>', T.markHtml('<p class="固溶体">x</p>', ['固溶体']))
check('markHtml 跳过 code/pre', T.markHtml('<p>固溶体</p><code>固溶体</code><pre>固溶体</pre>', ['固溶体']) === '<p><mark class="kbs-mark">固溶体</mark></p><code>固溶体</code><pre>固溶体</pre>', T.markHtml('<p>固溶体</p><code>固溶体</code>', ['固溶体']))
check('markHtml 空词表原样返回', T.markHtml('<p>固溶体</p>', []) === '<p>固溶体</p>')

/* ---------------- 底部篇间连读继承查询词与导航 ---------------- */
const titleOf = () => findAll(tree, (n) => n.props && n.props.className === 'kbs-doc-title').map((n) => (n.children || []).join('')).join('')
const hitBtn2 = () => findAll(tree, (n) => n.props && typeof n.props.onClick === 'function' && /^命中 /.test((n.children || []).join('')))[0]
const footBtn = () => findAll(tree, (n) => n.props && String(n.props.className || '') === 'kbs-foot-btn')
const hlCount = () => findAll(tree, (n) => n.props && /kbs-hl/.test(String(n.props.className || ''))).length
const navCount = () => findAll(tree, (n) => n.props && typeof n.props.onClick === 'function' && ['‹', '›'].indexOf((n.children || []).join('')) !== -1).length

/* 编辑保存会把查询词清空（openDoc 走的是空 query），这里重新从搜索结果进一次 */
const backBtn = findAll(tree, (n) => n.props && typeof n.props.onClick === 'function' && (n.children || []).join('') === '← 返回')[0]
if (backBtn) { backBtn.props.onClick(); await settle(4) }
const rows2 = findAll(tree, (n) => n.props && n.props.className === 'kbs-row')
if (rows2.length) { rows2[0].props.onClick(); await settle(6) }

check('阅读视图里有词级 <mark>', findAll(tree, (n) => n.props && n.props.dangerouslySetInnerHTML && String(n.props.dangerouslySetInnerHTML.__html).includes('kbs-mark')).length >= 1)
const fb = footBtn()
check('检索态底部是逐处导航（上一处/下一处）', fb.map((n) => (n.children || []).join('')).join('|') === '‹ 上一处|下一处 ›', 'foot=' + fb.map((n) => (n.children || []).join('')).join('|'))
if (fb.length) {
  const before = hlCount()
  const beforeTitle = titleOf()
  const beforeDocUrl = fetched.filter((u) => u.includes('/kb-api/doc?')).slice(-1)[0] || ''
  fb[fb.length - 1].props.onClick()
  await settle(6)
  check('底部跳转后仍有蓝块标亮', hlCount() >= 1, 'before=' + before + ' after=' + hlCount() + ' title=' + titleOf())
  check('底部跳转后仍有「命中 k/n」', !!hitBtn2(), hitBtn2() ? (hitBtn2().children || []).join('') : '（没有）')
  /* 底部「下一处」先篇内逐处走，本篇走完才接下一条结果 → 请求的 doc id 必须变 */
  const lastDocUrl = () => fetched.filter((u) => u.includes('/kb-api/doc?')).slice(-1)[0] || ''
  const idOf = (u) => (String(u).match(/[?&]id=([^&]+)/) || [])[1] || ''
  check('底部「下一处」篇内走完接下一条结果', idOf(lastDocUrl()) !== idOf(beforeDocUrl) && idOf(lastDocUrl()) !== '', 'before=' + idOf(beforeDocUrl) + ' after=' + idOf(lastDocUrl()))
  check('底部跳转后结果导航仍在（目标还在命中列表里）', navCount() >= 2, 'nav=' + navCount())
  check('底部跳转后仍是文档视图', !!titleOf())
}

/* ---------------- 逐处跳转（Word 式查找下一个） ---------------- */
check('按处计数：一段两处 = 2', T.countTermHits('位错是线缺陷，位错运动造成滑移。', ['位错']) === 2)
check('按处计数：一段一处 = 1', T.countTermHits('结合键决定材料性能。', ['结合键']) === 1)
check('按处计数：没命中 = 0', T.countTermHits('这一句没有关键词。', ['结合键']) === 0)

/* ---------------- 汇报 ---------------- */
console.log('\n✔ ' + ok.length + ' passed')
ok.forEach((n) => console.log('  ✓ ' + n))
if (fail.length) {
  console.log('\n✘ ' + fail.length + ' failed')
  fail.forEach((n) => console.log('  ✗ ' + n))
  process.exit(1)
}
