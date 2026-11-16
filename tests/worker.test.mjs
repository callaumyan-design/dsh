// 发布到 Cloudflare 用的"服务员"程序的检查
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../tools/worker/handler.js";

const file = (text, type) => ({ body: new TextEncoder().encode(text), type, etag: `"${text.length}-${type.length}"` });
const fetch = createHandler(
  new Map([
    ["/index.html", file("home", "text/html; charset=utf-8")],
    ["/about/index.html", file("about", "text/html; charset=utf-8")],
    ["/uq/index.html", file("uq", "text/html; charset=utf-8")],
    ["/assets/js/main.js", file("js", "text/javascript; charset=utf-8")],
    ["/assets/icons/icon-192.png", file("png", "image/png")],
    ["/sw.js", file("sw", "text/javascript; charset=utf-8")],
  ])
);
const get = (path, init) => fetch(new Request("https://example.test" + path, init));

test("首页、子目录、文件都能取到", async () => {
  let res = await get("/");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "home");
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await (await get("/index.html")).text(), "home");
  assert.equal(await (await get("/about/")).text(), "about");
  assert.equal(await (await get("/uq/")).text(), "uq");
  res = await get("/assets/js/main.js");
  assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await get("/sw.js")).status, 200);
});

test("目录地址少了斜杠会转到带斜杠的地址，并保留问号后面的内容", async () => {
  const res = await get("/about?x=1");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/about/?x=1");
});

test("不存在的地址返回 404 页面，不会报错", async () => {
  for (const path of ["/nope", "/nope/", "/assets/", "/../etc/passwd", "/%E0%A4%A", "/about/index.html/x"]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.match(await res.text(), /找不到这个页面/);
  }
});

test("缓存：页面和脚本每次确认，图片缓存一天；内容没变时返回 304", async () => {
  const page = await get("/");
  assert.equal(page.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal((await get("/assets/icons/icon-192.png")).headers.get("cache-control"), "public, max-age=86400");
  const again = await get("/", { headers: { "If-None-Match": page.headers.get("etag") } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
});

test("只接受读取请求；HEAD 只回信息不回内容", async () => {
  assert.equal((await get("/", { method: "POST" })).status, 405);
  const head = await get("/uq/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await get("/nope", { method: "HEAD" })).status, 404);
});

test("搬走的旧地址会跳到新地址，并保留后面的路径和参数", async () => {
  const moved = createHandler(new Map([["/index.html", file("home", "text/html; charset=utf-8")]]), { "/drop": "https://new.example/drop" });
  const go = (path, init) => moved(new Request("https://example.test" + path, init));
  for (const [from, to] of [
    ["/drop", "https://new.example/drop"],
    ["/drop/", "https://new.example/drop/"],
    ["/drop/room/abc?x=1", "https://new.example/drop/room/abc?x=1"],
  ]) {
    const res = await go(from);
    assert.equal(res.status, 307, from);
    assert.equal(res.headers.get("location"), to);
  }
  assert.equal((await go("/drop/ws", { method: "POST" })).status, 307); // 其他请求方式也照样指过去
  assert.equal((await go("/dropbox")).status, 404); // 只是开头几个字母相同的不算
  assert.equal((await go("/")).status, 200);
});

test("带 www 的地址转到不带 www 的，路径和参数不变", async () => {
  const res = await fetch(new Request("https://www.example.test/uq/?a=1"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://example.test/uq/?a=1");
  assert.equal((await fetch(new Request("https://example.test/uq/"))).status, 200);
});

// ---------- 在线壁纸的中转 ----------
import { handleWallpaper, hash } from "../tools/worker/wallpaper.js";

/** 把"去图库取东西"换成假的：按网址开头给出预先准备好的回答，并记下都取了哪些网址 */
async function withUpstream(routes, run) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input);
    seen.push(url);
    for (const [prefix, reply] of routes) if (url.startsWith(prefix)) return typeof reply === "function" ? reply(url) : reply.clone();
    return new Response("not found", { status: 404 });
  };
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = real;
  }
}
const wall = (query, init) => {
  const url = new URL("https://example.test/api/wallpaper?" + query);
  return handleWallpaper(new Request(url, init), url, Date.UTC(2026, 10, 16, 3));
};
const jpeg = () => new Response(new Uint8Array([255, 216, 255, 224]), { headers: { "content-type": "image/jpeg" } });
const asJson = (data) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const bingList = asJson({
  images: Array.from({ length: 8 }, (_, i) => ({ urlbase: `/th?id=OHR.Pic${i}_ZH-CN1`, title: `标题${i}`, copyright: `说明${i} (© 作者${i})`, copyrightlink: `https://www.bing.com/search?q=pic${i}` })),
});

test("壁纸中转：参数不对直接拒绝，不会去取任何东西", async () => {
  await withUpstream([], async (seen) => {
    assert.equal((await wall("source=evil&seed=abc")).status, 400);
    assert.equal((await wall("source=bing&seed=")).status, 400);
    assert.equal((await wall("source=bing&seed=../../x")).status, 400);
    assert.equal((await wall("source=bing&seed=" + "a".repeat(25))).status, 400);
    assert.equal((await wall("source=constructor&seed=abc")).status, 400);
    assert.equal((await wall("source=bing&seed=abc", { method: "POST" })).status, 405);
    assert.equal(seen.length, 0);
  });
});

test("壁纸中转·必应：日期编号取当天那张，i0~i7 取指定的一张，竖屏要竖图", async () => {
  await withUpstream([["https://www.bing.com/HPImageArchive.aspx", bingList], ["https://www.bing.com/th?id=", jpeg]], async (seen) => {
    let res = await wall("source=bing&seed=20261116&shape=land");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
    assert.equal((await res.arrayBuffer()).byteLength, 4);
    assert.equal(seen.at(-1), "https://www.bing.com/th?id=OHR.Pic0_ZH-CN1_1920x1080.jpg");
    await wall("source=bing&seed=i5&shape=port");
    assert.equal(seen.at(-1), "https://www.bing.com/th?id=OHR.Pic5_ZH-CN1_1080x1920.jpg");
    await wall("source=bing&seed=whatever");
    assert.equal(seen.at(-1), `https://www.bing.com/th?id=OHR.Pic${hash("whatever") % 8}_ZH-CN1_1920x1080.jpg`);
    res = await wall("source=bing&seed=i2&info=1");
    assert.deepEqual(await res.json(), { title: "标题2", credit: "说明2 (© 作者2)", link: "https://www.bing.com/search?q=pic2" });
  });
});

test("壁纸中转：图库出问题时回一个说明，不会把错误内容当图片发出去", async () => {
  // 图库接口挂了
  await withUpstream([["https://www.bing.com/HPImageArchive.aspx", new Response("oops", { status: 503 })]], async () => {
    const res = await wall("source=bing&seed=i1");
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal((await res.json()).error, "暂时取不到壁纸");
  });
  // 图片地址给的不是图片（比如一张网页）
  await withUpstream([["https://www.bing.com/HPImageArchive.aspx", bingList], ["https://www.bing.com/th?id=", new Response("<html>", { headers: { "content-type": "text/html" } })]], async () => {
    assert.equal((await wall("source=bing&seed=i1")).status, 502);
  });
  // 接口返回的不是预期的格式
  await withUpstream([["https://www.bing.com/HPImageArchive.aspx", asJson({ images: [{ urlbase: 5 }] })]], async () => {
    assert.equal((await wall("source=bing&seed=i1")).status, 502);
  });
});
