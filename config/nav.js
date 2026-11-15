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
//     desc:   "一句话描述",           // 可选
//     group:  "分组名",               // 同一个分组名的入口会排在一起
//     newTab: true,                   // 是否在新标签页打开（true / false）
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
  // ---------- DSH ----------
  {
    name: "下载",
    icon: "download",
    url: "https://github.com/callaumyan-design/dsh/releases",
    desc: "Windows x64 便携版下载",
    group: "DSH",
    newTab: true,
  },
  {
    name: "关于",
    icon: "info",
    url: "./about/",
    desc: "项目说明、运行要求与许可",
    group: "DSH",
    newTab: false,
  },
  {
    name: "项目仓库",
    icon: "git-branch",
    url: "https://github.com/callaumyan-design/dsh",
    desc: "本项目的 GitHub 仓库",
    group: "DSH",
    newTab: true,
  },

  // ---------- 上游项目 ----------
  {
    name: "DeepSeek Harness",
    icon: "rocket",
    url: "https://github.com/deepseek-ai/deepseek-harness",
    desc: "上游项目主页",
    group: "上游项目",
    newTab: true,
  },
  {
    name: "上游许可证",
    icon: "scale",
    url: "https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE",
    desc: "MIT License",
    group: "上游项目",
    newTab: true,
  },
  {
    name: "第三方声明",
    icon: "file-text",
    url: "https://github.com/deepseek-ai/deepseek-harness/blob/master/THIRD_PARTY_NOTICES.md",
    desc: "上游的第三方组件声明",
    group: "上游项目",
    newTab: true,
  },

  // ---------- DSH 插件 ----------
  {
    name: "消息编辑",
    icon: "pencil-line",
    url: "https://github.com/callaumyan-design/dshx-message-edit",
    desc: "修改已发送的提问或回复并重新生成",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "会话删除",
    icon: "trash-2",
    url: "https://github.com/callaumyan-design/dshx-session-delete",
    desc: "永久删除一段对话",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "技能管理",
    icon: "list-checks",
    url: "https://github.com/callaumyan-design/dshx-skill-manager",
    desc: "查看并开关已安装的技能",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "用量与费用",
    icon: "coins",
    url: "https://github.com/callaumyan-design/dshx-token-cost",
    desc: "账户余额、每日 Token 用量和费用",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "项目目录",
    icon: "folder-open",
    url: "https://github.com/callaumyan-design/dshx-project",
    desc: "在会话顶部显示并打开项目目录",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "循环守卫",
    icon: "repeat",
    url: "https://github.com/callaumyan-design/dshx-loop-guard",
    desc: "检测并中止重复的工具调用",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "语言跟随",
    icon: "languages",
    url: "https://github.com/callaumyan-design/dshx-language-mirror",
    desc: "总是用你提问的语言回复",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "图片限幅",
    icon: "image",
    url: "https://github.com/callaumyan-design/dshx-image-clamp",
    desc: "限制发给模型的图片最大边长",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "AI 审批",
    icon: "shield-check",
    url: "https://github.com/callaumyan-design/dshx-ai-approval",
    desc: "由 AI 审核的沙箱提权预设",
    group: "DSH 插件",
    newTab: true,
  },
  {
    name: "Claude Code 移植版",
    icon: "puzzle",
    url: "https://github.com/callaumyan-design/dshx-claude",
    desc: "上述插件的 Claude Code 版本",
    group: "DSH 插件",
    newTab: true,
  },
];
