// IndexedDB 的简单封装：用来存上传的背景图片（localStorage 放不下图片）
const DB_NAME = "start-page";
const STORE = "images";

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null)); // 打开失败的话下次再试
  }
  return dbPromise;
}

async function run(mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 记录格式：{ id, blob, thumb(小缩略图的 data URL) } */
export const images = {
  get: (id) => run("readonly", (s) => s.get(id)),
  all: () => run("readonly", (s) => s.getAll()),
  put: (record) => run("readwrite", (s) => s.put(record)),
  delete: (id) => run("readwrite", (s) => s.delete(id)),
  clear: () => run("readwrite", (s) => s.clear()),
};
