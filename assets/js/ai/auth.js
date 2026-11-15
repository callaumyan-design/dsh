// AI 访问密码：验证通过后只保存在这台设备的浏览器里，到期自动失效。
// 注意：这是"访问 catgpt 的口令"，不是 API Key —— API Key 永远只在 catgpt 的服务端。
import { AI } from "../../../config/site.js";
import { readJSON, writeJSON, removeKey } from "../store.js";

const KEY = "sp:ai-auth";
const DAY = 24 * 60 * 60 * 1000;

function load() {
  const data = readJSON(KEY);
  if (!data || typeof data.p !== "string" || typeof data.exp !== "number") return null;
  if (Date.now() > data.exp) {
    removeKey(KEY); // 过期了就删掉
    return null;
  }
  return data;
}

/** 密码记住多少天（在 config/site.js 里改） */
export const passwordDays = Number(AI.passwordDays) > 0 ? Math.round(Number(AI.passwordDays)) : 30;

export const aiAuth = {
  get: () => load()?.p || "",
  /** 还剩多少天过期；没有保存密码时返回 0 */
  daysLeft: () => {
    const data = load();
    return data ? Math.max(1, Math.ceil((data.exp - Date.now()) / DAY)) : 0;
  },
  save(password) {
    writeJSON(KEY, { p: password, exp: Date.now() + passwordDays * DAY });
  },
  clear: () => removeKey(KEY),
};
