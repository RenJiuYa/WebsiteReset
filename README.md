# 网页大修（WebsiteReset）

按站点组织的网页样式改造项目：**CSS（LESS）负责布局与隐藏**，**uBlock Origin 规则负责 CSS 做不到的部分**（文本匹配、按计算样式匹配、向上隐藏等）。

## 目录结构

```
start.user.js            总入口（直接装在暴力猴里的文件）
Web/
  sites.js               站点管理表（哪些网站、哪些地址加载哪些入口；运行时读取）
  Bilibili/              一个站点一个文件夹
    _Entry.less          入口（主文件）：把本站各模块 @import 在一起
    _Entry.css           编译产物（只有入口才产出 .css）
    _Entry.js            JS 入口（需要脚本行为时才写；JS 同样按"每站一入口"组织）
    _Entry-直播.less     分页面入口示例：直播页"追加"的那一份（另有同名 .css / .js）
    通用.less            模块（顶部写了 // main: _Entry.less，保存它就重新编译入口）
    Page-首页.less 等     其它模块
    _param.less          共享参数 / CSS 变量（只放变量/mixin，不产出 .css）
  _媒体/                 按站点命名放单文件入口的站点（如 X推特.less / .css / .js）
ublock.user.txt          uBlock Origin 规则（CSS 做不到的才写这里）
utils/                   工具类（由 start.user.js 自动加载：click / disableShortcut）
```

## 一、暴力猴脚本（总入口）

- **开发**：启动 live-server（根目录设为仓库根）→ 浏览器打开
  `http://127.0.0.1:5500/start.user.js` → 暴力猴安装/更新。
- 改完 CSS：刷新页面，或点暴力猴菜单「重新加载样式（手动刷新）」。
- 临时和原网站对比：菜单「临时退出脚本」。
- 加网站：建 `Web/<网站>/` 文件夹（含入口 `_Entry.less`）→ 在 `Web/sites.js` 里加一条 → 刷新页面。
- **开发/发布切换**：改 `start.user.js` 顶部的开关 `const IS_DEV = true;`
  - `true` = 开发：全部从本地 live-server（`127.0.0.1:5500`）取，改完刷新即生效
  - `false` = 发布：分两套源 —— `utils/**` 走 tag 快照；`Web/sites.js` 与各站点 `.css` / `.js` 走 `main` 实时源
  （`Web/sites.js` 只放站点信息：有哪些网站、各地址加载哪些入口）
- **日常小修小补（不需要发版）**：只改 `Web/**` → 提交推 `main` → 页面刷新即生效
  （实时源是 `raw.githubusercontent.com/.../main`，请求带 `?t=` 时间戳绕过 CDN 缓存；raw 不通时自动回退 jsDelivr `@main`）
- **发版（只有改 `start.user.js` 或 `utils/**` 才需要）**：升 `@version` → 把 `REMOTE_BASE` 里的 tag 改成同一版本号 → 提交 → 打新 tag，之后
  `https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@<tag>/start.user.js`
  可直接安装。

### 运行环境（为什么脚本头部写了 `@inject-into content`）

- 本脚本有两处必须**执行下载来的代码**：`utils/*.js` 与 `Web/<网站>/*.js`（用 `Function` 构造器）。
- 如果脚本运行在**页面世界**，页面自己的 CSP 会拦下它（X/Twitter 这类站点很典型），控制台报
  `call to Function() blocked by CSP` → 整个脚本不生效（表现为"过一会儿或重启浏览器才恢复"）。
- 所以头部写了 `@inject-into content`，强制在扩展沙箱里执行，页面 CSP 就管不到这些调用。
- `Web/sites.js` 的解析也改成了**纯数据解析**（`JSON.parse`，不再用 `eval`）→ 双保险：
  即使某次仍落在页面世界，样式也照样能加载。
- 真遇到同类报错时，控制台会额外打印三项诊断：`页面 / 执行世界 / 页面 CSP`。

### 站点管理表（`Web/sites.js`）

```js
const SITES = {
  'B站': {
    enabled: true,                          // 省略 = 启用；false = 整个网站不加载
    dir: 'Web/Bilibili',                    // 站点目录（本地与发布共用同一结构）
    rules: [                                // 命中哪些地址 → 加载哪些入口（按顺序匹配，命中都生效）
      { match: ['bilibili.com'], css: '_Entry', js: ['_Entry'] },
      { match: ['live.bilibili.com'], css: '_Entry-直播', js: ['_Entry-直播'] },  // 直播页多加载这一份
    ],
  },
  '百度贴吧': {
    enabled: true,
    dir: 'Web/百度贴吧',
    rules: [{ match: ['tieba.baidu.com'], css: '_Entry' }],
  },
};
```

> 配置按**纯数据**解析（严格 JSON 优先，兼容现在的 JS 风格写法）；
> 字符串里有 `,`、`//`、`{}` 之类的字符都没问题，字符串统一用双引号写最稳。

`match` 的写法：

| 写法 | 含义 |
| --- | --- |
| `'live.bilibili.com'` | 该域名**及其子域**，任意路径 |
| `'bilibili.com/'` | 该域名及其子域 + 路径**正好是** `/` |
| `'bilibili.com/user/*'` | 该域名及其子域 + 路径以 `/user/` 开头（`*` 匹配任意字符，可含 `/`） |
| `'*.bilibili.com'` | 域名里也可以用 `*` |
| 省略 / 空数组 | 兜底：该站点任何地址 |

- `css` / `js` 写的是**模块名**（不含扩展名，自动补 `.css` / `.js`），可省略、可写数组（按顺序加载）
- 多条规则都命中时**全部生效**（后面的覆盖前面的），同名只加载一次
- 规则里的 `enabled: false` 可以单独停用某一条

### CSS 的编译与合并（LESS）

每个站点由**入口文件**把各模块 `@import` 在一起，编译成一个 `.css`（站点目录里**只有不带 `// out: false` 的 `.less` 会产出 `.css`**）：

```less
// Web/Bilibili/_Entry.less          主站入口
@import '通用';
@import 'Page-首页';
// … 顺序 = 级联顺序（后面的覆盖前面的）

// Web/Bilibili/_Entry-直播.less      直播页「追加」的入口（只引直播相关模块）
@import 'Page-直播';
```

各模块顶部统一写这两行（Easy LESS 的**文件级设置**）：

```less
// main: _Entry.less   ← 保存本文件时，改为编译入口文件（保证入口产物同步更新）
// out: false          ← 本文件不单独产出 .css
```

- 这样**改任何 `.less`（含共享参数文件）都不会出现"某个 `.css` 还是旧值"**
- 一个站点可以有**多个入口**（如 B站：主站 `_Entry` + 直播页 `_Entry-直播`），
  由 `sites.js` 的 `rules` 决定"哪些地址加载哪些入口"
- 共享参数：建 `_param.less`（只放变量/mixin，同样写上面两行），在入口里 `@import '_param';`
  - 想让它里面的 `:root { --变量 }` **一起输出**进产物（贴吧就是这么用的）→ 直接 `@import`
  - 只想取变量、不输出它的规则 → 写 `@import (reference) '_param';`
- ⚠️ **只写 LESS 级的 `@import`**（编译期展开）。别用 CSS 级的 `@import`（`@import url("x.css")`）：
  脚本是把 CSS 内联进 `<style>` 的，相对路径会按页面地址解析 → 404
- ⚠️ **共享文件里只放变量/mixin**，不要放实际规则或 `/* @shadow */` 标记
  （它们会被复制进每一个用到它的产物里）

## 二、uBlock Origin 规则（`ublock.user.txt`）

只放 CSS 实现不了的规则。**每条规则都必须带域名前缀。**

### 开发期订阅（本地实时，改完不用 push）

1. uBO 面板 → **过滤列表** → 底部 **自定义** → 勾选 **Import**
2. 粘贴地址：

   ```
   http://127.0.0.1:5500/ublock.user.txt
   ```

3. 点「应用更改」
4. 之后改完规则，点该列表旁的**时钟图标**，或面板上的 **Update now**，就会重新拉取生效

### 发布期订阅（自己长期用 / 分享给别人）

- 粘贴地址：

  ```
  https://raw.githubusercontent.com/RenJiuYa/WebsiteReset/main/ublock.user.txt
  ```

- **一键订阅**（在 GitHub 页面上点一下即可，[github.com](https://github.com) 是 uBO 认可的订阅来源）：

  [订阅「网页大修」规则](https://subscribe.adblockplus.org/?location=https%3A%2F%2Fraw.githubusercontent.com%2FRenJiuYa%2FWebsiteReset%2Fmain%2Fublock.user.txt&title=%E7%BD%91%E9%A1%B5%E5%A4%A7%E4%BF%AE%E8%A7%84%E5%88%99)

  （若上面链接在你的浏览器里不弹订阅确认：右键该链接 → **Subscribe to filter list…**）

### 规则示例

```
! 注释用 ! 开头
bilibili.com##.feed-card:has-text(广告)      ← 隐藏含"广告"字样的视频卡片
bilibili.com##.feed-card:has-text(推广):upward(2)   ← 匹配到内层后隐藏上层容器
```

- 纯选择器能做到的（`display:none`、网格/间距调整、`:has()`、`:not()` 等）→ 写进 `Web/<网站>/*.less`
- 需要脚本行为的（读写 DOM、监听路由、动态插入节点时重建）→ 写 `Web/<网站>/*.js`
- 两类都做不到的（按文本/计算样式选元素、隐藏某个祖先）→ 才写这里

### 注入到 shadow DOM（只支持 open）

有些组件把内容放在 shadow root 里，普通 CSS 进不去。用注释标记把它交给脚本注入：

```less
/* 普通 CSS：照旧写在文档层 */
.bili-header__bar { height: 60px !important; }

/* @shadow(.宿主选择器) */
.shadow 内部的选择器 { display: none !important; }
/* @shadow-end */
```

- **`@shadow(...)` 括号里写的是宿主（shadow host）的选择器**，也就是"包着 `#shadow-root` 的那一层真实元素"（`#shadow-root` 本身没有属性、选不到）。
- 块里的 CSS **不会进 document**（避免文档层误伤），只注入到匹配宿主的 shadow root。
- 想确认某个类名是不是宿主：DevTools 里选中 shadow 内的元素，看 `#shadow-root (open)` 上面的那个元素；或 Console 里 `$0.getRootNode().host`。

**多层（嵌套 shadow）**——两种写法等价：

```less
/* 嵌套写法 */
/* @shadow(.外层宿主) */
  /* @shadow(.内层宿主) */     ← 在「外层 shadow root 内部」找宿主
  .inner { color: red; }
  /* @shadow-end */
/* @shadow-end */

/* 语法糖：>> 分隔路径 */
/* @shadow(.外层宿主 >> .内层宿主) */
.inner { color: red; }
/* @shadow-end */
```

其他行为：

- 匹配到多个宿主 → 每个宿主的 shadow root 各注入一份（共享同一个样式表对象，省内存）
- 匹配到元素但它没有 `shadowRoot`（closed，或选择器选错了层）→ 控制台给出提示
- 没匹配到宿主 → 控制台提示"这条标记不生效"
- 标记的 `@shadow(...)` / `@shadow-end` 数量不匹配 → 报错并指出原因（本次不处理 shadow 块，文档层照旧注入）
- 「重新加载样式」会**就地更新**已注入的样式（所有 shadow root 一起刷新，不闪烁）；「临时退出脚本」会把注入的样式从 shadow root 上摘掉

## 三、工具类（`utils/`）

`utils/` 下的文件由总入口**自动加载**（在站点 JS 之前执行），并把函数挂到全局，所以 `Web/<网站>/*.js` 里可以直接调用，不需要任何声明/引入。

### `click(选择器, 延迟秒 = 0, 次数 = 1, 间隔秒 = 1)`

模拟鼠标点击匹配的元素（匹配到的会**全部**点击）。相当于自己脚本版的 uBO `##+js(trusted-click-element…)`，但**不需要"信任"设置**。

```js
click('.bpx-player-ctrl-setting-handoff-content .bui-radio-item:nth-of-type(2)'); // 加载完立即点一次
click('.share-btn', 1.5, 3, 2);      // 加载完等 1.5s，点 3 次，每次间隔 2s
const cancel = click('.xxx', 0, 5);  // 返回值是取消函数
cancel();
```

- **"页面加载完成"** = window 的 `load`（即 `document.readyState === 'complete'`）；已经完成就直接开始算延迟
- 每次点击前都会**重新查询**一次选择器 → 晚出现的元素也能点到，配合"次数/间隔"可当**重试**用（没匹配到会 `console.warn` 并继续下一次）
- 点击依次派发 `pointerdown → mousedown → pointerup → mouseup → click`（都带 `composed: true`，能跨 shadow 边界冒泡）
- 合成事件的 `isTrusted = false`，极少数组件会据此拒绝响应（那种只能靠 uBO 的 scriptlet）
- 若与页面全局撞名，可用别名 **`simulateClick(...)`**

### `disableShortcut(快捷键, 选项?)`

让页面上某个快捷键**失效**（页面自己绑定的按键，拦不到浏览器/系统级的那些）。

```js
disableShortcut('G');                        // 让 G 键失效
disableShortcut('Ctrl Alt G');               // 组合键（顺序/大小写随意，也支持 Ctrl+Alt+G）
disableShortcut('Space');                    // 支持别名：space / esc / up / down / left / right …
disableShortcut('G', { inInputs: true });    // 连输入框里也拦（默认跳过输入框）

const restore = disableShortcut('D');        // 返回值是恢复函数
restore();                                   // 解除拦截
```

- 实现：在 `window` 上以**捕获阶段**监听 `keydown` + `keyup`，命中就 `stopImmediatePropagation()` + `preventDefault()`
- 匹配规则：**Ctrl/Alt/Meta 严格**（写了必须按、没写必须没按）、**Shift 忽略**、字母大小写不敏感，并同时比对 `event.key` 与 `event.code`
- **默认在 `input` / `textarea` / `select` / `[contenteditable]` 上不拦**（否则会毁掉打字）
- 拦不住的：`Ctrl+W/T/N/L`、`F11` 等浏览器/系统级快捷键；极少数用 `keypress` 或非键盘机制触发的站点
- 与"临时退出脚本"无关：退出脚本**不会**自动解除拦截，请用返回的 `restore()`
- 短别名：**`disableKey(...)`**

## 四、发布流程

### 日常改动（不需要发版）

1. 只改 `Web/**`：`Web/<网站>/*.less` 会被插件自动编译成入口 `.css`（两者都要提交）、`Web/sites.js`、`Web/<网站>/*.js`
2. 提交 → `git push origin main`
3. 页面刷新即生效 —— 脚本对 `Web/**` 走 `main` 实时源（请求带 `?t=` 时间戳绕过 CDN 缓存）
4. 性能：内容会缓存到本地，页面一打开先用缓存注入（秒开、不闪），同时后台检查更新
   - CSS 有变化 → 当次就地热替换（刷新就能看到）
   - 站点 JS / `sites.js` 有变化 → 提示一句，**再刷新一次**生效（避免重复执行）

### 发版（只有改 `start.user.js` 或 `utils/**` 才需要）

1. 升版本：`start.user.js` 的 `@version`（小改动 +末位，结构/行为变化 +中间位），并把 `REMOTE_BASE` 里的 tag 改成同一个版本号
2. 提交 → `git push origin main`
3. 打 tag → `git push origin <tag>`（**注意别用 `git push --tags`**）
4. 验证 CDN：
   `https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@<tag>/start.user.js`

> **来源分层**（`start.user.js` 顶部常量）：
> - `REMOTE_BASE`（tag 快照，内容不可变）→ 只给 `utils/**` 这类脚本基础设施用，因此长期缓存、不带时间戳
> - `LIVE_BASE`（`raw.githubusercontent.com/.../main`）→ `Web/sites.js` 与各站点 `.css` / `.js`，push 即生效
> - `LIVE_BASE_FALLBACK`（jsDelivr `@main`）→ 主实时源取不到时自动回退（有缓存，可能滞后）
>
> 所以"改样式 / 加站点 / 调参数"不用发版；只有"改脚本本体或工具类"才发版。`ublock.user.txt` 同样走 `main` 的 raw 地址，随时最新。
