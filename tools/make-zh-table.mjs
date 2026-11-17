// 生成 assets/js/zh-hans.js：繁体 → 简体的单字对照表（天气显示地名时用，把繁体地名转成简体）。
//
// 字表来自 OpenCC（https://github.com/BYVoid/OpenCC，Apache License 2.0）的 data/dictionary/TSCharacters.txt。
// 用法：下载 OpenCC 的这个文件，然后在仓库根目录执行
//   node tools/make-zh-table.mjs <放这个文件的目录>
//
// 规则：一个繁体字只有在"简体里不用这个字"时才转（OpenCC 的候选里含它自己的就不转，
// 比如"乾"在简体里也用（乾隆、乾县），所以不转成"干"）；有多个候选取第一个。只收录基本平面里的字（地名用到的都在里面）。
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("用法：node tools/make-zh-table.mjs <OpenCC 字表所在目录>");
  process.exit(1);
}
const lines = fs
  .readFileSync(path.join(dir, "TSCharacters.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const [from, to] = line.split("\t");
    return [from, (to || "").split(" ").filter(Boolean)];
  });
const single = (ch) => ch.length === 1; // 基本平面里的一个字（UTF-16 一个单元）

const pairs = [];
for (const [t, cands] of lines) {
  if (!single(t) || !cands.length || cands.includes(t) || !single(cands[0])) continue;
  pairs.push(t + cands[0]);
}

const out = `// 繁体 → 简体的单字对照：天气显示地名时，把繁体地名转成简体（界面只用简体中文和英文）。
// 由 tools/make-zh-table.mjs 根据 OpenCC（https://github.com/BYVoid/OpenCC，Apache License 2.0）的字表生成，不要手改。
// 只在查新地名时才加载，首屏不加载。

// 每两个字一组：繁体字 + 对应的简体字
const PAIRS = "${pairs.join("")}";

let map = null;

/** 繁体转简体（逐字；简体里也用的字保持不变） */
export function toSimplified(text) {
  if (!map) {
    map = new Map();
    for (let i = 0; i < PAIRS.length; i += 2) map.set(PAIRS[i], PAIRS[i + 1]);
  }
  return Array.from(String(text), (ch) => map.get(ch) || ch).join("");
}
`;
fs.writeFileSync(new URL("../assets/js/zh-hans.js", import.meta.url), out);
console.log(`繁→简 ${pairs.length} 个字，生成 assets/js/zh-hans.js：${Buffer.byteLength(out)} 字节`);
