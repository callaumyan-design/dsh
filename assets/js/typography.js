// 文字设置：字体、整体字号和粗细、时钟的大小和粗细。
// 字体只用设备上已经装好的（不从网上下载字体），所以同一个选项在不同设备上看到的字形可能不一样。
import { store, writeJSON } from "./store.js";

const CACHE_KEY = "sp:type-cache"; // 给 boot.js 用：下次打开页面时立刻套用，不会先闪一下默认字体

const SANS = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

// 每个选项是一串"候选字体"，浏览器会用其中第一个设备上有的
const STACKS = {
  system: SANS,
  serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", STSong, SimSun, Georgia, "Times New Roman", serif',
  kai: '"Kaiti SC", STKaiti, KaiTi, "AR PL UKai CN", "Songti SC", "Noto Serif CJK SC", serif',
  round: '"Yuanti SC", YouYuan, "Hiragino Maru Gothic ProN", ui-rounded, "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "PingFang SC", "Microsoft YaHei", monospace',
};

/** 设置面板里的字体选项：[代号, 显示名] */
export const FONT_CHOICES = [
  ["system", "系统默认"],
  ["serif", "宋体（衬线）"],
  ["kai", "楷体"],
  ["round", "圆体"],
  ["mono", "等宽"],
  ["custom", "自定义…"],
];

export const WEIGHT_NAMES = { 100: "极细", 200: "纤细", 300: "细", 400: "常规", 500: "中等", 600: "半粗", 700: "粗", 800: "特粗", 900: "黑" };

function fontStack(font) {
  if (font.family === "custom" && font.custom) return `"${font.custom}", ${SANS}`; // 设备上没有这个字体时，退回系统默认
  return STACKS[font.family] || SANS;
}

function apply() {
  const font = store.get().font;
  const values = {
    "--font": fontStack(font),
    "--fs": String(font.scale / 100),
    "--fw": String(font.weight),
    "--clock-scale": String(font.clockScale / 100),
    "--clock-weight": String(font.clockWeight),
  };
  for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value);
  writeJSON(CACHE_KEY, values);
}

export function initTypography() {
  apply();
  store.subscribe(apply);
}
