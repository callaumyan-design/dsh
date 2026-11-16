// 在线壁纸的"中转站"：浏览器只向本站要图，由这里去各个图库取图再转交。
//
// 为什么要中转：
//   - 必应等图库不允许网页直接读取它们的接口；
//   - 访客的网络地址不会暴露给图库（图库只看得到 Cloudflare）；
//   - 图片算本站的，页面可以读出它的平均色，用来决定时钟和搜索框用白字还是深字。
//
// 它只会去下面写死的几个图库取图，不是"给个网址就代取"的开放代理。
//
// 用法：
//   /api/wallpaper?source=<来源>&seed=<编号>&shape=<land|port>          → 图片
//   /api/wallpaper?source=<来源>&seed=<编号>&shape=<land|port>&info=1   → 这张图的标题、作者、出处（JSON）
//   seed 是 8 位日期（如 20261116）表示"那一天的每日图片"；其他编号表示"按这个编号固定挑一张"，
//   同一个编号挑到的总是同一张，所以浏览器可以放心缓存。

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
async function bing(seed, shape) {
  const data = await getJson("必应图片列表", "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN", 1800);
  const list = Array.isArray(data.images) ? data.images.filter((i) => i && typeof i.urlbase === "string") : [];
  if (!list.length) throw new Error("必应没有返回图片");
  const pick = isDate(seed) ? 0 : /^i[0-7]$/.test(seed) ? Number(seed[1]) % list.length : hash(seed) % list.length;
  const item = list[pick];
  const size = shape === "port" ? "1080x1920" : "1920x1080";
  return {
    images: [`https://www.bing.com${item.urlbase}_${size}.jpg`],
    title: plain(item.title),
    credit: plain(item.copyright),
    link: typeof item.copyrightlink === "string" && /^https:\/\/www\.bing\.com\//.test(item.copyrightlink) ? item.copyrightlink : "https://www.bing.com/",
    maxAge: isDate(seed) ? 3600 : 6 * 3600, // 列表每天都在变，所以不能缓存太久
  };
}

// ---------- 维基共享资源（Wikimedia Commons）的"每日图片" ----------
// seed 是日期 → 那一天的；其他 → 按编号固定挑过去十年里的某一天
const DAY = 24 * 60 * 60 * 1000;
const ymd = (date) => date.toISOString().slice(0, 10);

const COMMONS = "https://commons.wikimedia.org/w/api.php?format=json&formatversion=2";

async function wikimedia(seed, shape, now) {
  const fixedDay = isDate(seed);
  let day = fixedDay ? new Date(`${seed.slice(0, 4)}-${seed.slice(4, 6)}-${seed.slice(6, 8)}T00:00:00Z`) : new Date(now - (1 + (hash(seed) % 3650)) * DAY);
  if (Number.isNaN(day.getTime()) || day.getTime() > now + 2 * DAY) day = new Date(now);
  const width = shape === "port" ? 1280 : 1920;
  // 个别日子没有"每日图片"，或者那天的不适合当壁纸：往前一天一天找，最多找 6 天
  for (let i = 0; i < 6; i++, day = new Date(day.getTime() - DAY)) {
    // 第一步：那一天的每日图片是哪个文件（"Potd/日期"这个模板的内容就是文件名）
    const text = encodeURIComponent(`{{Potd/${ymd(day)}}}`);
    const expanded = await getJson("维基每日图片（查文件名）", `${COMMONS}&action=expandtemplates&prop=wikitext&text=${text}`, 6 * 3600);
    const name = plain(expanded.expandtemplates?.wikitext).replace(/^(File|Image):/i, "");
    if (!name || /[[\]{}|#<>]/.test(name)) continue; // 那天没有（模板不存在时会原样返回一段带括号的文字）
    // 第二步：这个文件的图片地址（要一张宽度合适的缩小版）、作者和授权
    const title = encodeURIComponent(`File:${name}`);
    const data = await getJson("维基每日图片（查图片地址）", `${COMMONS}&action=query&titles=${title}&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=${width}`, 86400);
    const info = data.query?.pages?.[0]?.imageinfo?.[0];
    const image = info?.thumburl || info?.url;
    // 只要常见的图片格式（矢量图、扫描件会由对方转成 png/jpg 的缩小版；视频、动图不要）
    if (typeof image !== "string" || !/^https:\/\/upload\.wikimedia\.org\/.+\.(jpe?g|png|webp)$/i.test(image)) continue;
    const meta = info.extmetadata || {};
    return {
      images: [image],
      title: plain(meta.ObjectName?.value) || plain(name.replace(/\.\w+$/, "")),
      credit: [plain(meta.Artist?.value), plain(meta.LicenseShortName?.value)].filter(Boolean).join(" · "),
      link: typeof info.descriptionurl === "string" && /^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl) ? info.descriptionurl : "https://commons.wikimedia.org/",
      // 过去某一天的每日图片是固定的，可以缓存很久；"今天"的或者往前找来顶替的，过几小时再确认
      maxAge: i === 0 && day.getTime() < now - 2 * DAY ? 30 * 86400 : 6 * 3600,
    };
  }
  throw new Error("维基共享资源这几天都没有能当壁纸的图片");
}

// ---------- 名画：芝加哥艺术博物馆（Art Institute of Chicago）的公有领域绘画 ----------
async function art(seed, shape) {
  const params = {
    // 只要"公有领域"（没有版权限制）的"绘画"
    query: { bool: { filter: [{ term: { is_public_domain: true } }, { match: { artwork_type_title: "Painting" } }, { exists: { field: "image_id" } }] } },
    fields: ["id", "title", "artist_display", "date_display", "image_id", "thumbnail"],
    limit: 12,
    page: 1 + (hash(seed) % 80), // 接口最多翻到前 1000 条
  };
  const data = await getJson("博物馆作品列表", `https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`, 86400, { "AIC-User-Agent": UA });
  const list = (Array.isArray(data.data) ? data.data : []).filter((a) => a && /^[0-9a-f-]{20,60}$/.test(String(a.image_id || "")));
  if (!list.length) throw new Error("博物馆没有返回作品");
  // 横屏挑横幅的画，竖屏挑竖幅的画，裁切得少一些；没有合适的就按编号挑一幅
  const ratio = (a) => (Number(a.thumbnail?.width) || 1) / (Number(a.thumbnail?.height) || 1);
  const fits = list.filter((a) => (shape === "port" ? ratio(a) < 0.9 : ratio(a) > 1.15));
  const pool = fits.length ? fits : list;
  const item = pool[hash(seed + "pick") % pool.length];
  const iiif = `https://www.artic.edu/iiif/2/${item.image_id}/full`;
  return {
    images: [`${iiif}/1686,/0/default.jpg`, `${iiif}/843,/0/default.jpg`], // 原图不够大时退而求其次
    title: plain(item.title),
    credit: [plain(item.artist_display), plain(item.date_display)].filter(Boolean).join("，"),
    link: Number.isInteger(item.id) ? `https://www.artic.edu/artworks/${item.id}` : "https://www.artic.edu/",
    maxAge: 7 * 86400,
  };
}

const SOURCES = { bing, wikimedia, art };

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
  const shape = url.searchParams.get("shape") === "port" ? "port" : "land";
  if (!Object.hasOwn(SOURCES, source)) return json({ error: "不认识的壁纸来源" }, 400);
  if (!/^[a-z0-9]{1,24}$/.test(seed)) return json({ error: "编号只能是 1~24 位小写字母或数字" }, 400);

  let found;
  try {
    found = await SOURCES[source](seed, shape, now);
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
