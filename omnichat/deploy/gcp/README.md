# 在谷歌云（Google Cloud）上部署 OmniChat

适合拿到了谷歌云额度（学生 / 教育额度、新用户试用金）或想用谷歌云「永久免费」虚拟机的情况。
做法是开一台 Compute Engine 虚拟机，由启动脚本自动安装 Docker、拉取代码、构建并运行 OmniChat，
前面用 Caddy 提供 HTTPS。之后每次重启虚拟机都会自动更新到最新代码，数据保存在虚拟机磁盘上不受影响。

> 为什么不用 Cloud Run：Cloud Run 的容器不保留本地磁盘，而 OmniChat 的数据库（SQLite）需要持久磁盘。
> 一台小虚拟机最简单，也最便宜。

## 先弄清你的额度是哪一种

| 优惠 | 能用来做什么 |
| --- | --- |
| 谷歌云额度（教育 / 学生 credits、新用户试用金） | 支付虚拟机等谷歌云资源，也可能覆盖 Gemini API 付费用量（以额度条款为准） |
| 谷歌云「Always Free」免费层 | 每月一台 e2-micro 虚拟机（仅美国 `us-west1` / `us-central1` / `us-east1`）+ 30 GB 标准磁盘 |
| Google AI Pro 学生免费（Gemini App 会员） | 只用于 Gemini 网页 / App，**不包含 API 额度，也不是服务器** |

到 [Billing → Credits](https://console.cloud.google.com/billing) 可以看到额度金额、有效期和适用范围。
**建议在 Billing → Budgets & alerts 设一个预算提醒**（例如 5 美元），避免额度用完后产生意外费用。

## 选地区和机型

- **想用免费层**：`us-west1-b`（俄勒冈），机型 `e2-micro`。三个免费地区里它离亚洲最近。
- **用额度、想要国内访问更快**：`asia-northeast1-b`（东京）或 `asia-east1-b`（台湾），机型 `e2-micro` 或 `e2-small`。
- **不要选香港（`asia-east2`）**：OpenAI、Claude、Gemini 的 API 都不对香港提供服务，服务器代理调用会失败。

OmniChat 本身很轻量，e2-micro（1 GB 内存）够个人和家人使用；脚本会自动加 2 GB 交换空间用于首次构建。

## 部署步骤

最省事的是在浏览器里用 [Cloud Shell](https://shell.cloud.google.com)（已登录、已装好 gcloud，无需本地安装）。

```bash
# 1. 选择项目并启用 Compute Engine
gcloud config set project 你的项目ID
gcloud services enable compute.googleapis.com

# 2. 获取部署脚本
git clone https://github.com/callaumyan-design/dsh.git && cd dsh

# 3. 创建虚拟机（首次启动时自动安装并运行 OmniChat）
gcloud compute instances create omnichat \
  --zone=us-west1-b \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --tags=omnichat \
  --metadata=domain=auto \
  --metadata-from-file=startup-script=omnichat/deploy/gcp/startup.sh

# 4. 放行网页端口
gcloud compute firewall-rules create omnichat-web --allow=tcp:80,tcp:443 --target-tags=omnichat
```

> 代码还没合并到 `main` 分支时，把第 3 步的 `--metadata=domain=auto` 改成
> `--metadata=domain=auto,branch=claude/omnichat-webapp`。

首次启动需要 5～10 分钟（安装 Docker、构建应用）。查看进度：

```bash
gcloud compute ssh omnichat --zone=us-west1-b \
  --command='sudo journalctl -u google-startup-scripts.service -n 30 --no-pager'
```

看到 `OmniChat is running at https://…` 即完成。查询虚拟机 IP：

```bash
gcloud compute instances describe omnichat --zone=us-west1-b \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

`domain=auto` 会使用免费的 `sslip.io` 域名自动获得 HTTPS 证书：如果 IP 是 `34.82.10.20`，
访问 **https://34-82-10-20.sslip.io** 即可，然后按提示创建管理员账户。手机打开同一地址登录即可同步，
在浏览器菜单里选「添加到主屏幕」就能像 App 一样使用（需要 HTTPS）。

### `domain` 的三种写法

| 写法 | 效果 |
| --- | --- |
| `domain=auto` | 用 `<IP>.sslip.io` 自动 HTTPS，不需要自己的域名（推荐） |
| `domain=chat.example.com` | 用自己的域名自动 HTTPS（先把域名的 A 记录指向虚拟机 IP） |
| 不设置 | 只提供 HTTP：`http://IP`（不能「添加到主屏幕」，剪贴板等功能受限） |

修改后执行下面的「更新」命令即可生效：

```bash
gcloud compute instances add-metadata omnichat --zone=us-west1-b --metadata=domain=chat.example.com
```

> 临时 IP 在虚拟机「停止再启动」后可能变化，`sslip.io` 地址也会随之变化（脚本会自动适配）。
> 想要固定地址，可以预留静态 IP 或使用自己的域名。

## 日常维护

```bash
# 更新到最新代码（拉取并重新构建，数据不受影响）
gcloud compute ssh omnichat --zone=us-west1-b --command='sudo google_metadata_script_runner startup'

# 忘记管理员密码
gcloud compute ssh omnichat --zone=us-west1-b \
  --command='sudo docker exec omnichat node dist/server/index.mjs reset-password admin 新密码'
```

- 数据保存在虚拟机的 `/var/lib/omnichat`（数据库 + 加密密钥文件）。
- 备份：在 OmniChat「设置 → 数据管理」导出，或给虚拟机磁盘创建快照。

## 搭配 Gemini 使用

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 创建 API Key。
2. OmniChat「设置 → 模型服务 → 添加服务商 → Google Gemini」，粘贴密钥，点「获取模型」和「测试连接」。
3. 请求方式保持默认的 **服务器代理**：请求由谷歌云上的服务器发出，不受你本地网络能否访问 Gemini 的影响。

注意：

- Gemini API 免费层有速率限制，且免费层的对话内容可能被谷歌用于改进产品，敏感内容建议开通付费层。
- 付费层按项目关联的结算账号计费；你的谷歌云额度是否覆盖 Gemini API，以 Billing → Credits 里的适用范围为准。
- 「Google AI Pro 学生会员」不提供 API 额度，在 OmniChat 里用不上。

## 费用提示

- e2-micro + 30 GB 标准磁盘在免费地区属于免费层；外网流量只有少量免费额度，发往中国大陆的流量不在免费层内，
  但聊天的流量很小（每条消息通常只有几 KB）。外网 IP 等也可能产生少量费用，额度可以抵扣。
- 以谷歌云官方的 [免费层说明](https://cloud.google.com/free/docs/free-cloud-features) 和账单页为准，并设置预算提醒。
- 从中国大陆访问谷歌云的海外 IP 可能不稳定；如果遇到这种情况，可以改选东京 / 台湾地区，或在前面加一层 CDN。
