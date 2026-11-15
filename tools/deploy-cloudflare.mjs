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
const SITE = ["index.html", "manifest.webmanifest", "sw.js", "assets", "config", "about", "uq", "duo"];

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
const imports = [];
const table = [];
const parts = []; // 上传时的各个部分：[名字, 文件, 类型]
let total = 0;
files.forEach((rel, i) => {
  const bytes = fs.readFileSync(path.join(ROOT, rel));
  const type = TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream";
  const etag = `"${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}"`;
  const moduleName = `f${i}.bin`;
  fs.writeFileSync(path.join(OUT, moduleName), bytes);
  imports.push(`import f${i} from "./${moduleName}";`);
  table.push(`  [${JSON.stringify("/" + rel)}, { body: f${i}, type: ${JSON.stringify(type)}, etag: ${JSON.stringify(etag)} }],`);
  parts.push([moduleName, moduleName, "application/octet-stream"]);
  total += bytes.length;
});

fs.copyFileSync(path.join(ROOT, "tools/worker/handler.js"), path.join(OUT, "handler.js"));
fs.writeFileSync(
  path.join(OUT, "worker.js"),
  `// 这个文件是 tools/deploy-cloudflare.mjs 自动生成的，不要手改。\nimport { createHandler } from "./handler.js";\n${imports.join("\n")}\n\nconst FILES = new Map([\n${table.join("\n")}\n]);\n\nexport default { fetch: createHandler(FILES) };\n`
);
fs.writeFileSync(path.join(OUT, "metadata.json"), JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-01-01" }));
console.log(`打包完成：${files.length} 个文件，共 ${(total / 1024).toFixed(0)} KB → ${path.relative(ROOT, OUT)}/`);
if (DRY_RUN) process.exit(0);

// ---------- 上传 ----------
// 用 curl 发请求：它会自动走系统设置的网络代理，也方便一次上传很多文件
function cf(method, endpoint, extra = []) {
  const args = ["-sS", "--fail-with-body", "-m", "120", "-X", method, API + endpoint];
  if (process.env.CLOUDFLARE_API_TOKEN) args.push("-H", `Authorization: Bearer ${process.env.CLOUDFLARE_API_TOKEN}`);
  let text;
  try {
    text = execFileSync("curl", [...args, ...extra], { cwd: OUT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    console.error(`请求失败：${method} ${endpoint}\n${err.stdout || err.message}`);
    process.exit(1);
  }
  const data = JSON.parse(text);
  if (!data.success) {
    console.error(`Cloudflare 返回错误：${method} ${endpoint}\n${JSON.stringify(data.errors)}`);
    process.exit(1);
  }
  return data.result;
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

const form = ["-F", "metadata=@metadata.json;type=application/json", "-F", "worker.js=@worker.js;type=application/javascript+module", "-F", "handler.js=@handler.js;type=application/javascript+module"];
for (const [name, file, type] of parts) form.push("-F", `${name}=@${file};type=${type}`);
cf("PUT", `/accounts/${account}/workers/scripts/${NAME}`, form);
console.log(`已上传：${NAME}`);

// 打开 workers.dev 上的访问地址
cf("POST", `/accounts/${account}/workers/scripts/${NAME}/subdomain`, ["-H", "Content-Type: application/json", "--data", JSON.stringify({ enabled: true, previews_enabled: false })]);
const { subdomain } = cf("GET", `/accounts/${account}/workers/subdomain`);
console.log(`发布完成：https://${NAME}.${subdomain}.workers.dev/`);
