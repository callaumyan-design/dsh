// 天气的检查：天气代码转中文、读 Open-Meteo 的回复、城市的校验、搜城市（繁体转简体）
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { describeWeather, weatherLine, forecastUrl, parseForecast } from "../assets/js/weather.js";
import { parsePlaces, mergeReplies, searchPlaces } from "../assets/js/weather-places.js";
import { toSimplified, toTraditional } from "../assets/js/zh-hans.js";
import { normalizeSettings, defaultSettings, normalizePlace } from "../assets/js/store.js";
import { WEATHER_PLACE } from "../config/site.js";

const brisbane = { name: "布里斯班", area: "昆士兰州 · 澳大利亚", lat: -27.47, lon: 153.03 };

test("天气代码转中文", () => {
  assert.equal(describeWeather(0), "晴");
  assert.equal(describeWeather(2), "多云");
  assert.equal(describeWeather(3), "阴");
  assert.equal(describeWeather(63), "中雨");
  assert.equal(describeWeather(95), "雷阵雨");
  assert.equal(describeWeather(-1), "");
  assert.equal(describeWeather(42), "");
});

test("显示的那一句", () => {
  assert.equal(weatherLine(brisbane, { temp: 28.4, code: 2 }), "布里斯班 28° 多云");
  assert.equal(weatherLine(brisbane, { temp: 27.5, code: 0 }), "布里斯班 28° 晴");
  // 不认识的天气代码只显示温度；-0.3 度显示 0°，不显示 -0°
  assert.equal(weatherLine(brisbane, { temp: -0.3, code: -1 }), "布里斯班 0°");
  assert.equal(weatherLine(brisbane, { temp: -5.6, code: 71 }), "布里斯班 -6° 小雪");
});

test("请求地址只带城市的经纬度", () => {
  const url = new URL(forecastUrl(brisbane));
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "-27.47");
  assert.equal(url.searchParams.get("longitude"), "153.03");
  assert.equal(url.searchParams.get("current"), "temperature_2m,weather_code");
  assert.equal([...url.searchParams.keys()].length, 3);
});

test("读天气回复：格式不对的不用", () => {
  // Open-Meteo 实际返回的样子（节选）
  const real = { latitude: -27.5, longitude: 153, current_units: { temperature_2m: "°C" }, current: { time: "2026-11-17T14:00", interval: 900, temperature_2m: 28.1, weather_code: 3 } };
  assert.deepEqual(parseForecast(real), { temp: 28.1, code: 3 });
  assert.deepEqual(parseForecast({ current: { temperature_2m: 20, weather_code: null } }), { temp: 20, code: -1 });
  assert.equal(parseForecast(null), null);
  assert.equal(parseForecast({}), null);
  assert.equal(parseForecast({ error: true, reason: "Latitude must be in range" }), null);
  assert.equal(parseForecast({ current: { temperature_2m: "28" } }), null);
  assert.equal(parseForecast({ current: { temperature_2m: NaN } }), null);
  assert.equal(parseForecast({ current: { temperature_2m: 999 } }), null);
});

test("读城市搜索结果", () => {
  const data = {
    results: [
      { id: 2174003, name: "布里斯班", latitude: -27.46794, longitude: 153.02809, country: "澳大利亚", admin1: "昆士兰州" },
      { id: 1, name: "新加坡", latitude: 1.28967, longitude: 103.85007, country: "新加坡", admin1: "新加坡" },
      { id: 2, name: "布里斯班", latitude: -27.46794, longitude: 153.02809, country: "澳大利亚", admin1: "昆士兰州" }, // 重复的
      { id: 3, name: "坏数据", latitude: "x", longitude: 1 },
      { id: 4, name: "", latitude: 1, longitude: 1 },
      { id: 5, name: "Brisbane", latitude: 37.68, longitude: -122.4, country: "美国", admin1: "加利福尼亚州" },
      null,
    ],
  };
  assert.deepEqual(parsePlaces(data), [
    { name: "布里斯班", area: "昆士兰州 · 澳大利亚", lat: -27.47, lon: 153.03 },
    { name: "新加坡", area: "", lat: 1.29, lon: 103.85 },
    { name: "Brisbane", area: "加利福尼亚州 · 美国", lat: 37.68, lon: -122.4 },
  ]);
  // "香港"会同时返回地区和市区两条（没有省和国家），算同一个地方
  const hk = { results: [{ name: "香港", latitude: 22.27832, longitude: 114.17469, feature_code: "PCLS" }, { name: "香港", latitude: 22.27832, longitude: 114.17469, feature_code: "PPLC" }, { name: "香港", latitude: 23.6, longitude: 113.1, admin1: "广东", country: "中国" }] };
  assert.deepEqual(parsePlaces(hk), [{ name: "香港", area: "", lat: 22.28, lon: 114.17 }, { name: "香港", area: "广东 · 中国", lat: 23.6, lon: 113.1 }]); // 离得远的同名地方都留着
  // 什么都没找到时 Open-Meteo 不带 results
  assert.deepEqual(parsePlaces({ generationtime_ms: 0.5 }), []);
  assert.deepEqual(parsePlaces(null), []);
  const many = { results: Array.from({ length: 20 }, (_, i) => ({ name: `城${i}`, latitude: i, longitude: i })) };
  assert.equal(parsePlaces(many).length, 8);
});

test("设置里的城市：校验和默认值", () => {
  assert.deepEqual(normalizePlace(WEATHER_PLACE), brisbane);
  assert.deepEqual(defaultSettings().widgets, { clock: true, weather: true, place: brisbane });
  assert.equal(normalizePlace({ name: "x", lat: 91, lon: 0 }), null);
  assert.equal(normalizePlace({ name: "x", lat: 0, lon: -181 }), null);
  assert.equal(normalizePlace({ name: "  ", lat: 0, lon: 0 }), null);
  assert.equal(normalizePlace({ name: "x", lat: null, lon: 0 }), null);
  assert.deepEqual(normalizePlace({ name: " 东京 ", lat: 35.6895, lon: 139.69171, extra: "<script>" }), { name: "东京", area: "", lat: 35.69, lon: 139.69 });
  // 旧版设置（只有 clock）：天气默认开、用默认城市
  assert.deepEqual(normalizeSettings({ widgets: { clock: false } }).widgets, { clock: false, weather: true, place: brisbane });
  // 自己选过的城市保留；坏掉的城市退回默认
  const tokyo = { name: "东京", area: "东京都 · 日本", lat: 35.69, lon: 139.69 };
  assert.deepEqual(normalizeSettings({ widgets: { weather: false, place: tokyo } }).widgets, { clock: true, weather: false, place: tokyo });
  assert.deepEqual(normalizeSettings({ widgets: { place: { name: "x", lat: "1", lon: 2 } } }).widgets.place, brisbane);
});

test("繁简转换：地名转成简体；简体里也用的字不动", () => {
  assert.equal(toSimplified("東京"), "东京");
  assert.equal(toSimplified("倫敦 · 英格蘭"), "伦敦 · 英格兰");
  assert.equal(toSimplified("千葉縣"), "千叶县");
  assert.equal(toSimplified("臺北市"), "台北市");
  assert.equal(toSimplified("黃金海岸"), "黄金海岸");
  assert.equal(toSimplified("乾隆"), "乾隆"); // "乾"简体里也用，不转成"干"
  assert.equal(toSimplified("布里斯班 · State of Queensland"), "布里斯班 · State of Queensland");
  assert.equal(toTraditional("东京"), "東京");
  assert.equal(toTraditional("伦敦"), "倫敦");
  assert.equal(toTraditional("纽约"), "紐約");
  assert.equal(toTraditional("Tokyo"), "Tokyo");
});

test("搜到的城市一律显示简体，机场不列", () => {
  const data = {
    results: [
      { name: "東京", latitude: 35.6895, longitude: 139.69171, country: "日本", admin1: "东京都", feature_code: "PPLC", population: 8336599 },
      { name: "Tokyo Heliport", latitude: 35.63, longitude: 139.84, country: "日本", admin1: "千葉縣", feature_code: "AIRH" },
      { name: "布里斯班機場", latitude: -27.38, longitude: 153.12, country: "澳大利亚", admin1: "State of Queensland", feature_code: "AIRP" },
      { name: "Tōkyō Zan", latitude: 37.5, longitude: 139.2, country: "日本", admin1: "新潟縣", feature_code: "MT" },
    ],
  };
  assert.deepEqual(parsePlaces(data), [
    { name: "东京", area: "东京都 · 日本", lat: 35.69, lon: 139.69 },
    { name: "Tōkyō Zan", area: "新潟县 · 日本", lat: 37.5, lon: 139.2 },
  ]);
});

test("简体、繁体两次搜索合在一起：人口多的排前面", () => {
  const simp = { results: [{ name: "东京", population: 0, admin1: "江苏", id: 1 }, { name: "东京", population: 12000, admin1: "浙江", id: 2 }] };
  const trad = { results: [{ name: "東京", population: 8336599, admin1: "东京都", id: 3 }] };
  assert.deepEqual(mergeReplies([simp, trad]).results.map((r) => r.id), [3, 2, 1]);
  assert.equal(mergeReplies([simp]), simp); // 只搜了一次：保持对方的顺序
  // "北京"和"北京市"在同一个地方：只留一个
  assert.deepEqual(parsePlaces({ results: [{ name: "北京", latitude: 39.91, longitude: 116.4, admin1: "北京市", country: "中国" }, { name: "北京市", latitude: 40.0, longitude: 116.3, admin1: "北京市", country: "中国" }] }), [{ name: "北京", area: "中国", lat: 39.91, lon: 116.4 }]);
  assert.deepEqual(mergeReplies([simp, { error: true }]).results.map((r) => r.id), [2, 1]);
});

test("搜城市：中文用简体、繁体、加“市”各搜一次，英文只搜一次；部分失败照样出结果", async () => {
  const real = globalThis.fetch;
  const asked = [];
  const replies = {
    东京: { results: [{ name: "东京", latitude: 32.21, longitude: 119.29, country: "中国", admin1: "江苏", population: 0 }] },
    東京: { results: [{ name: "東京", latitude: 35.6895, longitude: 139.69171, country: "日本", admin1: "东京都", population: 8336599 }] },
    Tokyo: { results: [{ name: "東京", latitude: 35.6895, longitude: 139.69171, country: "日本", admin1: "东京都", population: 8336599 }] },
  };
  let failTrad = false;
  globalThis.fetch = async (url) => {
    const name = new URL(url).searchParams.get("name");
    asked.push(name);
    if (failTrad && name === "東京") return new Response("oops", { status: 500 });
    return new Response(JSON.stringify(replies[name] || {}), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await searchPlaces(" 东京 "), [
      { name: "东京", area: "东京都 · 日本", lat: 35.69, lon: 139.69 },
      { name: "东京", area: "江苏 · 中国", lat: 32.21, lon: 119.29 },
    ]);
    assert.deepEqual(asked, ["东京", "東京", "东京市", "東京市"]);
    asked.length = 0;
    // 输入繁体也一样
    await searchPlaces("東京");
    assert.deepEqual(asked, ["东京", "東京", "东京市", "東京市"]);
    asked.length = 0;
    // 本来就带"市"的：再去掉"市"搜一次；只有一个"市"字的不会去搜空的
    await searchPlaces("台北市");
    assert.deepEqual(asked, ["台北市", "臺北市", "台北", "臺北"]);
    asked.length = 0;
    await searchPlaces("市");
    assert.deepEqual(asked, ["市"]);
    asked.length = 0;
    assert.deepEqual(await searchPlaces("Tokyo"), [{ name: "东京", area: "东京都 · 日本", lat: 35.69, lon: 139.69 }]);
    assert.deepEqual(asked, ["Tokyo"]);
    // 繁体那次失败：其他的结果照样给
    failTrad = true;
    assert.deepEqual((await searchPlaces("东京")).map((p) => p.area), ["江苏 · 中国"]);
    // 都失败：报错
    globalThis.fetch = async () => new Response("oops", { status: 503 });
    await assert.rejects(searchPlaces("东京"), /天气服务暂时不可用（503）/);
    assert.deepEqual(await searchPlaces("   "), []);
  } finally {
    globalThis.fetch = real;
  }
});
