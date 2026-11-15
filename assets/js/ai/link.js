// AI 的工作方式判断，以及"在 catgpt 中打开"的网址拼接
import { AI } from "../../../config/site.js";
import { safeUrl } from "../store.js";

const pageUrl = safeUrl(AI.pageUrl, { allowRelative: true });
const apiUrl = safeUrl(AI.apiUrl, { allowRelative: true });

export const aiConfig = { name: AI.name || "AI", pageUrl, apiUrl, model: typeof AI.model === "string" ? AI.model : "" };

/**
 * "embed"：在起始页里弹出对话面板，直接调用 catgpt 后端
 * "jump" ：没有配置接口地址，提问后直接跳转到 catgpt 页面
 * "none" ：两个地址都没配置
 */
export const aiMode = () => (apiUrl ? "embed" : pageUrl ? "jump" : "none");

/** catgpt 页面地址，带上 ?q=问题（catgpt 那边读到后自动发送） */
export function catgptUrl(question) {
  if (!pageUrl) return "";
  const url = new URL(pageUrl, location.href);
  if (question) url.searchParams.set("q", question);
  return url.href;
}
