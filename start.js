// ==UserScript==
// @name          网页大修-B站
// @namespace     RenJiuYa
// @version       1.0.0
// @description   略
// @author        RenJiuYa
//
// @match         *://*.bilibili.com/*
// @run-at        document-start
//
// @grant         GM_addStyle
// @grant         GM_xmlhttpRequest
// @connect       127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  // ============ 开发/发布开关 ============
  const IS_DEV = true;

  const LOCAL_BASE = 'http://127.0.0.1:5500/Web-B站';
  const REMOTE_BASE = 'https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@v1.0.0/Web-B站';
  const BASE = IS_DEV ? LOCAL_BASE : REMOTE_BASE;

  // ============ 资源清单 ============
  // CSS 文件列表（相对 BASE 的路径）
  const CSS_FILES = [
    '/通用.css',
  ];

  // JS 模块列表（相对 BASE 的路径）
  const JS_FILES = [
    '/通用.js',
  ];

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
          else reject(new Error(`HTTP ${res.status}: ${url}`));
        },
        onerror: (err) => reject(new Error(`网络错误: ${url}`)),
      });
    });
  }

  // ============ 加载 CSS ============
  async function loadAllCSS() {
    // 先移除旧的样式（热重载）
    document.querySelectorAll('style[data-module-css]').forEach(el => el.remove());

    // 并行拉取所有 CSS
    const results = await Promise.allSettled(
      CSS_FILES.map(async (path) => {
        const css = await gmFetch(BASE + path);
        const style = document.createElement('style');
        style.setAttribute('data-module-css', path);
        style.textContent = css;
        document.head.appendChild(style);
        return path;
      })
    );

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[CSS] 加载失败: ${CSS_FILES[i]}`, r.reason);
      }
    });
  }

  // 开发模式下，每 2 秒重新加载一次（仅调试用，发布时删除）
  if (IS_DEV) {
    setInterval(() => {
      loadAllCSS();
      // JS 模块不建议热重载，可能重复绑定事件
    }, 2000);
  }

  // ============ 加载 JS 模块 ============
  async function loadAllJS() {
    // 按顺序加载，保证依赖关系（如果模块之间有依赖）
    for (const path of JS_FILES) {
      try {
        const code = await gmFetch(BASE + path);
        // 用 Function 构造器执行，避免 eval 的一些限制
        // 注意：模块内的代码在全局作用域执行，可直接使用 GM_* API
        new Function(code)();
      } catch (err) {
        console.error(`[JS] 加载失败: ${path}`, err);
      }
    }
  }

  // ============ 启动 ============
  (async function main() {
    // CSS 和 JS 并行加载
    await Promise.all([loadAllCSS(), loadAllJS()]);
  })();

})();