// 搜索引擎、导航合并、设置校验的检查
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_ENGINES, AI_ENGINE, listEngines, buildSearchUrl, parseBang } from "../assets/js/engines.js";
import { normalizeSettings, defaultSettings, safeUrl, safeTemplate } from "../assets/js/store.js";
import { normalizeEntry, normalizeNavState, buildGroups, DEFAULT_GROUP } from "../assets/js/nav-model.js";
import navConfig from "../config/nav.js";
import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND, AI } from "../config/site.js";
import { ICONS } from "../assets/js/icons.js";

const engines = [...BUILTIN_ENGINES, AI_ENGINE];

test("搜索网址拼接", () => {
  const byId = (id) => engines.find((e) => e.id === id);
  assert.equal(buildSearchUrl(byId("google"), "a b&c"), "https://www.google.com/search?q=a%20b%26c");
  assert.equal(buildSearchUrl(byId("bing"), "天气"), "https://www.bing.com/search?q=%E5%A4%A9%E6%B0%94");
  assert.equal(buildSearchUrl(byId("baidu"), "x"), "https://www.baidu.com/s?wd=x");
  assert.equal(buildSearchUrl(byId("duckduckgo"), "x"), "https://duckduckgo.com/?q=x");
  assert.equal(buildSearchUrl({ url: "https://a.com/?q=%s&again=%s" }, "$&"), "https://a.com/?q=%24%26&again=%24%26");
});

test("!前缀直达", () => {
  assert.equal(parseBang("!g 关键词", engines).engine.id, "google");
  assert.equal(parseBang("!bd 关键词", engines).engine.id, "baidu");
  assert.equal(parseBang("!ai 问题", engines).engine.id, "ai");
  assert.equal(parseBang("!AI 问题", engines).engine.id, "ai");
  assert.equal(parseBang("!ddg  多个  空格 ", engines).query, "多个  空格");
  // 不认识的前缀、只有前缀没有内容、感叹号不在开头：都按普通关键词处理
  assert.deepEqual(parseBang("!xyz 关键词", engines), { engine: null, query: "!xyz 关键词" });
  assert.deepEqual(parseBang("!g", engines), { engine: null, query: "!g" });
  assert.deepEqual(parseBang("hello !g world", engines), { engine: null, query: "hello !g world" });
});

test("自定义引擎进入引擎列表，AI 排在最后", () => {
  const s = normalizeSettings({ search: { custom: [{ id: "c-abc", name: "GitHub", url: "https://github.com/search?q=%s", bang: "!GH" }] } });
  const list = listEngines(s);
  assert.deepEqual(list.map((e) => e.id), ["google", "bing", "baidu", "duckduckgo", "c-abc", "ai"]);
  assert.equal(parseBang("!gh x", list).engine.id, "c-abc");
});

test("网址安全检查", () => {
  assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeUrl("  http://example.com  "), "http://example.com");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " java\nscript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "//evil.com", "\\\\evil", "", null, 42, "https://"]) {
    assert.equal(safeUrl(bad, { allowRelative: true }), "", String(bad));
  }
  assert.equal(safeUrl("./about/", { allowRelative: true }), "./about/");
  assert.equal(safeUrl("about/"), ""); // 没有允许相对路径时不接受
  assert.equal(safeTemplate("https://a.com/?q=%s"), "https://a.com/?q=%s");
  assert.equal(safeTemplate("https://a.com/"), "");
  assert.equal(safeTemplate("javascript:%s"), "");
});

test("设置校验：乱七八糟的数据会被洗成合法设置", () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings("oops"), defaultSettings());
  const s = normalizeSettings({
    theme: "pink",
    linkTarget: "new",
    search: { engine: 5, history: "yes", custom: [{ id: "c-1", name: "", url: "https://a/?%s" }, { id: "bad id", name: "x", url: "https://a/?%s" }, "junk"] },
    widgets: null,
    bg: { type: "image", preset: "nope", blur: 999, dim: -5, color: { c1: "red", angle: 9999 }, images: [{ id: "u-1", kind: "upload", color: "#ABCDEF", lum: 5 }, { id: "l-1", kind: "url", url: "javascript:x" }, { id: "u-1", kind: "upload" }], current: "ghost" },
  });
  assert.equal(s.theme, "system");
  assert.equal(s.linkTarget, "new");
  assert.equal(s.search.engine, "google");
  assert.equal(s.search.history, true);
  assert.deepEqual(s.search.custom, []);
  assert.equal(s.widgets.clock, true);
  assert.equal(s.bg.preset, DEFAULT_BACKGROUND);
  assert.equal(s.bg.blur, 30);
  assert.equal(s.bg.dim, 0);
  assert.equal(s.bg.color.c1, defaultSettings().bg.color.c1);
  assert.equal(s.bg.color.angle, 360);
  assert.deepEqual(s.bg.images, [{ id: "u-1", kind: "upload", color: "#abcdef", lum: 1 }]);
  assert.equal(s.bg.current, "u-1");
  // 选了"图片"但一张图都没有 → 退回内置背景
  assert.equal(normalizeSettings({ bg: { type: "image" } }).bg.type, "preset");
});

test("设置校验：文字和在线壁纸", () => {
  const d = defaultSettings();
  assert.deepEqual(d.font, { family: "system", custom: "", scale: 100, weight: 400, clockScale: 100, clockWeight: 600 });
  assert.deepEqual(d.bg.online, { source: "picsum", url: "", every: "open" });
  // 越界的数值被拉回范围内，粗细取整到 100 的倍数
  const s = normalizeSettings({ font: { family: "kai", scale: 500, weight: 449, clockScale: 1, clockWeight: 951 }, bg: { type: "online", online: { source: "custom", url: "https://wall.example/a?w={w}", every: "hour" } } });
  assert.deepEqual(s.font, { family: "kai", custom: "", scale: 130, weight: 400, clockScale: 60, clockWeight: 900 });
  assert.equal(s.bg.type, "online");
  assert.deepEqual(s.bg.online, { source: "custom", url: "https://wall.example/a?w={w}", every: "hour" });
  // 自定义字体名里会破坏样式的字符被去掉；没填名字就退回系统默认
  assert.equal(normalizeSettings({ font: { family: "custom", custom: 'A"B\';} body{x:y' } }).font.custom, "AB bodyxy");
  assert.equal(normalizeSettings({ font: { family: "custom", custom: "  " } }).font.family, "system");
  assert.equal(normalizeSettings({ font: { family: "comic" } }).font.family, "system");
  // 自定义壁纸接口：地址不安全或没填 → 退回默认来源
  assert.equal(normalizeSettings({ bg: { online: { source: "custom", url: "javascript:alert(1)" } } }).bg.online.source, "picsum");
  assert.equal(normalizeSettings({ bg: { online: { every: "weekly" } } }).bg.online.every, "open");
  // 搜索框透明度：默认半透明，范围 0~100
  assert.equal(d.search.transparency, 50);
  assert.equal(normalizeSettings({ search: { transparency: 250 } }).search.transparency, 100);
  assert.equal(normalizeSettings({ search: { transparency: -3 } }).search.transparency, 0);
  assert.equal(normalizeSettings({ search: { transparency: "x" } }).search.transparency, 50);
});

test("导航：合并默认入口和本地改动", () => {
  const defaults = [
    { name: "甲", url: "https://a.example/", group: "一" },
    { name: "乙", url: "https://b.example/", group: "二" },
    { name: "丙", url: "https://c.example/", group: "一" },
    { name: "坏", url: "javascript:alert(1)", group: "一" },
    { name: "重复", url: "https://a.example/", group: "一" },
  ];
  const names = (groups) => groups.map((g) => `${g.name}:${g.items.map((i) => i.name).join(",")}`);
  // 没有本地改动：按配置文件的顺序，危险的和重复的被跳过
  assert.deepEqual(names(buildGroups(defaults, normalizeNavState(null))), ["一:甲,丙", "二:乙"]);

  const state = normalizeNavState({
    order: ["d:https://c.example/", "d:https://a.example/", "c:mine"],
    hidden: ["d:https://b.example/"],
    custom: [
      { id: "c:mine", name: "我的", url: "https://m.example/", group: "一", newTab: false },
      { id: "c:evil", name: "坏的", url: "javascript:alert(1)" },
      { id: "not-custom", name: "x", url: "https://x.example/" },
      { id: "c:nogroup", name: "没分组", url: "https://n.example/" },
    ],
  });
  assert.equal(state.custom.length, 2);
  // 排序生效；隐藏的不显示（整组空了就不显示这一组）；自定义入口合并进来
  assert.deepEqual(names(buildGroups(defaults, state)), ["一:丙,甲,我的", `${DEFAULT_GROUP}:没分组`]);
  // 编辑模式下隐藏的也列出来，并带标记
  const all = buildGroups(defaults, state, { includeHidden: true });
  assert.deepEqual(names(all), ["一:丙,甲,我的", "二:乙", `${DEFAULT_GROUP}:没分组`]);
  assert.equal(all[1].items[0].hidden, true);
  // 之后配置文件里新加的入口：排在本组后面，不打乱用户已经排好的顺序
  const later = [...defaults.slice(0, 3), { name: "新", url: "https://new.example/", group: "一" }];
  assert.deepEqual(names(buildGroups(later, state))[0], "一:丙,甲,我的,新");
  assert.equal(normalizeEntry({ name: "x", url: "./about/" }).newTab, true);
  assert.equal(normalizeEntry({ name: "x", url: "./about/", newTab: false }).newTab, false);
  // 图标底色：只接受 #rrggbb
  assert.equal(normalizeEntry({ name: "x", url: "./a/", color: "#5B5BD6" }).color, "#5b5bd6");
  assert.equal(normalizeEntry({ name: "x", url: "./a/", color: "red; background:url(x)" }).color, "");
});

test("配置文件本身没有问题", () => {
  assert.ok(Array.isArray(navConfig)); // 允许是空的（还没有接入入口）
  const ids = new Set();
  for (const raw of navConfig) {
    const entry = normalizeEntry(raw);
    assert.ok(entry, `入口不合法：${JSON.stringify(raw)}`);
    assert.ok(!ids.has(entry.id), `入口重复：${entry.name}`);
    ids.add(entry.id);
    assert.ok(raw.group, `入口没写分组：${entry.name}`);
    assert.ok(Object.hasOwn(ICONS, raw.icon) || /[/.]/.test(raw.icon) || Array.from(raw.icon).length <= 2, `图标不存在：${raw.icon}`);
    // 公开的配置文件里不放后台、管理面板这类私密入口
    assert.doesNotMatch(`${raw.name} ${raw.url} ${raw.desc || ""}`, /admin|后台|管理面板|dashboard|:\d{4,5}\//i, `疑似私密入口：${entry.name}`);
  }
  assert.equal(BACKGROUND_PRESETS.length, 3);
  assert.ok(BACKGROUND_PRESETS.some((p) => p.id === DEFAULT_BACKGROUND));
  for (const p of BACKGROUND_PRESETS) {
    assert.ok(p.css || p.image);
    assert.doesNotMatch(p.css || p.image, /https?:/, "内置背景不引用外链图片");
    assert.match(p.color, /^#[0-9a-f]{6}$/i);
  }
  // 配置里只有地址，没有任何密钥字段
  assert.deepEqual(Object.keys(AI).sort(), ["apiUrl", "model", "name", "pageUrl", "passwordDays"]);
});

// ---------- 自己填的 AI 接口 ----------
import { chatEndpoint, modelsEndpoint, userApi } from "../assets/js/ai/api.js";

test("AI 接口地址：填基础地址或完整地址都行", () => {
  assert.equal(chatEndpoint("https://api.deepseek.com"), "https://api.deepseek.com/chat/completions");
  assert.equal(chatEndpoint("https://api.deepseek.com/"), "https://api.deepseek.com/chat/completions");
  assert.equal(chatEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(chatEndpoint("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1/chat/completions");
  assert.equal(chatEndpoint("https://api.openai.com/v1/chat/completions/"), "https://api.openai.com/v1/chat/completions");
  // 带参数的地址（如某些云服务）当作已经写全了，原样使用
  assert.equal(chatEndpoint("https://x.example/openai/deployments/a/chat/completions?api-version=1"), "https://x.example/openai/deployments/a/chat/completions?api-version=1");
  assert.equal(modelsEndpoint("https://api.deepseek.com"), "https://api.deepseek.com/models");
  assert.equal(modelsEndpoint("https://api.openai.com/v1/"), "https://api.openai.com/v1/models");
  assert.equal(modelsEndpoint("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1/models");
});

test("AI 接口的保存：只接受 http(s) 地址，去掉首尾空格；地址和模型都有才算能用", () => {
  userApi.clear();
  assert.deepEqual(userApi.get(), { url: "", key: "", model: "" });
  assert.equal(userApi.ready(), false);
  assert.deepEqual(userApi.save({ url: "  https://api.deepseek.com ", key: " sk-abc ", model: " deepseek-chat " }), { url: "https://api.deepseek.com", key: "sk-abc", model: "deepseek-chat" });
  assert.equal(userApi.ready(), true);
  // 危险或不完整的内容不会被存成可用的接口
  assert.equal(userApi.save({ url: "javascript:alert(1)", key: "k", model: "m" }).url, "");
  assert.equal(userApi.ready(), false);
  assert.equal(userApi.save({ url: "https://a.example", key: "", model: "" }) && userApi.ready(), false);
  // 本机的 Ollama 不需要 Key
  userApi.save({ url: "http://localhost:11434/v1", key: "", model: "qwen2.5" });
  assert.equal(userApi.ready(), true);
  userApi.clear();
  assert.equal(userApi.ready(), false);
});
