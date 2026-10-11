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

  const IS_DEV = true; // 开发时 true，发布时 false

  const CSS_URL = IS_DEV
    ? 'http://127.0.0.1:5500/css/B站-导航栏.css?t=' + Date.now()
    : 'https://cdn.jsdelivr.net/gh/用户名/仓库名@v1.0.0/导航栏.css';

  function loadCSS() {
    GM_xmlhttpRequest({
      method: 'GET',
      url: CSS_URL,
      onload: function (res) {
        if (res.status === 200) {
          // 移除旧样式，实现热重载
          const old = document.getElementById('my-local-css');
          if (old) old.remove();

          const style = document.createElement('style');
          style.id = 'my-local-css';
          style.textContent = res.responseText;
          document.head.appendChild(style);
        } else {
          console.error('[本地CSS] 请求失败，状态码:', res.status);
        }
      },
      onerror: function (err) {
        console.error('[本地CSS] 网络错误:', err);
      }
    });
  }

  loadCSS();
})();