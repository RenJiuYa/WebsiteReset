// ============================================================
// 工具类：disableShortcut —— 让页面上某个快捷键失效
// 由总入口 start.user.js 自动加载（在站点 JS 之前执行），Web/ 下的 .js 里可直接调用：
//
//   disableShortcut('G');                        // 让 G 键在页面上失效
//   disableShortcut('Ctrl Alt G');                // 组合键（顺序随意、大小写随意）
//   disableShortcut('Ctrl+Alt+G');                // + 号分隔也可以
//   disableShortcut('Space');                     // 支持别名：space / esc / up / down / left / right …
//   disableShortcut('G', { inInputs: true });     // 连输入框里也拦（默认跳过输入框）
//
// 返回值：恢复函数。调用后这个键位就恢复正常：
//   const restore = disableShortcut('G');  // 后悔了 → restore();
//
// 匹配规则：
//   · Ctrl / Alt / Meta（Win/Cmd）严格匹配：写了就必须按住，没写就必须没按
//   · Shift 忽略：Shift+G 也算命中（否则会漏拦）
//   · 字母大小写不敏感；同时比对 event.key 和 event.code（G ↔ KeyG），主键区/小键盘都能拦
//   · 默认在 input / textarea / select / [contenteditable] 上不拦（否则会毁掉打字）
//
// 实现方式：在 window 上以「捕获阶段」监听 keydown + keyup，命中就
//   stopImmediatePropagation()（页面收不到）+ preventDefault()（浏览器默认行为也拦）。
//   因为本脚本 @run-at document-start，注册得比页面自己的监听更早、层级更外，所以不会被抢先。
//
// 注意（拦不住的）：
//   · 浏览器/系统自己的快捷键：Ctrl+W/T/N/L、F11、Ctrl+Shift+Del… 页面 JS 收不到或拦不了
//   · 极少数站点用 keypress 或非键盘机制触发；也有站点用别的键位名（如 event.code 定向）
//   · 与"临时退出脚本"开关无关：退出脚本不会自动解除拦截，请用返回的 restore()
// ============================================================

(function () {
  'use strict';

  // 别名：把常见的写法归一化
  const ALIASES = {
    space: 'space',
    spacebar: 'space',
    esc: 'escape',
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
    return: 'enter',
    del: 'delete',
    ins: 'insert',
    pgup: 'pageup',
    pgdn: 'pagedown',
    cmd: 'meta',
    command: 'meta',
    win: 'meta',
    super: 'meta',
    option: 'alt',
    control: 'ctrl',
  };

  function aliasKey(token) {
    const t = String(token).toLowerCase();
    return ALIASES[t] || t;
  }

  // event.key 归一化（空格是 ' '，统一叫 space）
  function normKey(k) {
    const s = k == null ? '' : String(k);
    if (s === ' ') return 'space';
    return s.toLowerCase();
  }

  // 由主键推出可能的 event.code（小写比较）
  function codeFor(k) {
    if (/^[a-z]$/.test(k)) return 'key' + k;
    if (/^[0-9]$/.test(k)) return 'digit' + k;
    return k;
  }

  // 解析快捷键字符串 → { ctrl, alt, shift, meta, key, code }；无法识别返回 null
  function parseShortcut(str) {
    if (typeof str !== 'string' || str.trim() === '') return null;
    const spec = { ctrl: false, alt: false, shift: false, meta: false, key: '', code: '' };
    const mains = [];
    str
      .trim()
      .split(/[\s+]+/)
      .filter(Boolean)
      .forEach(function (part) {
        const low = aliasKey(part);
        if (low === 'ctrl') spec.ctrl = true;
        else if (low === 'alt') spec.alt = true;
        else if (low === 'shift') spec.shift = true;
        else if (low === 'meta') spec.meta = true;
        else mains.push(low);
      });
    if (mains.length !== 1) return null; // 必须且只能有一个主键
    spec.key = mains[0];
    spec.code = codeFor(spec.key);
    return spec;
  }

  function matchEvent(ev, spec) {
    if (!!ev.ctrlKey !== spec.ctrl) return false;
    if (!!ev.altKey !== spec.alt) return false;
    if (!!ev.metaKey !== spec.meta) return false;
    // Shift 忽略（spec.shift 只作记录，不参与判断）
    if (normKey(ev.key) === spec.key) return true;
    const code = String(ev.code || '').toLowerCase();
    return !!code && code === spec.code;
  }

  // 可编辑元素：默认不拦（否则会把打字也拦掉）
  function isEditable(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable === true) return true;
    const attr = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
    return attr === '' || attr === 'true' || attr === 'plaintext-only';
  }

  /**
   * 让某个快捷键在页面上失效
   * @param {string} shortcut 快捷键，如 'G'、'Ctrl Alt G'、'Ctrl+Shift+P'、'Space'
   * @param {object} [options] { inInputs: true } 时连输入框里也拦
   * @returns {Function} 恢复函数
   */
  function disableShortcut(shortcut, options) {
    const noop = function () {};
    const spec = parseShortcut(shortcut);
    if (!spec) {
      console.error('[shortcut] 快捷键写法无法识别（需要「修饰键… + 一个主键」）：' + shortcut);
      return noop;
    }

    const win = typeof window !== 'undefined' ? window : null;
    if (!win || typeof win.addEventListener !== 'function') {
      console.error('[shortcut] 当前环境没有 window，无法拦截按键');
      return noop;
    }

    const inInputs = !!(options && options.inInputs === true);
    let active = true;

    function onKey(ev) {
      if (!active) return;
      if (!inInputs && isEditable(ev.target)) return;
      if (!matchEvent(ev, spec)) return;
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
    }

    win.addEventListener('keydown', onKey, true);
    win.addEventListener('keyup', onKey, true);

    return function restore() {
      active = false;
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('keyup', onKey, true);
    };
  }

  // 挂到全局，Web/ 下的 .js 模块可直接调用（disableKey 是同名短别名）
  if (typeof globalThis !== 'undefined') {
    globalThis.disableShortcut = disableShortcut;
    globalThis.disableKey = disableShortcut;
  }
})();
