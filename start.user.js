// ==UserScript==
// @name          网页大修-总入口
// @namespace     RenJiuYa
// @version       1.2.2
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
// @connect       raw.githubusercontent.com
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
// 6. 性能：CSS/JS/配置都"缓存优先，后台更新" —— 页面一打开先用上次下载的内容注入（秒开、不闪），
//    同时后台去拉最新：CSS 变了就地热替换（当次就能看到），站点 JS 与 sites.js 变了只提示，
//    下次刷新生效。请求带 3 秒超时，实时源不通时立刻回退备用源，不会卡住页面。
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
// 11. 文件来源：手动切换，开关就在本文件里（下面 const IS_DEV 那一行）
//     true  = 开发：全部从本地 live-server（127.0.0.1:5500）取，改完刷新即生效
//     false = 发布：分两套源
//               · 版本化源（tag 快照）：utils/ —— 只有改本文件或 utils/ 才需要升版本、打新 tag
//               · 实时源（main 分支）：Web/sites.js + Web/<站点>/ 下的 .css / .js
//                 → 小修小补 push 完刷新页面就是最新的，不必发版
//     （Web/sites.js 只放站点信息：哪些网站、哪些入口，不掺别的）
// ============================================================

(function () {
  'use strict';

  // 你写的 CSS 是否自动补 !important（省得每条声明都手写）
  // 注意：@keyframes / @font-face 这类"描述符块"和 CSS 变量（--x）会自动跳过
  const FORCE_IMPORTANT = true;

  // ============ 开发/发布开关（来源手动切换） ============
  // true  = 开发：全部从本地 live-server 取（改完刷新即生效）
  // false = 发布：脚本基础设施走版本化快照，Web/ 下的配置与样式走实时源
  const IS_DEV = true;

  const LOCAL_BASE = 'http://127.0.0.1:5500'; // 本地 live-server 根目录（=仓库根目录）

  // ① 版本化源（tag 快照，内容永不变化）—— 只给 utils/ 这类"脚本基础设施"用。
  //    改动本文件或 utils/ 时：升 @version → 把这里换成同名 tag → 打 tag 并推送。
  const REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@v1.2.2';

  // ② 实时源（main 分支）—— Web/sites.js 与 Web/<站点>/ 下的 .css / .js 都从这里取。
  //    push 到 main 之后刷新页面就是最新的，不需要升版本、不需要打 tag。
  //    raw.githubusercontent 边缘缓存约 5 分钟，所以下面 FRESH_DATA 会给每次请求加时间戳，
  //    确保拿到刚 push 的内容；万一 raw 取不到（网络/被墙），自动回退备用地址。
  const LIVE_BASE = 'https://raw.githubusercontent.com/RenJiuYa/WebsiteReset/main';
  const LIVE_BASE_FALLBACK = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@main';

  // 代码源（版本化快照）：utils/** 这类基础设施，稳定优先
  const CODE_BASE = IS_DEV ? LOCAL_BASE : REMOTE_BASE;
  // 数据源（实时）：站点配置 + 站点样式 + 站点 JS，实时优先
  const DATA_BASE = IS_DEV ? LOCAL_BASE : LIVE_BASE;
  const DATA_BASE_FALLBACK = IS_DEV ? '' : LIVE_BASE_FALLBACK;

  // 实时源是否强制绕过 CDN 缓存（请求 URL 上带 ?t= 时间戳）
  //   true  = 改完 push 就能看到（推荐）
  //   false = 吃 CDN 缓存（省流量，但可能滞后几分钟 ~ 12 小时）
  const FRESH_DATA = true;

  const SITES_FILE = '/Web/sites.js'; // 站点管理表的位置（本地与 CDN 同一结构）

  // ============ 站点管理（外部文件 Web/sites.js，运行时读取） ============
  // 好处：改站点、改文件清单只需刷新页面，不必修改本文件、也不必在暴力猴里更新脚本
  const SITES_CACHE = 'sitesCache'; // 站点配置缓存（页面一打开先用它，后台再检查更新）

  // ============ 内容缓存（本地优先，后台更新） ============
  // 页面一打开就先用上次下载的内容注入（≈0 延迟、不闪），同时后台去拉最新：
  //   · CSS 有变化 → 就地热替换 <style> 的内容（同一次加载里就能看到新样式）
  //   · 站点 JS 有变化 → 只更新缓存，下次刷新生效（同一个模块重复执行可能有副作用，不做热替换）
  // 存储键 = 文件完整地址 → 本地 / 实时源 / tag 三套源各自独立，不会串味
  const MOD_CACHE = 'modCache:';

  // 单次请求超时（毫秒）：实时源不通时迅速失败 → 立刻走备用源，不会长时间卡住页面
  const FETCH_TIMEOUT = 3000;

  // ============ 工具类（utils/ 下的文件，自动加载） ============
  // 这些文件在站点 JS 之前执行，执行完会把函数挂到全局，
  // 所以 Web/ 下的 .js 里可以直接调用，不需要任何声明。
  // 新增工具类：在 utils/ 下建文件 → 把路径加到下面这一行
  const UTILS = ['utils/click.js', 'utils/disableShortcut.js'];

  // 当前命中的站点、该站点的文件根地址、本次要加载的模块（由 boot() 赋值）
  let SITE = null;
  let SITE_BASE = '';
  // 本次会话实际使用的数据源：主实时源取不到时会换成备用源（CSS/JS 一起跟着切，避免两个源混搭）
  let DATA_SOURCE = DATA_BASE;
  let SITE_CSS = []; // 命中规则里收集到的 CSS 入口名
  let SITE_JS = [];  // 命中规则里收集到的 JS 入口名

  // 读取 sites.js 源码：有缓存先用缓存（页面立刻起来），同时后台检查更新；
  // 没有缓存时才阻塞等网络（首次运行）。
  // 注意：缓存只在"解析成功"之后才写入（见 boot），所以写坏了配置不会把上一份好配置顶掉
  async function loadSitesSource() {
    const cached = GM_getValue(SITES_CACHE, '');
    if (cached) {
      refreshSitesInBackground(cached);
      return cached;
    }
    try {
      return await fetchSitesSource();
    } catch (err) {
      console.error(
        '[网页大修] 读取站点配置失败，本次不加载样式: ' + err.message +
          (IS_DEV ? '（IS_DEV=true 时配置来自本地 live-server，没开就把它改成 false）' : '')
      );
      return '';
    }
  }

  // 后台检查配置更新：内容变了就写缓存并提示刷新
  //（配置决定"加载哪些入口"，重新解析会重跑站点 JS，所以不做热替换）
  function refreshSitesInBackground(cached) {
    fetchSitesSource()
      .then((text) => {
        if (!text || text === cached) return;
        GM_setValue(SITES_CACHE, text);
        console.log('[网页大修] 站点配置已更新，刷新页面后生效');
      })
      .catch((err) => {
        // 后台检查失败不影响本次加载（也可能只是离线）
      });
  }

  // 去网络取配置：主实时源 → 备用源（全部失败时抛错，由调用方决定用缓存还是放弃）
  // 数据源策略：优先实时主源（raw.githubusercontent，配合时间戳 = 最新）；
  // 主源不可达（网络/被墙/超时）时自动改用备用源（jsDelivr @main，有缓存、可能滞后），
  // 并把 DATA_SOURCE 定下来，后面的 CSS / 站点 JS 也从同一个源取，不会两个源混搭。
  async function fetchSitesSource() {
    const bases = [DATA_SOURCE];
    if (DATA_BASE_FALLBACK && DATA_SOURCE !== DATA_BASE_FALLBACK) bases.push(DATA_BASE_FALLBACK);

    const tried = [];
    for (const base of bases) {
      try {
        const text = await gmFetch(base + SITES_FILE, true);
        if (base !== DATA_SOURCE) {
          DATA_SOURCE = base;
          console.warn(
            '[网页大修] 实时源 ' + DATA_BASE + ' 取不到，已切换到备用源 ' + base +
              '（备用源有缓存，内容可能不是最新）'
          );
        }
        return text;
      } catch (err) {
        tried.push(base + ' → ' + err.message);
      }
    }
    throw new Error(tried.join(' ; '));
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
        if (IS_DEV) console.warn('[网页大修] 站点配置是 JS 风格（单引号/裸键名），已按宽松模式解析成功；建议以后统一用双引号（标准 JSON 写法）');
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

    SITE_BASE = DATA_SOURCE + '/' + SITE.dir;
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
  // 加时间戳绕过缓存
  //   IS_DEV：本地 live-server 每次都要拿最新
  //   fresh ：实时源（Web/ 下的配置、样式、站点 JS）也要绕，否则拿到的是 CDN 缓存
  //   两个都不是（tag 上的 utils/）：tag 内容不可变，交给 CDN 长期缓存，省流量
  function withCacheBust(url, fresh) {
    if (!IS_DEV && !fresh) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }

  // 用 Promise 包装 GM_xmlhttpRequest，方便 async/await
  // fresh=true 表示这份文件要求"实时"（会加时间戳绕过 CDN 缓存）
  // 带超时：实时源不通时 3 秒就失败，交给调用方回退备用源，不会长时间卡住
  // reject 出的 Error 上带 status（404 = 文件不存在，用于跳过没有该扩展名的模块）
  function gmFetch(url, fresh) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: withCacheBust(url, fresh),
        timeout: FETCH_TIMEOUT,
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
        ontimeout: () => {
          const err = new Error('超时(' + FETCH_TIMEOUT + 'ms): ' + url);
          err.timeout = true;
          reject(err);
        },
      });
    });
  }

  // 内容缓存读写（浏览器可能禁用存储，失败不影响主流程）
  function cacheGet(url) {
    try {
      return GM_getValue(MOD_CACHE + url, '');
    } catch (err) {
      return '';
    }
  }

  function cacheSet(url, text) {
    try {
      GM_setValue(MOD_CACHE + url, text);
    } catch (err) {
      /* 忽略 */
    }
  }

  function head() {
    return document.head || document.documentElement;
  }

  // ============ 加载 CSS ============
  // sites.js 里只写模块名，这里自动去找同名的 .css（不存在就跳过）。
  // 两阶段：
  //   ① 先用本地缓存立即注入（同步读存储，没有网络等待 → 页面一打开就有样式）
  //   ② 后台拉最新，内容变了就地热替换 <style> 的 textContent（不删元素 → 不闪烁）
  async function loadAllCSS() {
    const files = SITE_CSS.map((name) => name + '.css');
    const urls = files.map((file) => SITE_BASE + '/' + file);
    const texts = Object.create(null); // url → CSS 文本

    // ① 缓存阶段：能读到就用（不产生任何 await 间隙）
    let hasCache = false;
    files.forEach((file, i) => {
      const cached = cacheGet(urls[i]);
      if (cached) {
        texts[urls[i]] = cached;
        hasCache = true;
      }
    });
    if (hasCache) applyCssTexts(files, urls, texts, false);

    // ② 更新阶段：拉最新内容，成功就写缓存
    const results = await Promise.allSettled(urls.map((url) => gmFetch(url, true)));
    let allOk = true;
    results.forEach((r, i) => {
      const url = urls[i];
      if (r.status === 'rejected') {
        // 404 = 这个模块没有 css，属于正常情况，跳过
        if (!r.reason || r.reason.status !== 404) {
          console.error('[CSS] 加载失败: ' + files[i], r.reason);
          allOk = false;
        }
        return; // 拉不到就继续用缓存里的旧内容（不会变空）
      }
      if (texts[url] !== r.value) {
        texts[url] = r.value;
        cacheSet(url, r.value);
      }
    });

    // 有变化（或首次加载）→ 再应用一次：就地更新，元素不重建
    return applyCssTexts(files, urls, texts, allOk);
  }

  // 把一批 CSS 文本应用到 <style data-module-css>（幂等：已存在的元素只更新 textContent）
  // prune = 本次 CSS 全部加载成功时才清理"已经删掉的标记块"
  function applyCssTexts(files, urls, texts, prune) {
    let loaded = 0;
    const shadowDefs = [];

    files.forEach((file, i) => {
      const raw = texts[urls[i]];
      if (raw == null) return;

      // 自动补 !important → 摘出 /* @shadow(...) */ 块
      let css = forceImportant(raw);
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
      }

      let style = document.querySelector('style[data-module-css="' + file + '"]');
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-module-css', file);
        style.textContent = css; // 先填内容再插入 → 不会出现空白样式的瞬间
        head().appendChild(style);
      } else if (style.textContent !== css) {
        style.textContent = css; // 热替换：只换内容，元素不动
      }
      loaded++;
    });

    applyShadowBlocks(shadowDefs, !!prune);
    return loaded;
  }

  // ============ 加载工具类 ============
  // 在站点 JS 模块之前执行；工具类自己会把函数挂到全局（如 globalThis.hasText）
  async function loadUtils() {
    for (const file of UTILS) {
      try {
        const code = await gmFetch(CODE_BASE + '/' + file);
        new Function(code)();
      } catch (err) {
        console.error('[工具类] 加载失败: ' + file + hintCSP(err), err);
      }
    }
  }

  // ============ 加载 JS 模块 ============
  // 同样按模块名去找同名的 .js（不存在就跳过）；按顺序执行，保证模块之间的依赖顺序。
  // 缓存优先：有缓存先执行（立刻生效），后台检查更新；内容变了只写缓存，下次刷新生效
  //（同一个模块重复执行可能有副作用，所以不热替换）
  async function loadAllJS() {
    let loaded = 0;
    for (const name of SITE_JS) {
      const file = name + '.js';
      const url = SITE_BASE + '/' + file;
      const cached = cacheGet(url);

      if (cached) {
        try {
          new Function(cached)();
          loaded++;
        } catch (err) {
          console.error('[JS] 缓存版本执行失败: ' + file + hintCSP(err), err);
        }
        checkJsUpdate(file, url, cached);
        continue;
      }

      try {
        const code = await gmFetch(url, true);
        // 用 Function 构造器执行（在页面世界会被页面 CSP 拦下，所以脚本头部写了 @inject-into content）
        // 注意：模块内的代码在全局作用域执行，可直接操作页面
        new Function(code)();
        cacheSet(url, code);
        loaded++;
      } catch (err) {
        // 404 = 这个模块没有 js，属于正常情况，跳过
        if (err.status === 404) continue;
        console.error('[JS] 加载失败: ' + file + hintCSP(err), err);
      }
    }
    return loaded;
  }

  // 后台检查模块更新：只更新缓存 + 提示，重新加载页面后才用新代码
  function checkJsUpdate(file, url, cached) {
    gmFetch(url, true)
      .then((text) => {
        if (!text || text === cached) return;
        cacheSet(url, text);
        console.log('[网页大修] ' + file + ' 有新版本，刷新页面后生效');
      })
      .catch((err) => {
        if (err && err.status === 404) return;
        console.warn('[网页大修] 检查 ' + file + ' 更新失败: ' + ((err && err.message) || err));
      });
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

  const SHADOW_SCAN_MS = 400; // 两次扫描的最小间隔（节流）：滚动/懒加载再频繁也最多这么多次

  const shadowBlocks = []; // [{ key, path, sheet|null, css, roots:Set, styleEls:Map(root → <style>) }]
  const shadowWarned = new Set(); // 只提示一次（同一个问题不重复刷控制台）
  let shadowObserver = null;  // 全站只挂 1 个 document 观察器
  let shadowTree = [];        // 所有 block 的路径合并成的树（公共前缀只查一次）
  let shadowDirty = false;    // 有变动待扫描
  let shadowTimer = null;     // 节流定时器
  let shadowThrottle = 0;     // 上次扫描的时间
  let shadowScrollEnd = 0;    // 滚动停止后的补扫定时器

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

  // 宿主选择器写错时只报一次（以前每次扫描都刷一条，能把控制台拖垮）
  function resolveHosts(scope, sel) {
    try {
      return Array.prototype.slice.call(scope.querySelectorAll(sel));
    } catch (err) {
      if (!shadowWarned.has('__sel:' + sel)) {
        shadowWarned.add('__sel:' + sel);
        console.error('[shadow] 宿主选择器写法有问题：' + sel);
      }
      return [];
    }
  }

  // 把所有 block 的 path 合并成一棵树：共同前缀（如 bili-comments）只查一次，
  // 而不是每个块、每次扫描都从 document 重新下钻一遍（这是之前卡死的根因之一）
  function buildShadowTree() {
    const root = [];
    for (const block of shadowBlocks) {
      let nodes = root;
      let leaf = null;
      for (const sel of block.path) {
        leaf = null;
        for (const n of nodes) {
          if (n.sel === sel) {
            leaf = n;
            break;
          }
        }
        if (!leaf) {
          leaf = { sel: sel, children: [], blocks: [] };
          nodes.push(leaf);
        }
        nodes = leaf.children;
      }
      if (leaf && leaf.blocks.indexOf(block) === -1) leaf.blocks.push(block);
    }
    return root;
  }

  // 沿树扫描一次：同一层、同一 scope 上的选择器只查询一次
  function collectShadowTargets(nodes, scope, out) {
    for (const node of nodes) {
      const hosts = resolveHosts(scope, node.sel);
      if (!hosts.length) continue;
      for (const block of node.blocks) {
        const list = out.get(block);
        if (list) for (const h of hosts) list.push(h);
        else out.set(block, hosts.slice());
      }
      if (!node.children.length) continue;
      for (const host of hosts) {
        const sr = host.shadowRoot;
        if (sr) collectShadowTargets(node.children, sr, out);
      }
    }
  }

  // 变动 → 标脏并节流合并成一次扫描。
  // 只挂 1 个 document 观察器：以前是"每个中间层 shadow root 各挂一个"，
  // 评论一多就是几十上百个 observer 且从不释放 → 越滚越卡，最后页面无响应。
  function scheduleShadowScan() {
    shadowDirty = true;
    if (shadowTimer) return;
    const wait = Math.max(0, SHADOW_SCAN_MS - (Date.now() - shadowThrottle));
    shadowTimer = setTimeout(function () {
      shadowTimer = null;
      if (!shadowDirty) return;
      shadowDirty = false;
      shadowThrottle = Date.now();
      injectShadowBlocks();
    }, wait);
  }

  // 滚动是懒加载的触发点：滚动中按节流扫；停下后再补扫一次（接住最后一批评论）
  function onShadowScroll() {
    scheduleShadowScan();
    if (shadowScrollEnd) clearTimeout(shadowScrollEnd);
    shadowScrollEnd = setTimeout(function () {
      shadowScrollEnd = 0;
      scheduleShadowScan();
    }, 200);
  }

  function startShadowObserver() {
    if (!shadowBlocks.length) return;
    if (shadowObserver) return; // 已经挂过（含滚动监听），别重复挂
    shadowObserver = new MutationObserver(scheduleShadowScan); // 回调只标脏，不做任何遍历
    shadowObserver.observe(document.documentElement || document, { childList: true, subtree: true });
    window.addEventListener('scroll', onShadowScroll, true);
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
    if (!shadowBlocks.length) return;
    const targets = new Map(); // block → 命中的宿主
    collectShadowTargets(shadowTree, document, targets);

    for (const block of shadowBlocks) {
      const hosts = targets.get(block) || [];
      let sawRoot = false;
      for (const host of hosts) {
        const sr = host.shadowRoot;
        if (!sr) continue;
        sawRoot = true;
        applyStyleToRoot(block, sr);
      }
      // 虚拟列表会不停销毁评论：把已经脱离文档的 root / <style> 清掉，避免无限增长
      if (block.roots.size) {
        block.roots.forEach(function (root) {
          const h = root && root.host;
          if (h && typeof h.isConnected === 'boolean' && !h.isConnected) block.roots.delete(root);
        });
      }
      if (block.styleEls.size) {
        block.styleEls.forEach(function (el, root) {
          const h = root && root.host;
          if (h && typeof h.isConnected === 'boolean' && !h.isConnected) {
            if (el.remove) el.remove();
            block.styleEls.delete(root);
          }
        });
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

    shadowTree = buildShadowTree(); // 路径合并成树（块有增删时才重建）
    injectShadowBlocks();
    startShadowObserver();
  }

  // 临时退出脚本时：把注入的样式从各 shadow root 上摘掉，并停掉观察器
  function removeShadowStyles() {
    if (shadowTimer) { clearTimeout(shadowTimer); shadowTimer = null; }
    if (shadowScrollEnd) { clearTimeout(shadowScrollEnd); shadowScrollEnd = 0; }
    if (shadowObserver) { shadowObserver.disconnect(); shadowObserver = null; }
    window.removeEventListener('scroll', onShadowScroll, true);
    shadowDirty = false;
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
