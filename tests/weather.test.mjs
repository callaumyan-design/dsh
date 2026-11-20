// 天气的检查：天气代码转中文、读 Open-Meteo 的回复、从 OpenStreetMap 的回复里挑城市名、繁体转简体、设置校验
// 运行方法：在仓库根目录执行  node --test
import test from "node:test";
import assert from "node:assert/strict";
import { describeWeather, weatherLine, forecastUrl, parseForecast } from "../assets/js/weather.js";
import { reverseUrl, pickCityName, tidyName } from "../assets/js/weather-where.js";
import { toSimplified } from "../assets/js/zh-hans.js";
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
  // 还没查到地名：只有温度和天气
  assert.equal(weatherLine({ name: "", lat: 1, lon: 1 }, { temp: 20, code: 3 }), "20° 阴");
});

test("请求地址只带大致位置（两位小数）", () => {
  const url = new URL(forecastUrl({ lat: -27.4975, lon: 153.0137 }));
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "-27.50");
  assert.equal(url.searchParams.get("longitude"), "153.01");
  assert.equal(url.searchParams.get("current"), "temperature_2m,weather_code");
  assert.equal([...url.searchParams.keys()].length, 3);
  const rev = new URL(reverseUrl(-27.4975, 153.0137));
  assert.equal(rev.origin + rev.pathname, "https://nominatim.openstreetmap.org/reverse");
  assert.equal(rev.searchParams.get("lat"), "-27.50");
  assert.equal(rev.searchParams.get("lon"), "153.01");
  assert.equal(rev.searchParams.get("zoom"), "10");
  assert.equal(rev.searchParams.get("accept-language"), "zh-CN,zh,en");
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

// OpenStreetMap（Nominatim，zoom=10，accept-language=zh-CN）真实返回的样子（节选）
const OSM = {
  uq: { name: "布里斯班", address: { city: "布里斯班", state: "昆士兰州", "ISO3166-2-lvl4": "AU-QLD", country: "澳大利亚;澳洲", country_code: "au" } },
  goldCoast: { name: "黄金海岸", address: { city: "黄金海岸", state: "昆士兰州", "ISO3166-2-lvl4": "AU-QLD", country: "澳大利亚;澳洲" } },
  tokyo: { name: "新宿区", address: { city: "新宿区", "ISO3166-2-lvl4": "JP-13", postcode: "160-8484", country: "日本" } },
  taipei: { name: "信義區", address: { suburb: "信義區", village: "信義商圈", city: "臺北市", "ISO3166-2-lvl4": "TW-TPE", country: "臺灣" } },
  hongKong: { name: "灣仔區", address: { suburb: "灣仔區", city_district: "香港島", city: "香港", region: "香港", "ISO3166-2-lvl3": "CN-HK", country: "中国" } },
  shanghai: { name: "南京东路街道", address: { suburb: "南京东路街道", city: "上海市", state: "上海市", "ISO3166-2-lvl4": "CN-SH", country: "中国" } },
  beijing: { name: "东华门街道", address: { suburb: "东华门街道", city: "东城区", "ISO3166-2-lvl4": "CN-BJ", country: "中国" } },
  london: { name: "City of Westminster", address: { city: "City of Westminster", "ISO3166-2-lvl8": "GB-WSM", state: "英格兰;英格蘭", country: "英国;英國" } },
  newYork: { name: "Manhattan", address: { suburb: "Manhattan", county: "New York County", city: "纽约;紐約", state: "纽约州;紐約州", country: "美国;美國" } },
  village: { name: "Yuleba", address: { village: "Yuleba", state: "昆士兰州", country: "澳大利亚;澳洲" } },
  bigLondon: { name: "大倫敦;大伦敦", address: { city: "大倫敦;大伦敦", state: "英格兰;英格蘭", country: "英国;英國" } },
};
const cityOf = (data) => tidyName(toSimplified(pickCityName(data)));

test("从 OpenStreetMap 的回复里挑城市名，转成简体", () => {
  assert.equal(cityOf(OSM.uq), "布里斯班");
  assert.equal(cityOf(OSM.goldCoast), "黄金海岸");
  assert.equal(cityOf(OSM.tokyo), "东京"); // 给的是区名，换成城市名
  assert.equal(cityOf(OSM.beijing), "北京");
  assert.equal(cityOf(OSM.shanghai), "上海");
  assert.equal(cityOf(OSM.taipei), "台北"); // 臺北市 → 台北
  assert.equal(cityOf(OSM.hongKong), "香港");
  assert.equal(cityOf(OSM.newYork), "纽约"); // "纽约;紐約" 取第一种
  assert.equal(cityOf(OSM.bigLondon), "大伦敦"); // 第一种是繁体，转成简体
  assert.equal(cityOf(OSM.london), "City of Westminster"); // 没有中文名的保留英文
  assert.equal(cityOf(OSM.village), "Yuleba"); // 没有"城市"一级，用村镇名
  assert.equal(pickCityName({}), "");
  assert.equal(pickCityName(null), "");
  assert.equal(pickCityName({ error: "Unable to geocode" }), "");
  assert.equal(pickCityName({ address: { country: "" } }), "");
});

test("繁简转换：地名转成简体；简体里也用的字不动", () => {
  assert.equal(toSimplified("東京"), "东京");
  assert.equal(toSimplified("倫敦 · 英格蘭"), "伦敦 · 英格兰");
  assert.equal(toSimplified("千葉縣"), "千叶县");
  assert.equal(toSimplified("臺北市"), "台北市");
  assert.equal(toSimplified("黃金海岸"), "黄金海岸");
  assert.equal(toSimplified("乾隆"), "乾隆"); // "乾"简体里也用，不转成"干"
  assert.equal(toSimplified("Brisbane City"), "Brisbane City");
  assert.equal(tidyName("台北市"), "台北");
  assert.equal(tidyName("市"), "市");
  assert.equal(tidyName("Brisbane City"), "Brisbane City");
});

test("设置：天气开关；默认城市", () => {
  assert.deepEqual(normalizePlace(WEATHER_PLACE), brisbane);
  assert.deepEqual(defaultSettings().widgets, { clock: true, weather: true });
  assert.equal(normalizePlace({ name: "x", lat: 91, lon: 0 }), null);
  assert.equal(normalizePlace({ name: "x", lat: 0, lon: -181 }), null);
  assert.equal(normalizePlace({ name: "  ", lat: 0, lon: 0 }), null);
  assert.equal(normalizePlace({ name: "x", lat: null, lon: 0 }), null);
  assert.deepEqual(normalizePlace({ name: " 东京 ", lat: 35.6895, lon: 139.69171, extra: "<script>" }), { name: "东京", area: "", lat: 35.69, lon: 139.69 });
  // 旧版设置（只有 clock）：天气默认开
  assert.deepEqual(normalizeSettings({ widgets: { clock: false } }).widgets, { clock: false, weather: true });
  // 上一版存过的城市（place）不再保留：现在按定位
  assert.deepEqual(normalizeSettings({ widgets: { weather: false, place: { name: "东京", lat: 35.69, lon: 139.69 } } }).widgets, { clock: true, weather: false });
});
