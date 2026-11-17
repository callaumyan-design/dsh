// 飞汇地区比价（/flywire/）的检查：取 GitHub 上最新的报告、检查、兜底、加页头和提示、隔离
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { handleFlywire, parseReport, decorate, ageText, resetFlywireMemo, REPORT_URL, SANDBOX } from "../tools/worker/flywire.js";
import { createHandler } from "../tools/worker/handler.js";

const DAY = 86400000;
const NOW = Date.parse("2026-11-20T02:00:00Z");

/** 做一份和真实报告结构一样的小报告 */
function report({ scrapedAt = "2026-11-17T08:53:07+00:00", amount = 25000, marker = "" } = {}) {
  const data = { scraped_at: scrapedAt, recipient: { id: "CUQ", name: "The University of Queensland", currency: "AUD" }, amount, countries: [{ country: "CN", offers: [] }], failed: [] };
  return `<title>飞汇地区比价器</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap">
<style>
:root { --font-body: "Noto Sans SC", sans-serif; }
</style>

<div class="wrap">
  <header><h1>飞汇地区比价器</h1>${marker}</header>
</div>

<script id="fw-data" type="application/json">${JSON.stringify(data).replace(/<\//g, "<\\/")}</script>
<script>/* 报告自己的计算脚本 */ var RAW = JSON.parse(document.getElementById("fw-data").textContent);</script>`;
}
const file = (text) => ({ body: new TextEncoder().encode(text), type: "text/html; charset=utf-8", etag: '"x"' });
const filesWith = (html) => new Map(html ? [["/flywire/index.html", file(html)]] : []);
const req = (path = "/flywire/", init) => new Request("https://callaum.com" + path, init);
const url = new URL("https://callaum.com/flywire/");

/** 假的 GitHub：记下每次请求 */
function fakeGitHub(reply) {
  const calls = [];
  const fetcher = async (u, init = {}) => {
    calls.push({ url: String(u), headers: init.headers || {} });
    return typeof reply === "function" ? reply() : reply;
  };
  return { calls, fetcher };
}

test("检查报告：真实结构的能用；GitHub 的报错、缺数据、坏数据、太大的都不要", () => {
  const info = parseReport(report());
  assert.equal(info.scrapedAt, Date.parse("2026-11-17T08:53:07Z"));
  assert.equal(info.amount, 25000);
  assert.equal(info.currency, "AUD");
  assert.equal(parseReport('{"message":"Bad credentials","documentation_url":"https://docs.github.com"}'), null);
  assert.equal(parseReport("<html>没有数据</html>"), null);
  assert.equal(parseReport('<script id="fw-data" type="application/json">{坏的</script>'), null);
  assert.equal(parseReport(report({ scrapedAt: "昨天" })), null);
  assert.equal(parseReport(report() + " ".repeat(3 * 1024 * 1024)), null);
  assert.equal(parseReport(null), null);
});

test("多久以前", () => {
  assert.equal(ageText(10 * 60000), "刚刚");
  assert.equal(ageText(5 * 3600000), "5 小时前");
  assert.equal(ageText(3 * DAY + 3600000), "3 天前");
});

test("加上页头、提示条、页脚；字体换成系统字体，不再去 Google 下载；原来的报告和计算脚本原样保留", () => {
  const html = report({ marker: "<p>原来的内容</p>" });
  const out = decorate(html, parseReport(html), { now: NOW });
  assert.ok(out.startsWith("<!doctype html>"));
  assert.match(out, /<meta name="viewport" content="width=device-width/);
  assert.match(out, /<meta charset="utf-8">/);
  assert.match(out, /<meta name="robots" content="noindex/);
  assert.doesNotMatch(out, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(out, /--font-body: system-ui/);
  assert.match(out, /<a href="\/">← 起始页<\/a>/);
  assert.match(out, /数据抓取于 <b><time id="cs-time" datetime="2026-11-17T08:53:07.000Z">2026年11月17日 16:53（北京时间）<\/time><\/b>（<span id="cs-ago">2 天前<\/span>），按 <b>25,000 AUD<\/b> 报价/);
  assert.match(out, /报价随汇率变化，付款前请在飞汇页面再确认金额/);
  assert.match(out, /<div class="cs-stale" id="cs-stale" role="alert" hidden>数据已超过两周未更新，可能已过期<\/div>/);
  assert.match(out, /<footer class="cs-foot">/);
  // 提示条在报告的内容区里、标题前面；页脚在报告数据前面
  assert.ok(out.indexOf('class="cs-note"') > out.indexOf('<div class="wrap">') && out.indexOf('class="cs-note"') < out.indexOf("<h1>"));
  assert.ok(out.indexOf('class="cs-foot"') > out.indexOf("<h1>") && out.indexOf('class="cs-foot"') < out.indexOf('id="fw-data"'));
  // 报告原来的内容和脚本都在
  assert.ok(out.includes("<p>原来的内容</p>") && out.includes("/* 报告自己的计算脚本 */"));
  assert.ok(out.includes(html.slice(html.indexOf('<script id="fw-data"'))));
});

test("超过 14 天没更新：显示“数据已超过两周未更新，可能已过期”；14 天以内不显示", () => {
  const html = report();
  const info = parseReport(html);
  assert.match(decorate(html, info, { now: info.scrapedAt + 14 * DAY - 60000 }), /id="cs-stale" role="alert" hidden>/);
  const old = decorate(html, info, { now: info.scrapedAt + 15 * DAY });
  assert.match(old, /id="cs-stale" role="alert">数据已超过两周未更新，可能已过期/);
  assert.match(old, /15 天前/);
});

test("没设令牌：用打包进来的那份，不去 GitHub；页面隔离", async () => {
  resetFlywireMemo();
  const gh = fakeGitHub(new Response(report({ scrapedAt: "2026-11-24T02:00:00Z" })));
  const res = await handleFlywire(req(), url, {}, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(gh.calls.length, 0);
  assert.equal(res.headers.get("x-flywire-source"), "bundled");
  assert.equal(res.headers.get("content-security-policy"), SANDBOX);
  assert.match(res.headers.get("content-security-policy"), /^sandbox allow-scripts/);
  assert.doesNotMatch(res.headers.get("content-security-policy"), /allow-same-origin/);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(res.headers.get("cache-control"), /no-cache/);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  assert.match(await res.text(), /2026年11月17日/);
});

test("设了令牌：从 GitHub 读最新的（令牌放在请求头里，不在网址里），10 分钟内不重复读", async () => {
  resetFlywireMemo();
  const gh = fakeGitHub(() => new Response(report({ scrapedAt: "2026-11-24T02:00:00Z", amount: 31000 })));
  const env = { FLYWIRE_GITHUB_TOKEN: "github_pat_test_123" };
  let res = await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.headers.get("x-flywire-source"), "github");
  assert.match(await res.text(), /按 <b>31,000 AUD<\/b> 报价/);
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].url, REPORT_URL);
  assert.ok(!gh.calls[0].url.includes("github_pat"));
  assert.equal(gh.calls[0].headers.Authorization, "Bearer github_pat_test_123");
  assert.equal(gh.calls[0].headers.Accept, "application/vnd.github.raw");
  assert.ok(gh.calls[0].headers["User-Agent"]);
  // 9 分钟后：还用刚才那份
  await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW + 9 * 60000 });
  assert.equal(gh.calls.length, 1);
  // 11 分钟后：再去读一次
  await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW + 11 * 60000 });
  assert.equal(gh.calls.length, 2);
});

test("GitHub 出问题（令牌不对、超时、内容不对）：用手上的那份，页面照样能打开；一分钟内不重复试", async () => {
  const env = { FLYWIRE_GITHUB_TOKEN: "github_pat_test_123" };
  for (const reply of [
    () => new Response('{"message":"Bad credentials"}', { status: 401 }),
    () => Promise.reject(new Error("timeout")),
    () => new Response("<html>不是报告</html>"),
  ]) {
    resetFlywireMemo();
    const gh = fakeGitHub(reply);
    const res = await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-flywire-source"), "bundled");
    await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW + 30000 });
    assert.equal(gh.calls.length, 1);
  }
  // 以前从 GitHub 取到过：GitHub 再出问题时继续用以前取到的（比打包的新）
  resetFlywireMemo();
  let ok = true;
  const gh = fakeGitHub(() => (ok ? new Response(report({ scrapedAt: "2026-11-24T02:00:00Z" })) : new Response("", { status: 502 })));
  await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
  ok = false;
  const res = await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW + 20 * 60000 });
  assert.equal(res.headers.get("x-flywire-source"), "github");
  assert.match(await res.text(), /2026年11月24日/);
});

test("两份都有时用抓取时间更新的那份；两份都没有时回一个说明（503）", async () => {
  resetFlywireMemo();
  const env = { FLYWIRE_GITHUB_TOKEN: "t" };
  const gh = fakeGitHub(() => new Response(report({ scrapedAt: "2026-11-01T00:00:00Z" })));
  let res = await handleFlywire(req(), url, env, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.headers.get("x-flywire-source"), "bundled");
  resetFlywireMemo();
  res = await handleFlywire(req(), url, {}, undefined, filesWith(null), { now: NOW });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /比价报告暂时打不开/);
});

test("只接受读取；HEAD 只回信息；不管怎样都不去碰飞汇", async () => {
  resetFlywireMemo();
  const gh = fakeGitHub(() => new Response(report()));
  let res = await handleFlywire(req("/flywire/", { method: "POST" }), url, {}, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.status, 405);
  res = await handleFlywire(req("/flywire/", { method: "HEAD" }), url, { FLYWIRE_GITHUB_TOKEN: "t" }, undefined, filesWith(report()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.ok(gh.calls.every((c) => !/flywire\.com/.test(c.url)));
});

test("网站路由：/flywire、/flywire/、/flywire/index.html", async () => {
  resetFlywireMemo();
  const fetch = createHandler(new Map([["/index.html", file("home")], ["/flywire/index.html", file(report())]]));
  let res = await fetch(new Request("https://callaum.com/flywire"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/flywire/");
  for (const p of ["/flywire/", "/flywire/index.html"]) {
    res = await fetch(new Request("https://callaum.com" + p));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-security-policy"), SANDBOX);
    assert.match(await res.text(), /cs-note/);
  }
});
