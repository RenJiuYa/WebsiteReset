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
  'AI': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['deepseek.com'], css: 'DeepSeek' },
      { match: ['chatgpt.com'], css: 'ChatGPT' },
      { match: ['doubao.com'], css: '豆包' },
    ],
  },
  /* ———————————————— Code 代码 ———————————————— */
  'Code': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['csdn.net'], css: 'CSDN' },
      { match: ['juejin.cn'], css: '稀土掘金' },
      { match: ['cnki.net'], css: '中国知网' },
    ],
  },
  /* ———————————————— Game 游戏 ———————————————— */
  'Game': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['store.epicgames.com'], css: 'Epic Games' },
      { match: ['nexusmods.com'], css: 'Nexus' },
      { match: ['bbs.3dmgame.com'], css: '3DM' },
      { match: ['op.gg'], css: 'OPGG' },
      { match: ['oxygennotincluded.wiki.gg'], css: '缺氧Wiki' },
    ],
  },
  /* ———————————————— Joy ———————————————— */
  'Joy': {
    enabled: true,
    dir: 'Web/_Joy',
    rules: [
      { match: ['pixiv.net'], css: 'pixiv' },
      { match: ['18comic.vip'], css: '18comic', js: ['18comic'] },
      { match: ['ahri8.*'], css: 'ahri8' },
      { match: ['manhuabika.com'], css: 'bika' },
      { match: ['e-hentai.org'], css: 'e-hentai' },
      { match: ['nhentai.net'], css: 'nhentai' },
      { match: ['wnacg.com'], css: 'wnacg' },
      { match: ['pornhub.com'], css: 'pornhub' },
    ],
  },
  /* ———————————————— Media 媒体 ———————————————— */
  '媒体': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['x.com'], css: 'X推特' },
      { match: ['xiaohongshu.com'], css: '小红书' },
      { match: ['zhihu.com'], css: '知乎' },
      { match: ['zhipin.com'], css: 'BOSS直聘' },
    ],
  },
  /* ———————————————— Netdisk 网盘 ———————————————— */
  'Netdisk': {
    enabled: true,
    dir: 'Web/_Netdisk',
    rules: [
      { match: ['lanzouw.com'], css: '蓝奏云' },
      { match: ['*.lanzou*.com'], css: '蓝奏云' },
      { match: ['pan.quark.cn'], css: '夸克网盘' },
      { match: ['pan.xunlei.com'], css: '迅雷云盘' },
      { match: ['cloud.189.cn'], css: '天翼云盘' },
      { match: ['share.123pan.cn'], css: '123云盘' },
    ],
  },
  /* ———————————————— Official ———————————————— */
  'Google 谷歌': {
    enabled: true,
    dir: 'Web/Google',
    rules: [
      { match: ['www.google.com', 'www.google.com.*'], css: 'Google 搜索' },
      { match: ['translate.google.com'], css: 'Google 翻译' },
      { match: ['youtube.com'], css: 'Youtube' },
    ],
  },
  'Microsoft 微软': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['bing.com'], css: '微软-搜索' },
    ],
  },
  '抖音': {
    enabled: true,
    dir: 'Web/_Video',
    rules: [
      { match: ['douyin.com'], css: '抖音' },
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
  '网易': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['yeah.net', 'mail.163.com', 'mail.126.com'], css: '网易-邮箱' },
      { match: ['music.163.com'], css: '网易-云音乐' },
      { match: ['fanyi.youdao.com'], css: '网易-有道翻译' },
    ],
  },
  '腾讯': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['wx.mail.qq.com'], css: '腾讯-邮箱' },
      { match: ['map.qq.com'], css: '腾讯-地图' },
    ],
  },
  '新浪': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['weibo.com'], css: '新浪微博' },
    ],
  },
  /* ———————————————— Shop 商店 ———————————————— */
  'Shop': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['detail.zol.com.cn'], css: '中关村在线' },
      { match: ['58.com'], css: '58同城' },
    ],
  },
  '阿里': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['taobao.com'], css: '阿里' },
      { match: ['tmall.com'], css: '阿里' },
      { match: ['goofish.com'], css: '阿里-咸鱼' },
    ],
  },
  '京东': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['jd.com'], css: '京东' },
    ],
  },
  /* ———————————————— Software 软件 ———————————————— */
  'Software': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['423down.com'], css: '423Down' },
      { match: ['52pojie.cn'], css: '吾爱破解' },
    ],
  },
  /* ———————————————— Video 视频 ———————————————— */
  'Video': {
    enabled: true,
    dir: 'Web/_Video',
    rules: [
      { match: ['4kvm.net'], css: '4kvm' },
      { match: ['iyf.tv'], css: '爱壹帆' },
    ],
  },
  /* ———————————————— 娱乐 ———————————————— */
  '娱乐': {
    enabled: true,
    dir: 'Web/_Web',
    rules: [
      { match: ['manhuagui.com'], css: '漫画柜' },
      { match: ['qidian.com'], css: '起点中文网' },
      { match: ['write.qq.com'], css: '阅文作家' },
      { match: ['moegirl.org.cn'], css: '萌娘百科' },
    ],
  },
};

