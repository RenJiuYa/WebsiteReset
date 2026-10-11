// ==UserScript==
// @name          网页大修-总入口
// @namespace     RenJiuYa
// @version       1.0.1
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
// 总入口说明（只做一件事：按站点把样式加载起来）
// 1. Web/ 下每个网站一个文件夹，存放该网站的 css / js；本文件是唯一入口。
// 2. @match 故意写成全站通配（*://*/*）：插件头部的匹配范围在注入前就定死了，
//    脚本运行时无法动态扩大，所以把"真正生效范围"交给 SITES 里的 hosts 判断。
//    新增网站：建好站点文件夹 → 在 SITES 里加一条即可，头部不用动。
// 3. 永久停用某网站：把该站点配置里的 enabled 改成 false。
// 4. 站点级 start.js 仅作单站调试用，正式使用只装本文件。
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
  const REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@v1.0.1'; // 发布地址，版本号与 @version 同步（tag 内容不可变，改完要换新 tag）
  const BASE = IS_DEV ? LOCAL_BASE : REMOTE_BASE;

  // ============ 站点注册表 ============
  // 键（key）: 网站名，仅作标识，方便人工识别
  // enabled  : 是否启用该网站的样式
  // hosts    : 生效域名（含子域），这才是真正决定"在哪些站生效"的地方
  // dir      : 站点样式目录（相对 BASE，本地与发布共用同一目录结构）
  // css / js : 样式与脚本文件（相对站点目录）
  const SITES = {
    'B站': {
      enabled: true,
      hosts: ['bilibili.com'],
      dir: 'Web/Bilibili',
      css: ['通用.css', 'Page-首页.css'],
      js: ['通用.js', 'Page-首页.js'],
    },
  };

  // ============ 匹配当前站点 ============
  function matchSite() {
    const host = location.hostname;
    return Object.values(SITES).find(
      (site) =>
        site.enabled &&
        site.hosts.some((h) => host === h || host.endsWith('.' + h))
    );
  }

  const SITE = matchSite();
  if (!SITE) return;

  // 该站点的样式根地址
  const SITE_BASE = BASE + '/' + SITE.dir;

  // ============ 工具函数 ============
  // 加时间戳绕过缓存（仅开发模式需要）
  function withCacheBust(url) {
    return IS_DEV ? url + '?t=' + Date.now() : url;
  }

  // 用 Promise 包装 GM_xmlhttpRequest，方便 async/await
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: withCacheBust(url),
        onload: (res) => {
          if (res.status === 200) resolve(res.responseText);
          else reject(new Error('HTTP ' + res.status + ': ' + url));
        },
        onerror: () => reject(new Error('网络错误: ' + url)),
      });
    });
  }

  function head() {
    return document.head || document.documentElement;
  }

  // ============ 加载 CSS ============
  // 先把 CSS 全部拉到内存，再就地更新 <style> 的 textContent；
  // 全程不删除任何 style 元素、写入前也没有 await，因此不会出现"短暂无样式"的闪烁。
  async function loadAllCSS() {
    const results = await Promise.allSettled(
      SITE.css.map((file) => gmFetch(SITE_BASE + '/' + file))
    );

    results.forEach((r, i) => {
      const file = SITE.css[i];
      if (r.status === 'rejected') {
        console.error('[CSS] 加载失败: ' + file, r.reason);
        return;
      }
      let style = document.querySelector('style[data-module-css="' + file + '"]');
      if (!style) {
        style = document.createElement('style');
        style.setAttribute('data-module-css', file);
        head().appendChild(style);
      }
      style.textContent = r.value;
    });
  }

  // ============ 加载 JS 模块 ============
  async function loadAllJS() {
    // 按顺序加载，保证依赖关系（如果模块之间有依赖）
    for (const file of SITE.js) {
      try {
        const code = await gmFetch(SITE_BASE + '/' + file);
        // 用 Function 构造器执行，避免 eval 的一些限制
        // 注意：模块内的代码在全局作用域执行，可直接操作页面
        new Function(code)();
      } catch (err) {
        console.error('[JS] 加载失败: ' + file, err);
      }
    }
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
      loadAllCSS();
      console.log('[网页大修] 已启用（样式已重新加载）');
    } else {
      removeAllCSS();
      console.log('[网页大修] 已临时退出（样式已移除；已执行的 JS 模块需刷新页面才会失效）');
    }
  }

  // 菜单项固定，每次切换不重复注册
  // 改完 CSS 后点「重新加载样式」即可生效（手动刷新，不做定时轮询，避免组件闪烁）
  GM_registerMenuCommand('重新加载样式（手动刷新）', () => {
    if (running) loadAllCSS();
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
  (async function main() {
    // CSS 和 JS 并行加载（改完样式后，用暴力猴菜单里的「重新加载样式」手动刷新）
    // JS 模块不重新加载，避免重复绑定事件
    await Promise.all([loadAllCSS(), loadAllJS()]);
  })();
})();
