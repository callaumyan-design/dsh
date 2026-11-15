// 入口的"能不能访问"检测。
// 原则：宁可显示"未知"，也不把一个其实正常的网站误报成"离线"。
//
// - 站内地址：能读到真实的响应状态，结果是确定的（可访问 / 无法访问）。
// - 站外地址：浏览器出于安全限制（跨域）不让读响应内容，只能知道"对方有没有回应"。
//   有回应 → 可访问；没回应 → 可能是离线，也可能只是被浏览器或插件拦了，所以算"未知"。

const TIMEOUT_MS = 8000;

export const STATUS_TEXT = {
  checking: "检测中",
  online: "可访问",
  offline: "无法访问",
  unknown: "未知（跨站无法判断）",
};

async function probe(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // cache: "no-store" 保证每次都是真的去问服务器，而不是读缓存
    return await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal, ...init });
  } finally {
    clearTimeout(timer);
  }
}

/** 返回 "online" | "offline" | "unknown" */
export async function checkStatus(entry) {
  if (navigator.onLine === false) return "unknown"; // 自己断网了，谁都判断不了
  let target;
  try {
    target = new URL(entry.statusUrl || entry.url, location.href);
  } catch {
    return "unknown";
  }
  if (!/^https?:$/.test(target.protocol)) return "unknown";

  if (target.origin === location.origin) {
    try {
      let res = await probe(target, { method: "HEAD" });
      if (res.status === 405 || res.status === 501) res = await probe(target, { method: "GET" }); // 个别服务器不支持 HEAD
      return res.ok ? "online" : "offline";
    } catch {
      return "offline";
    }
  }

  // 专门指定了检测地址（statusUrl）且对方允许跨域读取时，可以得到确定结果
  if (entry.statusUrl) {
    try {
      const res = await probe(target, { method: "GET", mode: "cors" });
      return res.ok ? "online" : "offline";
    } catch {
      /* 对方不允许跨域读取，退回下面的方式 */
    }
  }
  try {
    await probe(target, { method: "HEAD", mode: "no-cors" });
    return "online"; // 对方有回应
  } catch {
    return "unknown"; // 没回应，但原因不明，不误报离线
  }
}
