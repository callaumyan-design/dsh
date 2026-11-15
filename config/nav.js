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
//     color:  "#5b5bd6",              // 可选：图标的底色；不写就用默认的淡蓝色
//   }
//
// 还有两个可选项（一般用不到）：
//   statusUrl: "https://example.com/health"  // 专门用来检测"能不能访问"的地址
//   status: false                            // 不检测、不显示状态小圆点
//
// 注意：
//   - 每一项末尾的逗号不要漏。
//   - 这个文件是公开的，后台、管理面板这类私密入口不要写在这里，
//     请在页面右上角的"编辑"模式里添加（只保存在你自己的浏览器里）。

export default [
  // 下面四个应用的网址是按"都放在 callaum.com 下面"的方案先填的：
  // 相对路径 ./duo/ 表示"起始页所在网站的 /duo/ 目录"。应用实际放在别处的话，把 url 改成真实地址即可。
  {
    name: "Duo 适配",
    icon: "smartphone",
    url: "./duo/",
    desc: "iPhone Duo 折叠屏 App 适配进度，每天更新",
    group: "应用",
    newTab: false,
    color: "#0f766e",
  },
  {
    name: "CatGPT",
    icon: "cat",
    url: "https://chat.callaum.com/",
    desc: "多模型 AI 聊天",
    group: "应用",
    newTab: false,
    color: "#5b5bd6",
  },
  {
    name: "UQ 校历",
    icon: "calendar",
    url: "./uq/",
    desc: "昆士兰大学中文校历",
    group: "应用",
    newTab: false,
    color: "#51247a",
  },
  {
    name: "砚录",
    icon: "scan-text",
    url: "./yanlu/",
    desc: "离线文字识别，图片不上传",
    group: "应用",
    newTab: false,
    color: "#7c5a2e",
  },
];
