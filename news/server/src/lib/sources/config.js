// 新闻来源。增删来源只改这个文件。
//
// section 决定条目进哪一栏：
//   news      科技 / 数码新闻，由 AI 挑出当天的大事、合并重复报道、写中文摘要
//   products  Product Hunt 每日新品
//   github    GitHub Trending 每日榜
//
// category 是这家媒体最常写的门类：没有 AI、关键词也判断不出来时，归到这一类（见 lib/classify.js）。
//
// pagedUrl 是能翻页的订阅源（WordPress 的 ?paged=2、3…），补抓历史新闻时用（见 lib/sources/history.js）。
//
// 单个来源抓取失败不影响其他来源，失败情况会记在当天这一期的 sourceStatus 里。
// 改了地址先用 scripts/probe-sources.js 检查（我们的开发环境连不上这些网站时，推送后看“检查新闻来源”工作流的日志）。
// 36氪不带 www 的 /feed 会返回防爬网页；虎嗅的 www.huxiu.com/rss 在海外连不上，用 rss.huxiu.com。
export const SOURCES = [
  // 中文
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/', lang: 'zh', section: 'news', category: '数码' },
  { id: '36kr', name: '36氪', url: 'https://www.36kr.com/feed', lang: 'zh', section: 'news', category: '商业与政策' },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed', lang: 'zh', section: 'news', category: '数码' },
  { id: 'ifanr', name: '爱范儿', url: 'https://www.ifanr.com/feed', lang: 'zh', section: 'news', category: '数码', pagedUrl: 'https://www.ifanr.com/feed?paged={n}' },
  { id: 'geekpark', name: '极客公园', url: 'https://www.geekpark.net/rss', lang: 'zh', section: 'news' },
  { id: 'tmtpost', name: '钛媒体', url: 'https://www.tmtpost.com/rss.xml', lang: 'zh', section: 'news', category: '商业与政策' },
  { id: 'huxiu', name: '虎嗅', url: 'https://rss.huxiu.com/', lang: 'zh', section: 'news', category: '商业与政策' },
  // 英文
  { id: 'theverge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', section: 'news' },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', lang: 'en', section: 'news', category: '商业与政策', pagedUrl: 'https://techcrunch.com/feed/?paged={n}' },
  { id: 'arstechnica', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en', section: 'news', pagedUrl: 'https://arstechnica.com/feed/?paged={n}' },
  { id: 'engadget', name: 'Engadget', url: 'https://www.engadget.com/rss.xml', lang: 'en', section: 'news', category: '数码' },
  { id: '9to5mac', name: '9to5Mac', url: 'https://9to5mac.com/feed/', lang: 'en', section: 'news', category: '数码', pagedUrl: 'https://9to5mac.com/feed/?paged={n}' },
  { id: 'gsmarena', name: 'GSMArena', url: 'https://www.gsmarena.com/rss-news-reviews.php3', lang: 'en', section: 'news', category: '数码' },
  { id: 'mittr', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', lang: 'en', section: 'news', category: '科学与前沿', pagedUrl: 'https://www.technologyreview.com/feed/?paged={n}' },
  // 新品与开源
  { id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com/feed', lang: 'en', section: 'products' },
  { id: 'github', name: 'GitHub Trending', url: 'https://github.com/trending?since=daily', lang: 'en', section: 'github', kind: 'github-trending' },
];

/** 新闻的门类。AI 或关键词规则给每条新闻归到其中一类，都判断不出来时归到 OTHER。 */
export const CATEGORIES = ['数码', 'AI', '互联网', '芯片与硬件', '开发者', '科学与前沿', '商业与政策'];
export const OTHER = '其他';
