// 生成 assets/js/zh-hans.js：繁体 ↔ 简体的单字对照表（天气搜城市时用，把繁体地名转成简体）。
//
// 字表来自 OpenCC（https://github.com/BYVoid/OpenCC，Apache License 2.0）的
// data/dictionary/TSCharacters.txt（繁→简）和 STCharacters.txt（简→繁）。
// 用法：下载 OpenCC 的这两个文件，然后在仓库根目录执行
//   node tools/make-zh-table.mjs <放这两个文件的目录>
//
// 规则：
//   - 繁→简：一个繁体字只有在"简体里不用这个字"时才转（OpenCC 的候选里含它自己的就不转，
//     比如"乾"在简体里也用（乾隆、乾县），所以不转成"干"）；有多个候选取第一个。
//   - 简→繁：取 OpenCC 的第一个候选（只用来多搜一次繁体写法，写错了也不会影响显示）。
//   - 只收录基本平面里的字（地名用到的都在里面）。
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("用法：node tools/make-zh-table.mjs <OpenCC 字表所在目录>");
  process.exit(1);
}
const read = (name) =>
  fs
    .readFileSync(path.join(dir, name), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from, to] = line.split("\t");
      return [from, (to || "").split(" ").filter(Boolean)];
    });
const single = (ch) => ch.length === 1; // 基本平面里的一个字（UTF-16 一个单元）

const t2s = new Map();
for (const [t, cands] of read("TSCharacters.txt")) {
  if (!single(t) || !cands.length || cands.includes(t) || !single(cands[0])) continue;
  t2s.set(t, cands[0]);
}
const s2t = new Map();
for (const [s, cands] of read("STCharacters.txt")) {
  if (!single(s) || !cands.length || cands[0] === s || !single(cands[0])) continue;
  s2t.set(s, cands[0]);
}

// 一份"繁简成对"的字串：繁→简直接查；简→繁取同一个简体字第一次出现时配的繁体字。
// 所以先放"简→繁首选"的那一对，再放其余的。首选那一对繁→简对不上的，单独放进 EXTRA（只用于简→繁）。
const pairs = [];
const used = new Set();
const extra = [];
for (const [s, t] of s2t) {
  if (t2s.get(t) === s) {
    pairs.push(t + s);
    used.add(t);
  } else extra.push(s + t);
}
for (const [t, s] of t2s) if (!used.has(t)) pairs.push(t + s);

const out = `// 繁体 ↔ 简体的单字对照：天气搜城市时，把繁体地名转成简体，并多用繁体写法搜一次。
// 由 tools/make-zh-table.mjs 根据 OpenCC（https://github.com/BYVoid/OpenCC，Apache License 2.0）的字表生成，不要手改。
// 只在打开设置、搜城市时才加载，首屏不加载。

// 每两个字一组：繁体字 + 对应的简体字
const PAIRS = "${pairs.join("")}";
// 简→繁时额外的对照（简体字 + 繁体字），这些繁体字不参与繁→简
const EXTRA = "${extra.join("")}";

let toS = null;
let toT = null;
function load() {
  if (toS) return;
  toS = new Map();
  toT = new Map();
  for (let i = 0; i < PAIRS.length; i += 2) {
    toS.set(PAIRS[i], PAIRS[i + 1]);
    if (!toT.has(PAIRS[i + 1])) toT.set(PAIRS[i + 1], PAIRS[i]);
  }
  for (let i = 0; i < EXTRA.length; i += 2) toT.set(EXTRA[i], EXTRA[i + 1]);
}

/** 繁体转简体（逐字；简体里也用的字保持不变） */
export function toSimplified(text) {
  load();
  return Array.from(String(text), (ch) => toS.get(ch) || ch).join("");
}

/** 简体转繁体（逐字，取最常用的写法） */
export function toTraditional(text) {
  load();
  return Array.from(String(text), (ch) => toT.get(ch) || ch).join("");
}
`;
fs.writeFileSync(new URL("../assets/js/zh-hans.js", import.meta.url), out);
console.log(`繁→简 ${t2s.size} 个字，简→繁 ${s2t.size} 个字（其中 ${extra.length} 个单独存放），生成 assets/js/zh-hans.js：${Buffer.byteLength(out)} 字节`);
