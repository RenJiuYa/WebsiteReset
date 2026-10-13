# 网页大修（WebsiteReset）

按站点组织的网页样式改造项目：**CSS（LESS）负责布局与隐藏**，**uBlock Origin 规则负责 CSS 做不到的部分**（文本匹配、按计算样式匹配、向上隐藏等）。

## 目录结构

```
start.user.js            总入口（直接装在暴力猴里的文件）
Web/
  sites.js               站点管理表（哪些网站、加载哪些文件；运行时读取）
  Bilibili/              一个站点一个文件夹
    通用.less / 通用.css
    Page-首页.less / Page-首页.css
    通用.js 等            需要脚本行为时才写（可为空）
ublock.user.txt          uBlock Origin 规则（CSS 做不到的才写这里）
utils/                   工具类（由 start.user.js 自动加载，目前为空）
```

## 一、暴力猴脚本（总入口）

- **开发**：启动 live-server（根目录设为仓库根）→ 浏览器打开
  `http://127.0.0.1:5500/start.user.js` → 暴力猴安装/更新。
- 改完 CSS：刷新页面，或点暴力猴菜单「重新加载样式（手动刷新）」。
- 临时和原网站对比：菜单「临时退出脚本」。
- 加网站：建 `Web/<网站>/` 文件夹 → 在 `Web/sites.js` 里加一条 → 刷新页面。
- **发布**：把 `start.user.js` 里的 `IS_DEV` 改成 `false`，提交并打新 tag（`REMOTE_BASE` 的版本号同步改）后，
  `https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@<tag>/start.user.js`
  可直接安装。

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

## 三、发布流程

1. 改内容：`Web/<网站>/*.less` 会被插件自动编译成 `.css`（两者都要提交）、`ublock.user.txt`、必要时 `start.user.js`
2. 升版本：`start.user.js` 的 `@version` 末位 +1，并把 `REMOTE_BASE` 里的 tag 改成同一个版本号
3. 提交 → `git push origin main`
4. 打 tag → `git push origin <tag>`（**注意别用 `git push --tags`**）
5. 验证 CDN：
   `https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@<tag>/start.user.js`
   `https://cdn.jsdelivr.net/gh/RenJiuYa/WebsiteReset@<tag>/Web/<网站>/<文件>.css`

> `ublock.user.txt` 走的是 `main` 分支的 raw 地址（随时最新），不跟 tag；CSS/JS 走 tag（内容不可变，稳定）。
