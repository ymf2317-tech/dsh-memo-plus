// 验证 MemoSlot（右栏 tab 的正文）能渲染出带三页签的 MemoPanel
// 关键：MemoSlot 返回的是 h(MemoPanel, props) 这个「元素」，要递归展开函数组件才能看到树。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.resolve(HERE, '../lib/client.js'), 'utf8')

let cursor = 0
let slots = []
let refs = []
let cbStore = []
let effectDeps = []
let batch = []

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
    if (changed) batch.push(fn)
  },
  useRef(init) { const i = cursor++; if (!(i in refs)) refs[i] = { current: init }; return refs[i] },
  useCallback(fn, deps) {
    const i = cursor++
    const prev = cbStore[i]
    const changed = !prev || !deps || deps.some((d, k) => d !== prev.deps[k])
    if (!prev || changed) cbStore[i] = { fn, deps: deps ? deps.slice() : [] }
    return cbStore[i].fn
  },
  useMemo(fn) { cursor++; return fn() },
  // 用函数而非 class：memo 里的错误边界是 ES5 风格 `Component.call(this, props)`，class 不能被 call
  Component: (function () {
    function C(props) { this.props = props || {}; this.state = {} }
    C.prototype.setState = function (s) { Object.assign(this.state, typeof s === 'function' ? s(this.state, this.props) : s) }
    C.prototype.render = function () { return null }
    return C
  })(),
}

globalThis.window = {
  location: { origin: 'http://127.0.0.1:3081' },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: (function () {
    var captured = []
    globalThis.__CSS_CAPTURED = captured
    return {
      createElement: function () {
        var el = { setAttribute() {}, remove() {}, style: {} }
        Object.defineProperty(el, 'textContent', { set: function (v) { captured.push(String(v)) }, get: function () { return captured[captured.length - 1] || '' } })
        return el
      },
      head: { appendChild() {} },
    }
  })(),
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.document = globalThis.window.document
globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, value: { items: [], stats: { total: 0, todo: 0 } } }) })

let mod = null
globalThis.window.__ModuleLoader__ = { load({ factory }) { mod = factory((n) => (n === 'react' ? React : null)) } }
new Function('window', 'globalThis', src)(globalThis.window, globalThis)

const T = mod.__test
if (!T) throw new Error('缺少 __test')

// 伪造 ctx，捕获右栏 tab 注册的组件
const registered = {}
const fakeCtx = {
  effect: (fn) => { if (typeof fn === 'function') { try { fn() } catch (e) {} } },
  locale: { register: () => () => {}, bind: () => (k) => k },
  slots: {
    inject: (name, fn) => { try { fn() } catch (e) {} },
    register: (opts, comp) => { registered[opts.name + ':' + (opts.key || opts.id)] = comp; return () => {} },
  },
  inject: (deps, fn) => {
    console.log("[桩] ctx.inject 调用:", JSON.stringify(deps))
    const c = {
      sidebarRightTabs: { register: () => () => {} },
      slots: {
        inject: (n, f2) => {
          try { f2() } catch (e) { console.log('[桩] slots.inject 抛错:', e.message) }
        },
        register: (opts, comp) => { registered[opts.name + ':' + (opts.key || opts.id)] = comp; return () => {} },
      },
    }
    fn(c)
  },
}
mod.apply(fakeCtx)

const tabComp = registered['sidebar.right.pane.tab:@dsh-kb-sidebar/kb'] || registered['sidebar.right.pane.tab']
console.log('注册到的键:', Object.keys(registered).join(' | '))
console.log('右栏 tab 正文组件:', tabComp ? (tabComp.name || 'anonymous') : '缺失')

/* 递归展开：遇到函数类型的 type 就调用它（重新计 cursor），得到真正的树 */
function expand(node, depth = 0) {
  if (node == null || typeof node !== 'object') return node
  if (depth > 30) return node
  // 函数组件 → 渲染
  if (typeof node.type === 'function') {
    const isClass = node.type.prototype && node.type.prototype.render
    if (isClass) {
      const inst = new node.type(node.props)
      if (typeof inst.componentDidCatch !== 'function') inst.componentDidCatch = () => {}
      return expand(inst.render(), depth + 1)
    }
    cursor = 0
    batch = []
    const rendered = node.type(node.props)
    return expand(rendered, depth + 1)
  }
  if (node.type === undefined) {
    // 纯包装节点
    return { ...node, children: (node.children || []).map((c) => expand(c, depth + 1)) }
  }
  return { ...node, children: (node.children || []).map((c) => expand(c, depth + 1)) }
}

const texts = (n, out = []) => {
  if (n == null) return out
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out }
  if (n.props && n.props.dangerouslySetInnerHTML) out.push(String(n.props.dangerouslySetInnerHTML.__html || ''))
  ;(n.children || []).forEach((c) => texts(c, out))
  return out
}
const findAll = (n, pred, out = []) => {
  if (!n || typeof n !== 'object') return out
  if (n.props && pred(n)) out.push(n)
  ;(n.children || []).forEach((c) => findAll(c, pred, out))
  return out
}

if (!tabComp) { console.log('✘ 右栏 tab 未注册'); process.exit(1) }
cursor = 0
const root = tabComp({})
const tree = expand(root)
const t = texts(tree).join(' ')
const tabs = findAll(tree, (n) => String(n.props.className || '').includes('dm-vtab'))
console.log('页签数:', tabs.length, '→', tabs.map((x) => texts(x).join('')).join(' | '))
console.log('页签文案齐全:', ['检索', '备忘', '笔记'].every((k) => t.includes(k)))
console.log('含「随身书柜」标题:', t.includes('随身书柜'))

const wrap = findAll(tree, (n) => String(n.props.className || '').includes('dm-wrap'))[0]
console.log('dm-wrap 带 dm-kbview:', !!(wrap && String(wrap.props.className).includes('dm-kbview')))
const kbBox = findAll(tree, (n) => String(n.props.className || '') === 'dm-kb')
console.log('dm-kb 容器存在:', kbBox.length === 1)
console.log('dm-kb 不再绝对定位:', !/.dm-kb{position:absolute/.test(src))
console.log('知识库正文已渲染:', t.includes('继续读上次的位置') || t.includes('全部') || t.includes('搜随身书柜'))
const first = tabs[0]
console.log('默认选中第一个页签:', !!(first && String(first.props.className).includes('on')))

// 切到「备忘」页签：备忘控件应回来、kbview 修饰类应消失
const memoTab = tabs.find((x) => texts(x).join('') === '备忘')
if (memoTab && memoTab.props.onClick) {
  memoTab.props.onClick()
  cursor = 0
  const tree2 = expand(tabComp({}))
  const wrap2 = findAll(tree2, (n) => String(n.props.className || '').includes('dm-wrap'))[0]
  const t2 = texts(tree2).join(' ')
  console.log('切到备忘后 kbview 消失:', !!(wrap2 && !String(wrap2.props.className).includes('dm-kbview')))
  console.log('备忘输入区回来了:', findAll(tree2, (n) => String(n.props.className || '') === 'dm-compose').length === 1)
  console.log('备忘页签已选中:', !!(findAll(tree2, (n) => String(n.props.className || '').includes('dm-vtab')).find((x) => texts(x).join('') === '备忘') || {}).props?.className?.includes('on'))
}

// 切到「笔记」页签：列表页必须有搜索框（v0.4.0-ymfd.7）
const noteTab = tabs.find((x) => texts(x).join('').startsWith('笔记'))
if (noteTab && noteTab.props.onClick) {
  noteTab.props.onClick()
  cursor = 0
  const tree3 = expand(tabComp({}))
  const find = findAll(tree3, (n) => String(n.props.className || '') === 'dm-notefind')[0]
  console.log('笔记页搜索框存在:', !!find)
  console.log('笔记页搜索框占位文案:', !!(find && String(find.props.placeholder || '').includes('搜笔记')))
  console.log('笔记页仍有新建入口:', findAll(tree3, (n) => String(n.props.className || '') === 'dm-newbtn').length === 1)
}

// ---- 样式表内容断言：.kbs-* 必须真的在 <style> 里（曾经被拼在 ].join 之后成了死代码）----
const css = (globalThis.__CSS_CAPTURED || []).join('\n')
console.log('CSS 长度:', css.length)
for (const sel of ['.kbs{', '.kbs-body{', '.kbs-row{', '.kbs-chip{', '.dm-kb{', '.dm-vtab.on{']) {
  console.log('  含 ' + sel + ':', css.includes(sel))
}
console.log('  .kbs-body 带 stretch:', /\.kbs-body\{[^}]*align-items:stretch/.test(css))
console.log('  .kbs-row 铺满:', /\.kbs-row\{[^}]*width:100%/.test(css))
