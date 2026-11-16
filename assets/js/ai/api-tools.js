// "设置 → AI"里用到的工具：常见服务商的地址、测试接口能不能用、读取可用的模型列表。
// 只在打开设置面板时才加载。
import { chatEndpoint, modelsEndpoint } from "./api.js";

/** 常见服务商：选了以后自动填好接口地址（模型名很固定的，顺便把模型也填上） */
export const AI_PRESETS = [
  { id: "deepseek", name: "DeepSeek", url: "https://api.deepseek.com", model: "deepseek-chat" },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1", model: "" },
  { id: "siliconflow", name: "硅基流动", url: "https://api.siliconflow.cn/v1", model: "" },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "" },
  { id: "moonshot", name: "月之暗面 Kimi", url: "https://api.moonshot.cn/v1", model: "" },
  { id: "zhipu", name: "智谱", url: "https://open.bigmodel.cn/api/paas/v4", model: "" },
  { id: "dashscope", name: "通义千问（阿里云百炼）", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "" },
  { id: "ollama", name: "本机的 Ollama", url: "http://localhost:11434/v1", model: "" },
];

const TIMEOUT = 30000;

/** 发一个请求，超时就放弃。连不上时抛出一句人能看懂的话 */
async function request(url, key, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const headers = { Accept: "application/json", ...init.headers };
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    return await fetch(url, { ...init, headers, signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    throw new Error(controller.signal.aborted ? "等了 30 秒，这个地址一直没有回应。" : "连不上这个地址。可能是地址填错了、网络不通，或者这个服务不允许网页直接调用。");
  } finally {
    clearTimeout(timer);
  }
}

/** 接口报错时，把它自己的说明取出来（一般在 error.message 里） */
async function reasonOf(res) {
  try {
    const data = JSON.parse((await res.text()).slice(0, 4000));
    const e = data?.error;
    const text = typeof e === "string" ? e : typeof e?.message === "string" ? e.message : typeof data?.message === "string" ? data.message : "";
    return text.replace(/\s+/g, " ").trim().slice(0, 160);
  } catch {
    return "";
  }
}

/** 把接口返回的状态码说成人话 */
async function explain(res) {
  const reason = await reasonOf(res);
  const base =
    res.status === 401 || res.status === 403
      ? "API Key 不对，或者没有权限。"
      : res.status === 402
        ? "账户余额不足。"
        : res.status === 404
          ? "接口地址或模型名不对。"
          : res.status === 429
            ? "请求太频繁，或者额度用完了。"
            : `接口出错了（${res.status}）。`;
  return reason ? `${base}（对方的说明：${reason}）` : base;
}

const testBody = (model) => JSON.stringify({ model, messages: [{ role: "user", content: "你好" }], max_tokens: 8, stream: false });
const postJson = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body });

/**
 * 测试接口能不能用：发一句很短的"你好"。
 * 成功返回最终可用的接口地址（如果地址少写了 /v1，会自动补上再试一次）；失败抛出一句说明。
 */
export async function testApi({ url, key, model }) {
  let res = await request(chatEndpoint(url), key, postJson(testBody(model)));
  if (res.ok) return url;
  // 很多服务的地址要以 /v1 结尾。填的地址后面什么都没有、又返回 404 时，补上 /v1 再试一次
  let path = "";
  try {
    path = new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    /* 地址在保存时已经检查过，这里不会走到 */
  }
  if (res.status === 404 && path === "") {
    const withV1 = url.replace(/\/+$/, "") + "/v1";
    const retry = await request(chatEndpoint(withV1), key, postJson(testBody(model))).catch(() => null);
    if (retry?.ok) return withV1;
    // 补上 /v1 以后不再是"找不到"了：说明地址就该带 /v1，出的是别的问题（比如 Key 不对），按这次的结果来说明
    if (retry && retry.status !== 404) res = retry;
  }
  throw new Error(await explain(res));
}

/** 读取这个接口有哪些模型可用（按名字排序）。读不到时抛出一句说明 */
export async function fetchModels({ url, key }) {
  const res = await request(modelsEndpoint(url), key);
  if (!res.ok) throw new Error(await explain(res));
  const data = await res.json().catch(() => null);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  const ids = list.map((m) => (typeof m === "string" ? m : typeof m?.id === "string" ? m.id : typeof m?.name === "string" ? m.name : "")).filter(Boolean);
  if (!ids.length) throw new Error("这个接口没有给出模型列表，请手动填写模型名。");
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, 300);
}
