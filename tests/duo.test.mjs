// Duo 适配（/duo/）的检查：取 GitHub 上最新的网页、检查、兜底、加“← 起始页”和过期提示、隔离
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { handleDuo, parseReport, decorate, daysOld, resetDuoMemo, REPORT_URL, SANDBOX, STALE_DAYS } from "../tools/worker/duo.js";
import { createHandler } from "../tools/worker/handler.js";

// 北京时间 2026-11-18 10:00
const NOW = Date.parse("2026-11-18T02:00:00Z");

/** 做一份和真实网页结构一样的小报告。meta=false 时模仿早期没有 meta 标记的网页 */
function page({ date = "2026-11-18", generated = "2026-11-18T01:15:00Z", meta = true, marker = "" } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Duo 适配追踪</title>
${meta ? `<meta name="duo-tracker:date" content="${date}">\n<meta name="duo-tracker:generated" content="${generated}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&display=swap">
<style>:root{--accent:#2f5bd3}</style>
</head>
<body>
<header class="topbar"><div class="in">
  <div class="brand"><span>Duo 适配追踪</span><small>${date}</small></div>
</div></header>
<main class="wrap">
<section class="view" id="view-apps">${marker}</section>
</main>
<script>
const APPS = [];
const DATE = "${date}";
/* 网页自己的脚本 */
</script>
</body>
</html>`;
}
const file = (text) => ({ body: new TextEncoder().encode(text), type: "text/html; charset=utf-8", etag: '"x"' });
const filesWith = (html) => new Map(html ? [["/duo/index.html", file(html)]] : []);
const req = (path = "/duo/", init) => new Request("https://callaum.com" + path, init);
const url = new URL("https://callaum.com/duo/");

/** 假的 GitHub：记下每次请求 */
function fakeGitHub(reply) {
  const calls = [];
  const fetcher = async (u, init = {}) => {
    calls.push({ url: String(u), headers: init.headers || {} });
    return typeof reply === "function" ? reply() : reply;
  };
  return { calls, fetcher };
}

test("检查网页：新旧两种写法都能读出数据日期；GitHub 的报错、别的网页、太大的都不要", () => {
  const info = parseReport(page());
  assert.equal(info.date, "2026-11-18");
  assert.equal(info.generatedAt, Date.parse("2026-11-18T01:15:00Z"));
  const old = parseReport(page({ date: "2026-11-15", meta: false }));
  assert.equal(old.date, "2026-11-15");
  assert.equal(old.generatedAt, 0);
  assert.equal(parseReport("404: Not Found"), null);
  assert.equal(parseReport("<html><title>别的网页</title></html>"), null);
  assert.equal(parseReport(page().replace(/<meta name="duo-tracker:date"[^>]*>/, "").replace(/const DATE = "[^"]*";/, "")), null);
  assert.equal(parseReport(page() + " ".repeat(12 * 1024 * 1024)), null);
  assert.equal(parseReport(null), null);
});

test("隔了几天：按北京时间的日历日算", () => {
  const info = parseReport(page({ date: "2026-11-17" }));
  assert.equal(daysOld(info, Date.parse("2026-11-17T15:59:00Z")), 0); // 北京时间 11-17 23:59
  assert.equal(daysOld(info, Date.parse("2026-11-17T16:01:00Z")), 1); // 北京时间 11-18 00:01
  assert.equal(daysOld(info, Date.parse("2026-11-19T16:01:00Z")), 3);
});

test("加上“← 起始页”和（隐藏的）过期提示；不再去 Google 下载字体；网页原来的内容和脚本原样保留", () => {
  const html = page({ marker: "<p>原来的内容</p>" });
  const out = decorate(html, parseReport(html), { now: NOW });
  assert.ok(out.startsWith("<!doctype html>"));
  assert.doesNotMatch(out, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(out, /<a class="cs-back" href="\/">← 起始页<\/a>\n<div class="brand">/);
  assert.match(out, /<main class="wrap">\n<div class="cs-stale" id="cs-stale" role="alert" data-date="2026-11-18" hidden>/);
  assert.ok(out.indexOf(".cs-back {") < out.indexOf("</head>"));
  assert.ok(out.indexOf('getElementById("cs-stale")') < out.indexOf("</body>"));
  assert.ok(out.includes("<p>原来的内容</p>") && out.includes("/* 网页自己的脚本 */"));
});

test(`数据日期早 ${STALE_DAYS} 天及以上：显示过期提示；只早 1 天（当天还没跑到）不显示`, () => {
  const html = page({ date: "2026-11-17" });
  assert.match(decorate(html, parseReport(html), { now: NOW }), /id="cs-stale" role="alert" data-date="2026-11-17" hidden>/);
  const old = decorate(page({ date: "2026-11-15" }), parseReport(page({ date: "2026-11-15" })), { now: NOW });
  assert.match(old, /id="cs-stale" role="alert" data-date="2026-11-15">数据日期是 2026-11-15，已经 <span id="cs-days">3<\/span> 天没有更新/);
});

test("从 GitHub 读最新的（公开仓库，不带令牌），页面隔离；10 分钟内不重复读", async () => {
  resetDuoMemo();
  const gh = fakeGitHub(() => new Response(page({ date: "2026-11-18" })));
  let res = await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-15", meta: false })), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-duo-source"), "github");
  assert.equal(res.headers.get("x-duo-date"), "2026-11-18");
  assert.equal(res.headers.get("content-security-policy"), SANDBOX);
  assert.doesNotMatch(res.headers.get("content-security-policy"), /allow-same-origin/);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(res.headers.get("cache-control"), /no-cache/);
  assert.match(await res.text(), /← 起始页/);
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].url, REPORT_URL);
  assert.ok(!("Authorization" in gh.calls[0].headers));
  assert.ok(gh.calls[0].headers["User-Agent"]);
  // 9 分钟后：还用刚才那份
  await handleDuo(req(), url, {}, undefined, filesWith(null), { fetcher: gh.fetcher, now: NOW + 9 * 60000 });
  assert.equal(gh.calls.length, 1);
  // 11 分钟后：再去读一次
  await handleDuo(req(), url, {}, undefined, filesWith(null), { fetcher: gh.fetcher, now: NOW + 11 * 60000 });
  assert.equal(gh.calls.length, 2);
});

test("可以在 Cloudflare 后台用 DUO_REPORT_URL 换地址（只接受 https）", async () => {
  resetDuoMemo();
  const gh = fakeGitHub(() => new Response(page()));
  await handleDuo(req(), url, { DUO_REPORT_URL: " https://example.com/duo.html " }, undefined, filesWith(null), { fetcher: gh.fetcher, now: NOW });
  assert.equal(gh.calls[0].url, "https://example.com/duo.html");
  resetDuoMemo();
  await handleDuo(req(), url, { DUO_REPORT_URL: "http://example.com/duo.html" }, undefined, filesWith(null), { fetcher: gh.fetcher, now: NOW });
  assert.equal(gh.calls[1].url, REPORT_URL);
});

test("GitHub 出问题（404、超时、内容不对）：用打包的那份，页面照样能打开；一分钟内不重复试", async () => {
  for (const reply of [
    () => new Response("404: Not Found", { status: 404 }),
    () => Promise.reject(new Error("timeout")),
    () => new Response("<html>不是报告</html>"),
  ]) {
    resetDuoMemo();
    const gh = fakeGitHub(reply);
    const res = await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-17" })), { fetcher: gh.fetcher, now: NOW });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-duo-source"), "bundled");
    assert.equal(res.headers.get("x-duo-date"), "2026-11-17");
    await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-17" })), { fetcher: gh.fetcher, now: NOW + 30000 });
    assert.equal(gh.calls.length, 1);
  }
  // 以前从 GitHub 取到过：GitHub 再出问题时继续用以前取到的（比打包的新）
  resetDuoMemo();
  let ok = true;
  const gh = fakeGitHub(() => (ok ? new Response(page({ date: "2026-11-18" })) : new Response("", { status: 502 })));
  await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-15", meta: false })), { fetcher: gh.fetcher, now: NOW });
  ok = false;
  const res = await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-15", meta: false })), { fetcher: gh.fetcher, now: NOW + 20 * 60000 });
  assert.equal(res.headers.get("x-duo-source"), "github");
  assert.equal(res.headers.get("x-duo-date"), "2026-11-18");
});

test("两份都有时用数据日期新的；同一天用后生成的；两份都没有时回一个说明（503）", async () => {
  resetDuoMemo();
  let gh = fakeGitHub(() => new Response(page({ date: "2026-11-16" })));
  let res = await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-17" })), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.headers.get("x-duo-source"), "bundled");
  resetDuoMemo();
  gh = fakeGitHub(() => new Response(page({ date: "2026-11-18", generated: "2026-11-18T01:15:00Z" })));
  res = await handleDuo(req(), url, {}, undefined, filesWith(page({ date: "2026-11-18", generated: "2026-11-17T16:45:00Z" })), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.headers.get("x-duo-source"), "github");
  resetDuoMemo();
  res = await handleDuo(req(), url, {}, undefined, filesWith(null), { fetcher: fakeGitHub(() => new Response("", { status: 500 })).fetcher, now: NOW });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /Duo 适配报告暂时打不开/);
});

test("只接受读取；HEAD 只回信息", async () => {
  resetDuoMemo();
  const gh = fakeGitHub(() => new Response(page()));
  let res = await handleDuo(req("/duo/", { method: "POST" }), url, {}, undefined, filesWith(page()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.status, 405);
  assert.equal(gh.calls.length, 0);
  res = await handleDuo(req("/duo/", { method: "HEAD" }), url, {}, undefined, filesWith(page()), { fetcher: gh.fetcher, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

test("网站路由：/duo、/duo/、/duo/index.html", async () => {
  resetDuoMemo();
  // 不让测试真的连 GitHub：先在内存里放一份刚取到的
  await handleDuo(req(), url, {}, undefined, filesWith(null), { fetcher: fakeGitHub(() => new Response(page({ date: "2026-11-18" }))).fetcher, now: Date.now() });
  const fetch = createHandler(new Map([["/index.html", file("home")], ["/duo/index.html", file(page({ date: "2026-11-15", meta: false }))]]));
  let res = await fetch(new Request("https://callaum.com/duo"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/duo/");
  for (const p of ["/duo/", "/duo/index.html"]) {
    res = await fetch(new Request("https://callaum.com" + p));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-security-policy"), SANDBOX);
    assert.equal(res.headers.get("x-duo-date"), "2026-11-18");
    assert.match(await res.text(), /cs-back/);
  }
});
