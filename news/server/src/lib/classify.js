// 不靠 AI 的分类：按关键词给新闻打分，分数最高的门类胜出。
// 标题里的词算 2 分，简介里的算 1 分；来源的默认门类（config.js 里的 category）加 1 分，
// 一个词都没命中时直接用来源的默认门类，再没有就归到“其他”。
// 有 AI 时以 AI 的判断为准，AI 没给出有效门类时才用这里的结果。
import { CATEGORIES, OTHER } from './sources/config.js';

// 英文词按整词匹配，中文词按包含匹配。只放“出现了就基本能确定门类”的词，宁缺毋滥：
// 像 fine、shares、study、Arm 这种在普通句子里也常见的词不要加。
const KEYWORDS = {
  AI: [
    'AI', '人工智能', '大模型', '大语言模型', '生成式', '智能体', '机器学习', '深度学习', '神经网络', '推理模型', '多模态',
    'OpenAI', 'ChatGPT', 'GPT', 'Anthropic', 'Claude', 'Gemini', 'DeepSeek', '通义', '千问', '文心', '豆包', 'Kimi', 'Copilot',
    'LLM', 'LLMs', 'chatbot', 'chatbots', 'machine learning', 'deep learning', 'neural', 'generative', 'agentic', 'Sora', 'Midjourney', 'Hugging Face',
  ],
  数码: [
    'iPhone', 'iPad', 'MacBook', 'iMac', 'Mac mini', 'Apple Watch', 'AirPods', 'Vision Pro', 'iOS', 'iPadOS', 'macOS', 'watchOS',
    '手机', '平板', '笔记本', '耳机', '手表', '手环', '相机', '镜头', '折叠屏', '屏幕', '充电', '续航', '评测', '上手', '真机', '新机', '发布会', '开售', '首销',
    '小米', '华为', '荣耀', 'OPPO', 'vivo', '一加', '三星', '魅族', '真我', 'Redmi', 'iQOO', '鸿蒙', 'HarmonyOS',
    'Galaxy', 'Pixel', 'Xperia', 'OnePlus', 'Android', 'smartphone', 'smartphones', 'phone', 'phones', 'laptop', 'laptops', 'tablet', 'tablets',
    'headphones', 'earbuds', 'smartwatch', 'wearable', 'camera', 'foldable', 'PlayStation', 'PS5', 'Xbox', 'Nintendo', 'Switch 2', 'Steam Deck', '游戏机', '电视', 'TV',
  ],
  芯片与硬件: [
    '芯片', '处理器', '显卡', '半导体', '晶圆', '制程', '光刻', '台积电', '中芯国际', '英特尔', '英伟达', '高通', '骁龙', '联发科', '天玑', '麒麟', '内存', '闪存', '固态硬盘', '服务器', '数据中心', '算力',
    'chip', 'chips', 'chipmaker', 'semiconductor', 'semiconductors', 'processor', 'CPU', 'GPU', 'GPUs', 'TSMC', 'Intel', 'AMD', 'Nvidia', 'Qualcomm', 'Snapdragon',
    'MediaTek', 'RISC-V', 'DRAM', 'NAND', 'SSD', 'foundry', 'wafer', 'data center', 'datacenter', 'Ryzen', 'Xeon', 'M5', 'M6',
  ],
  开发者: [
    '开源', '编程', '开发者', '程序员', '代码', '框架', '编译器', '数据库', '云原生', '操作系统内核',
    'GitHub', 'GitLab', 'open source', 'open-source', 'developer', 'developers', 'programming', 'API', 'SDK', 'Linux', 'kernel', 'Rust', 'Python', 'JavaScript',
    'TypeScript', 'Kotlin', 'Swift', 'WebAssembly', 'Docker', 'Kubernetes', 'VS Code', 'Xcode', 'compiler', 'database', 'Postgres', 'npm', 'framework',
  ],
  科学与前沿: [
    '科学家', '研究人员', '研究团队', '论文', '太空', '航天', '火箭', '卫星', '空间站', '月球', '火星', '量子', '物理', '基因', '生物', '医学', '气候', '核聚变', '电池', '新材料', '机器人', '脑机',
    'NASA', 'SpaceX', 'Starship', 'rocket', 'satellite', 'satellites', 'space station', 'Moon', 'Mars', 'quantum', 'physics', 'scientists', 'researchers',
    'gene', 'genetic', 'climate', 'fusion', 'battery', 'batteries', 'robot', 'robots', 'robotics', 'humanoid', 'telescope', 'asteroid',
  ],
  商业与政策: [
    '融资', '收购', '并购', '上市', '财报', '营收', '净利润', '裁员', '估值', '投资', '反垄断', '监管', '罚款', '诉讼', '起诉', '法院', '政策', '关税', '制裁', '出口管制', '工信部', '欧盟', '市值', '股价', 'CEO',
    'acquire', 'acquires', 'acquisition', 'merger', 'IPO', 'funding', 'raises', 'valuation', 'earnings', 'revenue', 'profit', 'layoffs', 'layoff', 'lawsuit', 'sues', 'sued',
    'antitrust', 'regulator', 'regulators', 'regulation', 'FTC', 'DOJ', 'SEC', 'tariff', 'tariffs', 'sanctions', 'export controls', 'fined', 'EU', 'court', 'judge', 'stock', 'investors',
  ],
  互联网: [
    '微信', '抖音', '淘宝', '京东', '拼多多', '美团', '阿里巴巴', '腾讯', '字节跳动', '百度', '网易', '快手', '小红书', '微博', 'B站', '哔哩哔哩', '支付宝', '电商', '社交', '短视频', '直播', '流媒体', '浏览器', '网站', '应用商店', '隐私', '数据泄露', '黑客', '网络安全', '漏洞', '诈骗',
    'Meta', 'Facebook', 'Instagram', 'WhatsApp', 'Threads', 'TikTok', 'YouTube', 'Netflix', 'Spotify', 'Reddit', 'Bluesky', 'Twitter', 'Chrome', 'Firefox', 'browser', 'App Store',
    'social media', 'streaming', 'privacy', 'hack', 'hacked', 'hackers', 'breach', 'ransomware', 'malware', 'phishing', 'vulnerability', 'security', 'website', 'search engine',
  ],
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);

// 每个门类编译成两个正则：英文整词（区分大小写的缩写如 AI、EU 单独处理）、中文包含
const MATCHERS = Object.fromEntries(
  Object.entries(KEYWORDS).map(([cat, words]) => {
    const ascii = words.filter(isAscii);
    // 全大写的短缩写（AI、EU、TV、SEC…）必须大小写完全一致，否则 "said"/"sec" 之类会误中
    const strict = ascii.filter((w) => w.length <= 4 && w === w.toUpperCase());
    const loose = ascii.filter((w) => !strict.includes(w));
    const cjk = words.filter((w) => !isAscii(w));
    return [
      cat,
      [
        strict.length && new RegExp(`(?<![A-Za-z0-9])(?:${strict.map(escape).join('|')})(?![A-Za-z0-9])`, 'g'),
        loose.length && new RegExp(`(?<![A-Za-z0-9])(?:${loose.map(escape).join('|')})(?![A-Za-z0-9])`, 'gi'),
        cjk.length && new RegExp(cjk.map(escape).join('|'), 'g'),
      ].filter(Boolean),
    ];
  }),
);

function hits(text, regexes) {
  let n = 0;
  for (const re of regexes) n += (String(text ?? '').match(re) ?? []).length;
  return n;
}

/**
 * 给一条新闻归类。
 * @param {{title: string, summary?: string|null, sourceCategory?: string|null}} item
 * @returns {string} CATEGORIES 之一，或 OTHER
 */
export function classify({ title, summary, sourceCategory }) {
  let best = null;
  let bestScore = 0;
  for (const cat of CATEGORIES) {
    const m = MATCHERS[cat];
    let score = hits(title, m) * 2 + Math.min(hits(summary, m), 3);
    if (score > 0 && cat === sourceCategory) score += 1;
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  if (best) return best;
  return CATEGORIES.includes(sourceCategory) ? sourceCategory : OTHER;
}
