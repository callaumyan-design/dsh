// 新闻来源。增删来源只改这个文件。
//
// section 决定条目进哪一栏：
//   news      科技 / 数码新闻，由 AI 挑出当天的大事、合并重复报道、写中文摘要
//   products  Product Hunt 每日新品
//   github    GitHub Trending 每日榜
//
// 单个来源抓取失败不影响其他来源，失败情况会记在当天这一期的 sourceStatus 里。
export const SOURCES = [
  // 中文
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/', lang: 'zh', section: 'news' },
  { id: '36kr', name: '36氪', url: 'https://36kr.com/feed', lang: 'zh', section: 'news' },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed', lang: 'zh', section: 'news' },
  { id: 'ifanr', name: '爱范儿', url: 'https://www.ifanr.com/feed', lang: 'zh', section: 'news' },
  { id: 'geekpark', name: '极客公园', url: 'https://www.geekpark.net/rss', lang: 'zh', section: 'news' },
  { id: 'huxiu', name: '虎嗅', url: 'https://www.huxiu.com/rss/0.xml', lang: 'zh', section: 'news' },
  // 英文
  { id: 'theverge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', section: 'news' },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', lang: 'en', section: 'news' },
  { id: 'arstechnica', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en', section: 'news' },
  { id: 'engadget', name: 'Engadget', url: 'https://www.engadget.com/rss.xml', lang: 'en', section: 'news' },
  { id: '9to5mac', name: '9to5Mac', url: 'https://9to5mac.com/feed/', lang: 'en', section: 'news' },
  { id: 'gsmarena', name: 'GSMArena', url: 'https://www.gsmarena.com/rss-news-reviews.php3', lang: 'en', section: 'news' },
  { id: 'mittr', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', lang: 'en', section: 'news' },
  // 新品与开源
  { id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com/feed', lang: 'en', section: 'products' },
  { id: 'github', name: 'GitHub Trending', url: 'https://github.com/trending?since=daily', lang: 'en', section: 'github', kind: 'github-trending' },
];

/** 新闻栏的分类。AI 给每条大事归到其中一类。 */
export const CATEGORIES = ['数码', 'AI', '互联网', '芯片与硬件', '开发者', '科学与前沿', '商业与政策'];
