// ==UserScript==
// @name          网页大修-总入口
// @namespace     RenJiuYa
// @version       1.0.3
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
// 5. 改完 CSS 后：暴力猴菜单点「重新加载样式（手动刷新）」立即生效（不做定时轮询，避免组件闪烁）；
//    发布模式下该操作受 CDN 缓存影响，需要等 jsDelivr 刷新。
// 6. 运行时临时退出：暴力猴菜单点「临时退出脚本」，样式立刻移除，方便和原网站对比；
//    该选择会被记住（刷新页面依然生效），直到点「重新启用脚本」。
//    注意：已执行过的 JS 模块无法撤销，需刷新页面才会失效。
// ============================================================

(function () {
  'use strict';

  // ============ 开发/发布开关 ============
  const IS_DEV = true;

  const LOCAL_BASE = 'http://127.0.0.1:5500';                              // 本地 live-server 根目录（=仓库根目录）
  const REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@v1.0.3'; // 发布地址，版本号与 @version 同步（tag 内容不可变，改完要换新 tag）
  const BASE = IS_DEV ? LOCAL_BASE : REMOTE_BASE;

  // ============ 站点管理（外部文件 Web/sites.js，运行时读取） ============
  // 好处：改站点、改文件清单只需刷新页面，不必修改本文件、也不必在暴力猴里更新脚本
  const SITES_URL = BASE + '/Web/sites.js';
  const SITES_CACHE = 'sitesCache'; // 读取失败时的兜底缓存

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
    // CSS 和 JS 并行加载；JS 模块不重复执行，避免重复绑定事件
    const [cssCount, jsCount] = await Promise.all([loadAllCSS(), loadAllJS()]);
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
    results.forEach((r, i) => {
      const file = files[i];
      if (r.status === 'rejected') {
        // 404 = 这个模块没有 css，属于正常情况，跳过
        if (!r.reason || r.reason.status !== 404) console.error('[CSS] 加载失败: ' + file, r.reason);
        return;
      }
      let style = document.querySelector('style[data-module-css="' + file + '"]');
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-module-css', file);
        style.textContent = r.value; // 先填内容再插入 → 不会出现空白样式的瞬间
        head().appendChild(style);
      } else {
        style.textContent = r.value;
      }
      loaded++;
    });
    return loaded;
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

  // ============ 运行时开关（暴力猴菜单） ============
  const SWITCH_KEY = 'enabled';
  let running = GM_getValue(SWITCH_KEY, true); // 默认启用

  function removeAllCSS() {
    document.querySelectorAll('style[data-module-css]').forEach((el) => el.remove());
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
