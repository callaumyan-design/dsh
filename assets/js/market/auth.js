// 行情接口的访问口令：验证通过后只保存在这台设备的浏览器里，到期自动失效，不会被"导出设置"带走。
// 口令本身存在 Cloudflare 的密钥 QUOTES_TOKEN 里，代码和配置文件里都没有。
import { AI } from "../../../config/site.js";
import { readJSON, writeJSON, removeKey } from "../store.js";

const KEY = "sp:quotes-auth";
const DAY = 24 * 60 * 60 * 1000;

/** 记住多少天：和 AI 访问密码一样（config/site.js 里的 passwordDays） */
export const tokenDays = Number(AI.passwordDays) > 0 ? Math.round(Number(AI.passwordDays)) : 30;

function load() {
  const data = readJSON(KEY);
  if (!data || typeof data.t !== "string" || typeof data.exp !== "number") return null;
  if (Date.now() > data.exp) {
    removeKey(KEY);
    return null;
  }
  return data;
}

export const quotesAuth = {
  get: () => load()?.t || "",
  daysLeft: () => {
    const data = load();
    return data ? Math.max(1, Math.ceil((data.exp - Date.now()) / DAY)) : 0;
  },
  save: (token) => writeJSON(KEY, { t: token, exp: Date.now() + tokenDays * DAY }),
  clear: () => removeKey(KEY),
};
