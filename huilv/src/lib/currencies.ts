/** 支持的币种。flag 对应 circle-flags 的文件名；没有 flag 的用符号徽章显示。 */
export interface Currency {
  code: string;
  /** 中文名 */
  name: string;
  /** 英文名，用于搜索 */
  en: string;
  /** 拼音（空格分隔音节），用于搜索，比如 "mei yuan" 可以用 "meiyuan" 或 "my" 搜到 */
  py: string;
  /** 国家或地区，用于搜索 */
  region: string;
  symbol: string;
  flag?: string;
  /** 常用：在添加列表里排在前面 */
  common?: boolean;
}

export const CURRENCIES: Currency[] = [
  { code: 'CNY', name: '人民币', en: 'Chinese Yuan', py: 'ren min bi', region: '中国', symbol: '¥', flag: 'cn', common: true },
  { code: 'USD', name: '美元', en: 'US Dollar', py: 'mei yuan', region: '美国', symbol: '$', flag: 'us', common: true },
  { code: 'HKD', name: '港币', en: 'Hong Kong Dollar', py: 'gang bi', region: '中国香港', symbol: 'HK$', flag: 'hk', common: true },
  { code: 'EUR', name: '欧元', en: 'Euro', py: 'ou yuan', region: '欧盟', symbol: '€', flag: 'eu', common: true },
  { code: 'JPY', name: '日元', en: 'Japanese Yen', py: 'ri yuan', region: '日本', symbol: '¥', flag: 'jp', common: true },
  { code: 'GBP', name: '英镑', en: 'British Pound', py: 'ying bang', region: '英国', symbol: '£', flag: 'gb', common: true },
  { code: 'AUD', name: '澳元', en: 'Australian Dollar', py: 'ao yuan', region: '澳大利亚', symbol: 'A$', flag: 'au', common: true },
  { code: 'KRW', name: '韩元', en: 'South Korean Won', py: 'han yuan', region: '韩国', symbol: '₩', flag: 'kr', common: true },
  { code: 'TWD', name: '新台币', en: 'New Taiwan Dollar', py: 'xin tai bi', region: '中国台湾', symbol: 'NT$', flag: 'tw', common: true },
  { code: 'MOP', name: '澳门元', en: 'Macanese Pataca', py: 'ao men yuan', region: '中国澳门', symbol: 'MOP$', flag: 'mo', common: true },
  { code: 'SGD', name: '新加坡元', en: 'Singapore Dollar', py: 'xin jia po yuan', region: '新加坡', symbol: 'S$', flag: 'sg', common: true },
  { code: 'CAD', name: '加元', en: 'Canadian Dollar', py: 'jia yuan', region: '加拿大', symbol: 'C$', flag: 'ca', common: true },
  { code: 'NZD', name: '新西兰元', en: 'New Zealand Dollar', py: 'xin xi lan yuan', region: '新西兰', symbol: 'NZ$', flag: 'nz', common: true },
  { code: 'CHF', name: '瑞士法郎', en: 'Swiss Franc', py: 'rui shi fa lang', region: '瑞士', symbol: 'Fr', flag: 'ch', common: true },
  { code: 'THB', name: '泰铢', en: 'Thai Baht', py: 'tai zhu', region: '泰国', symbol: '฿', flag: 'th', common: true },
  { code: 'MYR', name: '马来西亚林吉特', en: 'Malaysian Ringgit', py: 'ma lai xi ya lin ji te', region: '马来西亚', symbol: 'RM', flag: 'my', common: true },
  { code: 'XAU', name: '黄金', en: 'Gold (troy ounce)', py: 'huang jin', region: '金价 每盎司', symbol: 'oz' },
  { code: 'XAG', name: '白银', en: 'Silver (troy ounce)', py: 'bai yin', region: '银价 每盎司', symbol: 'oz' },
  { code: 'BTC', name: '比特币', en: 'Bitcoin', py: 'bi te bi', region: '加密货币', symbol: '₿' },
  { code: 'ETH', name: '以太坊', en: 'Ethereum', py: 'yi tai fang', region: '加密货币', symbol: 'Ξ' },
  { code: 'VND', name: '越南盾', en: 'Vietnamese Dong', py: 'yue nan dun', region: '越南', symbol: '₫', flag: 'vn' },
  { code: 'IDR', name: '印尼盾', en: 'Indonesian Rupiah', py: 'yin ni dun', region: '印度尼西亚', symbol: 'Rp', flag: 'id' },
  { code: 'PHP', name: '菲律宾比索', en: 'Philippine Peso', py: 'fei lv bin bi suo', region: '菲律宾', symbol: '₱', flag: 'ph' },
  { code: 'INR', name: '印度卢比', en: 'Indian Rupee', py: 'yin du lu bi', region: '印度', symbol: '₹', flag: 'in' },
  { code: 'KHR', name: '柬埔寨瑞尔', en: 'Cambodian Riel', py: 'jian pu zhai rui er', region: '柬埔寨', symbol: '៛', flag: 'kh' },
  { code: 'LAK', name: '老挝基普', en: 'Lao Kip', py: 'lao wo ji pu', region: '老挝', symbol: '₭', flag: 'la' },
  { code: 'MMK', name: '缅甸元', en: 'Myanmar Kyat', py: 'mian dian yuan', region: '缅甸', symbol: 'K', flag: 'mm' },
  { code: 'MNT', name: '蒙古图格里克', en: 'Mongolian Tugrik', py: 'meng gu tu ge li ke', region: '蒙古', symbol: '₮', flag: 'mn' },
  { code: 'KZT', name: '哈萨克斯坦坚戈', en: 'Kazakhstani Tenge', py: 'ha sa ke si tan jian ge', region: '哈萨克斯坦', symbol: '₸', flag: 'kz' },
  { code: 'PKR', name: '巴基斯坦卢比', en: 'Pakistani Rupee', py: 'ba ji si tan lu bi', region: '巴基斯坦', symbol: '₨', flag: 'pk' },
  { code: 'BDT', name: '孟加拉塔卡', en: 'Bangladeshi Taka', py: 'meng jia la ta ka', region: '孟加拉国', symbol: '৳', flag: 'bd' },
  { code: 'LKR', name: '斯里兰卡卢比', en: 'Sri Lankan Rupee', py: 'si li lan ka lu bi', region: '斯里兰卡', symbol: 'Rs', flag: 'lk' },
  { code: 'NPR', name: '尼泊尔卢比', en: 'Nepalese Rupee', py: 'ni bo er lu bi', region: '尼泊尔', symbol: 'Rs', flag: 'np' },
  { code: 'AED', name: '阿联酋迪拉姆', en: 'UAE Dirham', py: 'a lian qiu di la mu', region: '阿联酋 迪拜', symbol: 'د.إ', flag: 'ae' },
  { code: 'SAR', name: '沙特里亚尔', en: 'Saudi Riyal', py: 'sha te li ya er', region: '沙特阿拉伯', symbol: '﷼', flag: 'sa' },
  { code: 'QAR', name: '卡塔尔里亚尔', en: 'Qatari Riyal', py: 'ka ta er li ya er', region: '卡塔尔', symbol: '﷼', flag: 'qa' },
  { code: 'KWD', name: '科威特第纳尔', en: 'Kuwaiti Dinar', py: 'ke wei te di na er', region: '科威特', symbol: 'KD', flag: 'kw' },
  { code: 'ILS', name: '以色列新谢克尔', en: 'Israeli New Shekel', py: 'yi se lie xin xie ke er', region: '以色列', symbol: '₪', flag: 'il' },
  { code: 'TRY', name: '土耳其里拉', en: 'Turkish Lira', py: 'tu er qi li la', region: '土耳其', symbol: '₺', flag: 'tr' },
  { code: 'RUB', name: '俄罗斯卢布', en: 'Russian Ruble', py: 'e luo si lu bu', region: '俄罗斯', symbol: '₽', flag: 'ru' },
  { code: 'UAH', name: '乌克兰格里夫纳', en: 'Ukrainian Hryvnia', py: 'wu ke lan ge li fu na', region: '乌克兰', symbol: '₴', flag: 'ua' },
  { code: 'SEK', name: '瑞典克朗', en: 'Swedish Krona', py: 'rui dian ke lang', region: '瑞典', symbol: 'kr', flag: 'se' },
  { code: 'NOK', name: '挪威克朗', en: 'Norwegian Krone', py: 'nuo wei ke lang', region: '挪威', symbol: 'kr', flag: 'no' },
  { code: 'DKK', name: '丹麦克朗', en: 'Danish Krone', py: 'dan mai ke lang', region: '丹麦', symbol: 'kr', flag: 'dk' },
  { code: 'ISK', name: '冰岛克朗', en: 'Icelandic Krona', py: 'bing dao ke lang', region: '冰岛', symbol: 'kr', flag: 'is' },
  { code: 'PLN', name: '波兰兹罗提', en: 'Polish Zloty', py: 'bo lan zi luo ti', region: '波兰', symbol: 'zł', flag: 'pl' },
  { code: 'CZK', name: '捷克克朗', en: 'Czech Koruna', py: 'jie ke ke lang', region: '捷克', symbol: 'Kč', flag: 'cz' },
  { code: 'HUF', name: '匈牙利福林', en: 'Hungarian Forint', py: 'xiong ya li fu lin', region: '匈牙利', symbol: 'Ft', flag: 'hu' },
  { code: 'RON', name: '罗马尼亚列伊', en: 'Romanian Leu', py: 'luo ma ni ya lie yi', region: '罗马尼亚', symbol: 'lei', flag: 'ro' },
  { code: 'ZAR', name: '南非兰特', en: 'South African Rand', py: 'nan fei lan te', region: '南非', symbol: 'R', flag: 'za' },
  { code: 'EGP', name: '埃及镑', en: 'Egyptian Pound', py: 'ai ji bang', region: '埃及', symbol: 'E£', flag: 'eg' },
  { code: 'MAD', name: '摩洛哥迪拉姆', en: 'Moroccan Dirham', py: 'mo luo ge di la mu', region: '摩洛哥', symbol: 'DH', flag: 'ma' },
  { code: 'NGN', name: '尼日利亚奈拉', en: 'Nigerian Naira', py: 'ni ri li ya nai la', region: '尼日利亚', symbol: '₦', flag: 'ng' },
  { code: 'KES', name: '肯尼亚先令', en: 'Kenyan Shilling', py: 'ken ni ya xian ling', region: '肯尼亚', symbol: 'KSh', flag: 'ke' },
  { code: 'BRL', name: '巴西雷亚尔', en: 'Brazilian Real', py: 'ba xi lei ya er', region: '巴西', symbol: 'R$', flag: 'br' },
  { code: 'MXN', name: '墨西哥比索', en: 'Mexican Peso', py: 'mo xi ge bi suo', region: '墨西哥', symbol: 'Mex$', flag: 'mx' },
  { code: 'ARS', name: '阿根廷比索', en: 'Argentine Peso', py: 'a gen ting bi suo', region: '阿根廷', symbol: 'AR$', flag: 'ar' },
  { code: 'CLP', name: '智利比索', en: 'Chilean Peso', py: 'zhi li bi suo', region: '智利', symbol: 'CLP$', flag: 'cl' },
  { code: 'COP', name: '哥伦比亚比索', en: 'Colombian Peso', py: 'ge lun bi ya bi suo', region: '哥伦比亚', symbol: 'COL$', flag: 'co' },
  { code: 'PEN', name: '秘鲁索尔', en: 'Peruvian Sol', py: 'bi lu suo er', region: '秘鲁', symbol: 'S/', flag: 'pe' },
  { code: 'FJD', name: '斐济元', en: 'Fijian Dollar', py: 'fei ji yuan', region: '斐济', symbol: 'FJ$', flag: 'fj' },
];

export const CURRENCY_MAP: Record<string, Currency> = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));
export const SUPPORTED_CODES = CURRENCIES.map((c) => c.code);

export const DEFAULT_LIST = ['CNY', 'USD', 'HKD', 'EUR', 'JPY', 'GBP', 'AUD'];

function initials(py: string): string {
  return py
    .split(' ')
    .map((s) => s[0])
    .join('');
}

/** 用代码、中文名、英文名、地区、拼音全拼或首字母搜索 */
export function searchCurrencies(query: string, list: Currency[] = CURRENCIES): Currency[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return list;
  const scored: { c: Currency; score: number }[] = [];
  for (const c of list) {
    const code = c.code.toLowerCase();
    const py = c.py.replace(/ /g, '');
    const ini = initials(c.py);
    let score = -1;
    if (code === q) score = 100;
    else if (c.name === query.trim()) score = 95;
    else if (ini === q) score = 85;
    else if (code.startsWith(q)) score = 80;
    else if (c.name.includes(q)) score = 70;
    else if (py.startsWith(q)) score = 60;
    else if (ini.startsWith(q)) score = 55;
    else if (c.region.toLowerCase().includes(q)) score = 50;
    else if (c.en.toLowerCase().replace(/\s+/g, '').includes(q)) score = 40;
    else if (py.includes(q)) score = 30;
    if (score >= 0) scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.c);
}
