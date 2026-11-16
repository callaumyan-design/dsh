// AI 的工作方式判断，以及"在 catgpt 中打开"的网址拼接
import { AI } from "../../../config/site.js";
import { safeUrl } from "../store.js";
import { userApi, chatEndpoint } from "./api.js";

const pageUrl = safeUrl(AI.pageUrl, { allowRelative: true });
const apiUrl = safeUrl(AI.apiUrl, { allowRelative: true });

/** 站点配置（config/site.js）里的那一套：catgpt */
export const aiSite = { name: AI.name || "AI", pageUrl, apiUrl, model: typeof AI.model === "string" ? AI.model : "" };

/**
 * 现在 AI 用的是哪一套。自己在"设置 → AI"里填的接口优先，其次才是站点配置里的 catgpt。
 *   source: "user" 自己填的接口 | "site" 站点配置
 *   mode:   "embed" 在起始页里弹出对话面板，直接调用接口
 *           "jump"  只配置了 catgpt 的页面地址，提问后直接跳转过去
 *           "none"  什么都没配置
 */
export function aiSetup() {
  const mine = userApi.get();
  if (mine.url && mine.model) {
    return { source: "user", mode: "embed", name: mine.model, apiUrl: chatEndpoint(mine.url), model: mine.model, key: mine.key, pageUrl: "" };
  }
  return { source: "site", mode: apiUrl ? "embed" : pageUrl ? "jump" : "none", name: aiSite.name, apiUrl, model: aiSite.model, key: "", pageUrl };
}

export const aiMode = () => aiSetup().mode;

/** catgpt 页面地址，带上 ?q=问题（catgpt 那边读到后自动发送） */
export function catgptUrl(question) {
  if (!pageUrl) return "";
  const url = new URL(pageUrl, location.href);
  if (question) url.searchParams.set("q", question);
  return url.href;
}
