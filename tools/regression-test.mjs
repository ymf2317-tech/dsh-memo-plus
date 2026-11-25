// dsh-memo-plus 全量回归测试：覆盖搜索跳转、阅读换页、滚动防弹回、目录跳转、分页与编辑安全
// 用法：node tools/regression-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.resolve(HERE, '../lib/client.js')
const src = fs.readFileSync(CLIENT, 'utf8')

/* ---------------- 带 cleanup 的迷你 React ---------------- */
let slots = []
let cursor = 0
let refs = []
let effectDeps = []
let effectCleanups = []
let batch = []
let cbStore = []
let memoStore = []
let tree = null

function resetReact() {
  for (const fn of effectCleanups) {
    if (typeof fn === 'function') { try { fn() } catch {} }
  }
  slots = []
  cursor = 0
  refs = []
  effectDeps = []
  effectCleanups = []
  batch = []
  cbStore = []
  memoStore = []
  tree = null
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false) }
  },
  useState(init) {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init
    return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v }]
  },
  useEffect(fn, deps) {
    const i = cursor++
    const prev = effectDeps[i]
    const changed = !prev || !deps || deps.length !== prev.length || deps.some((d, k) => d !== prev[k])
    effectDeps[i] = deps ? deps.slice() : null
    if (changed) batch.push({ i, fn })
  },
  useRef(init) {
    const i = cursor++
    if (!(i in refs)) refs[i] = { current: init }
    return refs[i]
  },
  useCallback(fn, deps) {
    const i = cursor++
    const prev = cbStore[i]
    const changed = !prev || !deps || deps.some((d, k) => d !== prev.deps[k])
    if (!prev || changed) cbStore[i] = { fn, deps: deps ? deps.slice() : [] }
    return cbStore[i].fn
  },
  useMemo(fn, deps) {
    const i = cursor++
    const prev = memoStore[i]
    const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, k) => d !== prev.deps[k])
    if (!prev || changed) memoStore[i] = { value: fn(), deps: deps ? deps.slice() : [] }
    return memoStore[i].value
  },
}

/* ---------------- 模拟 DOM 容器 + localStorage + fetch ---------------- */
const ls = new Map()
globalThis.window = {
  location: { origin: 'http://127.0.0.1:3081' },
  localStorage: {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
  },
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.marked = {
  parse(md) {
    const esc = String(md)
    if (/^`([^`]+)`$/.test(esc.trim())) return '<p><code>' + esc.trim().slice(1, -1) + '</code></p>'
    return '<p>' + esc.replace(/`([^`]+)`/g, '<code>$1</code>') + '</p>'
  },
}

// 构造测试数据：250 篇文档（测试 >200 分页），含背诵本/真题/教材
const MOCK_DOCS = []
for (let i = 1; i <= 10; i++) {
  MOCK_DOCS.push({ id: `rec-${i}`, title: `第${i}章 背诵内容`, collection: 'kaoyan', tags: ['考研', '背诵本'], chunkCount: 2, chars: 500 })
}
for (let i = 1; i <= 240; i++) {
  MOCK_DOCS.push({ id: `txt-${i}`, title: `第${Math.ceil(i / 2)}章 教材 › 第${(i % 2) + 1}节(${i}/240)`, collection: 'kaoyan', tags: ['考研', '教材'], chunkCount: 3, chars: 800 })
}

const DOC_BODIES = {
  'rec-3': [
    '---',
    'title: 第3章 背诵内容',
    '---',
    '',
    '# 第3章 晶体结构缺陷',
    '',
    '第一段提到位错的基本概念和位错密度。',
    '',
    '## 第二节 滑移机制',
    '',
    '这里讨论 BCC 结构与 `BCC` 代码块，以及 $\\alpha$ 相中的位错滑移。',
    '',
    '## 第三节 攀移与交滑移',
    '',
    '在高温下刃型位错发生攀移，且位错反应满足伯氏矢量守恒。',
  ].join('\n'),
  'rec-9': [
    '---',
    'title: 第9章 背诵内容',
    '---',
    '',
    '# 第9章 变形与再结晶',
    '',
    '加工硬化源于位错塞积。',
    '',
    '回复阶段位错重新排列成亚晶界。',
  ].join('\n'),
  'rec-8': [
    '---',
    'title: 第8章 背诵内容',
    '---',
    '',
    '# 第8章 固态相变',
    '',
    '相变界面存在错配位错。',
  ].join('\n'),
  'rec-4': [
    '---',
    'title: 第4章 背诵内容',
    '---',
    '',
    '# 第4章 晶态固体中的扩散',
    '',
    '扩散遵循菲克第一定律与菲克第二定律。',
  ].join('\n'),
  'rec-1': [
    '---',
    'title: 第1章 背诵内容',
    '---',
    '',
    '# 第1章 原子结构',
    '',
    '纯阅读测试第一章。',
  ].join('\n'),
  'rec-2': [
    '---',
    'title: 第2章 背诵内容',
    '---',
    '',
    '# 第2章 材料结构',
    '',
    '纯阅读测试第二章。',
  ].join('\n'),
  'sem-1': [
    '---',
    'title: 语义匹配章节',
    '---',
    '',
    '# 晶体塑性变形',
    '',
    '刃型线缺陷在切应力作用下沿密排面运动。',
  ].join('\n'),
}

// 构造超 4000 行文档用于测试 fetchFullDoc 分页续拉
const LONG_LINES = Array.from({ length: 4500 }, (_, i) => `第 ${i + 1} 行内容`)

const SEARCH_HITS = [
  // 刻意构造非相邻重复：rec-3 -> rec-9 -> rec-3 -> rec-8（旧代码这里会陷入 rec-3 <-> rec-9 死循环）
  { docId: 'rec-3', title: '第3章 背诵内容', collection: 'kaoyan', heading: '第3章', snippet: '第一段提到位错的基本概念', lineStart: 7, lineEnd: 7, chunk: 0, score: 0.9 },
  { docId: 'rec-9', title: '第9章 背诵内容', collection: 'kaoyan', heading: '第9章', snippet: '…源于位错塞积。', lineStart: 7, lineEnd: 7, chunk: 0, score: 0.85 },
  { docId: 'rec-3', title: '第3章 背诵内容', collection: 'kaoyan', heading: '第三节', snippet: '…高温下刃型位错发生攀移，且位错反应…', lineStart: 15, lineEnd: 15, chunk: 2, score: 0.8 },
  { docId: 'rec-8', title: '第8章 背诵内容', collection: 'kaoyan', heading: '第8章', snippet: '…界面存在错配位错。', lineStart: 7, lineEnd: 7, chunk: 0, score: 0.75 },
]

const fetchLog = []
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url), 'http://127.0.0.1:3081')
  const route = u.pathname.replace('/kb-api/', '')
  fetchLog.push({ route, params: Object.fromEntries(u.searchParams.entries()), method: (init && init.method) || 'GET' })
  if (route === 'status') {
    return { status: 200, ok: true, json: async () => ({ configured: true, docs: MOCK_DOCS.length, chunks: 500, collections: [{ name: 'kaoyan', docs: MOCK_DOCS.length }] }) }
  }
  if (route === 'docs') {
    const col = u.searchParams.get('collection') || ''
    const tag = u.searchParams.get('tag') || ''
    const offset = Number(u.searchParams.get('offset') || 0)
    const limit = Math.min(200, Number(u.searchParams.get('limit') || 50))
    let filtered = MOCK_DOCS.slice()
    if (col) filtered = filtered.filter((d) => d.collection === col)
    if (tag) filtered = filtered.filter((d) => d.tags.includes(tag))
    return { status: 200, ok: true, json: async () => ({ total: filtered.length, offset, limit, docs: filtered.slice(offset, offset + limit) }) }
  }
  if (route === 'search') {
    const q = u.searchParams.get('q') || ''
    if (q === '语义测试') {
      return {
        status: 200, ok: true,
        json: async () => ({
          total: 2,
          results: [
            { docId: 'sem-1', title: '语义匹配章节', collection: 'kaoyan', heading: '晶体塑性变形', snippet: '…刃型线缺陷在切应力作用下…', lineStart: 7, lineEnd: 7, chunk: 0, score: 0.7 },
            { docId: 'rec-9', title: '第9章 背诵内容', collection: 'kaoyan', heading: '第9章', snippet: '加工硬化源于位错塞积', lineStart: 7, lineEnd: 7, chunk: 0, score: 0.6 },
          ],
        }),
      }
    }
    return { status: 200, ok: true, json: async () => ({ total: SEARCH_HITS.length, results: SEARCH_HITS }) }
  }
  if (route === 'doc') {
    const id = u.searchParams.get('id')
    if (id === 'long-1') {
      const offset = Number(u.searchParams.get('offset') || 1)
      const limit = Number(u.searchParams.get('limit') || 4000)
      return {
        status: 200, ok: true,
        json: async () => ({
          id: 'long-1', title: '超长文档', collection: 'kaoyan', tags: ['教材'],
          totalLines: LONG_LINES.length,
          content: LONG_LINES.slice(offset - 1, offset - 1 + limit).join('\n'),
        }),
      }
    }
    const meta = MOCK_DOCS.find((d) => d.id === id) || { id, title: id, collection: 'kaoyan', tags: ['背诵本'] }
    const content = DOC_BODIES[id] || `---\ntitle: ${meta.title}\n---\n\n# ${meta.title}\n\n正文`
    return {
      status: 200, ok: true,
      json: async () => ({
        id: meta.id, title: meta.title, collection: meta.collection, tags: meta.tags,
        totalLines: content.split('\n').length, content,
      }),
    }
  }
  return { status: 404, ok: false, json: async () => ({ error: 'not found' }) }
}

let mod = null
globalThis.window.__ModuleLoader__ = { load({ factory }) { mod = factory((n) => (n === 'react' ? React : null)) } }
new Function('window', 'globalThis', src)(globalThis.window, globalThis)
const T = mod.__test

const ok = []
const fail = []
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (cond ? '' : '  ← ' + (extra ?? '')))

/* ---------------- 1. 纯函数级回归测试 ---------------- */
// 1.1 单字搜索
check('queryTerms 支持单字查询「碳」', JSON.stringify(T.queryTerms('碳')) === '["碳"]', JSON.stringify(T.queryTerms('碳')))
check('queryTerms 多词正常切分', T.queryTerms('位错 滑移').includes('位错') && T.queryTerms('位错 滑移').includes('滑移'))

// 1.2 服务端带省略号 … 的 snippet 定位
const rec3Parsed = T.parseDocBlocks(DOC_BODIES['rec-3'])
const focusIdx = T.findFocus(rec3Parsed.blocks, '…高温下刃型位错发生攀移，且位错反应…')
check('findFocus 剥掉首尾省略号 … 后精准命中第 5 段', focusIdx === rec3Parsed.blocks.length - 1, 'got=' + focusIdx + ' len=' + rec3Parsed.blocks.length)
check('parseDocBlocks 正确追踪原文行号', rec3Parsed.blockLines[rec3Parsed.blocks.length - 1].start === 15, JSON.stringify(rec3Parsed.blockLines))

// 1.3 单一事实源：大小写不敏感 + 跳过 <code> + LaTeX 还原后标黄与计数完全一致
const vmBcc = T.buildDocViewModel(rec3Parsed.blocks, T.queryTerms('bcc'), true)
check('buildDocViewModel 英文大小写不敏感且跳过 <code>', vmBcc.hits.length === 1, 'hits=' + vmBcc.hits.length)
const vmAlpha = T.buildDocViewModel(rec3Parsed.blocks, T.queryTerms('α'), true)
check('buildDocViewModel 支持 LaTeX 还原后的单符号 α 命中', vmAlpha.hits.length === 1, 'hits=' + vmAlpha.hits.length)
const vmDisloc = T.buildDocViewModel(rec3Parsed.blocks, T.queryTerms('位错'), true)
const totalMarksInHtml = vmDisloc.rendered.reduce((s, r) => s + ((r.html || '').match(/class="kbs-mark"/g) || []).length, 0)
check('buildDocViewModel 命中总数与 DOM <mark> 数 100% 相等', vmDisloc.hits.length === totalMarksInHtml && vmDisloc.hits.length === 5, `hits=${vmDisloc.hits.length} marks=${totalMarksInHtml}`)

// 1.4 活跃焦点标亮
const curHtml = T.highlightActiveMark('<p><mark class="kbs-mark">a</mark><mark class="kbs-mark">b</mark></p>', 1)
check('highlightActiveMark 只给第 2 个 mark 加 kbs-mark-cur', curHtml === '<p><mark class="kbs-mark">a</mark><mark class="kbs-mark kbs-mark-cur">b</mark></p>', curHtml)

// 1.5 去重结果链（防非相邻重复死循环）
const uniq = T.uniqueSearchDocs(SEARCH_HITS)
check('uniqueSearchDocs 去重保序 [rec-3, rec-9, rec-8]', uniq.map((x) => x.id).join(',') === 'rec-3,rec-9,rec-8', uniq.map((x) => x.id).join(','))

// 1.6 半角分片号支持
check('docSortKey 支持半角分片 (2/3)', T.docSortKey('第一章 第一节(2/3)').part === 2, String(T.docSortKey('第一章 第一节(2/3)').part))

// 1.7 分页拉全 >200 篇文档 & 续拉 >4000 行长文
const allDocsRes = await T.fetchAllDocs('kaoyan', '')
check('fetchAllDocs 分页拉全全部 250 篇（不再被 40/200 截断）', allDocsRes.docs.length === 250, 'got=' + allDocsRes.docs.length)
const fullLong = await T.fetchFullDoc('long-1')
check('fetchFullDoc 续拉完整 4500 行（不再静默截断于 4000 行）', fullLong.content.split('\n').length === 4500, 'lines=' + fullLong.content.split('\n').length)

/* ---------------- 2. 交互与滚动行为回归测试（带真实坐标模拟的虚拟 DOM） ---------------- */
function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  ;(node.children || []).forEach((c) => findAll(c, pred, out))
  return out
}
function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return (node.children || []).map(textOf).join('')
}

// 模拟 .kbs-text 容器与每个 block / .kbs-mark 的真实几何位置
function createMockViewport() {
  let scrollTop = 0
  let onScrollCb = null
  const blocks = []
  const box = {
    clientHeight: 400,
    get scrollTop() { return scrollTop },
    set scrollTop(v) {
      scrollTop = v
      if (onScrollCb) onScrollCb()
    },
    getBoundingClientRect() { return { top: 0, bottom: 400, height: 400 } },
    querySelectorAll(sel) {
      if (sel !== '.kbs-mark') return []
      const out = []
      for (const b of blocks) {
        for (const m of b.marks) out.push(m)
      }
      return out
    },
    setOnScroll(cb) { onScrollCb = cb },
    resetBlocks() { blocks.length = 0 },
    registerBlock(index, htmlOrCount) {
      const y = index * 120
      const markCount = typeof htmlOrCount === 'number'
        ? htmlOrCount
        : ((String(htmlOrCount || '').match(/class="kbs-mark/g) || []).length)
      const marks = []
      for (let k = 0; k < markCount; k++) {
        const my = y + 20 + k * 30 // 同一段里两处命中相距 30px（远小于半屏！）
        marks.push({
          getBoundingClientRect: () => ({ top: my - scrollTop, bottom: my + 20 - scrollTop, height: 20 }),
        })
      }
      const el = {
        offsetTop: y,
        getBoundingClientRect: () => ({ top: y - scrollTop, bottom: y + 100 - scrollTop, height: 100 }),
        querySelectorAll: (sel) => (sel === '.kbs-mark' ? marks : []),
        marks,
      }
      blocks[index] = el
      return el
    },
  }
  return box
}

const vp = createMockViewport()

function renderAndBind() {
  cursor = 0
  batch = []
  tree = T.KbPanel()
  // 绑定模拟 DOM refs
  const textBoxNode = findAll(tree, (n) => n.props && n.props.className === 'kbs-text')[0]
  if (textBoxNode) {
    vp.setOnScroll(textBoxNode.props.onScroll)
    if (typeof textBoxNode.props.ref === 'function') textBoxNode.props.ref(vp)
    else if (textBoxNode.props.ref) textBoxNode.props.ref.current = vp
    vp.resetBlocks()
    const blockNodes = findAll(textBoxNode, (n) => n.props && String(n.props.className || '').startsWith('kbs-p'))
    blockNodes.forEach((bn, idx) => {
      const html = bn.props.dangerouslySetInnerHTML ? bn.props.dangerouslySetInnerHTML.__html : ''
      const el = vp.registerBlock(idx, html)
      if (typeof bn.props.ref === 'function') bn.props.ref(el)
    })
  }
  return tree
}

async function settle(rounds = 5, waitMs = 60) {
  for (let r = 0; r < rounds; r++) {
    const todo = batch.slice()
    batch = []
    for (const item of todo) {
      if (typeof effectCleanups[item.i] === 'function') {
        try { effectCleanups[item.i]() } catch {}
      }
      effectCleanups[item.i] = item.fn()
    }
    await new Promise((res) => setTimeout(res, waitMs))
    renderAndBind()
  }
}

/* --- 场景 A：列表不截断 + 纯阅读只走书本序 + 换页回顶 + 不冒出假搜索导航 --- */
resetReact()
renderAndBind()
await settle(6, 60)
const allRows = findAll(tree, (n) => n.props && n.props.className === 'kbs-row')
check('场景A：文档列表完整展示 250 篇（无 40 篇截断）', allRows.length === 250, 'rows=' + allRows.length)

// 点击第1章背诵本（纯阅读态）
const rec1Row = allRows.find((r) => textOf(r).includes('第1章 背诵内容'))
check('场景A：找到第1章背诵本', !!rec1Row)
rec1Row.props.onClick()
await settle(6, 60)

// 模拟读到底部（scrollTop = 900）
vp.scrollTop = 900
const footBtnsRead = findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-btn')
check('场景A：纯阅读底部下一篇严格走背诵本第2章（不被混排列表劫持到教材）', footBtnsRead.some((b) => textOf(b).includes('第2章 背诵内容')), footBtnsRead.map(textOf).join(' | '))

// 点击「第2章 背诵内容 ›」换页
const nextBookBtn = footBtnsRead.find((b) => textOf(b).includes('第2章 背诵内容'))
nextBookBtn.props.onClick()
await settle(6, 60)
check('场景A：纯阅读换页后顶部绝不冒出假搜索导航 ‹ n/N ›', findAll(tree, (n) => n.props && n.props.className === 'kbs-nav').length === 0)
check('场景A：未读过的新章打开时 scrollTop 自动归零回顶', vp.scrollTop === 0, 'scrollTop=' + vp.scrollTop)

/* --- 场景 B：搜索精准落位 + 下一处不弹回 + 手动滚动不弹回 + 跨篇不死循环 + 上一处对称跨回 --- */
// 点返回
const back1 = findAll(tree, (n) => n.props && textOf(n) === '← 返回')[0]
const beforeReturnFetches = fetchLog.length
back1.props.onClick()
await settle(4, 60)
check('场景B：点击 ← 返回不触发冗余网络重拉', fetchLog.length === beforeReturnFetches, `before=${beforeReturnFetches} after=${fetchLog.length}`)

// 搜「位错」
const searchInput = findAll(tree, (n) => n.props && String(n.props.placeholder || '').includes('搜随身书柜'))[0]
searchInput.props.onChange({ target: { value: '位错' } })
await settle(6, 80)
const searchRows = findAll(tree, (n) => n.props && n.props.className === 'kbs-row')
check('场景B：搜索返回 4 条结果', searchRows.length === 4, 'got=' + searchRows.length)

// 点击第 3 条结果（rec-3 的第 15 行片段，带 …）：必须精准落到该段第 4/5 处，而不是第 1/5 处！
searchRows[2].props.onClick()
await settle(6, 60)
const countText0 = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-count')[0])
check('场景B：点击同章中后段结果精准落到第 4/5 处（不再落回 1/5）', countText0 === '命中 4 / 5', countText0)

// 点「下一处 ›」（从 4/5 → 5/5，两处相距仅 30px！）等 600ms 验证绝不弹回 4/5！
const nextHitBtn1 = findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0]
nextHitBtn1.props.onClick()
await settle(4, 60)
const scrollAfterNext = vp.scrollTop
await new Promise((r) => setTimeout(r, 500))
renderAndBind()
const countAfterWait = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-count')[0])
check('场景B：相近两处命中点「下一处」后 500ms 绝不弹回上一处', countAfterWait === '命中 5 / 5' && vp.scrollTop === scrollAfterNext, `count=${countAfterWait} scroll=${vp.scrollTop} vs ${scrollAfterNext}`)

// 用户手动滚到最顶（scrollTop = 0），等 500ms：指示器可被动更新，但 scrollTop 绝不被强行拽回！
await new Promise((r) => setTimeout(r, 500)) // 过保护期
vp.scrollTop = 0
await new Promise((r) => setTimeout(r, 450))
await settle(3, 60)
check('场景B：手动滑动后页面绝不被橡皮筋弹回', vp.scrollTop === 0, 'scrollTop=' + vp.scrollTop)

// 回到 5/5 再点「下一处 ›」→ 必须跨篇到 rec-9 的 1/2（不再跳回 rec-3 死循环！）
// 先用顶部 ‹ › 或直接点下一处走到 5/5
for (let step = 0; step < 6; step++) {
  const ct = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-count')[0])
  if (ct === '命中 5 / 5') break
  findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0].props.onClick()
  await settle(2, 40)
}
findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0].props.onClick()
await settle(6, 60)
const titleAfterCross = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-doc-title')[0])
const countInRec9 = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-count')[0])
check('场景B：本篇走完「下一处」跳到下一篇去重结果 rec-9 第 1 处', titleAfterCross.includes('第9章') && countInRec9 === '命中 1 / 2', `${titleAfterCross} | ${countInRec9}`)

// 在 rec-9 第 1 处点「‹ 上一处」→ 必须对称跨回 rec-3 的最后一处（5/5）！
findAll(tree, (n) => n.props && textOf(n) === '‹ 上一处')[0].props.onClick()
await settle(6, 60)
const titleBack = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-doc-title')[0])
const countBack = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-count')[0])
check('场景B：篇首点「‹ 上一处」对称跨回上一篇最后一处（5/5）', titleBack.includes('第3章') && countBack === '命中 5 / 5', `${titleBack} | ${countBack}`)

// 再验证从 rec-9 走完到 rec-8（不会掉回 rec-3 死循环！）
findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0].props.onClick() // rec-3(5/5) -> rec-9(1/2)
await settle(5, 50)
findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0].props.onClick() // rec-9(1/2) -> rec-9(2/2)
await settle(3, 50)
findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0].props.onClick() // rec-9(2/2) -> rec-8(1/1)
await settle(5, 50)
const titleRec8 = textOf(findAll(tree, (n) => n.props && n.props.className === 'kbs-doc-title')[0])
check('场景B：非相邻重复列表走完 rec-9 直接进 rec-8（彻底杜绝 rec-3↔rec-9 死循环）', titleRec8.includes('第8章'), titleRec8)

/* --- 场景 C：目录跳转不弹回旧断点 + 切篇自动退出编辑态 --- */
// 预置一个旧断点到 rec-3 第 4 段
ls.set('kbs-pos:rec-3', JSON.stringify({ i: 4, at: Date.now() }))
// 切回 rec-3
findAll(tree, (n) => n.props && textOf(n) === '下一处 ›')[0].props.onClick() // rec-8(1/1) -> wrap rec-3(1/5)
await settle(5, 50)
// 点目录 → 点第一个标题（index=0）
const outlineToggle = findAll(tree, (n) => n.props && /^目录 /.test(textOf(n)))[0]
outlineToggle.props.onClick()
await settle(2, 40)
const firstOli = findAll(tree, (n) => n.props && n.props.className === 'kbs-oli')[0]
firstOli.props.onClick()
await settle(4, 60)
check('场景C：点目录跳转后停在目标标题（不弹回旧断点第 4 段）', vp.scrollTop < 100, 'scrollTop=' + vp.scrollTop)

// 开编辑框后点顶部 › 切篇 → 编辑框必须自动关闭，绝不串篇！
const editBtn = findAll(tree, (n) => n.props && textOf(n) === '编辑')[0]
editBtn.props.onClick()
await settle(2, 40)
check('场景C：已进入编辑态', findAll(tree, (n) => n.props && n.props.className === 'kbs-edit-ta').length === 1)
const topNextRes = findAll(tree, (n) => n.props && textOf(n) === '›')[0]
topNextRes.props.onClick()
await settle(5, 50)
check('场景C：切篇后编辑态自动清空，防止旧草稿误写进下一篇', findAll(tree, (n) => n.props && n.props.className === 'kbs-edit-ta').length === 0)

/* --- 场景 D：专注模式保留搜索导航 + 语义匹配无字面命中不卡死 --- */
const focusBtn = findAll(tree, (n) => n.props && textOf(n) === '专注')[0]
focusBtn.props.onClick()
await settle(3, 40)
const focusBar = findAll(tree, (n) => n.props && n.props.className === 'kbs-focusbar')[0]
check('场景D：专注模式顶部栏保留结果导航 ‹ n/N › 与命中计数',
  !!focusBar &&
  findAll(focusBar, (n) => n.props && n.props.className === 'kbs-nav').length === 1 &&
  findAll(focusBar, (n) => n.props && /^命中 /.test(textOf(n))).length === 1,
  focusBar ? textOf(focusBar) : 'no focusBar')
// 退出专注模式
findAll(tree, (n) => n.props && textOf(n) === '退出')[0].props.onClick()
await settle(2, 40)

// 回到列表，搜「语义测试」（0 字面命中）
findAll(tree, (n) => n.props && textOf(n) === '← 返回')[0].props.onClick()
await settle(3, 40)
const input2 = findAll(tree, (n) => n.props && String(n.props.placeholder || '').includes('搜随身书柜'))[0]
input2.props.onChange({ target: { value: '语义测试' } })
await settle(6, 80)
const semRows = findAll(tree, (n) => n.props && n.props.className === 'kbs-row')
semRows[0].props.onClick()
await settle(5, 50)
const semFoot = findAll(tree, (n) => n.props && n.props.className === 'kbs-foot-btn').map(textOf).join('|')
check('场景D：纯语义匹配（0 字面命中）底部显示「上一条结果 / 下一条结果」不卡死', semFoot === '‹ 上一条结果|下一条结果 ›', semFoot)

/* ---------------- 汇总 ---------------- */
console.log('\n✔ ' + ok.length + ' passed')
ok.forEach((n) => console.log('  ✓ ' + n))
if (fail.length) {
  console.log('\n✘ ' + fail.length + ' failed')
  fail.forEach((n) => console.log('  ✗ ' + n))
  process.exit(1)
}
