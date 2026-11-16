// 背景：内置预设 / 纯色或渐变 / 图片（上传或链接，可随机切换）/ 在线随机壁纸
// 图片加载完成前只显示纯色占位，加载好了再淡入，不白屏、不闪烁。
import { BACKGROUND_PRESETS, WALLPAPER_API } from "../../config/site.js";
import { store, readJSON, writeJSON, safeUrl, uid } from "./store.js";
import { images } from "./idb.js";
import { $, h, toast } from "./ui.js";

const CACHE_KEY = "sp:bg-cache"; // 给 boot.js 用：下次打开时立刻还原
const LAST_KEY = "sp:bg-last"; // 上次随机到的图片，避免连续两次一样
const ONLINE_KEY = "sp:bg-online"; // 在线壁纸的轮换记录：{ seed 当前这张, next 预先下载好的下一张, at 换上的时间, credit 这张的出处, ... }
const ONLINE_PERIOD = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };
const MAX_SIDE = 2560; // 上传图片压缩后的最长边
const UNKNOWN_LUM = 0.15; // 外链图片读不到亮度，按"偏暗"处理（白字 + 阴影）
// 背景（算上暗度遮罩）亮度高于这个值时，时钟改用深色字。
// 0.19 是白字和深字对比度打平的分界点：两边都能保证约 4.4:1 以上。
const LIGHT_TONE_FROM = 0.19;

const root = document.documentElement;
let layers = [];
let active = -1; // 当前显示的是哪一层（-1 表示都没显示）
let shownKey = ""; // 当前显示内容的标识，没变化就不重复淡入
let token = 0; // 快速连续切换时，丢弃过期的加载结果
let objectUrl = ""; // 上传图片的临时地址，用完要释放
let sessionPick = ""; // 本次打开页面随机到的图片
let onlineSeed = ""; // 本次打开页面显示的在线壁纸编号
let onlineFailed = false; // 在线壁纸这次加载失败了（只提示一次）
let hideTimer = 0;

// ---------- 颜色计算 ----------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 相对亮度 0（黑）~ 1（白） */
function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// ---------- 把设置翻译成"要显示什么" ----------
export function presetById(id) {
  return BACKGROUND_PRESETS.find((p) => p.id === id) || BACKGROUND_PRESETS[0];
}

/** 当前应该显示的图片条目（考虑随机切换） */
function currentImage(bg) {
  if (!bg.images.length) return null;
  if (bg.random && bg.images.length > 1) {
    if (!bg.images.some((i) => i.id === sessionPick)) sessionPick = pickRandom(bg.images);
    return bg.images.find((i) => i.id === sessionPick);
  }
  return bg.images.find((i) => i.id === bg.current) || bg.images[0];
}

function pickRandom(list) {
  const last = readJSON(LAST_KEY, "");
  const pool = list.length > 1 ? list.filter((i) => i.id !== last) : list;
  const id = pool[Math.floor(Math.random() * pool.length)].id;
  writeJSON(LAST_KEY, id);
  return id;
}

// ---------- 在线壁纸 ----------
// 壁纸来源。api：由本站后台代取时用的名字；daily：每天自动换成"当天那一张"，不用手动换
export const ONLINE_SOURCES = [
  { id: "picsum", name: "随机摄影（Picsum）" },
  { id: "bing-today", name: "必应每日一图", api: "bing", daily: true },
  { id: "bing", name: "必应近期壁纸（随机）", api: "bing" },
  { id: "custom", name: "自定义接口" },
].filter((s) => !s.api || WALLPAPER_API); // 没有后台时，需要后台代取的来源不显示

const sourceOf = (online) => ONLINE_SOURCES.find((s) => s.id === online.source) || ONLINE_SOURCES[0];

/** 今天的日期编号，如 20261116（按访客自己的时区） */
function todaySeed() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 生成一个新的图片编号。必应近期只有 8 张，直接指定第几张，并避开刚看过的那张 */
function newSeed(sourceId, previous) {
  if (sourceId !== "bing") return uid();
  let seed;
  do seed = `i${Math.floor(Math.random() * 8)}`;
  while (seed === previous);
  return seed;
}

const onlineState = () => {
  const st = readJSON(ONLINE_KEY, null);
  return st && typeof st === "object" ? st : {};
};

/** 按屏幕方向和清晰度决定要多大的图：够清楚，又不至于太大太慢 */
function onlineSize() {
  if (window.innerHeight > window.innerWidth) return [1080, 1920];
  const pixels = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1);
  return pixels > 2200 ? [2560, 1440] : [1920, 1080];
}

/** 某个编号对应的图片地址。同一个编号永远是同一张图，所以可以提前下载、下次秒开 */
function onlineUrl(online, seed) {
  const [w, h] = onlineSize();
  const source = sourceOf(online);
  // 由本站后台代取的来源（必应）
  if (source.api) return `${WALLPAPER_API}?source=${source.api}&seed=${seed}&shape=${h > w ? "port" : "land"}`;
  if (source.id === "custom") {
    // 自定义接口：可以用 {w} {h} {seed} 占位；没写 {seed} 就在末尾加一个参数，保证"换一张"时地址不同
    const url = online.url.replace(/\{w\}/g, w).replace(/\{h\}/g, h);
    if (url.includes("{seed}")) return url.replace(/\{seed\}/g, seed);
    return url + (url.includes("?") ? "&" : "?") + "_=" + seed;
  }
  // Lorem Picsum：免费的随机摄影图片服务（照片来自 Unsplash 的公开作品）
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

/** 换上下一张：优先用已经提前下载好的那张 */
function rotateOnline(bg) {
  const st = onlineState();
  const sameSource = st.source === bg.online.source;
  onlineSeed = (sameSource && typeof st.next === "string" && st.next) || newSeed(bg.online.source, sameSource ? st.seed : "");
  writeJSON(ONLINE_KEY, { source: bg.online.source, seed: onlineSeed, next: "", at: Date.now() });
}

/** 本次打开页面该显示哪一张：按"多久换一张"的设置决定沿用还是换新 */
function currentOnlineSeed(bg) {
  if (sourceOf(bg.online).daily) return todaySeed(); // "每日一图"：永远是今天这张
  const st = onlineState();
  // 换了来源：之前记下的编号不再适用
  if (onlineSeed && st.source === bg.online.source) return onlineSeed;
  const every = bg.online.every;
  const due = every === "open" || (every !== "manual" && Date.now() - (Number(st.at) || 0) >= ONLINE_PERIOD[every]);
  if (st.source === bg.online.source && typeof st.seed === "string" && st.seed && !due) onlineSeed = st.seed;
  else rotateOnline(bg);
  return onlineSeed;
}

/** 趁空闲把下一张提前下载好，下次换图时就不用等 */
function preloadNextOnline() {
  const bg = store.get().bg;
  const source = sourceOf(bg.online);
  if (bg.type !== "online" || source.id === "custom" || source.daily || bg.online.every === "manual" || onlineState().next) return;
  const next = newSeed(source.id, onlineSeed);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => writeJSON(ONLINE_KEY, { ...onlineState(), next }); // 下载成功了才记下来
  img.src = onlineUrl(bg.online, next);
}

/** 从已加载的图片里取平均色和亮度，记下来：下次打开先显示这个颜色，时钟也知道该用白字还是深字 */
function rememberOnlineColor(img, src) {
  try {
    const { color, lum } = sampleColor(img);
    // 记下这是"哪个地址的图"的颜色：换了来源或换了图，旧的颜色就不再适用
    writeJSON(ONLINE_KEY, { ...onlineState(), color, lum, sampled: src });
    apply();
  } catch {
    /* 对方不允许读取图片内容，就按"偏暗"处理 */
  }
}

/** 手动"换一张"在线壁纸 */
export function nextOnlineWallpaper() {
  onlineFailed = false;
  rotateOnline(store.get().bg);
  apply();
}

// ---------- 壁纸出处（主页最底下的一行小字，设置面板里也会显示） ----------
let credit = null; // 现在这张壁纸的出处 { title 标题, credit 作者等说明, link 链接 }；没有就是 null
let creditKey = ""; // 它说的是哪一张
const creditListeners = new Set();
// Picsum 查不到具体是谁拍的时候，至少说明照片是从哪来的
const PICSUM_CREDIT = { title: "", credit: "照片来自 Lorem Picsum", link: "https://picsum.photos/" };

/** 订阅"壁纸出处"：一订阅就先收到当前的，之后每次变化都会收到 */
export function onCredit(fn) {
  creditListeners.add(fn);
  fn(credit);
}

function setCredit(key, value) {
  creditKey = key;
  credit = value;
  for (const fn of creditListeners) fn(value);
}

/** 把查到的出处洗干净：只留文字和 http(s) 链接；什么都没有就返回 null */
function cleanCredit(raw) {
  const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : "");
  const value = { title: text(raw?.title), credit: text(raw?.credit), link: safeUrl(raw?.link) };
  return value.title || value.credit ? value : null;
}

/** 查出这张壁纸的出处并显示。查过的会记下来，下次打开直接显示 */
async function loadCredit(view) {
  const want = view.credit;
  if (!want) return setCredit("", null);
  if (want.key === creditKey && credit) return;
  const saved = onlineState().credit;
  if (saved?.key === want.key && cleanCredit(saved)) {
    setCredit(want.key, cleanCredit(saved));
    if (!want.refresh) return; // "每日一图"当天也可能换图，所以还要再确认一次
  } else {
    setCredit(want.key, want.picsum ? PICSUM_CREDIT : null);
  }
  let data = null;
  try {
    const res = await fetch(want.url);
    if (res.ok) data = await res.json();
  } catch {
    /* 查不到就算了 */
  }
  if (creditKey !== want.key || !data || typeof data !== "object") return; // 等结果的时候又换了一张
  // Picsum 给的是摄影师名字和照片在 Unsplash 上的页面
  const value = cleanCredit(want.picsum ? { credit: typeof data.author === "string" && data.author.trim() ? `摄影：${data.author.trim()} · Unsplash` : "", link: data.url } : data);
  if (!value) return;
  setCredit(want.key, value);
  writeJSON(ONLINE_KEY, { ...onlineState(), credit: { key: want.key, ...value } });
}

function describe(bg) {
  if (bg.type === "online") {
    const seed = currentOnlineSeed(bg);
    const src = onlineUrl(bg.online, seed);
    const st = onlineState();
    const known = st.sampled === src && typeof st.color === "string";
    const source = sourceOf(bg.online);
    const creditKeyOf = `${source.id}:${seed}`;
    return {
      key: `o:${bg.online.source}:${bg.online.url}:${seed}`,
      src,
      online: true,
      // 去哪查这张图的出处：本站代取的来源问本站后台，Picsum 问它自己；自定义接口查不了
      credit: source.api
        ? { key: creditKeyOf, url: `${src}&info=1`, refresh: !!source.daily }
        : source.id === "picsum"
          ? { key: creditKeyOf, url: `https://picsum.photos/seed/${seed}/info`, picsum: true }
          : null,
      cors: bg.online.source !== "custom", // 除了自定义接口，其他来源都允许读取图片内容（用来取色）
      color: known ? st.color : "#1e293b",
      lum: known ? Number(st.lum) || 0 : UNKNOWN_LUM,
    };
  }
  if (bg.type === "color") {
    const { c1, c2, gradient, angle } = bg.color;
    const l1 = luminance(hexToRgb(c1));
    if (!gradient) return { key: `c:${c1}`, css: c1, color: c1, lum: l1 };
    const css = `linear-gradient(${angle}deg, ${c1}, ${c2})`;
    return { key: `g:${css}`, css, color: c1, lum: (l1 + luminance(hexToRgb(c2))) / 2 };
  }
  if (bg.type === "image") {
    const item = currentImage(bg);
    if (item?.kind === "upload") return { key: `u:${item.id}`, uploadId: item.id, color: item.color, lum: item.lum };
    if (item?.kind === "url") return { key: `l:${item.url}`, src: item.url, color: "#1e293b", lum: UNKNOWN_LUM };
  }
  const p = presetById(bg.preset);
  const lum = p.tone === "light" ? 0.8 : 0.15;
  if (p.image) return { key: `p:${p.id}`, src: p.image, color: p.color, lum };
  return { key: `p:${p.id}`, css: p.css, color: p.color, lum };
}

// ---------- 两层图片交替淡入 ----------
function crossfade(paint) {
  clearTimeout(hideTimer);
  const next = active === 0 ? 1 : 0;
  const nextEl = layers[next];
  const prevEl = active >= 0 ? layers[active] : null;
  paint(nextEl);
  if (!prevEl) {
    nextEl.classList.remove("no-anim");
    void nextEl.offsetWidth; // 强制浏览器先画一帧透明，再开始淡入
    nextEl.classList.add("is-on");
  } else if (next === 1) {
    // 新图在上层：淡入盖住旧图，结束后再把旧图撤掉
    nextEl.classList.remove("no-anim");
    void nextEl.offsetWidth;
    nextEl.classList.add("is-on");
    hideTimer = setTimeout(() => {
      prevEl.classList.add("no-anim");
      prevEl.classList.remove("is-on");
    }, 700);
  } else {
    // 新图在下层：先垫在下面，再让上层旧图淡出
    nextEl.classList.add("no-anim", "is-on");
    void nextEl.offsetWidth;
    prevEl.classList.remove("no-anim");
    prevEl.classList.remove("is-on");
  }
  active = next;
}

function loadImage(src, cors) {
  const img = new Image();
  img.decoding = "async";
  img.alt = "";
  if (cors) img.crossOrigin = "anonymous";
  img.src = src;
  return img.decode().then(() => img); // 等图片完全解码好再显示，避免一截一截地出现
}

/** 背景算上暗度遮罩后的实际亮度。遮罩是按"颜色值"压暗的，换算到亮度上大约是 (1 - 暗度) 的 2.4 次方 */
const dimmed = (lum, dim) => lum * (1 - dim / 100) ** 2.4;

/** 把亮度（考虑暗度遮罩后）换算成"时钟用白字还是深字" */
function toneFor(lum, dim) {
  return dimmed(lum, dim) >= LIGHT_TONE_FROM ? "light" : "dark";
}

/**
 * 搜索框里的文字用白字还是深字：搜索框是半透明的，
 * 实际看到的底色 = 它自己的底色（浅色主题是白、深色主题是深蓝黑）和透出来的背景按透明度混在一起。
 */
function searchToneFor(bgLum, alpha) {
  const glassLum = root.dataset.theme === "light" ? 1 : 0.008;
  const gray = (lum) => lum ** (1 / 2.2); // 亮度 → 大致的灰度值，混色要在灰度上算
  const mixed = (alpha * gray(glassLum) + (1 - alpha) * gray(bgLum)) ** 2.2;
  return mixed >= LIGHT_TONE_FROM ? "light" : "dark";
}

function showCss(css) {
  crossfade((el) => {
    el.replaceChildren();
    el.style.background = css;
  });
}

async function showImage(view, src, mine, onDone) {
  let img;
  let readable = !!view.cors;
  try {
    try {
      img = await loadImage(src, readable);
    } catch (err) {
      if (!readable) throw err;
      readable = false; // 对方不允许跨域读取时，退回普通加载（只是取不了色）
      img = await loadImage(src, false);
    }
  } catch {
    if (mine === token) imageFailed(view);
    onDone?.();
    return;
  }
  if (mine !== token) return onDone?.();
  // 直接把下载好的这张 <img> 放进图层，不再让浏览器按地址重新请求一次
  crossfade((el) => {
    el.style.background = "";
    el.replaceChildren(img);
  });
  if (view.online) {
    onlineFailed = false;
    if (readable) rememberOnlineColor(img, src);
    loadCredit(view);
    setTimeout(preloadNextOnline, 1500);
  }
  // 等淡入结束、旧图撤掉以后，再释放旧图的临时地址
  setTimeout(() => onDone?.(), 900);
}

function imageFailed(view) {
  if (!view.online) return toast("背景图片加载失败，先用纯色顶上");
  // 在线壁纸连不上（断网、被拦截等）：换成内置背景顶上，只提示一次
  const first = !onlineFailed;
  onlineFailed = true;
  setCredit("", null);
  const preset = presetById(store.get().bg.preset);
  if (preset.css) showCss(preset.css);
  apply(); // 占位色和时钟颜色改按内置背景来
  if (first) toast("在线壁纸暂时加载不了，先显示内置背景");
}

// ---------- 应用背景 ----------
async function apply() {
  const bg = store.get().bg;
  const view = describe(bg);
  if (view.online && onlineFailed) {
    // 在线壁纸没加载出来，屏幕上实际是内置背景：颜色按内置背景算
    const preset = presetById(bg.preset);
    view.color = preset.color;
    view.lum = preset.tone === "light" ? 0.8 : 0.15;
  }
  const tone = toneFor(view.lum, bg.dim);
  const searchAlpha = 1 - store.get().search.transparency / 100;
  const searchTone = searchToneFor(dimmed(view.lum, bg.dim), searchAlpha);

  root.style.setProperty("--search-alpha", String(searchAlpha));
  root.dataset.searchtone = searchTone;
  root.style.setProperty("--blur", bg.blur + "px");
  root.style.setProperty("--dim", String(bg.dim / 100));
  root.style.setProperty("--bg-base", view.color);
  root.dataset.bgtone = tone;
  // 这张壁纸有出处可查：在页面最底下给那行小字留出位置（先留好，字出来时图标就不会跳动）
  const hasCredit = !!view.credit && !onlineFailed;
  root.toggleAttribute("data-credit", hasCredit);
  if (!hasCredit) setCredit("", null);
  $('meta[name="theme-color"]')?.setAttribute("content", view.color);
  writeJSON(CACHE_KEY, { color: view.color, css: view.css || "", tone, blur: bg.blur, dim: bg.dim, searchAlpha, searchTone, credit: hasCredit });

  if (view.key === shownKey) return; // 只是调了模糊/暗度，画面内容没变
  shownKey = view.key;

  if (view.css) {
    token++;
    return showCss(view.css);
  }
  if (view.src) return showImage(view, view.src, ++token);

  // 上传的图片：从 IndexedDB 取出来
  const mine = ++token;
  let record = null;
  try {
    record = await images.get(view.uploadId);
  } catch {
    /* 读不到就当作没有 */
  }
  if (mine !== token) return;
  if (!record?.blob) {
    toast("找不到这张上传的图片，可能已被浏览器清理");
    return;
  }
  const old = objectUrl;
  objectUrl = URL.createObjectURL(record.blob);
  showImage(view, objectUrl, mine, () => old && URL.revokeObjectURL(old));
}

export function initBackground() {
  layers = [$("#bg-a"), $("#bg-b")];
  // boot.js 已经把上次的渐变画在第一层了：接管过来，后面按正常流程切换
  if (root.hasAttribute("data-bginstant")) {
    const cache = readJSON(CACHE_KEY, {});
    layers[0].style.background = cache.css || "";
    layers[0].classList.add("no-anim", "is-on");
    active = 0;
    const view = describe(store.get().bg);
    if (view.css === cache.css) shownKey = view.key;
    root.removeAttribute("data-bginstant");
    root.style.removeProperty("--bg-instant");
  }
  // 主页最底下的"壁纸出处"
  const creditEl = $("#wall-credit");
  onCredit((value) => {
    if (!creditEl) return;
    const text = value ? [value.title, value.credit].filter(Boolean).join(" · ") : "";
    creditEl.replaceChildren(text && value.link ? h("a", { href: value.link, target: "_blank", rel: "noopener noreferrer", title: "查看这张壁纸的出处" }, text) : text);
    creditEl.hidden = !text;
  });
  apply();
  store.subscribe(apply);
  // 系统在深色 / 浅色之间切换时，搜索框的底色跟着变，文字颜色要重新判断（等主题先切换完）
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => setTimeout(apply, 0));
}

/** 现在显示的是哪张图片（设置面板里用来高亮） */
export function shownImageId() {
  const bg = store.get().bg;
  return bg.type === "image" ? currentImage(bg)?.id || "" : "";
}

/** 随机模式下手动"换一张" */
export function shuffleBackground() {
  const bg = store.get().bg;
  if (bg.images.length < 2) return;
  writeJSON(LAST_KEY, shownImageId());
  sessionPick = pickRandom(bg.images);
  // 通过设置仓库更新，这样背景和设置面板里的高亮会一起刷新
  store.update((s) => (s.bg.current = sessionPick));
}

/** 指定显示某张图片 */
export function selectImage(id) {
  sessionPick = id;
  store.update((s) => {
    s.bg.type = "image";
    s.bg.current = id;
  });
}

// ---------- 上传与压缩 ----------
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* 某些格式不支持，退回 <img> 方式 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  return canvas;
}

/** 压缩一张图片，并算出占位色、亮度和缩略图 */
async function compress(file) {
  const source = await loadBitmap(file);
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  if (!w || !h) throw new Error("empty image");
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = drawScaled(source, Math.round(w * scale), Math.round(h * scale));

  // 优先 WebP（体积小）；浏览器不支持时会悄悄给出 PNG，这时改用 JPEG
  let blob = await canvasToBlob(canvas, "image/webp", 0.82);
  if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (!blob) throw new Error("encode failed");
  // 原图本来就不大、压完反而变大的话，直接用原图
  if (scale === 1 && file.size <= blob.size && /^image\/(jpeg|png|webp)$/.test(file.type)) blob = file;

  const small = drawScaled(canvas, 240, Math.max(1, Math.round((240 * canvas.height) / canvas.width)));
  const thumb = small.toDataURL("image/jpeg", 0.7);

  const { color, lum } = sampleColor(small);
  source.close?.();
  return { blob, thumb, color, lum };
}

/** 缩到 16x16 取平均色：整体平均色做占位色，上半部分的亮度决定时钟用白字还是深字 */
function sampleColor(source) {
  // 先缩到 240 宽再缩到 16x16，比一步缩到位取到的颜色更准
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const small = w > 240 ? drawScaled(source, 240, Math.max(1, Math.round((240 * h) / w))) : source;
  const tiny = drawScaled(small, 16, 16).getContext("2d").getImageData(0, 0, 16, 16).data;
  const sum = [0, 0, 0];
  let topLum = 0;
  for (let i = 0; i < 256; i++) {
    const px = [tiny[i * 4], tiny[i * 4 + 1], tiny[i * 4 + 2]];
    sum[0] += px[0];
    sum[1] += px[1];
    sum[2] += px[2];
    if (i < 160) topLum += luminance(px);
  }
  return { color: toHex(sum.map((v) => v / 256)), lum: topLum / 160 };
}

/** 上传本地图片（可多选）。返回成功和失败的数量 */
export async function addUploads(files) {
  let ok = 0;
  let failed = 0;
  let lastId = "";
  const added = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      failed++;
      continue;
    }
    try {
      const { blob, thumb, color, lum } = await compress(file);
      const id = uid("u-");
      await images.put({ id, blob, thumb });
      added.push({ id, kind: "upload", color, lum });
      lastId = id;
      ok++;
    } catch {
      failed++;
    }
  }
  if (added.length) {
    sessionPick = lastId;
    store.update((s) => {
      s.bg.images.push(...added);
      s.bg.type = "image";
      s.bg.current = lastId;
    });
  }
  return { ok, failed };
}

/** 添加一个图片链接 */
export function addImageUrl(value) {
  const url = safeUrl(value);
  if (!url) return false;
  const id = uid("l-");
  sessionPick = id;
  store.update((s) => {
    s.bg.images.push({ id, kind: "url", url });
    s.bg.type = "image";
    s.bg.current = id;
  });
  return true;
}

export async function removeImage(id) {
  const item = store.get().bg.images.find((i) => i.id === id);
  if (!item) return;
  store.update((s) => {
    s.bg.images = s.bg.images.filter((i) => i.id !== id);
  });
  if (item.kind === "upload") {
    try {
      await images.delete(id);
    } catch {
      /* 忽略 */
    }
  }
}

/** 取缩略图地址（上传的图片存的是小图 data URL，链接图片直接用原地址） */
export async function thumbFor(item) {
  if (item.kind === "url") return item.url;
  try {
    return (await images.get(item.id))?.thumb || "";
  } catch {
    return "";
  }
}
