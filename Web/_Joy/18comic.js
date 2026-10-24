// 18comic.vip：滚动时收起顶部导航 / 隐藏右下浮动按钮 + 屏蔽站点自带脚本的抖动
// ★ 所有改动都在这一个文件里：不依赖页面的 jQuery、也不依赖 18comic.less 里的新规则
//   （需要的那几行样式由本脚本自己注入，见 injectStyle）
//
// 一、站点自带那份脚本的 bug（就是"不停修改组件的属性"的来源）
//     Head.slideUp() / Head.slideDown()
//        → 每次"滚动停下 200ms"就写一遍 inline style，导航来回抖
//     $('.float_right > div').addClass('hide') 紧接着又 removeClass('hide')
//        → 每 200ms 写两遍 class 属性，而且永远不会真的隐藏（净效果是零）
//     处理：
//       ① 用 CSS 把导航的尺寸/显示"钉死"（slideUp/slideDown 改 inline style 也动不了布局）
//       ② 能拿到 jQuery 时再定向拦掉这几类调用（拿不到也不影响效果，只是省点无用功）
//       ③ 浮动按钮用我们自己的 class（ws18-hide），站点的 removeClass('hide') 删不掉它
//
// 二、为什么不用 $('#x')
//     本脚本跑在暴力猴沙箱世界（start.user.js 头部 @inject-into content），页面的 $ 不在
//     这个作用域里 → 直接写 $('#Comic_Top_Nav') 会 ReferenceError: $ is not defined，
//     表现就是"CSS 生效、JS 一句都没跑"。所以自己的逻辑全部用原生 DOM。
//
// 三、为什么不在顶层缓存元素
//     脚本在 document-start 执行，那时 DOM 还没生成，抓到的是空集合（toggleClass 静默无效）。
//     改成每次 update() 重新查询：元素后插入（懒加载/局部刷新）也能对上，缺失也不报错。
//
// 四、只做"幂等"切换：状态没变就不碰 class 属性 → 不会引起额外重排
//
// 行为：向下滚且离顶 >60px 收起导航；向上滚放出；滚过 300px 隐藏右下浮动按钮。
(function () {
  'use strict';

  var HEAD_SEL = '#Comic_Top_Nav';
  var FLOAT_SEL = '.float_right > div';
  var HIDE_AFTER = 60;   // 离开顶部超过这个距离，才允许收起导航
  var FLOAT_AFTER = 300; // 滚过这个距离隐藏右下浮动
  var DELTA = 6;         // 单次滚动量小于它就不判方向（避免微小抖动来回切）

  var lastY = 0;
  var ticking = false;
  var styleReady = false;

  // ── 需要的那一点点样式（不改 18comic.less，由脚本注入） ─────────────────
  // 用 transform 收起（不改变布局，下文不跳）；sticky 让导航滚下来时浮在顶部
  function injectStyle() {
    if (styleReady) return;
    styleReady = true;
    var style = document.createElement('style');
    style.setAttribute('data-ws18', '1');
    style.textContent =
      // 把导航的显示/尺寸钉死：站点那份脚本的 slideUp/slideDown 会改 inline style，
      // 这几条 !important 让它们怎么改都动不了布局 → 不会再跟着跳动（哪怕拦 jQuery 没生效）
      HEAD_SEL + '{display:block !important;height:auto !important;overflow:visible !important;}' +
      HEAD_SEL + '{position:sticky !important;top:0 !important;z-index:1000 !important;' +
      'transition:transform .2s ease !important;}' +
      HEAD_SEL + '.is-hidden{transform:translateY(-100%) !important;}' +
      // 浮动按钮用自己的 class：站点的 removeClass('hide') 删不掉它
      FLOAT_SEL + '.ws18-hide{display:none !important;}';
    (document.head || document.documentElement).appendChild(style);
  }

  // ── 屏蔽站点脚本的抖动（定向：只针对上面那两个目标，不动其它 jQuery 行为） ──
  // 找页面的 jQuery（沙箱里优先 unsafeWindow；有的站点只挂了 $，也一并接受）
  function pageJQuery() {
    var cands = [];
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) cands.push(unsafeWindow);
    cands.push(window);
    try {
      if (document.defaultView) cands.push(document.defaultView);
    } catch (err) { /* 忽略 */ }
    for (var i = 0; i < cands.length; i++) {
      var w = cands[i];
      var jq = w && (w.jQuery || w.$);
      if (jq && jq.fn) return jq;
    }
    return null;
  }

  function silenceSiteScript() {
    var jq = pageJQuery();
    if (!jq) return false;

    function hitNav(self) {
      return !!(self && self.is && self.is(HEAD_SEL));
    }
    function hitFloatHide(self, args) {
      return !!(args && args[0] === 'hide' && self && self.is && self.is(FLOAT_SEL));
    }

    function wrap(name, shouldBlock) {
      var orig = jq.fn[name];
      if (typeof orig !== 'function' || orig.__ws18) return;
      var patched = function () {
        if (shouldBlock(this, arguments)) return this; // 拦掉：什么都不做
        return orig.apply(this, arguments);
      };
      patched.__ws18 = 1;
      jq.fn[name] = patched;
    }

    wrap('slideUp', hitNav);   // 导航的滑动动画：会反复写 inline style
    wrap('slideDown', hitNav);
    wrap('addClass', hitFloatHide);    // 站点那段"加了 hide 又立刻删掉"的 bug 逻辑
    wrap('removeClass', hitFloatHide);
    return true;
  }

  // jQuery 可能比我们晚出现：轮询几次，一出现就立刻挂上（最多试 3 秒，之后不再打扰）
  function watchJQuery() {
    if (silenceSiteScript()) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (silenceSiteScript() || tries > 60) clearInterval(timer);
    }, 50);
  }

  // ── 自己的滚动逻辑（原生 DOM + 幂等切换） ─────────────────────────────
  function setClass(el, name, on) {
    if (!el || !el.classList) return;
    if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
  }

  function update() {
    ticking = false;
    var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    var dy = y - lastY;

    if (Math.abs(dy) >= DELTA) {
      // 向下滚（内容往上走）→ 收起；向上滚 → 放出
      setClass(document.querySelector(HEAD_SEL), 'is-hidden', dy > 0 && y > HIDE_AFTER);
      lastY = y;
    }

    var floats = document.querySelectorAll(FLOAT_SEL);
    for (var i = 0; i < floats.length; i++) setClass(floats[i], 'ws18-hide', y >= FLOAT_AFTER);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update);
    else setTimeout(update, 16); // 每帧最多一次
  }

  function start() {
    injectStyle();
    lastY = window.pageYOffset || 0;
    update();      // 刷新后可能停在页面中间：先对齐一次状态
    watchJQuery(); // 尝试拦掉站点脚本的抖动（拿不到 jQuery 也不影响样式效果）
    console.log('[18comic] 脚本已注入（导航/浮动按钮由 class 控制）'); // 只打一次
  }

  window.addEventListener('scroll', onScroll, { passive: true }); // 声明不阻止默认行为

  if (document.readyState === 'loading' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

