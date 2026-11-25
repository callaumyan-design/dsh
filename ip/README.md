# IP 检测

网址：`/ip/`（在站点首页「我的小工具」里）。参考 ping0.cc 这类网站做的简单版本。

## 能看到什么

打开就查你自己的公网 IP，也可以输入任意 IPv4、IPv6、域名或网址来查（域名会先解析成 IP）。查询内容会写进网址（`?q=8.8.8.8`），可以直接分享。

| 项目 | 说明 | 数据来源 |
| --- | --- | --- |
| IP 地址、位置、ASN、运营商、时区 | 归属地信息 | [ipquery.io](https://ipquery.io/)，连不上时换 [ipwho.is](https://ipwho.is/) |
| IP 类型 | 机房 IP / 移动网络 / 宽带 IP（非机房） | ipquery.io |
| 代理检测、风险值 | 是否 VPN、代理、Tor；风险值 0–100，低于 25 算低，60 以上算高 | ipquery.io |
| 原生 IP / 广播 IP | IP 的注册国家和实际使用的国家一样就是原生，不一样就是广播 | [ipleak.net](https://ipleak.net/) 的注册国家 |
| 主机名 | 反向解析 | ipleak.net |
| 不同网站看到的 IP | 国内网站（IPIP.net）、国外网站（Cloudflare）、IPv6（ipify）各看到哪个 IP；用了分流代理时国内外通常不同 | 只在查自己时显示 |

域名解析用阿里 DNS 的 DoH 接口，连不上时换 Cloudflare。

备用来源 ipwho.is 不提供 IP 类型、代理和风险值，这几行会显示「这个数据源不提供」。这些判断来自免费数据库，仅供参考。

## 怎么做的

纯静态页面，没有后端，也不需要构建：浏览器直接请求上面这些允许跨域的免费接口。

- `site/index.html`、`site/style.css`：页面
- `site/app.js`：发请求、画结果
- `site/lib.js`：解析输入、判断内网地址、整理各家接口的返回（纯函数，有测试）
- `test/lib.test.js`：`npm test` 运行

本地预览：`npm run preview`，然后打开 <http://localhost:8080/>（页面用了 ES 模块，直接双击 `index.html` 打不开）。

推到 main 后由 `.github/workflows/ip.yml` 测试并发布到 `/ip/`。

## 放到起始页（callaum.com）

`site/` 里的文件原样复制到任何网站的子目录就能用：只有本站自己的脚本和样式，没有内联代码，起始页那种严格的 CSP 也不受影响；返回链接指向上一级（`../`）。
`homepage-icon.svg` 是给起始页导航用的图标（白色图形、透明底，和起始页其他应用图标一个画法）。
