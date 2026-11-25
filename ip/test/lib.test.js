import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../site/lib.js';

test('parseQuery：IP、域名、网址和非法输入', () => {
  const cases = {
    '': { kind: 'self' },
    '   ': { kind: 'self' },
    '8.8.8.8': { kind: 'ip', value: '8.8.8.8' },
    ' 1.1.1.1 ': { kind: 'ip', value: '1.1.1.1' },
    '1.1.1.1:443': { kind: 'ip', value: '1.1.1.1' },
    '2001:4860:4860:0:0:0:0:8888': { kind: 'ip', value: '2001:4860:4860::8888' },
    '[2001:DB8::1]:8080': { kind: 'ip', value: '2001:db8::1' },
    'GitHub.com': { kind: 'domain', value: 'github.com' },
    'github.com.': { kind: 'domain', value: 'github.com' },
    'https://news.ycombinator.com/item?id=1': { kind: 'domain', value: 'news.ycombinator.com' },
    'http://8.8.4.4/dns': { kind: 'ip', value: '8.8.4.4' },
    'http://[::1]/': { kind: 'ip', value: '::1' },
    '例子.中国': { kind: 'domain', value: 'xn--fsqu00a.xn--fiqs8s' },
    '1.2.3': { kind: 'invalid' },
    '999.1.1.1': { kind: 'invalid' },
    '01.2.3.4': { kind: 'invalid' },
    localhost: { kind: 'invalid' },
    'a b.com': { kind: 'invalid' },
    'foo.123': { kind: 'invalid' },
    '-bad.com': { kind: 'invalid' },
  };
  for (const [input, want] of Object.entries(cases)) assert.deepEqual(lib.parseQuery(input), want, input);
});

test('isPrivateIP：内网、保留地址和公网地址', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255', '100.64.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:10.0.0.1'])
    assert.equal(lib.isPrivateIP(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.255.255', '100.128.0.1', '1.1.1.1', '223.255.255.255', '2001:4860:4860::8888', '2606:4700::1111'])
    assert.equal(lib.isPrivateIP(ip), false, ip);
});

test('countryName：中文短名，查不到用备用名', () => {
  assert.equal(lib.countryName('US'), '美国');
  assert.equal(lib.countryName('hk'), '香港');
  assert.equal(lib.countryName('MO'), '澳门');
  assert.equal(lib.countryName('', 'Somewhere'), 'Somewhere');
  assert.equal(lib.countryName('ZZZ', 'X'), 'X');
});

test('fromIpquery：整理字段，AS0 视为没有 ASN', () => {
  const info = lib.fromIpquery({
    ip: '185.220.101.1',
    isp: { asn: 'AS60729', org: 'Stiftung Erneuerbare Freiheit', isp: 'Stiftung Erneuerbare Freiheit' },
    location: { country: 'Germany', country_code: 'DE', city: 'Hamburg', state: 'Hamburg', timezone: 'Europe/Berlin' },
    risk: { is_mobile: false, is_vpn: false, is_tor: true, is_proxy: false, is_datacenter: true, risk_score: 100 },
  });
  assert.equal(info.country, '德国');
  assert.equal(info.asn, 'AS60729');
  assert.equal(lib.placeText(info), '德国 · Hamburg');
  assert.deepEqual(info.risk, { datacenter: true, mobile: false, vpn: false, proxy: false, tor: true, score: 100 });
  assert.equal(lib.fromIpquery({ ip: '10.0.0.1', isp: { asn: 'AS0' }, location: {} }).asn, '');
  assert.equal(lib.fromIpquery({ error: 'IP address abc not found' }), null);
});

test('fromIpwho：备用来源没有风险信息', () => {
  const info = lib.fromIpwho({
    ip: '8.8.8.8', success: true, country: 'United States', country_code: 'US', region: 'California', city: 'Mountain View',
    connection: { asn: 15169, org: 'Google LLC', isp: 'Google LLC' }, timezone: { id: 'America/Los_Angeles' },
  });
  assert.equal(info.asn, 'AS15169');
  assert.equal(info.risk, null);
  assert.equal(lib.ipType(info.risk), null);
  assert.equal(lib.fromIpwho({ success: false, message: 'Invalid IP address' }), null);
});

test('fromIpleak 和 nativeStatus：原生 / 广播', () => {
  const e = lib.fromIpleak({ ip: '1.1.1.1', country_code: null, registered_country_code: 'AU', reverse: 'one.one.one.one' });
  assert.deepEqual(e, { ip: '1.1.1.1', countryCode: '', registeredCountryCode: 'AU', hostname: 'one.one.one.one' });
  assert.equal(lib.fromIpleak({ ip: '1.2.3.4', reverse: '1.2.3.4' }).hostname, '');
  assert.equal(lib.nativeStatus('US', 'us').label, '原生 IP');
  assert.equal(lib.nativeStatus('HK', 'US').label, '广播 IP');
  assert.equal(lib.nativeStatus('', 'US'), null);
});

test('fromIpip：中文位置去重去空', () => {
  assert.deepEqual(lib.fromIpip({ ret: 'ok', data: { ip: '1.2.3.4', location: ['中国', '北京', '北京', '', '联通'] } }), {
    ip: '1.2.3.4',
    country: '中国',
    place: '中国 北京 联通',
  });
  assert.equal(lib.fromIpip({ ret: 'ok', data: { ip: '1.2.3.4', location: ['中国', '香港', '', ''] } }).country, lib.countryName('HK'));
  assert.equal(lib.fromIpip({ ret: 'ok', data: { ip: '1.2.3.4', location: ['中国', '台湾', '台北'] } }).country, lib.countryName('TW'));
  assert.equal(lib.fromIpip({ ret: 'err' }), null);
});

test('splitVerdict：国内外看到的 IP 是否一样', () => {
  const cn = { ip: '116.23.45.67', country: '中国' };
  assert.match(lib.splitVerdict(cn, { ip: '116.23.45.67', country: '中国' }), /同一个 IP/);
  assert.match(lib.splitVerdict(cn, { ip: '203.198.12.34', country: '香港' }), /在中国，国外网站看到你在香港：你可能在用分流代理/);
  assert.match(lib.splitVerdict(cn, { ip: '116.23.45.99', country: '中国' }), /也可能是运营商有多个出口/);
  assert.equal(lib.splitVerdict(cn, { ip: '2001:4860::1', country: '美国' }), null);
  assert.equal(lib.splitVerdict(null, cn), null);
});

test('parseTrace 和 dnsAnswers', () => {
  const t = lib.parseTrace('fl=1\nip=160.79.106.135\nloc=US\ncolo=IAD\nwarp=off\n');
  assert.equal(t.ip, '160.79.106.135');
  assert.equal(t.colo, 'IAD');
  const j = { Status: 0, Answer: [{ type: 5, data: 'x.cdn.net.' }, { type: 1, data: '1.2.3.4' }, { type: 1, data: '5.6.7.8' }] };
  assert.deepEqual(lib.dnsAnswers(j, 1), ['1.2.3.4', '5.6.7.8']);
  assert.deepEqual(lib.dnsAnswers(j, 28), []);
  assert.deepEqual(lib.dnsAnswers({ Status: 3 }, 1), []);
});

test('ipType、proxyFlags、riskLevel', () => {
  const base = { datacenter: false, mobile: false, vpn: false, proxy: false, tor: false, score: 0 };
  assert.equal(lib.ipType({ ...base, datacenter: true }).label, '机房 IP');
  assert.equal(lib.ipType({ ...base, mobile: true }).label, '移动网络');
  assert.equal(lib.ipType(base).label, '宽带 IP（非机房）');
  assert.deepEqual(lib.proxyFlags(base), [{ label: '未发现', tone: 'ok' }]);
  assert.deepEqual(lib.proxyFlags({ ...base, vpn: true, tor: true }).map((f) => f.label), ['Tor', 'VPN']);
  assert.equal(lib.riskLevel(0).label, '低');
  assert.equal(lib.riskLevel(40).label, '中');
  assert.equal(lib.riskLevel(100).label, '高');
  assert.equal(lib.riskLevel(null), null);
});

test('localTime 和 ipFamily', () => {
  assert.equal(lib.localTime('Asia/Shanghai', new Date('2026-01-01T00:00:00Z')), '08:00');
  assert.equal(lib.localTime('Not/AZone'), '');
  assert.equal(lib.ipFamily('1.2.3.4'), 4);
  assert.equal(lib.ipFamily('::1'), 6);
  assert.equal(lib.ipFamily('nope'), 0);
});
