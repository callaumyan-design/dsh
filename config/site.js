// ============================================================
// 站点配置：默认背景、AI（catgpt）对接地址
// ============================================================

// ---------- 内置背景 ----------
// 每一套背景的写法：
//   id:    内部代号（英文，不要重复）
//   name:  设置面板里显示的名字
//   css:   CSS 渐变写法（和 image 二选一）
//   image: 仓库里一张图片的路径，如 "./assets/img/bg-1.jpg"（和 css 二选一）
//   color: 图片还没加载出来时先显示的纯色
//   tone:  背景整体偏暗写 "dark"，偏亮写 "light"（用来决定应用图标的玻璃底和搜索框里的字用浅色还是深色）
export const BACKGROUND_PRESETS = [
  {
    id: "aurora",
    name: "极光",
    css: "radial-gradient(120% 85% at 12% 8%, #2563eb 0%, transparent 58%), radial-gradient(100% 75% at 88% 18%, #7c3aed 0%, transparent 60%), radial-gradient(120% 90% at 50% 105%, #0d9488 0%, transparent 62%), #0f172a",
    color: "#0f172a",
    tone: "dark",
  },
  {
    id: "dusk",
    name: "暮色",
    css: "linear-gradient(165deg, #1e1b4b 0%, #5b2a6f 42%, #c2475f 76%, #f59e5b 100%)",
    color: "#3b1f5c",
    tone: "dark",
  },
  {
    id: "mist",
    name: "晨雾",
    css: "linear-gradient(160deg, #dbe7f3 0%, #c7d5ea 45%, #f1e4e8 100%)",
    color: "#d5dfee",
    tone: "light",
  },
];

// 默认用哪一套背景（填上面某一套的 id）。只影响还没自己设置过背景的访客。
export const DEFAULT_BACKGROUND = "aurora";

// ---------- 在线壁纸 ----------
// 必应的壁纸不允许网页直接取，要由网站自己的后台代取。
// 这里填后台的地址。网站如果放在没有后台的地方（比如 GitHub Pages），把它改成 ""，必应这两个来源就不会出现在设置里。
export const WALLPAPER_API = "./api/wallpaper";

// ---------- 天气 ----------
// 问候语后面那一句"布里斯班 28° 多云"：按浏览器定位到的位置显示（见 assets/js/weather.js）。
// 这里是默认城市：定位没打开、被拒绝、或者暂时定位不了时，显示这里的天气。
//   name: 显示的名字    area: 所在地区（可以留空）
//   lat:  纬度（南纬为负数）    lon: 经度（西经为负数）
// 改成 null：定位不了时就不显示天气。
export const WEATHER_PLACE = { name: "布里斯班", area: "昆士兰州 · 澳大利亚", lat: -27.47, lon: 153.03 };

// ---------- AI（catgpt）----------
// 最简单的用法不在这里：每个人可以在页面右上角"设置 → AI"里填自己的接口地址、API Key 和模型，
// 那些内容只存在他自己的浏览器里。下面这一段是"全站默认接到 catgpt"的配置，没人在设置里填接口时才用到。
//
// 两个地址都留空：没在设置里填接口的人，AI 模式会提示"还没有接入"，并提供"去设置"和"改用搜索引擎搜"。
// 只填 pageUrl：  AI 模式直接跳转到 catgpt 页面（带上 ?q=问题）。
// 填了 apiUrl：    在起始页里弹出对话面板，直接调用 catgpt 的后端接口（流式显示）。
//
// 注意：这里只能填"地址"，绝对不要把任何 API Key 写进来 —— 这个文件是公开的。
// Key 必须只放在 catgpt 的服务端。
export const AI = {
  name: "catgpt",   // 面板标题和按钮上显示的名字
  pageUrl: "",      // catgpt 网页地址，例如 "https://catgpt.example.com/"
  apiUrl: "",       // catgpt 对话接口地址，例如 "https://catgpt.example.com/api/chat"
  model: "",        // 可选：要指定模型时填写，留空则由 catgpt 自己决定
  passwordDays: 30, // 访问密码验证通过后，在本机记住多少天
};
