#!/usr/bin/env node
// 把起始页发布到 Cloudflare。
//
// 做法：把网站的文件连同一个很小的"服务员"程序（tools/worker/handler.js）打成一个 Worker 上传。
// 发布后的地址是 https://<名字>.<你的账户>.workers.dev，之后可以在 Cloudflare 里把自己的域名绑上去。
//
// 用法（在仓库根目录）：
//   node tools/deploy-cloudflare.mjs             打包并发布
//   node tools/deploy-cloudflare.mjs --dry-run   只打包到 .deploy/ 目录，不上传
//
// 需要一个 Cloudflare API 令牌（权限：Workers Scripts 编辑），放在环境变量 CLOUDFLARE_API_TOKEN 里。
// 在 Claude 的云端会话里，如果令牌已经保存在环境的"网络凭证"中，就不用设这个变量。
// 可选的环境变量：CLOUDFLARE_ACCOUNT_ID（有多个账户时指定）、WORKER_NAME（默认 start-page）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".deploy");
const NAME = process.env.WORKER_NAME || "start-page";
const DRY_RUN = process.argv.includes("--dry-run");
const API = "https://api.cloudflare.com/client/v4";

// 网站由这些文件和文件夹组成；仓库里其他东西（说明文档、测试、工具）不发布
const SITE = ["index.html", "manifest.webmanifest", "sw.js", "robots.txt", "assets", "config", "about", "uq", "duo", "flywire"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function listFiles(entry) {
  const full = path.join(ROOT, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [entry];
  return fs
    .readdirSync(full, { withFileTypes: true })
    .filter((d) => !d.name.startsWith("."))
    .flatMap((d) => listFiles(path.posix.join(entry, d.name)))
    .sort();
}

// ---------- 打包 ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const files = SITE.flatMap(listFiles);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// 这一版的"版本号"：由所有文件的内容算出来，任何一个文件变了，版本号就变。
// 首页里引用样式和脚本的地址会带上它（如 v/3fa9c1d2e4/assets/js/main.js）。
// 这样每次发布后地址都是新的，浏览器不可能再用到上一版留下的旧文件——
// 以前就出过这种事：手机上样式是新的、图标配置却还是旧的。
const BUILD = sha(files.map((rel) => `${rel}:${sha(fs.readFileSync(path.join(ROOT, rel)))}`).join("\n")).slice(0, 10);

/** 发布前对首页做的两处改动：写上版本号；样式、脚本的地址前面加上 v/版本号/ */
function stampIndex(html) {
  const marked = html.replace('<meta name="build" content="dev" />', `<meta name="build" content="${BUILD}" />`);
  if (marked === html) throw new Error('index.html 里找不到 <meta name="build" content="dev" />，没法写入版本号');
  return marked.replace(/(href|src)="((?:assets\/(?:css|js)|config)\/[^"]+)"/g, `$1="v/${BUILD}/$2"`);
}

const imports = [];
const table = [];
const parts = []; // 上传时的各个部分：[名字, 文件, 类型]
let total = 0;
files.forEach((rel, i) => {
  let bytes = fs.readFileSync(path.join(ROOT, rel));
  if (rel === "index.html") bytes = Buffer.from(stampIndex(bytes.toString("utf8")), "utf8");
  const type = TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream";
  const etag = `"${sha(bytes).slice(0, 20)}"`;
  const moduleName = `f${i}.bin`;
  fs.writeFileSync(path.join(OUT, moduleName), bytes);
  imports.push(`import f${i} from "./${moduleName}";`);
  table.push(`  [${JSON.stringify("/" + rel)}, { body: f${i}, type: ${JSON.stringify(type)}, etag: ${JSON.stringify(etag)} }],`);
  parts.push([moduleName, moduleName, "application/octet-stream"]);
  total += bytes.length;
});

// "服务员"程序的各个文件（handler.js 以及它用到的其他 .js）
const workerModules = fs.readdirSync(path.join(ROOT, "tools/worker")).filter((f) => f.endsWith(".js"));
for (const f of workerModules) fs.copyFileSync(path.join(ROOT, "tools/worker", f), path.join(OUT, f));
// 和页面共用的文件：仓库里 tools/worker 下只是"转一下手"，发布时换成原文（包里只有一层目录，引用不到 assets/）
// 共用文件之间只允许引用 ./ids.js（改成包里的名字 ./market-ids.js），别的引用一律报错
const SHARED = { "market-ids.js": "assets/js/market/ids.js", "market-hours.js": "assets/js/market/hours.js", "market-words.js": "assets/js/market/words.js" };
for (const [name, from] of Object.entries(SHARED)) {
  const text = fs.readFileSync(path.join(ROOT, from), "utf8").replace(/from "\.\/ids\.js";/g, 'from "./market-ids.js";');
  const imports = [...text.matchAll(/^\s*import\s[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  if (imports.some((x) => x !== "./market-ids.js")) throw new Error(`${from} 只能引用 ./ids.js（发布时它会被单独放进后台的包里）`);
  fs.writeFileSync(path.join(OUT, name), text);
}
// 搬走的旧地址（比如以前挂在这个域名下的别的应用）：旧路径前缀 → 新地址
const redirects = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/worker/redirects.json"), "utf8"));
fs.writeFileSync(
  path.join(OUT, "worker.js"),
  `// 这个文件是 tools/deploy-cloudflare.mjs 自动生成的，不要手改。\nimport { createHandler } from "./handler.js";\n${imports.join("\n")}\n\nconst FILES = new Map([\n${table.join("\n")}\n]);\nconst REDIRECTS = ${JSON.stringify(redirects)};\nconst BUILD = ${JSON.stringify(BUILD)};\n\nexport default { fetch: createHandler(FILES, REDIRECTS, BUILD) };\n`
);
// keep_bindings：发布新版本时保留在 Cloudflare 后台设置的密钥（QUOTES_TOKEN、FINNHUB_KEY 等），不然每次发布都会被清掉
fs.writeFileSync(path.join(OUT, "metadata.json"), JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-01-01", keep_bindings: ["secret_text"] }));
console.log(`打包完成：${files.length} 个文件，共 ${(total / 1024).toFixed(0)} KB，版本号 ${BUILD} → ${path.relative(ROOT, OUT)}/`);
if (DRY_RUN) process.exit(0);

// ---------- 上传 ----------
// 用 curl 发请求：它会自动走系统设置的网络代理，也方便一次上传很多文件
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function cf(method, endpoint, extra = []) {
  const args = ["-sS", "-m", "120", "-X", method, API + endpoint];
  if (process.env.CLOUDFLARE_API_TOKEN) args.push("-H", `Authorization: Bearer ${process.env.CLOUDFLARE_API_TOKEN}`);
  for (let attempt = 1; ; attempt++) {
    let text = "";
    let data = null;
    try {
      text = execFileSync("curl", [...args, ...extra], { cwd: OUT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      data = JSON.parse(text);
    } catch (err) {
      text = text || err.stdout || err.message;
    }
    if (data?.success) return data.result;
    // Cloudflare 说"请求太频繁"时，等一会儿再试，最多试 6 次
    const throttled = /"code":\s*(971|10429)|rate.?limit|throttl/i.test(text);
    if (throttled && attempt < 6) {
      console.log(`Cloudflare 提示请求太频繁，${attempt * 20} 秒后重试…`);
      sleep(attempt * 20000);
      continue;
    }
    console.error(`请求失败：${method} ${endpoint}\n${text.slice(0, 600)}`);
    process.exit(1);
  }
}

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = cf("GET", "/accounts?per_page=50");
  if (accounts.length !== 1) {
    console.error(`这个令牌能看到 ${accounts.length} 个账户，请用环境变量 CLOUDFLARE_ACCOUNT_ID 指定用哪一个。`);
    process.exit(1);
  }
  account = accounts[0].id;
}

const form = ["-F", "metadata=@metadata.json;type=application/json", "-F", "worker.js=@worker.js;type=application/javascript+module"];
for (const f of workerModules) form.push("-F", `${f}=@${f};type=application/javascript+module`);
for (const [name, file, type] of parts) form.push("-F", `${name}=@${file};type=${type}`);
cf("PUT", `/accounts/${account}/workers/scripts/${NAME}`, form);
console.log(`已上传：${NAME}`);

// 打开 workers.dev 上的访问地址
cf("POST", `/accounts/${account}/workers/scripts/${NAME}/subdomain`, ["-H", "Content-Type: application/json", "--data", JSON.stringify({ enabled: true, previews_enabled: false })]);
const { subdomain } = cf("GET", `/accounts/${account}/workers/subdomain`);
console.log(`发布完成：https://${NAME}.${subdomain}.workers.dev/`);
