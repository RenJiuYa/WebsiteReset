// ============================================================
// 站点管理表（由总入口 start.user.js 在运行时读取，改完刷新页面即生效）
//
// 键（key）: 网站名，仅作标识，方便人工识别
// enabled  : 是否启用（省略 = 启用）——写在站点上关掉整个网站，写在规则上关掉单条规则
// dir      : 站点样式目录（相对仓库根目录，本地与发布共用同一结构）
// rules    : 规则表 —— 决定"哪些地址加载哪些入口"，按声明顺序匹配，命中的都会加载
//              match : 地址模式（可写一个字符串，也可写数组）
//                        'live.bilibili.com'     该域名及其子域，任意路径
//                        'bilibili.com/'         该域名及其子域 + 路径正好是 /
//                        'bilibili.com/user/*'   该域名及其子域 + 路径以 /user/ 开头（* = 任意字符，可含 /）
//                        '*.bilibili.com'        域名里也可以用 *
//                        省略 / 空数组            兜底：该站点任何地址
//              css   : CSS 入口的模块名（不含扩展名，自动补 .css），可省略、可写数组
//              js    : JS  入口的模块名（不含扩展名，自动补 .js ），可省略、可写数组
//              → 多个规则都命中时按声明顺序全部加载（后面的覆盖前面的），同名只加载一次
//
// 站点的 CSS 是"合并产物"：由入口 _Entry.less 把本站各模块 @import 在一起 → _Entry.css，
// 改任何 .less 后保存，Easy LESS 都会重新编译入口（见各模块顶部的 // main: _Entry.less）。
// 所以这里只会写 '_Entry'（或分页面入口，如 '_Entry-直播'）这一个入口名。
//
// 新增网站：建好 Web/<网站>/ 文件夹 → 在下面加一条 → 刷新页面即可。
// ============================================================

const SITES = {
  'B站': {
    enabled: true,
    dir: 'Web/Bilibili',
    rules: [
      // 主体
      { match: ['bilibili.com'], css: '_Entry', js: ['_Entry'] },
      // 直播
      { match: ['live.bilibili.com'], css: '_Entry-直播', js: ['_Entry-直播'] },
    ],
  },
  '百度贴吧': {
    enabled: true,
    dir: 'Web/百度贴吧',
    rules: [
      { match: ['tieba.baidu.com'], css: '_Entry' },
    ],
  },
  /* ———————————————— AI ———————————————— */
  'DeepSeek': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['deepseek.com'], css: 'DeepSeek' },
    ],
  },
  /* ———————————————— Media 媒体 ———————————————— */
  'Google': {
    enabled: true,
    dir: 'Web/Google',
    rules: [
      { match: ['www.google.com'], css: 'Google 搜索' },
      { match: ['www.google.com.*'], css: 'Google 搜索' },
      { match: ['translate.google.com'], css: 'Google 翻译' },
    ],
  },
  'X推特': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['x.com'], css: 'X推特' },
    ],
  },
  '百度': {
    enabled: true,
    dir: 'Web/百度',
    rules: [
      { match: ['www.baidu.com'], css: '百度搜索' },
      { match: ['pan.baidu.com'], css: '百度网盘' },
      { match: ['map.baidu.com'], css: '百度地图' },
      { match: ['baike.baidu.com'], css: '百度百科' },
    ],
  },
  '新浪微博': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['weibo.com'], css: '新浪微博' },
    ],
  },
};

