// 在线壁纸的"中转站"：浏览器只向本站要图，由这里去图库取图再转交。目前只有必应一个图库。
//
// 为什么要中转：
//   - 必应不允许网页直接读取它的图片列表；
//   - 访客的网络地址不会暴露给图库（图库只看得到 Cloudflare）；
//   - 图片算本站的，页面可以读出它的平均色，用来决定时钟和搜索框用白字还是深字。
//
// 它只会去下面写死的图库取图，不是"给个网址就代取"的开放代理。
// 以后想加别的图库：照着 bing 的样子写一个函数，登记到最下面的 SOURCES 里。
// （试过维基共享资源和两家博物馆，要么取不到、要么图太小，所以没有保留。）
//
// 用法：
//   /api/wallpaper?source=<来源>&seed=<编号>&w=<宽>&h=<高>          → 图片（宽高是屏幕的真实像素，用来挑合适的清晰度）
//   /api/wallpaper?source=<来源>&seed=<编号>&w=<宽>&h=<高>&info=1   → 这张图的标题、作者、出处（JSON）
//   seed 是 8 位日期（如 20261116）表示"当天的每日图片"；"i0"~"i7" 表示最近 8 天里的第几张。

// 去图库取东西时自报家门（不含任何个人信息）
const UA = "start-page-wallpaper/1.0 (personal start page; static site helper)";

const isDate = (seed) => /^\d{8}$/.test(seed);

/** 把编号变成一个固定的数字，用来"随机但可重复"地挑图 */
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 去掉图库返回的文字里夹带的 HTML 标签 */
const plain = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** 向图库的接口要数据。what 是这一步在做什么，出错时写进说明里，方便排查 */
async function getJson(what, url, cacheSeconds, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, cf: { cacheTtl: cacheSeconds, cacheEverything: true } });
  if (!res.ok) throw new Error(`${what}：对方返回 ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${what}：对方返回的不是预期的格式`);
  }
}

// ---------- 必应 ----------
// 必应首页的每日图片，接口一次给出最近 8 天的。
// seed 是日期 → 今天的；"i0"~"i7" → 指定第几张；其他 → 按编号固定挑一张
async function bing(seed, w, h) {
  const data = await getJson("必应图片列表", "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN", 1800);
  const list = Array.isArray(data.images) ? data.images.filter((i) => i && typeof i.urlbase === "string") : [];
  if (!list.length) throw new Error("必应没有返回图片");
  const pick = isDate(seed) ? 0 : /^i[0-7]$/.test(seed) ? Number(seed[1]) % list.length : hash(seed) % list.length;
  const item = list[pick];
  return {
    images: bingImages(`https://www.bing.com${item.urlbase}`, w, h),
    title: plain(item.title),
    credit: plain(item.copyright),
    link: typeof item.copyrightlink === "string" && /^https:\/\/www\.bing\.com\//.test(item.copyrightlink) ? item.copyrightlink : "https://www.bing.com/",
    maxAge: isDate(seed) ? 3600 : 6 * 3600, // 列表每天都在变，所以不能缓存太久
  };
}

/**
 * 按屏幕的真实像素（w × h）挑图片地址，按顺序试：
 *   - 竖屏（手机）：一律用必应专门为手机裁好的竖版 1080x1920。
 *     试过从超清原图里自动裁一条竖的（能到 2160 高，清楚一点点），但自动裁只会从正中间裁，
 *     最近 8 张图里有 3 张把主体（崖居、石拱门、桥）裁掉了，所以不用。
 *   - 横屏、屏幕不超过 1920x1080：用现成的 1920x1080。
 *   - 横屏、屏幕更大：用超清原图（一般是 3840x2160），按屏幕的长宽比从中间裁好；万一取不到再退回 1920x1080。
 */
export function bingImages(base, w, h) {
  if (h > w) return [`${base}_1080x1920.jpg`];
  const preset = `${base}_1920x1080.jpg`;
  if (w <= 1920 && h <= 1080) return [preset];
  const width = Math.min(3840, w);
  const height = Math.max(Math.round(width / 2.4), Math.min(2160, Math.round((width * h) / w)));
  return [`${base}_UHD.jpg&w=${width}&h=${height}&rs=1&c=4`, preset]; // rs=1 缩放，c=4 按长宽比从中间裁
}

const SOURCES = { bing };

const json = (body, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store", "X-Content-Type-Options": "nosniff" },
  });

/** 处理 /api/wallpaper 的请求 */
export async function handleWallpaper(request, url, now = Date.now()) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const source = url.searchParams.get("source") || "";
  const seed = url.searchParams.get("seed") || "";
  // 屏幕的真实像素；没给的话（旧版页面）按"横屏 1920x1080 / 竖屏 1080x1920"算
  const portrait = url.searchParams.get("shape") === "port";
  const size = (name, fallback) => {
    const n = Number(url.searchParams.get(name));
    return Number.isInteger(n) && n >= 200 && n <= 8000 ? n : fallback;
  };
  const w = size("w", portrait ? 1080 : 1920);
  const h = size("h", portrait ? 1920 : 1080);
  if (!Object.hasOwn(SOURCES, source)) return json({ error: "不认识的壁纸来源" }, 400);
  if (!/^[a-z0-9]{1,24}$/.test(seed)) return json({ error: "编号只能是 1~24 位小写字母或数字" }, 400);

  let found;
  try {
    found = await SOURCES[source](seed, w, h, now);
  } catch (err) {
    return json({ error: "暂时取不到壁纸", detail: String(err?.message || err).slice(0, 200) }, 502);
  }
  if (url.searchParams.get("info") === "1") {
    return json({ title: found.title, credit: found.credit, link: found.link }, 200, Math.min(found.maxAge, 86400));
  }

  // 按顺序试每个候选地址，拿到一张真正的图片就发回去
  let problem = "没有可用的图片地址";
  for (const image of found.images) {
    let upstream;
    try {
      upstream = await fetch(image, { headers: { "User-Agent": UA, Accept: "image/*" }, cf: { cacheTtl: 30 * 86400, cacheEverything: true } });
    } catch (err) {
      problem = String(err?.message || err);
      continue;
    }
    const type = upstream.headers.get("content-type") || "";
    if (upstream.ok && /^image\/(jpeg|png|webp)/.test(type)) {
      return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: 200,
        headers: { "Content-Type": type.split(";")[0], "Cache-Control": `public, max-age=${found.maxAge}`, "X-Content-Type-Options": "nosniff" },
      });
    }
    problem = `图片地址返回 ${upstream.status} ${type.slice(0, 40)}`;
    upstream.body?.cancel().catch(() => {}); // 这个回答用不上了，不必读完
  }
  return json({ error: "暂时取不到壁纸", detail: problem.slice(0, 200) }, 502);
}
