// ============================================================
// 导航入口配置 —— 以后新增/修改/删除入口，只改这一个文件
// ============================================================
//
// 每一项的写法：
//   {
//     name:   "名称",                 // 必填，卡片上显示的名字
//     icon:   "download",             // 图标，三种写法任选：
//                                     //   1. 本地图标库里的名字（见 assets/js/icons.js，如 "download"、"globe"）
//                                     //   2. 一张图片的路径（如 "./assets/img/logo.png"）
//                                     //   3. 一个表情或一两个字（如 "🐱"、"博"）
//     url:    "https://example.com/", // 必填，点击后打开的地址；站内页面写相对路径，如 "./about/"
//     desc:   "一句话描述",           // 可选，鼠标停在图标上时显示
//     group:  "分组名",               // 同一个分组名的入口会排在一起（只有一个分组时不显示分组名）
//     newTab: true,                   // 是否在新标签页打开（true / false）
//     color:  "#5b5bd6",              // 可选：图标的底色；不写就是半透明的"毛玻璃"底（推荐）
//   }
//
// 注意：
//   - 每一项末尾的逗号不要漏。
//   - 这个文件是公开的，后台、管理面板这类私密入口不要写在这里，
//     请在页面右上角的"编辑"模式里添加（只保存在你自己的浏览器里）。

export default [
  // 页面最下面的应用。图标是专门画的（assets/icons/apps/ 里的 svg：白色图形、透明底），垫在毛玻璃底上。
  // ./duo/ 和 ./uq/ 是本网站自己的子目录（文件就在仓库的 duo/ 和 uq/ 文件夹里）；
  // CatGPT、砚录、WiFi Drop 是另外部署的，写的是它们现在的真实地址。
  // （CatGPT 和 WiFi Drop 原来在 callaum.com，起始页接管这个域名后搬到了 chat.callaum.com。）
  {
    name: "Duo 适配",
    icon: "./assets/icons/apps/duo.svg",
    url: "./duo/",
    desc: "iPhone Duo 折叠屏 App 适配进度",
    group: "应用",
    newTab: false,
  },
  {
    name: "CatGPT",
    icon: "./assets/icons/apps/catgpt.svg",
    url: "https://chat.callaum.com/",
    desc: "多模型 AI 聊天",
    group: "应用",
    newTab: false,
  },
  {
    name: "UQ 校历",
    icon: "./assets/icons/apps/uq.svg",
    url: "./uq/",
    desc: "昆士兰大学中文校历",
    group: "应用",
    newTab: false,
  },
  {
    name: "my.UQ",
    icon: "./assets/icons/apps/myuq.svg",
    url: "https://portal.my.uq.edu.au/#/dashboard",
    desc: "UQ 学生门户（课表、成绩、选课）",
    group: "应用",
    newTab: false,
  },
  // 本网站的子页面 /flywire/：另一个仓库 flywire-fx-compare 每周自动生成的报告，由后台转交（见 tools/worker/flywire.js）
  {
    name: "飞汇地区比价",
    icon: "./assets/icons/apps/flywire.svg",
    url: "./flywire/",
    desc: "对比飞汇各地区刷卡的汇率加点，找最省的付款方式",
    group: "应用",
    newTab: false,
  },
  {
    name: "砚录",
    icon: "./assets/icons/apps/yanlu.svg",
    url: "https://ocr.callaum.com/",
    desc: "离线文字识别，图片不上传",
    group: "应用",
    newTab: false,
  },
  {
    name: "WiFi Drop",
    icon: "./assets/icons/apps/wifidrop.svg",
    url: "https://chat.callaum.com/drop/",
    desc: "同一个 WiFi 下互传文件",
    group: "应用",
    newTab: false,
  },
  // 三个外部 AI 的网页版，点开直达
  {
    name: "Claude",
    icon: "./assets/icons/apps/claude.svg",
    url: "https://claude.ai/",
    desc: "Anthropic 的 AI 助手",
    group: "应用",
    newTab: false,
  },
  {
    name: "ChatGPT",
    icon: "./assets/icons/apps/chatgpt.svg",
    url: "https://chatgpt.com/",
    desc: "OpenAI 的 AI 助手",
    group: "应用",
    newTab: false,
  },
  {
    name: "Muse",
    icon: "./assets/icons/apps/muse.svg",
    url: "https://muse.ai/",
    desc: "Meta 的个人 AI 助手",
    group: "应用",
    newTab: false,
  },
];
