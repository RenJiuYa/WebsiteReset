// ==UserScript==
// @name          网页大修-总入口
// @namespace     RenJiuYa
// @version       1.0.5
// @description   统一管理各网站样式（CSS/JS）的启用与加载
// @author        RenJiuYa
//
// @match         *://*/*
//
// @run-at        document-start
//
// @grant         GM_xmlhttpRequest
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         GM_registerMenuCommand
// @connect       127.0.0.1
// @connect       cdn.jsdelivr.net
// ==/UserScript==

// ============================================================
// 总入口说明（本项目唯一入口，直接装在暴力猴里）
// 1. 本文件在仓库根目录；各网站的样式模块放在 Web/<网站>/ 下。
// 2. 站点管理（哪些网站、加载哪些文件）在 Web/sites.js，运行时读取：
//    改完 sites.js 只需刷新页面即生效，不用改本文件、也不用在暴力猴里更新脚本。
// 3. @match 故意写成全站通配（*://*/*）：插件头部的匹配范围在注入前就定死了，
//    脚本运行时无法动态扩大，所以"真正生效范围"交给 sites.js 里的 hosts 判断。
//    新增网站：建好 Web/<网站>/ 文件夹 → 在 sites.js 里加一条即可。
// 4. 永久停用某网站：把 sites.js 里该站点的 enabled 改成 false。
// 5. 「CSS 做不到的」规则（文本匹配、按计算样式匹配、向上隐藏等）写在根目录 ublock.user.txt，
//    用 uBlock Origin 的自定义过滤列表语法，由 uBO 执行，本脚本不参与。
//    工具类机制保留在 utils/ 下（目前为空）：加文件后把路径写进 UTILS 即会自动加载。
// 6. 改完 CSS 后：暴力猴菜单点「重新加载样式（手动刷新）」立即生效（不做定时轮询，避免组件闪烁）；
//    发布模式下该操作受 CDN 缓存影响，需要等 jsDelivr 刷新。
// 7. 运行时临时退出：暴力猴菜单点「临时退出脚本」，样式立刻移除，方便和原网站对比；
//    该选择会被记住（刷新页面依然生效），直到点「重新启用脚本」。
//    注意：已执行过的 JS 模块无法撤销，需刷新页面才会失效。
// 8. 需要注入 shadow DOM（只支持 open）的样式：在 .less/.css 里用注释标记
//    /* @shadow(.宿主选择器) */  ...  /* @shadow-end */
//    多层用嵌套（内层在「外层 shadow root 内部」找宿主），或用语法糖 >> 分隔路径。
// ============================================================

(function () {
  'use strict';

  // ============ 开发/发布开关 ============
  const IS_DEV = true;

  // 你写的 CSS 是否自动补 !important（省得每条声明都手写）
  // 注意：@keyframes / @font-face 这类"描述符块"和 CSS 变量（--x）会自动跳过
  const FORCE_IMPORTANT = true;

  const LOCAL_BASE = 'http://127.0.0.1:5500';                              // 本地 live-server 根目录（=仓库根目录）
  const REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@v1.0.5'; // 发布地址，版本号与 @version 同步（tag 内容不可变，改完要换新 tag）
  const BASE = IS_DEV ? LOCAL_BASE : REMOTE_BASE;

  // ============ 站点管理（外部文件 Web/sites.js，运行时读取） ============
  // 好处：改站点、改文件清单只需刷新页面，不必修改本文件、也不必在暴力猴里更新脚本
  const SITES_URL = BASE + '/Web/sites.js';
  const SITES_CACHE = 'sitesCache'; // 读取失败时的兜底缓存

  // ============ 工具类（utils/ 下的文件，自动加载） ============
  // 这些文件在站点 JS 之前执行，执行完会把函数挂到全局，
  // 所以 Web/ 下的 .js 里可以直接调用，不需要任何声明。
  // 目前为空：原先的 hasText / toStyle 已改成 ublock.user.txt 里的 uBO 规则实现。
  // 需要时：在 utils/ 下建文件 → 把路径加到下面这一行
  const UTILS = [];

  // 当前命中的站点及该站点的样式根地址（由 boot() 赋值）
  let SITE = null;
  let SITE_BASE = '';

  // 读取 sites.js 源码：失败时回退上次缓存
  async function loadSitesSource() {
    try {
      const src = await gmFetch(SITES_URL);
      GM_setValue(SITES_CACHE, src);
      return src;
    } catch (err) {
      const cached = GM_getValue(SITES_CACHE, '');
      if (cached) {
        console.warn('[网页大修] 读取站点配置失败，已回退上次缓存: ' + err.message);
        return cached;
      }
      console.error('[网页大修] 读取站点配置失败，本次不加载样式: ' + err.message);
      return '';
    }
  }

  // sites.js 的内容形如：const SITES = { '网站名': { ... } };
  function parseSites(src) {
    return new Function(src + '\nreturn SITES;')();
  }

  // 匹配当前站点（enabled 省略时视为启用；files 必须是模块名数组）
  function matchSite(sites) {
    const host = location.hostname;
    return Object.values(sites).find(
      (site) =>
        site.enabled !== false &&
        Array.isArray(site.files) &&
        site.hosts.some((h) => host === h || host.endsWith('.' + h))
    );
  }

  // 解析站点配置，并加载命中的网站样式
  async function boot() {
    const src = await loadSitesSource();
    if (!src) return;

    let sites;
    try {
      sites = parseSites(src);
    } catch (err) {
      console.error('[网页大修] 站点配置解析失败: ' + err.message);
      return;
    }

    SITE = matchSite(sites) || null;
    if (!SITE) return; // 未登记的网站：什么都不做

    SITE_BASE = BASE + '/' + SITE.dir;
    // CSS 与工具类并行加载（工具类必须先执行完，站点 JS 里才能直接调用）
    const [cssCount] = await Promise.all([loadAllCSS(), loadUtils()]);
    const jsCount = await loadAllJS();
    if (cssCount + jsCount === 0) {
      console.warn('[网页大修] 没有找到任何模块文件，请检查 sites.js 里的 dir 与模块名: ' + SITE_BASE);
    }
  }

  // 重新加载样式：已命中站点只重拉 CSS，否则重新走一遍完整流程
  function reloadStyles() {
    return SITE ? loadAllCSS() : boot();
  }

  // ============ 工具函数 ============
  // 加时间戳绕过缓存（仅开发模式需要）
  function withCacheBust(url) {
    return IS_DEV ? url + '?t=' + Date.now() : url;
  }

  // 用 Promise 包装 GM_xmlhttpRequest，方便 async/await
  // reject 出的 Error 上带 status（404 = 文件不存在，用于跳过没有该扩展名的模块）
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: withCacheBust(url),
        onload: (res) => {
          if (res.status === 200) {
            resolve(res.responseText);
            return;
          }
          const err = new Error('HTTP ' + res.status + ': ' + url);
          err.status = res.status;
          reject(err);
        },
        onerror: () => reject(new Error('网络错误: ' + url)),
      });
    });
  }

  function head() {
    return document.head || document.documentElement;
  }

  // ============ 加载 CSS ============
  // sites.js 里只写模块名，这里自动去找同名的 .css（不存在就跳过）；
  // 先把 CSS 全部拉到内存，再就地更新 <style> 的 textContent；
  // 全程不删除任何 style 元素、写入前也没有 await，因此不会出现"短暂无样式"的闪烁。
  async function loadAllCSS() {
    const files = SITE.files.map((name) => name + '.css');
    const results = await Promise.allSettled(
      files.map((file) => gmFetch(SITE_BASE + '/' + file))
    );

    let loaded = 0;
    let allOk = true;
    const shadowDefs = [];

    results.forEach((r, i) => {
      const file = files[i];
      if (r.status === 'rejected') {
        // 404 = 这个模块没有 css，属于正常情况，跳过
        if (!r.reason || r.reason.status !== 404) {
          console.error('[CSS] 加载失败: ' + file, r.reason);
          allOk = false;
        }
        return;
      }

      // 自动补 !important → 摘出 /* @shadow(...) */ 块
      let css = forceImportant(r.value);
      try {
        const split = splitShadowBlocks(css);
        css = split.plain;
        for (const b of split.blocks) {
          if (!b.css) continue; // 只有嵌套、自身没有 CSS 的外壳块：跳过（不用生成空样式表）
          const pathKey = b.path.join(' ' + SHADOW_SEP + ' ');
          const dup = shadowDefs.filter((x) => x.pathKey === pathKey).length;
          shadowDefs.push({ key: file + ' | ' + pathKey + '#' + dup, pathKey: pathKey, path: b.path, css: b.css });
        }
      } catch (err) {
        console.error('[shadow] ' + file + ' 的标记解析失败，本次不处理 shadow 块：' + err.message);
        allOk = false; // 标记可能有误 → 不做"清理已删除的标记块"
      }

      let style = document.querySelector('style[data-module-css="' + file + '"]');
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-module-css', file);
        style.textContent = css; // 先填内容再插入 → 不会出现空白样式的瞬间
        head().appendChild(style);
      } else {
        style.textContent = css;
      }
      loaded++;
    });

    applyShadowBlocks(shadowDefs, allOk);
    return loaded;
  }

  // ============ 加载工具类 ============
  // 在站点 JS 模块之前执行；工具类自己会把函数挂到全局（如 globalThis.hasText）
  async function loadUtils() {
    for (const file of UTILS) {
      try {
        const code = await gmFetch(BASE + '/' + file);
        new Function(code)();
      } catch (err) {
        console.error('[工具类] 加载失败: ' + file, err);
      }
    }
  }

  // ============ 加载 JS 模块 ============
  // 同样按模块名去找同名的 .js（不存在就跳过）；按顺序执行，保证模块之间的依赖顺序
  async function loadAllJS() {
    let loaded = 0;
    for (const name of SITE.files) {
      const file = name + '.js';
      try {
        const code = await gmFetch(SITE_BASE + '/' + file);
        // 用 Function 构造器执行，避免 eval 的一些限制
        // 注意：模块内的代码在全局作用域执行，可直接操作页面
        new Function(code)();
        loaded++;
      } catch (err) {
        // 404 = 这个模块没有 js，属于正常情况，跳过
        if (err.status === 404) continue;
        console.error('[JS] 加载失败: ' + file, err);
      }
    }
    return loaded;
  }

  // ============ 自动 !important ============
  // 你写的每条声明都会自动补上 !important（已经写了的不会重复加），所以 .less/.css 里不用再手写。
  // 只在「样式规则的声明」上加；下面这些情况会跳过（加了反而会让整条声明被浏览器忽略）：
  //   @keyframes / @-webkit-keyframes     动画关键帧
  //   @font-face / @property / @counter-style / @font-palette-values 等描述符块
  //   CSS 变量（--xxx: ...）               交给页面/组件自己消费，不强制
  const NO_IMPORTANT_AT = [
    '@keyframes',
    '@-webkit-keyframes',
    '@font-face',
    '@property',
    '@counter-style',
    '@font-palette-values',
    '@viewport',
    '@page',
  ];

  function forceImportant(css) {
    if (!FORCE_IMPORTANT) return css;
    const n = css.length;
    let out = '';
    let buf = '';
    let i = 0;
    let quote = '';
    let paren = 0;
    const stack = [{ decls: false, skip: false }]; // 顶层：这里不是声明

    // 在当前段落末尾补 !important（段落正文已经逐字符写进 out，这里只补后缀）
    function closeDecl() {
      const ctx = stack[stack.length - 1];
      const seg = buf;
      buf = '';
      if (!ctx.decls || ctx.skip) return;
      if (seg.indexOf(':') === -1) return;
      if (/^\s*--/.test(seg)) return; // CSS 变量不强制
      if (/!\s*important\s*$/i.test(seg)) return; // 已经有了，不重复
      const tail = /[ \t\r\n]+$/.exec(out);
      if (tail) out = out.slice(0, out.length - tail[0].length);
      out += ' !important';
    }

    while (i < n) {
      const ch = css[i];
      if (quote) {
        // 字符串：原样复制（里面的 ; : !important 都不动）
        out += ch;
        buf += ch;
        if (ch === '\\' && i + 1 < n) {
          out += css[i + 1];
          buf += css[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) quote = '';
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        out += ch;
        buf += ch;
        i++;
        continue;
      }
      if (ch === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2);
        const chunk = end === -1 ? css.slice(i) : css.slice(i, end + 2);
        out += chunk;
        buf += chunk;
        i += chunk.length;
        continue;
      }
      if (ch === '(') { paren++; out += ch; buf += ch; i++; continue; } // url(...)/:not(...) 里的 ; 不算分隔
      if (ch === ')') { if (paren > 0) paren--; out += ch; buf += ch; i++; continue; }

      if (paren === 0 && ch === '{') {
        const prelude = buf; // prelude 已经逐字符写进 out 了，这里只判断类型
        buf = '';
        out += ch;
        const parent = stack[stack.length - 1];
        if (parent.skip) {
          stack.push({ decls: true, skip: true }); // 描述符块里面继续保持跳过
        } else if (prelude.trim().charAt(0) === '@') {
          const head = prelude.trim().toLowerCase().split(/[\s(]/)[0];
          stack.push(
            NO_IMPORTANT_AT.indexOf(head) !== -1
              ? { decls: true, skip: true }
              : { decls: parent.decls, skip: false } // @media/@supports/@layer…：继承"能不能写声明"
          );
        } else {
          stack.push({ decls: true, skip: false }); // 普通选择器块：里面是声明
        }
        i++;
        continue;
      }
      if (paren === 0 && ch === '}') {
        closeDecl();
        out += ch;
        if (stack.length > 1) stack.pop();
        i++;
        continue;
      }
      if (paren === 0 && ch === ';') {
        closeDecl();
        out += ';';
        i++;
        continue;
      }
      out += ch;
      buf += ch;
      i++;
    }
    closeDecl();
    return out;
  }

  // ============ shadow DOM 注入（CSS 里的注释标记，可选） ============
  // 写在站点的 .less/.css 里（注释不会被浏览器执行；块里的 CSS 只进 shadow root，不进 document）：
  //
  //   /* @shadow(.宿主选择器) */
  //   .shadow 内部的选择器 { ... }
  //   /* @shadow-end */
  //
  // 多层：用嵌套表示路径（外层在 document 里找宿主，内层在「外层 shadow root 内部」找宿主）
  //
  //   /* @shadow(.外层宿主) */
  //     /* @shadow(.内层宿主) */
  //     .inner { ... }
  //     /* @shadow-end */
  //   /* @shadow-end */
  //
  // 语法糖：一层里写多段路径，用 >> 分隔（等价于上面的嵌套）
  //
  //   /* @shadow(.外层宿主 >> .内层宿主) */
  //
  // 说明：只处理 open 的 shadow root；宿主必须是有标签名/属性的真实元素（#shadow-root 本身选不到）。
  const SHADOW_COMMENT = /\/\*([\s\S]*?)\*\//g;
  const SHADOW_START = /^@shadow\s*\(([\s\S]*)\)$/;
  const SHADOW_END = /^@shadow-end$/;
  const SHADOW_SEP = '>>';
  const hasStyleSheet = typeof CSSStyleSheet === 'function';

  const shadowBlocks = []; // [{ key, path, sheet, roots:Set }]
  const shadowRootObservers = new Set(); // 中间层 root 的观察器（嵌套路径才会用到）
  const shadowWarned = new Set();
  let shadowObserver = null; // document 层观察器
  let shadowTimer = null; // 去抖定时器

  // 从 CSS 全文里切出「普通部分」和「shadow 块」（栈式配对，支持嵌套）
  function splitShadowBlocks(css) {
    const plain = [];
    const blocks = [];
    const stack = [];
    let cursor = 0;
    let m;
    SHADOW_COMMENT.lastIndex = 0;

    while ((m = SHADOW_COMMENT.exec(css))) {
      const body = m[1].trim();
      const isStart = SHADOW_START.test(body);
      const isEnd = SHADOW_END.test(body);
      if (!isStart && !isEnd) continue;

      const before = css.slice(cursor, m.index);
      if (stack.length) stack[stack.length - 1].buf.push(before);
      else plain.push(before);
      cursor = SHADOW_COMMENT.lastIndex;

      if (isStart) {
        const raw = SHADOW_START.exec(body)[1].trim();
        if (!raw) throw new Error('@shadow() 括号里要写宿主选择器');
        const parts = raw.split(SHADOW_SEP).map((s) => s.trim()).filter(Boolean);
        const parent = stack.length ? stack[stack.length - 1].path : [];
        stack.push({ path: parent.concat(parts), buf: [] });
      } else {
        const top = stack.pop();
        if (!top) throw new Error('多了一个 /* @shadow-end */（没有对应的 /* @shadow(...) */）');
        blocks.push({ path: top.path, css: top.buf.join('').trim() });
      }
    }

    if (stack.length) {
      throw new Error('有 ' + stack.length + ' 个 /* @shadow(...) */ 没有对应的 /* @shadow-end */');
    }
    plain.push(css.slice(cursor));
    return { plain: plain.join(''), blocks: blocks }; // 不做 trim：没有标记时保证与源文件逐字一致
  }

  function resolveHosts(scope, sel) {
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(sel));
    } catch (err) {
      console.error('[shadow] 宿主选择器写法有问题：' + sel);
      return [];
    }
  }

  // 沿路径逐层下钻，返回最后一段选择器命中的宿主元素
  function findShadowTargets(path) {
    let scopes = [document];
    for (let i = 0; i < path.length; i++) {
      const hosts = [];
      for (const scope of scopes) {
        for (const el of resolveHosts(scope, path[i])) hosts.push(el);
      }
      if (i === path.length - 1) return hosts;
      scopes = [];
      for (const host of hosts) {
        if (!host.shadowRoot) continue;
        watchShadowRoot(host.shadowRoot); // 中间层：它内部新出现的宿主也要能被扫到
        scopes.push(host.shadowRoot);
      }
      if (!scopes.length) return [];
    }
    return [];
  }

  // 中间层 root 的观察器（shadow 内部的变动不会冒泡到 document，所以要单独挂）
  function watchShadowRoot(root) {
    if (shadowRootObservers.has(root)) return;
    const mo = new MutationObserver(scheduleShadowScan);
    mo.observe(root, { childList: true, subtree: true });
    shadowRootObservers.add(mo);
  }

  function scheduleShadowScan() {
    if (shadowTimer) return;
    shadowTimer = setTimeout(function () {
      shadowTimer = null;
      injectShadowBlocks();
    }, 250);
  }

  function startShadowObserver() {
    if (shadowObserver || !shadowBlocks.length) return;
    shadowObserver = new MutationObserver(scheduleShadowScan);
    shadowObserver.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  function injectShadowBlocks() {
    if (!hasStyleSheet) return;
    for (const block of shadowBlocks) {
      const hosts = findShadowTargets(block.path);
      let sawRoot = false;
      for (const host of hosts) {
        const root = host.shadowRoot;
        if (!root) continue;
        sawRoot = true;
        if (root.adoptedStyleSheets.indexOf(block.sheet) !== -1) continue;
        root.adoptedStyleSheets = root.adoptedStyleSheets.concat(block.sheet);
        block.roots.add(root);
      }
      if (!shadowWarned.has(block.key)) {
        if (!hosts.length) {
          shadowWarned.add(block.key);
          console.warn('[shadow] 没有匹配到宿主，这条标记不生效：' + block.path.join(' ' + SHADOW_SEP + ' '));
        } else if (!sawRoot) {
          shadowWarned.add(block.key);
          console.warn(
            '[shadow] 匹配到的元素没有 shadowRoot（closed 或选择器选错了层），标记不生效：' +
              block.path.join(' ' + SHADOW_SEP + ' ')
          );
        }
      }
    }
  }

  // 应用（首次加载与「重新加载样式」都会走到这里）
  // prune = 本次 CSS 全部加载成功时才清理"已经删掉的标记块"
  function applyShadowBlocks(blocks, prune) {
    if (!hasStyleSheet) {
      if (blocks.length && !shadowWarned.has('__nosheet')) {
        shadowWarned.add('__nosheet');
        console.warn('[shadow] 当前环境不支持 CSSStyleSheet/adoptedStyleSheets，shadow 注入已跳过');
      }
      return;
    }

    const seen = new Set();
    for (const b of blocks) {
      seen.add(b.key);
      let block = shadowBlocks.find(function (x) { return x.key === b.key; });
      if (!block) {
        block = { key: b.key, path: b.path, sheet: new CSSStyleSheet(), roots: new Set() };
        shadowBlocks.push(block);
      } else {
        block.path = b.path;
      }
      try {
        block.sheet.replaceSync(b.css); // 共享 sheet：热重载时所有 root 一起更新，不闪烁
      } catch (err) {
        console.error('[shadow] 这段 CSS 无法注入（' + b.key + '）：' + err.message);
      }
    }

    if (prune) {
      for (const block of shadowBlocks) {
        if (seen.has(block.key)) continue;
        try { block.sheet.replaceSync(''); } catch (err) { /* 忽略 */ }
        block.roots.clear();
      }
    }

    injectShadowBlocks();
    startShadowObserver();
  }

  // 临时退出脚本时：把注入的样式从各 shadow root 上摘掉，并停掉观察器
  function removeShadowStyles() {
    if (shadowTimer) { clearTimeout(shadowTimer); shadowTimer = null; }
    if (shadowObserver) { shadowObserver.disconnect(); shadowObserver = null; }
    for (const mo of shadowRootObservers) mo.disconnect();
    shadowRootObservers.clear();
    for (const block of shadowBlocks) {
      for (const root of block.roots) {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter(function (s) { return s !== block.sheet; });
      }
      block.roots.clear();
    }
  }

  // ============ 运行时开关（暴力猴菜单） ============
  const SWITCH_KEY = 'enabled';
  let running = GM_getValue(SWITCH_KEY, true); // 默认启用

  function removeAllCSS() {
    document.querySelectorAll('style[data-module-css]').forEach((el) => el.remove());
    removeShadowStyles();
  }

  function setRunning(on) {
    running = on;
    GM_setValue(SWITCH_KEY, on);
    if (on) {
      reloadStyles();
      console.log('[网页大修] 已启用（样式已重新加载）');
    } else {
      removeAllCSS();
      console.log('[网页大修] 已临时退出（样式已移除；已执行的 JS 模块需刷新页面才会失效）');
    }
  }

  // 菜单项固定，每次切换不重复注册
  // 改完 CSS 后点「重新加载样式」即可生效（手动刷新，不做定时轮询，避免组件闪烁）
  GM_registerMenuCommand('重新加载样式（手动刷新）', () => {
    if (running) reloadStyles();
    else setRunning(true); // 处于临时退出状态时，点它就等于恢复启用并加载
  });
  GM_registerMenuCommand('临时退出脚本（移除样式，便于对比）', () => setRunning(false));
  GM_registerMenuCommand('重新启用脚本（加载样式）', () => setRunning(true));

  // 临时退出状态下，本次页面不加载任何资源
  if (!running) {
    console.log('[网页大修] 当前为临时退出状态，本次不加载样式（可用暴力猴菜单重新启用）');
    return;
  }

  // ============ 启动 ============
  boot();
})();
