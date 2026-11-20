// 和页面共用的搜索词文件。仓库里这里只是转一下手；发布时 tools/deploy-cloudflare.mjs 会把它换成
// assets/js/market/words.js 的原文（并把里面引用的 ./ids.js 改成 ./market-ids.js）。
export * from "../../assets/js/market/words.js";
