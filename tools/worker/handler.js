// 起始页在 Cloudflare 上的"服务员"：收到网址，把对应的文件发回去。
// 网站的所有文件在发布时直接打包进来（见 tools/deploy-cloudflare.mjs），这里不读硬盘、不连数据库。
//
// files 是一张表：网址路径（如 "/assets/css/main.css"）→ { body: 文件内容, type: 文件类型, etag: 内容指纹 }
// redirects 是"搬家了的旧地址"：路径前缀 → 新地址（见 tools/worker/redirects.json）

const NOT_FOUND = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>找不到这个页面</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:32em;margin:18vh auto;padding:0 20px;text-align:center"><h1 style="font-size:22px">找不到这个页面</h1><p><a href="/">回到起始页</a></p></body></html>`;

/** 把网址路径对应到文件。"/" 和 "/about/" 这类目录地址对应目录里的 index.html */
function resolve(files, pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return {};
  }
  if (files.has(path)) return { file: files.get(path) };
  if (path.endsWith("/")) return { file: files.get(path + "index.html") };
  // "/about" 少了结尾的斜杠：转到 "/about/"，这样页面里的相对链接才不会错位
  if (files.has(path + "/index.html")) return { redirect: path + "/" };
  return {};
}

/** 旧地址搬到哪了：/drop 和 /drop/任意内容 → 新地址下的同一位置。没搬过的返回空 */
function movedTo(redirects, url) {
  for (const [prefix, target] of Object.entries(redirects)) {
    if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) {
      return target + url.pathname.slice(prefix.length) + url.search;
    }
  }
  return "";
}

export function createHandler(files, redirects = {}) {
  return async function fetch(request) {
    const url = new URL(request.url);
    // 带 www 的地址统一转到不带 www 的：两个地址在浏览器眼里是两个网站，设置和自己加的入口不互通
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return new Response(null, { status: 301, headers: { Location: url.href } });
    }
    // 搬走的旧地址：不管是什么请求，都指到新地址去（307 会保留原来的请求方式）
    const moved = movedTo(redirects, url);
    if (moved) return new Response(null, { status: 307, headers: { Location: moved, "Cache-Control": "no-store" } });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const { file, redirect } = resolve(files, url.pathname);
    if (redirect) return new Response(null, { status: 301, headers: { Location: redirect + url.search } });
    if (!file) return new Response(request.method === "HEAD" ? null : NOT_FOUND, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

    const headers = {
      "Content-Type": file.type,
      ETag: file.etag,
      // 图片很少变，可以多缓存一会儿；页面、样式、脚本每次都向服务器确认一下有没有新版本（没变就不重新下载）
      "Cache-Control": file.type.startsWith("image/") ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    if (request.headers.get("If-None-Match") === file.etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : file.body, { status: 200, headers });
  };
}
