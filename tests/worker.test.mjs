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
  assert.equal(page.headers.get("cache-control"), "no-cache");
  assert.equal((await get("/assets/icons/icon-192.png")).headers.get("cache-control"), "public, max-age=86400");
  const again = await get("/", { headers: { "If-None-Match": page.headers.get("etag") } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
});

test("只接受读取请求；HEAD 只回信息不回内容（状态检测用）", async () => {
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
