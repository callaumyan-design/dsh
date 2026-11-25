// IP 检测用到的纯函数：解析输入、判断内网地址、把各家接口的返回整理成同一种格式。
// 这里不碰页面、不发请求，所以能直接在 Node 里测试（test/lib.test.js）。

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export const isIPv4 = (s) => IPV4.test(s);

/** 合法的 IPv6 返回规范写法（小写、压缩零），否则返回 null。 */
export function normalizeIPv6(s) {
  if (!s.includes(':')) return null;
  try {
    return new URL(`http://[${s}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

export function isDomain(s) {
  if (s.length > 253 || !s.includes('.')) return false;
  const labels = s.split('.');
  return labels.every((l) => LABEL.test(l)) && /[a-z]/.test(labels.at(-1));
}

/**
 * 把输入框里的内容变成要查的东西：
 *   ''                      → { kind: 'self' }         查自己
 *   '8.8.8.8' / '[::1]:443' → { kind: 'ip', value }
 *   'github.com' / 网址      → { kind: 'domain', value } 先解析成 IP 再查
 *   其他                     → { kind: 'invalid' }
 */
export function parseQuery(input) {
  let s = String(input ?? '').trim();
  if (!s) return { kind: 'self' };

  let m = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (m) s = m[1];
  m = s.match(/^([\d.]+):\d+$/);
  if (m) s = m[1];
  if (isIPv4(s)) return { kind: 'ip', value: s };
  // 只有数字和点却不是完整 IPv4（如 1.2.3）：浏览器会把它补成别的地址，这里直接拒绝
  if (/^[\d.]+$/.test(s)) return { kind: 'invalid' };
  const v6 = normalizeIPv6(s);
  if (v6) return { kind: 'ip', value: v6 };

  let host;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(s) ? s : `http://${s}`).hostname;
  } catch {
    return { kind: 'invalid' };
  }
  if (host.startsWith('[')) return { kind: 'ip', value: host.slice(1, -1) };
  if (isIPv4(host)) return { kind: 'ip', value: host };
  host = host.replace(/\.$/, '');
  return isDomain(host) ? { kind: 'domain', value: host } : { kind: 'invalid' };
}

// 不在公网上的 IPv4 网段：[起始地址, 前缀长度]
const RESERVED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4ToInt = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);

/** 内网、本机、保留和组播地址：这些地址没有公网归属地。 */
export function isPrivateIP(ip) {
  if (isIPv4(ip)) {
    const n = v4ToInt(ip);
    return RESERVED_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4ToInt(base) / 2 ** (32 - bits)));
  }
  const v6 = normalizeIPv6(ip);
  if (!v6) return false;
  if (v6.startsWith('::')) return true; // ::、::1 以及映射/兼容地址
  if (v6.startsWith('2001:db8:')) return true; // 文档示例
  const first = parseInt(v6.split(':')[0], 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

export const ipFamily = (ip) => (isIPv4(ip) ? 4 : normalizeIPv6(ip) ? 6 : 0);

let regionNames;
/**
 * 国家/地区代码转中文名，如 US → 美国、HK → 香港。
 * 各浏览器自带的名称不完全一样（HK 有的叫“香港”，有的叫“中国香港特别行政区”），这里统一成短的。
 */
export function countryName(code, fallback = '') {
  if (!code) return fallback;
  try {
    regionNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    const name = regionNames.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name.replace('特别行政区', '').replace(/^中国(?=香港|澳门)/, '') : fallback || code;
  } catch {
    return fallback || code;
  }
}

// ---- 各家接口的返回整理成同一种格式 ----
// { ip, countryCode, country, region, city, asn, isp, org, timezone, risk }
// risk 为 null 表示这个来源不提供风险信息。

/** api.ipquery.io */
export function fromIpquery(j) {
  if (!j || typeof j.ip !== 'string' || j.error) return null;
  const isp = j.isp ?? {};
  const loc = j.location ?? {};
  const r = j.risk;
  return {
    ip: j.ip,
    countryCode: loc.country_code || '',
    country: countryName(loc.country_code, loc.country || ''),
    region: loc.state || '',
    city: loc.city || '',
    asn: isp.asn && isp.asn !== 'AS0' ? isp.asn : '',
    isp: isp.isp || '',
    org: isp.org || '',
    timezone: loc.timezone || '',
    risk: r
      ? {
          datacenter: !!r.is_datacenter,
          mobile: !!r.is_mobile,
          vpn: !!r.is_vpn,
          proxy: !!r.is_proxy,
          tor: !!r.is_tor,
          score: Number.isFinite(r.risk_score) ? r.risk_score : null,
        }
      : null,
  };
}

/** ipwho.is（ipquery 不可用时的备用来源，没有风险信息） */
export function fromIpwho(j) {
  if (!j || j.success === false || typeof j.ip !== 'string') return null;
  const c = j.connection ?? {};
  return {
    ip: j.ip,
    countryCode: j.country_code || '',
    country: countryName(j.country_code, j.country || ''),
    region: j.region || '',
    city: j.city || '',
    asn: c.asn ? `AS${c.asn}` : '',
    isp: c.isp || '',
    org: c.org || '',
    timezone: j.timezone?.id || '',
    risk: null,
  };
}

/** ipleak.net：注册国家（判断原生/广播）和反向解析的主机名 */
export function fromIpleak(j) {
  if (!j || typeof j.ip !== 'string') return null;
  return {
    ip: j.ip,
    countryCode: j.country_code || '',
    registeredCountryCode: j.registered_country_code || '',
    hostname: j.reverse && j.reverse !== j.ip ? j.reverse : '',
  };
}

/** myip.ipip.net/json：国内网站看到的 IP，位置是中文 */
export function fromIpip(j) {
  const d = j?.data;
  if (j?.ret !== 'ok' || typeof d?.ip !== 'string') return null;
  const parts = (Array.isArray(d.location) ? d.location : []).map((s) => String(s).trim()).filter(Boolean);
  // IPIP 把港澳台写成“中国 香港”，统一成和 countryName() 一样的“香港”，方便比较
  let country = parts[0] ?? '';
  const sub = ['香港', '澳门', '台湾'].find((x) => x === parts[0] || (parts[0] === '中国' && x === parts[1]));
  if (sub) country = sub;
  return { ip: d.ip, country, place: [...new Set(parts)].join(' ') };
}

/** Cloudflare 的 /cdn-cgi/trace：每行一个 key=value */
export function parseTrace(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** DNS-over-HTTPS（JSON 格式）的回答里取出某种记录：1 = A，28 = AAAA */
export const dnsAnswers = (j, type) =>
  (Array.isArray(j?.Answer) ? j.Answer : []).filter((a) => a.type === type && typeof a.data === 'string').map((a) => a.data);

// ---- 判断和文案 ----

export function placeText(info) {
  const parts = [info.country, info.region, info.city].filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

/** tone：ok 绿 / warn 黄 / bad 红 */
export function ipType(risk) {
  if (!risk) return null;
  if (risk.datacenter) return { label: '机房 IP', tone: 'warn' };
  if (risk.mobile) return { label: '移动网络', tone: 'ok' };
  return { label: '宽带 IP（非机房）', tone: 'ok' };
}

/** 注册地和使用地是同一个国家/地区就是原生 IP，否则是广播 IP。 */
export function nativeStatus(locatedCode, registeredCode) {
  if (!locatedCode || !registeredCode) return null;
  const native = locatedCode.toUpperCase() === registeredCode.toUpperCase();
  return { native, label: native ? '原生 IP' : '广播 IP', tone: native ? 'ok' : 'warn' };
}

export function proxyFlags(risk) {
  if (!risk) return null;
  const found = [risk.tor && 'Tor', risk.vpn && 'VPN', risk.proxy && '代理'].filter(Boolean);
  return found.length ? found.map((label) => ({ label, tone: 'bad' })) : [{ label: '未发现', tone: 'ok' }];
}

export function riskLevel(score) {
  if (score == null) return null;
  if (score < 25) return { label: '低', tone: 'ok' };
  if (score < 60) return { label: '中', tone: 'warn' };
  return { label: '高', tone: 'bad' };
}

/**
 * 比较国内、国外网站看到的 IP（{ ip, country }），给出一句结论。
 * 一个是 IPv4 一个是 IPv6 时没法比，返回 null。
 */
export function splitVerdict(cn, intl) {
  if (!cn || !intl || ipFamily(cn.ip) !== ipFamily(intl.ip)) return null;
  if (cn.ip === intl.ip) return '国内和国外网站看到的是同一个 IP，没有分流。';
  if (cn.country && intl.country && cn.country !== intl.country)
    return `国内网站看到你在${cn.country}，国外网站看到你在${intl.country}：你可能在用分流代理，国外流量走了另一条线路。`;
  return '国内和国外网站看到的 IP 不一样：可能是分流代理，也可能是运营商有多个出口。';
}

export function localTime(timezone, now = new Date()) {
  if (!timezone) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  } catch {
    return '';
  }
}
