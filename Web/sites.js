// ============================================================
// 站点管理表（由总入口 start.user.js 在运行时读取，改完刷新页面即生效）
//
// 键（key）: 网站名，仅作标识，方便人工识别
// enabled  : 是否启用该网站的样式（省略 = 启用）
// hosts    : 生效域名（含子域），这才是真正决定"在哪些站生效"的地方
// dir      : 站点样式目录（相对仓库根目录，本地与发布共用同一结构）
// files    : 模块名（不含扩展名），会自动加载同名的 .css 与 .js；
//            其中不存在的那个自动跳过，所以只写一个名字就行
//
// 新增网站：建好 Web/<网站>/ 文件夹 → 在下面加一条 → 刷新页面即可。
// ============================================================

const SITES = {
  'B站': {
    enabled: true,
    hosts: ['bilibili.com'],
    dir: 'Web/Bilibili',
    files: [
      '通用',
      'Page-首页', 'Page-个人空间', 'Page-搜索', 'Page-播放', 'Page-播放：资源',
      'Page-动态', 'Page-专栏',
      'Page-其他',
      'Page-直播'
    ],
  },
  'B站：直播': {
    enabled: true,
    hosts: ['live.bilibili.com'],
    dir: 'Web/Bilibili',
    files: [
      'Page-直播'
    ],
  },
  '贴吧': {
    enabled: true,
    hosts: ['tieba.baidu.com'],
    dir: 'Web/百度贴吧',
    files: [
      '通用',
      'Page-首页', 'Page-吧页'
    ],
  },
};
