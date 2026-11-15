// 设置的导出 / 导入（换设备时用）。导出的是一个 JSON 文件。
// 不会导出：搜索历史、AI 访问密码。
import { store } from "./store.js";
import { navState } from "./nav.js";
import { images } from "./idb.js";

const APP = "start-page";
const IMAGE_DATA = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const THUMB_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const m = IMAGE_DATA.exec(dataUrl);
  if (!m) return null;
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** 生成导出内容。withImages 为 false 时不带上传的背景图片（文件会小很多） */
export async function buildExport(withImages) {
  const settings = structuredClone(store.get());
  const out = { app: APP, version: 1, exportedAt: new Date().toISOString(), settings, nav: navState.get() };
  if (!withImages) {
    settings.bg.images = settings.bg.images.filter((i) => i.kind !== "upload");
    return out;
  }
  out.images = [];
  for (const item of settings.bg.images) {
    if (item.kind !== "upload") continue;
    const record = await images.get(item.id).catch(() => null);
    if (record?.blob) out.images.push({ id: item.id, data: await blobToDataUrl(record.blob), thumb: record.thumb || "" });
  }
  return out;
}

/** 导入：整体替换当前的设置和导航改动。文件格式不对会抛出错误 */
export async function applyImport(data) {
  if (!data || typeof data !== "object" || data.app !== APP || !data.settings || typeof data.settings !== "object") {
    throw new Error("not a start-page export");
  }
  // 先把文件里带的图片存进 IndexedDB
  for (const img of Array.isArray(data.images) ? data.images.slice(0, 60) : []) {
    if (!img || typeof img.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(img.id) || typeof img.data !== "string") continue;
    const blob = dataUrlToBlob(img.data);
    if (!blob) continue;
    const thumb = typeof img.thumb === "string" && img.thumb.length < 300000 && THUMB_DATA.test(img.thumb) ? img.thumb : "";
    await images.put({ id: img.id, blob, thumb });
  }
  // 设置里提到、但实际没有图片数据的"上传图片"要去掉，免得显示空白
  const stored = new Set((await images.all().catch(() => [])).map((r) => r.id));
  const settings = structuredClone(data.settings);
  if (settings.bg && Array.isArray(settings.bg.images)) {
    settings.bg.images = settings.bg.images.filter((i) => i && (i.kind !== "upload" || stored.has(i.id)));
  }
  store.replace(settings);
  navState.set(data.nav);
  await pruneImages();
}

/** 删除 IndexedDB 里已经没有被设置引用的图片，回收空间 */
export async function pruneImages() {
  try {
    const used = new Set(store.get().bg.images.map((i) => i.id));
    for (const record of await images.all()) {
      if (!used.has(record.id)) await images.delete(record.id);
    }
  } catch {
    /* 清理失败不要紧 */
  }
}
