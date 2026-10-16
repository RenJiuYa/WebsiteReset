// ==UserScript==
// @name          网页大修-总入口
// @namespace     RenJiuYa
// @version       1.2.0
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
//
// @inject-into   content
//
// @connect       127.0.0.1
// @connect       cdn.jsdelivr.net
// ==/UserScript==

// ============================================================
// 总入口说明（本项目唯一入口，直接装在暴力猴里）
// 1. 本文件在仓库根目录；各网站的样式模块放在 Web/<网站>/ 下。
// 2. 站点管理（哪些网站、哪些地址加载哪些入口）在 Web/sites.js，运行时读取：
//    改完 sites.js 只需刷新页面即生效，不用改本文件、也不用在暴力猴里更新脚本。
// 3. @match 故意写成全站通配（*://*/*）：插件头部的匹配范围在注入前就定死了，
//    脚本运行时无法动态扩大，所以"真正生效范围"交给 sites.js 里的 rules（match）判断。
//    新增网站：建好 Web/<网站>/ 文件夹 → 在 sites.js 里加一条即可。
//    站点的 CSS 是合并产物：_Entry.less 把本站各模块 @import 在一起 → 只产出 _Entry.css。
// 4. 永久停用某网站：把 sites.js 里该站点的 enabled 改成 false。
// 5. 「CSS 做不到的」规则（文本匹配、按计算样式匹配、向上隐藏等）写在根目录 ublock.user.txt，
//    用 uBlock Origin 的自定义过滤列表语法，由 uBO 执行，本脚本不参与。
//    工具类放在 utils/ 下，自动加载（写法见下面 UTILS，用法见第 9 条）。
// 6. 改完 CSS 后：暴力猴菜单点「重新加载样式（手动刷新）」立即生效（不做定时轮询，避免组件闪烁）；
//    发布模式下该操作受 CDN 缓存影响，需要等 jsDelivr 刷新。
// 7. 运行时临时退出：暴力猴菜单点「临时退出脚本」，样式立刻移除，方便和原网站对比；
//    该选择会被记住（刷新页面依然生效），直到点「重新启用脚本」。
//    注意：已执行过的 JS 模块无法撤销，需刷新页面才会失效。
// 8. 需要注入 shadow DOM（只支持 open）的样式：在 .less/.css 里用注释标记
//    /* @shadow(.宿主选择器) */  ...  /* @shadow-end */
//    多层用嵌套（内层在「外层 shadow root 内部」找宿主），或用语法糖 >> 分隔路径。
// 9. 工具类：utils/click.js —— 模拟鼠标点击（不用再靠 uBO 的 ##+js(trusted-click-element…)）
//    click(选择器, 延迟秒, 次数, 间隔秒)，例如 click('.xxx', 1, 3, 2)
//    utils/disableShortcut.js —— 让某个快捷键在页面上失效
//    disableShortcut('Ctrl Alt G')，返回值是恢复函数；默认跳过输入框、Shift 忽略
// 10. 关于页面 CSP（为什么头部写了 @inject-into content）：
//    本脚本有两处必须"执行下载来的代码"——utils/ 与站点的 .js 模块（用 Function 构造器）。
//    如果脚本运行在"页面世界"，页面自己的 CSP（如 X/Twitter 这类严格站点）会禁止
//    Function()/eval，控制台报 "call to Function() blocked by CSP"，整个脚本就不生效了。
//    @inject-into content 强制在扩展沙箱里执行，页面 CSP 管不到这些调用。
//    另外 sites.js 的解析已改成纯数据解析（不依赖 eval），属于双保险：
//    即使某次仍落在页面世界，样式也照样能加载。
// 11. 文件来源自动选择（不用再手动切开发/发布）：打开页面先试本地 live-server（127.0.0.1:5500），
//    连得上就用本地（改完 CSS 刷新即生效），连不上或超时 1.5 秒就自动改用 CDN 上的发布版。
//    也就是说：本地开着 = 开发，本地关掉 = 发布，代码不用改。
// ============================================================

(function () {
  'use strict';

  // 你写的 CSS 是否自动补 !important（省得每条声明都手写）
  // 注意：@keyframes / @font-face 这类"描述符块"和 CSS 变量（--x）会自动跳过
  const FORCE_IMPORTANT = true;

  // ============ 文件来源：自动选择（不用再手动切开发/发布） ============
  // 打开页面时先试本地 live-server：
  //   · 连得上 → 用本地（改完刷新即生效，请求会带 ?t= 绕缓存）
  //   · 连不上/超时 → 自动改用下面这个 CDN 地址（= 发布版）
  // 所以：本地开着就是开发，本地关掉就是发布，不需要改代码。
  const LOCAL_BASE = 'http://127.0.0.1:5500';                              // 本地 live-server 根目录（=仓库根目录）
  const REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@v1.2.0'; // 发布地址，版本号与 @version 同步（tag 内容不可变，改完要换新 tag）
  const LOCAL_TIMEOUT = 1500; // 本地探测超时（毫秒），超过就当作本地不可用
  const SITES_FILE = '/Web/sites.js'; // 站点管理表的位置（本地与 CDN 同一结构）

  let BASE = REMOTE_BASE; // 由 loadSitesSource() 探测后决定：本地可用 → LOCAL_BASE
  let USE_LOCAL = false;  // 本次是否在用本地（= 以前的 IS_DEV：加 ?t=、开发期提示）

  // ============ 站点管理（外部文件 Web/sites.js，运行时读取） ============
  // 好处：改站点、改文件清单只需刷新页面，不必修改本文件、也不必在暴力猴里更新脚本
  const SITES_CACHE = 'sitesCache'; // 读取失败时的兜底缓存

  // ============ 工具类（utils/ 下的文件，自动加载） ============
  // 这些文件在站点 JS 之前执行，执行完会把函数挂到全局，
  // 所以 Web/ 下的 .js 里可以直接调用，不需要任何声明。
  // 新增工具类：在 utils/ 下建文件 → 把路径加到下面这一行
  const UTILS = ['utils/click.js', 'utils/disableShortcut.js'];

  // 当前命中的站点、该站点的样式根地址、本次要加载的模块（由 boot() 赋值）
  let SITE = null;
  let SITE_BASE = '';
  let SITE_CSS = []; // 命中规则里收集到的 CSS 入口名
  let SITE_JS = [];  // 命中规则里收集到的 JS 入口名

  // 取站点配置，同时决定"这次用哪个来源"（每个页面只做一次）：
  //   本地优先（带超时）→ 失败自动改用 CDN → 都失败才回退上次成功解析过的缓存
  // 注意：缓存只在"解析成功"之后才写入（见 boot），所以写坏了配置不会把上一份好配置顶掉
  async function loadSitesSource() {
    // 1) 本地 live-server
    try {
      const text = await gmFetch(LOCAL_BASE + SITES_FILE, { timeout: LOCAL_TIMEOUT, bust: true });
      BASE = LOCAL_BASE;
      USE_LOCAL = true;
      return text;
    } catch (err) {
      // 常见情况：没开 live-server（连接被拒或超时）→ 静默改用 CDN，不算错误
      BASE = REMOTE_BASE;
      USE_LOCAL = false;
    }
    // 2) CDN（发布版）
    try {
      return await gmFetch(REMOTE_BASE + SITES_FILE);
    } catch (err) {
      // 3) 两边都失败 → 回退缓存
      const cached = GM_getValue(SITES_CACHE, '');
      if (cached) {
        console.warn('[网页大修] 本地与 CDN 都读取站点配置失败，已回退上次缓存: ' + err.message);
        return cached;
      }
      console.error('[网页大修] 本地与 CDN 都读取站点配置失败，本次不加载样式: ' + err.message);
      return '';
    }
  }

  // sites.js 的内容形如：const SITES = { '网站名': { ... } };
  //
  // 这里刻意不用 new Function/eval 解析：页面自己的 CSP（如 X/Twitter）会禁止它，
  // 报 "call to Function() blocked by CSP"，然后整个脚本（CSS+JS）都不加载。
  // 改成"当纯数据解析"，两种写法都支持：
  //   1. 严格 JSON（推荐）：键和字符串都用双引号 → 直接 JSON.parse
  //   2. 现在的 JS 风格：不带引号的键、单引号字符串、整行注释、尾逗号 → 走宽松模式转换后再 JSON.parse
  function parseSites(src) {
    // 从 "SITES" 之后找第一个 { ：避免文件头部注释里出现花括号时抓错位置
    const anchor = src.indexOf('SITES');
    const start = src.indexOf('{', anchor === -1 ? 0 : anchor);
    const end = src.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('没找到配置对象 { ... }');
    const body = src.slice(start, end + 1);

    try {
      return JSON.parse(body);
    } catch (strictErr) {
      try {
        const sites = JSON.parse(looseToJson(body));
        // 只在开发模式提示：正式版保持控制台干净（宽松模式本身是支持这种写法的）
        if (USE_LOCAL) console.warn('[网页大修] 站点配置是 JS 风格（单引号/裸键名），已按宽松模式解析成功；建议以后统一用双引号（标准 JSON 写法）');
        return sites;
      } catch (looseErr) {
        throw new Error(looseErr.message + '（严格模式: ' + strictErr.message + '）');
      }
    }
  }

  // 宽松模式：把"JS 风格的配置"最小化地转成 JSON
  //  · 逐字符扫描，字符串和注释先单独处理（所以字符串里的 // 和 , 不会被误伤）
  //  · 单引号字符串 → 双引号；整行/块注释 → 删掉；{ 或 , 后面的裸键名 → 加引号；尾逗号 → 删掉
  function looseToJson(text) {
    const fixKeys = (s) =>
      s.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":') // 裸键名 → "键名"
       .replace(/,(\s*[}\]])/g, '$1');                          // 尾逗号
    let out = '';
    let buf = ''; // 字符串之外的部分（只有这部分做上面的转换）
    const flush = () => {
      out += fixKeys(buf);
      buf = '';
    };
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      // 字符串：原样取出，只把单引号统一成双引号
      if (ch === "'" || ch === '"') {
        const quote = ch;
        let j = i + 1;
        let val = '';
        while (j < text.length) {
          const c = text[j];
          if (c === '\\') {
            val += c + (text[j + 1] || '');
            j += 2;
            continue;
          }
          if (c === quote) break;
          val += c;
          j++;
        }
        if (quote === "'") val = val.replace(/\\'/g, "'").replace(/"/g, '\\"');
        flush();
        out += '"' + val + '"';
        i = j + 1;
        continue;
      }
      // 注释：整行/行尾 // 与 /* */ 都丢掉
      if (ch === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && text[i + 1] === '*') {
        const stop = text.indexOf('*/', i + 2);
        i = stop === -1 ? text.length : stop + 2;
        continue;
      }
      buf += ch;
      i++;
    }
    flush();
    return out;
  }

  // 解析配置（失败时给出定位信息；不记录任何"失败状态"，下次刷新会重新尝试）
  function parseSitesSafe(src, from) {
    try {
      const sites = parseSites(src);
      if (!sites || typeof sites !== 'object') throw new Error('解析结果不是对象');
      return sites;
    } catch (err) {
      console.error('[网页大修] 站点配置解析失败（' + from + '）: ' + err.message);
      console.error(
        '[网页大修] 诊断: 页面=' + location.href +
          ' ; 执行世界=' + (typeof unsafeWindow === 'undefined' ? '页面世界（页面 CSP 会限制 eval）' : '沙箱/隔离世界（正常）') +
          ' ; 页面 CSP=' + (document.querySelector('meta[http-equiv="Content-Security-Policy"]') ? '有 meta CSP' : '无 meta CSP')
      );
      return null;
    }
  }

  // 被页面 CSP 拦下 eval 时，给一句能看懂的提示
  function hintCSP(err) {
    const msg = String((err && err.message) || err || '');
    return /blocked by CSP|unsafe-eval/i.test(msg)
      ? '（被页面 CSP 拦下 Function()/eval：说明本脚本这次跑在页面世界，检查脚本头部的 @inject-into content 是否生效）'
      : '';
  }

  // 匹配当前站点：返回 { site, css: [...], js: [...] }（未命中返回 null）
  // sites.js 里每个站点用 rules 声明"哪些地址加载哪些入口"，
  // 按声明顺序匹配，命中的规则全部生效（后面的覆盖前面的），同名只收集一次。
  function matchSite(sites) {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;

    for (const site of Object.values(sites)) {
      if (!site || site.enabled === false) continue;
      if (!site.dir || !Array.isArray(site.rules)) continue;

      const css = [];
      const js = [];
      let hit = false;
      for (const rule of site.rules) {
        if (!rule || rule.enabled === false) continue;
        if (!matchRule(rule.match, host, path)) continue;
        hit = true;
        pushNames(css, rule.css);
        pushNames(js, rule.js);
      }
      if (hit) return { site: site, css: css, js: js };
    }
    return null;
  }

  // 收集模块名：允许写一个名字或写数组；去重并保持顺序
  function pushNames(list, value) {
    const names = value == null ? [] : Array.isArray(value) ? value : [value];
    for (const name of names) {
      if (typeof name !== 'string') continue;
      const n = name.trim();
      if (n && list.indexOf(n) === -1) list.push(n);
    }
  }

  // 规则是否命中。match 的写法见 Web/sites.js 顶部说明
  function matchRule(match, host, path) {
    if (match == null) return true;
    const list = Array.isArray(match) ? match : [match];
    if (!list.length) return true;
    for (const item of list) {
      if (matchOne(String(item), host, path)) return true;
    }
    return false;
  }

  // 单条模式：'域名' 或 '域名/路径'（也允许只写 /路径，此时不限域名）
  function matchOne(pattern, host, path) {
    const s = pattern.trim();
    if (!s) return true;
    const cut = s.indexOf('/');
    const hostPat = (cut === -1 ? s : s.slice(0, cut)).toLowerCase();
    const pathPat = cut === -1 ? '' : s.slice(cut);
    if (!hostMatch(hostPat, host)) return false;
    if (!pathPat) return true; // 只写域名：任意路径
    return globMatch(pathPat, path);
  }

  // 域名匹配：不带 * 时按"该域名及其子域"处理；带 * 时按通配
  function hostMatch(hostPat, host) {
    if (!hostPat) return true;
    if (hostPat.indexOf('*') !== -1) return globMatch(hostPat, host);
    return host === hostPat || host.endsWith('.' + hostPat);
  }

  // * 通配（匹配任意字符，可含 /）；没有 * 时就是精确相等
  function globMatch(pattern, text) {
    if (pattern.indexOf('*') === -1) return pattern === text;
    const parts = pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('^' + parts.join('[\\s\\S]*') + '$').test(text);
  }

  // 解析站点配置，并加载命中的网站样式
  async function boot() {
    const src = await loadSitesSource();
    if (!src) return;

    let sites = parseSitesSafe(src, '最新配置');
    let fromCache = false;
    if (!sites) {
      // 兜底：最新配置解析不了时，用上次"解析成功"过的缓存再试一次（配置被改坏的场景）
      const cached = GM_getValue(SITES_CACHE, '');
      if (cached && cached !== src) {
        sites = parseSitesSafe(cached, '缓存配置');
        fromCache = !!sites;
      }
    }
    if (!sites) return;
    if (!fromCache) GM_setValue(SITES_CACHE, src); // 只缓存能解析成功的配置，失败不会顶掉上一份好的

    const matched = matchSite(sites);
    if (!matched) return; // 未登记的网站（或没有规则命中）：什么都不做
    SITE = matched.site;
    SITE_CSS = matched.css;
    SITE_JS = matched.js;

    SITE_BASE = BASE + '/' + SITE.dir;
    // CSS 与工具类并行加载（工具类必须先执行完，站点 JS 里才能直接调用）
    const [cssCount] = await Promise.all([loadAllCSS(), loadUtils()]);
    const jsCount = await loadAllJS();
    if (cssCount + jsCount === 0) {
      console.warn('[网页大修] 没有找到任何模块文件，请检查 sites.js 里的 dir 与 rules 里的 css/js: ' + SITE_BASE);
    }
  }

  // 重新加载样式：已命中站点只重拉 CSS，否则重新走一遍完整流程
  function reloadStyles() {
    return SITE ? loadAllCSS() : boot();
  }

  // ============ 工具函数 ============
  // 加时间戳绕过缓存（只在用本地时；CDN 地址必须干净，才能吃到 jsDelivr 的缓存）
  function withCacheBust(url) {
    return USE_LOCAL ? url + '?t=' + Date.now() : url;
  }

  // 用 Promise 包装 GM_xmlhttpRequest，方便 async/await
  // reject 出的 Error 上带 status（404 = 文件不存在，用于跳过没有该扩展名的模块）
  // opts.timeout：毫秒；超时按失败处理（本地探测用）。opts.bust：强制加 ?t=（探测本地用）
  function gmFetch(url, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      const req = {
        method: 'GET',
        url: o.bust ? url + '?t=' + Date.now() : withCacheBust(url),
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
        ontimeout: () => reject(new Error('超时: ' + url)),
      };
      if (o.timeout) req.timeout = o.timeout;
      GM_xmlhttpRequest(req);
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
    const files = SITE_CSS.map((name) => name + '.css');
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
        console.error('[工具类] 加载失败: ' + file + hintCSP(err), err);
      }
    }
  }

  // ============ 加载 JS 模块 ============
  // 同样按模块名去找同名的 .js（不存在就跳过）；按顺序执行，保证模块之间的依赖顺序
  async function loadAllJS() {
    let loaded = 0;
    for (const name of SITE_JS) {
      const file = name + '.js';
      try {
        const code = await gmFetch(SITE_BASE + '/' + file);
        // 用 Function 构造器执行（在页面世界会被页面 CSP 拦下，所以脚本头部写了 @inject-into content）
        // 注意：模块内的代码在全局作用域执行，可直接操作页面
        new Function(code)();
        loaded++;
      } catch (err) {
        // 404 = 这个模块没有 js，属于正常情况，跳过
        if (err.status === 404) continue;
        console.error('[JS] 加载失败: ' + file + hintCSP(err), err);
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
  // 沙箱（隔离世界，暴力猴的 @inject-into content）里必须用"页面那个世界"的构造器：
  // 用沙箱里的 CSSStyleSheet 造出来的对象，交给页面的 shadowRoot.adoptedStyleSheets 会被拒绝，
  // 表现就是——普通 CSS 正常，但所有 @shadow 块都不生效。这里优先取 unsafeWindow 上的构造器。
  const PageSheet =
    typeof unsafeWindow !== 'undefined' && unsafeWindow && typeof unsafeWindow.CSSStyleSheet === 'function'
      ? unsafeWindow.CSSStyleSheet
      : typeof CSSStyleSheet === 'function'
        ? CSSStyleSheet
        : null;
  const hasSheetCtor = typeof PageSheet === 'function'; // 能不能用"共享构造样式表"

  const shadowBlocks = []; // [{ key, path, sheet|null, css, roots:Set, styleEls:Map(root → <style>) }]
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

  // 把一块 CSS 应用到某个 shadow root：
  //  ① 首选共享的构造样式表（省内存、热重载不闪烁）
  //  ② 页面拒绝这个表（跨世界等）→ 自动退化成往 root 里塞一个 <style>（只影响这一个 root）
  // 全程 try/catch：某一块失败不会连累其它块（以前一处异常会让后面所有块都不生效）
  function applyStyleToRoot(block, root) {
    if (block.sheet) {
      try {
        if (root.adoptedStyleSheets.indexOf(block.sheet) === -1) {
          root.adoptedStyleSheets = root.adoptedStyleSheets.concat(block.sheet);
        }
        block.roots.add(root);
        return;
      } catch (err) {
        // 换一个 root 也救不回来 → 这一块以后都走 <style> 模式，只提示一次
        block.sheet = null;
        block.roots.clear();
        if (!shadowWarned.has('__fallback')) {
          shadowWarned.add('__fallback');
          console.warn(
            '[shadow] 共享样式表被拒绝（常见于沙箱/跨世界环境），已自动改用 <style> 注入 shadow root：' +
              ((err && err.message) || err)
          );
        }
      }
    }
    let el = block.styleEls.get(root);
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-shadow-for', block.key);
      block.styleEls.set(root, el);
      try { root.appendChild(el); } catch (err) { /* 忽略 */ }
    }
    if (el.textContent !== block.css) el.textContent = block.css;
  }

  function injectShadowBlocks() {
    for (const block of shadowBlocks) {
      const hosts = findShadowTargets(block.path);
      let sawRoot = false;
      for (const host of hosts) {
        const root = host.shadowRoot;
        if (!root) continue;
        sawRoot = true;
        applyStyleToRoot(block, root);
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
    // 没有构造样式表也能干活：会自动走 <style> 注入（见 applyStyleToRoot）
    if (!hasSheetCtor && blocks.length && !shadowWarned.has('__nosheet')) {
      shadowWarned.add('__nosheet');
      console.warn('[shadow] 当前环境取不到 CSSStyleSheet，shadow 注入改用 <style> 方式');
    }

    const seen = new Set();
    for (const b of blocks) {
      seen.add(b.key);
      let block = shadowBlocks.find(function (x) { return x.key === b.key; });
      if (!block) {
        let sheet = null;
        if (hasSheetCtor) {
          try { sheet = new PageSheet(); } catch (err) { sheet = null; }
        }
        block = { key: b.key, path: b.path, sheet: sheet, css: b.css, roots: new Set(), styleEls: new Map() };
        shadowBlocks.push(block);
      } else {
        block.path = b.path;
        block.css = b.css;
      }
      if (block.sheet) {
        try {
          block.sheet.replaceSync(b.css); // 共享 sheet：热重载时所有 root 一起更新，不闪烁
        } catch (err) {
          block.sheet = null; // 这个表不可用 → 之后统一走 <style> 模式
        }
      }
      if (!block.sheet) {
        // <style> 模式：就地更新每个 root 里的元素（不删除重建 → 不闪烁）
        block.styleEls.forEach(function (el) { el.textContent = b.css; });
      }
    }

    if (prune) {
      for (const block of shadowBlocks) {
        if (seen.has(block.key)) continue;
        try { if (block.sheet) block.sheet.replaceSync(''); } catch (err) { /* 忽略 */ }
        block.roots.clear();
        block.styleEls.forEach(function (el) { if (el.remove) el.remove(); });
        block.styleEls.clear();
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
      if (block.sheet) {
        for (const root of block.roots) {
          try {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter(function (s) { return s !== block.sheet; });
          } catch (err) { /* 忽略 */ }
        }
      }
      block.roots.clear();
      block.styleEls.forEach(function (el) { if (el.remove) el.remove(); });
      block.styleEls.clear();
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
