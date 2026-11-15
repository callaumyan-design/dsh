// 背景：内置预设 / 纯色或渐变 / 图片（上传或链接，可随机切换）
// 图片加载完成前只显示纯色占位，加载好了再淡入，不白屏、不闪烁。
import { BACKGROUND_PRESETS } from "../../config/site.js";
import { store, readJSON, writeJSON, safeUrl, uid } from "./store.js";
import { images } from "./idb.js";
import { $, toast } from "./ui.js";

const CACHE_KEY = "sp:bg-cache"; // 给 boot.js 用：下次打开时立刻还原
const LAST_KEY = "sp:bg-last"; // 上次随机到的图片，避免连续两次一样
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

function describe(bg) {
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

const cssUrl = (src) => `url("${src.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

async function showImage(src, mine, onDone) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  try {
    await img.decode(); // 等图片完全解码好再显示，避免一截一截地出现
  } catch {
    if (mine === token) toast("背景图片加载失败，先用纯色顶上");
    onDone?.();
    return;
  }
  if (mine !== token) return onDone?.();
  crossfade((el) => {
    el.style.background = "";
    el.style.backgroundImage = cssUrl(src);
  });
  // 等淡入结束、旧图撤掉以后，再释放旧图的临时地址
  setTimeout(() => onDone?.(), 900);
}

// ---------- 应用背景 ----------
async function apply() {
  const bg = store.get().bg;
  const view = describe(bg);
  const tone = view.lum * (1 - bg.dim / 100) >= LIGHT_TONE_FROM ? "light" : "dark";

  root.style.setProperty("--blur", bg.blur + "px");
  root.style.setProperty("--dim", String(bg.dim / 100));
  root.style.setProperty("--bg-base", view.color);
  root.dataset.bgtone = tone;
  $('meta[name="theme-color"]')?.setAttribute("content", view.color);
  writeJSON(CACHE_KEY, { color: view.color, css: view.css || "", tone, blur: bg.blur, dim: bg.dim });

  if (view.key === shownKey) return; // 只是调了模糊/暗度，画面内容没变
  shownKey = view.key;

  if (view.css) {
    token++;
    crossfade((el) => {
      el.style.backgroundImage = "";
      el.style.background = view.css;
    });
    return;
  }
  if (view.src) return showImage(view.src, ++token);

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
  showImage(objectUrl, mine, () => old && URL.revokeObjectURL(old));
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
  apply();
  store.subscribe(apply);
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
  apply();
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

  // 缩到 16x16 取平均色：整体平均色做占位色，上半部分的亮度决定时钟用白字还是深字
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
  source.close?.();
  return { blob, thumb, color: toHex(sum.map((v) => v / 256)), lum: topLum / 160 };
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
