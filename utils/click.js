// ============================================================
// 工具类：click —— 模拟鼠标点击匹配的元素
// 由总入口 start.user.js 自动加载（在站点 JS 之前执行），Web/ 下的 .js 里可直接调用：
//
//   click('.xxx')                 // 页面加载完成后立即点一次
//   click('.xxx', 2)              // 页面加载完成后等 2 秒再点
//   click('.xxx', 0, 3)           // 点 3 次（每次间隔 1 秒，默认值）
//   click('.xxx', 1.5, 3, 2)      // 等 1.5s 后点，共 3 次，每次间隔 2s
//
// 参数：
//   selector  CSS 选择器（匹配到的元素会**全部**按文档顺序点击）
//   delay     页面加载完成后延迟多少秒再开始（默认 0）
//   times     点击次数（默认 1；每次点击前重新查询一遍选择器，所以晚出现的元素也能点到）
//   interval  多次点击之间的间隔秒数（默认 1）
//
// 返回值：取消函数。调用后不再执行剩余的点击：
//   const cancel = click('.xxx', 1, 5, 2);  // 后悔了 → cancel();
//
// 点击方式：依次派发 pointerdown → mousedown → pointerup → mouseup → click
//   （bubbles + cancelable + composed=true，能跨越 shadow 边界冒泡）
//
// 注意：
//   · 合成事件的 isTrusted = false，极少数组件会据此拒绝响应（那就只能用 uBO 的 ##+js(trusted-click-element…)）
//   · 某次执行没匹配到元素 → console.warn 并继续下一次（配合 times/interval 可当"重试"用）
//   · "页面加载完成"指 window 的 load（document.readyState === 'complete'）；已经完成则直接算延迟
//   · 名字 click 较通用，若与页面冲突，可用别名 simulateClick(...)
// ============================================================

(function () {
  'use strict';

  // 秒 → 毫秒（非法值/负数用默认值）
  function toMs(sec, def) {
    const n = Number(sec);
    return isFinite(n) && n >= 0 ? Math.round(n * 1000) : def;
  }

  // 查询：返回元素数组；选择器写错返回 null（用来区分"没匹配到"）
  function query(selector) {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (err) {
      console.error('[click] 选择器写法有问题：' + selector);
      return null;
    }
  }

  function ctorFor(kind) {
    if (kind === 'pointer' && typeof PointerEvent === 'function') return PointerEvent;
    if (typeof MouseEvent === 'function') return MouseEvent;
    return Event;
  }

  function fire(el, type, kind) {
    const EventCtor = ctorFor(kind);
    const opts = { bubbles: true, cancelable: true, composed: true };
    if (kind) opts.button = 0;
    let ev;
    try {
      ev = new EventCtor(type, opts);
    } catch (err) {
      ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
    }
    el.dispatchEvent(ev);
  }

  // 一次"鼠标点击"= 一串事件，尽量贴近真实点击
  function clickElement(el) {
    fire(el, 'pointerdown', 'pointer');
    fire(el, 'mousedown', 'pointer');
    fire(el, 'pointerup', 'pointer');
    fire(el, 'mouseup', 'pointer');
    fire(el, 'click', 'mouse');
  }

  // 等页面加载完成（已经完成就直接回调）
  function afterPageLoad(fn) {
    if (document.readyState === 'complete') {
      fn();
      return;
    }
    const win = typeof window !== 'undefined' ? window : null;
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('load', fn, { once: true });
      return;
    }
    const timer = setInterval(function () {
      if (document.readyState === 'complete') {
        clearInterval(timer);
        fn();
      }
    }, 100);
  }

  /**
   * 模拟点击匹配的元素
   * @param {string} selector  CSS 选择器
   * @param {number} [delay]   页面加载完成后延迟秒数（默认 0）
   * @param {number} [times]   点击次数（默认 1）
   * @param {number} [interval] 多次点击的间隔秒数（默认 1）
   * @returns {Function}        取消函数
   */
  function click(selector, delay, times, interval) {
    if (typeof selector !== 'string' || selector.trim() === '') {
      console.error('[click] 第一个参数必须是 CSS 选择器字符串');
      return function () {};
    }

    const waitMs = toMs(delay, 0);
    const count = Math.max(1, Math.floor(Number(times) > 0 ? Number(times) : 1));
    const gapMs = toMs(interval, 1000);

    let cancelled = false;
    let timer = null;
    let done = 0;

    function runOnce() {
      if (cancelled) return;
      const els = query(selector);
      if (els === null) {
        cancelled = true; // 选择器写错：直接停，不反复报错
        return;
      }
      if (els.length) {
        els.forEach(clickElement);
      } else {
        console.warn('[click] 第 ' + (done + 1) + ' 次没有匹配到元素：' + selector);
      }
      done++;
      if (done < count) timer = setTimeout(runOnce, gapMs);
    }

    afterPageLoad(function () {
      if (cancelled) return;
      timer = setTimeout(runOnce, waitMs);
    });

    return function cancel() {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }

  // 挂到全局，Web/ 下的 .js 模块可直接调用（simulateClick 是同名别名，避免与页面撞名）
  if (typeof globalThis !== 'undefined') {
    globalThis.click = click;
    globalThis.simulateClick = click;
  }
})();
