// 自己填的 AI 接口：在"设置 → AI"里填上接口地址、API Key 和模型，起始页就直接调用它。
//
// 这三样只保存在这台设备的浏览器里：不在任何代码和配置文件里，"导出设置"不会带上它，
// 提问时由浏览器直接发给你填的接口地址，不经过本站的服务器。
//
// 支持的是"OpenAI 兼容"的对话接口（POST …/chat/completions）——
// DeepSeek、OpenAI、硅基流动、OpenRouter、Kimi、智谱、通义千问、本机的 Ollama 等都是这种。
import { readJSON, writeJSON, removeKey, safeUrl } from "../store.js";

const KEY = "sp:ai-api";
const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function normalize(raw) {
  return { url: safeUrl(clean(raw?.url, 500)), key: clean(raw?.key, 500), model: clean(raw?.model, 120) };
}

export const userApi = {
  /** 现在保存的内容 { url 接口地址, key API Key, model 模型 }，没填的是空字符串 */
  get: () => normalize(readJSON(KEY)),
  /** 接口地址和模型都填了才算能用（API Key 可以为空：本机的 Ollama 就不需要） */
  ready() {
    const { url, model } = userApi.get();
    return !!(url && model);
  },
  save(value) {
    const next = normalize(value);
    writeJSON(KEY, next);
    return next;
  },
  clear: () => removeKey(KEY),
};

/** 把填的地址补成"对话接口"的完整地址。填的可以是"https://api.deepseek.com"，也可以直接是完整地址 */
export function chatEndpoint(base) {
  if (base.includes("?")) return base; // 带参数的地址当作已经写全了，不动它
  const url = base.replace(/\/+$/, "");
  return /\/chat\/completions$/.test(url) ? url : `${url}/chat/completions`;
}

/** "有哪些模型可用"的地址 */
export function modelsEndpoint(base) {
  return base.split("?")[0].replace(/\/+$/, "").replace(/\/chat\/completions$/, "") + "/models";
}
