// 天气的检查：天气代码转中文、读 Open-Meteo 的回复、城市的校验
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { describeWeather, weatherLine, forecastUrl, parseForecast } from "../assets/js/weather.js";
import { parsePlaces } from "../assets/js/weather-places.js";
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
  const hk = { results: [{ name: "香港", latitude: 22.27832, longitude: 114.17469, feature_code: "PCLS" }, { name: "香港", latitude: 22.27832, longitude: 114.17469, feature_code: "PPLC" }, { name: "香港", latitude: 22.5, longitude: 114.1, admin1: "广东", country: "中国" }] };
  assert.deepEqual(parsePlaces(hk), [{ name: "香港", area: "", lat: 22.28, lon: 114.17 }, { name: "香港", area: "广东 · 中国", lat: 22.5, lon: 114.1 }]);
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
