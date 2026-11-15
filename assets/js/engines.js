// 搜索引擎列表、网址拼接、"!前缀"解析。这个文件不碰页面，方便单独测试。

export const AI_ID = "ai";

// 内置引擎。mark 是圆形标记里显示的字（不使用各家商标图片）
export const BUILTIN_ENGINES = [
  { id: "google", name: "Google", mark: "G", url: "https://www.google.com/search?q=%s", bangs: ["g", "google"] },
  { id: "bing", name: "Bing", mark: "B", url: "https://www.bing.com/search?q=%s", bangs: ["b", "bing"] },
  { id: "baidu", name: "百度", mark: "度", url: "https://www.baidu.com/s?wd=%s", bangs: ["bd", "baidu"] },
  { id: "duckduckgo", name: "DuckDuckGo", mark: "D", url: "https://duckduckgo.com/?q=%s", bangs: ["d", "ddg"] },
];

export const AI_ENGINE = { id: AI_ID, name: "AI", ai: true, bangs: ["ai"] };

/** 全部引擎：内置 → 自定义 → AI */
export function listEngines(settings) {
  const custom = settings.search.custom.map((c) => ({
    id: c.id,
    name: c.name,
    mark: Array.from(c.name)[0].toUpperCase(),
    url: c.url,
    bangs: c.bang ? [c.bang] : [],
    custom: true,
  }));
  return [...BUILTIN_ENGINES, ...custom, AI_ENGINE];
}

/** 把关键词填进网址模板。关键词直接交给搜索引擎，不经过任何中间服务器 */
export function buildSearchUrl(engine, query) {
  return engine.url.replace(/%s/g, encodeURIComponent(query));
}

/**
 * 解析"!前缀 关键词"。例如 "!bd 天气" → 用百度搜"天气"。
 * 前缀不认识时返回 engine: null，整句话按普通关键词处理。
 */
export function parseBang(text, engines) {
  const m = /^!(\S+)\s+([\s\S]+)$/.exec(text.trim());
  if (m) {
    const bang = m[1].toLowerCase();
    const engine = engines.find((e) => e.bangs.includes(bang));
    if (engine) return { engine, query: m[2].trim() };
  }
  return { engine: null, query: text.trim() };
}
