import * as lib from './lib.js';

const $ = (sel) => document.querySelector(sel);
const form = $('#form');
const input = $('#q');
const result = $('#result');
const views = $('#views');

// ---- 请求 ----

function withTimeout(ms) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function get(url, { timeout = 8000, headers, as = 'json' } = {}) {
  const res = await fetch(url, { signal: withTimeout(timeout), headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'text' ? res.text() : res.json();
}

/** 归属地、运营商、风险：ipquery.io 为主，失败时换 ipwho.is。ip 为空表示查自己。 */
async function fetchInfo(ip) {
  const path = ip ?? '';
  try {
    const info = lib.fromIpquery(await get(`https://api.ipquery.io/${path}?format=json`));
    if (info) return info;
  } catch {
    /* 换备用来源 */
  }
  const info = lib.fromIpwho(await get(`https://ipwho.is/${path}`));
  if (!info) throw new Error('没有查到');
  return info;
}

const fetchExtra = (ip) => get(`https://ipleak.net/json/${ip}`).then(lib.fromIpleak).catch(() => null);

const DOH = ['https://dns.alidns.com/resolve', 'https://cloudflare-dns.com/dns-query'];

/** 域名解析成 IP：先 A 记录，没有再 AAAA。两个 DoH 服务器互为备用。 */
async function resolve(name) {
  for (const type of [1, 28]) {
    for (const base of DOH) {
      try {
        const j = await get(`${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
        if (j.Status === 3) return []; // 域名不存在
        const ips = lib.dnsAnswers(j, type);
        if (ips.length) return ips;
        break; // 这个服务器答了但没有这种记录，换下一种记录
      } catch {
        /* 换下一个服务器 */
      }
    }
  }
  return [];
}

// ---- 页面元素 ----

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

const tag = ({ label, tone }) => h('span', { class: `tag tag-${tone}` }, label);
const muted = (text) => h('span', { class: 'muted' }, text);
const pending = () => muted('查询中…');

function copyButton(text) {
  const btn = h('button', { type: 'button', class: 'copy', 'aria-label': `复制 ${text}` }, '复制');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '已复制';
    } catch {
      btn.textContent = '复制失败';
    }
    setTimeout(() => (btn.textContent = '复制'), 1500);
  });
  return btn;
}

const row = (label, ...value) => [h('dt', null, label), h('dd', null, ...value)];

/** extra 为 undefined 表示 ipleak 还没返回，null 表示查不到。 */
function renderInfo(info, { domain, extra }) {
  const type = lib.ipType(info.risk);
  const flags = lib.proxyFlags(info.risk);
  const level = lib.riskLevel(info.risk?.score);
  const native = extra && lib.nativeStatus(info.countryCode || extra.countryCode, extra.registeredCountryCode);
  const time = lib.localTime(info.timezone);
  const unknown = muted('这个数据源不提供');

  let nativeCell;
  if (extra === undefined) nativeCell = pending();
  else if (!native) nativeCell = muted('查不到注册地');
  else
    nativeCell = [
      tag(native),
      muted(
        native.native
          ? `注册地和使用地都在${lib.countryName(extra.registeredCountryCode)}`
          : `注册在${lib.countryName(extra.registeredCountryCode)}，在${lib.countryName(info.countryCode || extra.countryCode)}使用`,
      ),
    ];

  const ispCell = [info.isp || info.org || '—'];
  if (info.org && info.isp && info.org !== info.isp) ispCell.push(h('br'), muted(info.org));

  return h(
    'dl',
    { class: 'info' },
    row('IP 地址', h('code', { class: 'ip' }, info.ip), copyButton(info.ip)),
    domain && row('域名', domain.name, domain.count > 1 ? muted(`解析到 ${domain.count} 个地址，这里查第一个`) : null),
    extra?.hostname && row('主机名', h('code', null, extra.hostname)),
    row('位置', lib.placeText(info) || '—'),
    row(
      'ASN',
      info.asn
        ? h('a', { href: `https://bgp.tools/as/${info.asn.replace(/^AS/i, '')}`, target: '_blank', rel: 'noopener' }, info.asn)
        : '—',
    ),
    row('运营商', ...ispCell),
    row('IP 类型', type ? tag(type) : unknown),
    row('原生 IP', nativeCell),
    row('代理检测', flags ? flags.map(tag) : unknown),
    row('风险值', level ? [tag({ label: `${info.risk.score} · ${level.label}`, tone: level.tone })] : unknown),
    info.timezone && row('时区', info.timezone, time ? muted(`当地 ${time}`) : null),
  );
}

function message(text, kind = 'note') {
  result.replaceChildren(h('p', { class: `message message-${kind}` }, text));
}

// ---- 查询 ----

let current = 0;
let viewsLoaded = false;

async function run(raw) {
  const token = ++current;
  const stale = () => token !== current;
  const q = lib.parseQuery(raw);

  const url = new URL(location.href);
  if (q.kind === 'self') url.searchParams.delete('q');
  else url.searchParams.set('q', raw.trim());
  history.replaceState(null, '', url);

  views.hidden = q.kind !== 'self';
  if (!views.hidden && !viewsLoaded) {
    viewsLoaded = true;
    loadViews();
  }
  if (q.kind === 'invalid') return message('看不懂这个地址。请输入 IPv4、IPv6 或域名，例如 8.8.8.8 或 github.com。', 'error');

  let ip = q.kind === 'ip' ? q.value : null;
  let domain = null;
  result.setAttribute('aria-busy', 'true');
  message(q.kind === 'domain' ? `正在解析 ${q.value}…` : '正在查询…');

  try {
    if (q.kind === 'domain') {
      const ips = await resolve(q.value);
      if (stale()) return;
      if (!ips.length) return message(`${q.value} 没有解析到任何 IP，检查一下域名是否拼对。`, 'error');
      ip = ips[0];
      domain = { name: q.value, count: ips.length };
    }
    if (ip && lib.isPrivateIP(ip)) return message(`${ip} 是内网或保留地址，只在局域网里有意义，没有公网归属地。`);

    const info = await fetchInfo(ip);
    if (stale()) return;
    result.replaceChildren(renderInfo(info, { domain, extra: undefined }));
    const extra = await fetchExtra(info.ip);
    if (stale()) return;
    result.replaceChildren(renderInfo(info, { domain, extra }));
  } catch {
    if (!stale()) message('查询失败：数据接口暂时连不上，稍后再试。', 'error');
  } finally {
    if (!stale()) result.removeAttribute('aria-busy');
  }
}

// ---- 不同网站看到的 IP（只在查自己时显示）----

const VIEWS = [
  {
    id: 'cn',
    label: '国内网站',
    source: 'IPIP.net',
    load: async () => {
      const r = lib.fromIpip(await get('https://myip.ipip.net/json'));
      if (!r) throw new Error();
      return { ip: r.ip, country: r.country, detail: r.place };
    },
  },
  {
    id: 'intl',
    label: '国外网站',
    source: 'Cloudflare',
    load: async () => {
      const t = lib.parseTrace(await get('https://www.cloudflare.com/cdn-cgi/trace', { as: 'text' }));
      if (!t.ip) throw new Error();
      const detail = [lib.countryName(t.loc), t.colo && `节点 ${t.colo}`, t.warp && t.warp !== 'off' && 'WARP 已开启'];
      return { ip: t.ip, country: lib.countryName(t.loc), detail: detail.filter(Boolean).join(' · ') };
    },
  },
  {
    id: 'v6',
    label: 'IPv6',
    source: 'ipify',
    missing: '没有检测到 IPv6（网络不支持或已关闭）',
    load: async () => {
      const j = await get('https://api6.ipify.org?format=json', { timeout: 6000 });
      if (!lib.normalizeIPv6(j.ip ?? '')) throw new Error();
      return { ip: j.ip, detail: '' };
    },
  },
];

function viewRow(v, state) {
  let value;
  if (state === undefined) value = pending();
  else if (state === null) value = muted(v.missing ?? '连不上，可能被网络拦截了');
  else
    value = [
      h('button', { type: 'button', class: 'ip-link', title: '查询这个 IP', onclick: () => go(state.ip) }, state.ip),
      state.detail && h('span', { class: 'muted' }, state.detail),
    ];
  return row(h('span', null, v.label, h('small', null, v.source)), value);
}

async function loadViews() {
  const list = views.querySelector('dl');
  const note = views.querySelector('.views-note');
  const states = VIEWS.map(() => undefined);
  const draw = () => list.replaceChildren(...VIEWS.flatMap((v, i) => viewRow(v, states[i])));
  draw();
  await Promise.all(
    VIEWS.map(async (v, i) => {
      states[i] = await v.load().catch(() => null);
      draw();
    }),
  );
  const verdict = lib.splitVerdict(states[0], states[1]);
  if (verdict) note.textContent = verdict;
}

// ---- 启动 ----

function go(value) {
  input.value = value;
  run(value);
  input.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  run(input.value);
});

$('#self').addEventListener('click', () => go(''));

const initial = new URL(location.href).searchParams.get('q') ?? '';
input.value = initial;
run(initial);
