# 在 Azure 上部署 OmniChat（Azure for Students）

适合拿到 **Azure for Students**（约 100～150 美元额度，无需信用卡）或 Azure 免费账户的情况。
做法是开一台 Linux 虚拟机，由 `setup.sh` 自动安装 Docker、拉取代码、构建并运行 OmniChat，
前面用 Caddy 提供 HTTPS，并使用 Azure 免费提供的 `xxx.<地区>.cloudapp.azure.com` 域名。
之后每次重启虚拟机都会自动更新到最新代码，数据保存在虚拟机磁盘上不受影响。

> 为什么不用 App Service / Container Apps：OmniChat 的数据库是 SQLite，需要可靠的本地持久磁盘；
> 一台小虚拟机最简单、最省钱，也最好排查问题。

## 额度怎么花

| 项目 | 费用 |
| --- | --- |
| B1s 虚拟机（1 vCPU / 1 GB） | 学生「免费服务」每月 750 小时 Linux B1s（足够一台全天运行），超出部分从额度扣 |
| 系统盘 64 GB 高级 SSD（P6） | 免费服务包含 2 块 P6 托管磁盘 |
| 公共 IP（Standard，静态） | 约 3～4 美元 / 月，从额度扣 |
| 流量 | 每月有免费出站流量，聊天流量很小 |

也就是说，额度主要只花在公共 IP 上，142 美元足够用到额度过期。免费服务以门户里
「教育 → 免费服务」显示的项目和剩余用量为准（截图里的 Windows B1s 之外通常还有 Linux B1s）。

**强烈建议**：到 门户 →「成本管理 + 计费」→「预算」设一个预算提醒（例如 10 美元）。
Azure for Students 额度用完或过期后订阅会被停用（不会自动扣你的钱），但服务会停止，记得提前导出数据。

## 选地区

| 地区 | 名称 | 说明 |
| --- | --- | --- |
| 日本东部 | `japaneast` | 推荐，国内访问较快 |
| 韩国中部 | `koreacentral` | 推荐 |
| 东南亚（新加坡） | `southeastasia` | 推荐 |
| 美国西部 2 | `westus2` | 延迟较高，但几乎所有服务都可用 |
| ~~东亚（香港）~~ | `eastasia` | **不要选**：OpenAI、Claude、Gemini 的 API 都不对香港提供服务，服务器代理会调用失败 |

学生订阅有「允许的地区」限制，并且部分地区的 B1s 可能售罄。创建时如果报 `SkuNotAvailable` 或
`RequestDisallowedByAzure`，换一个地区重试即可（下方命令里只需改 `LOCATION`）。

## 部署步骤

在 [Azure 门户](https://portal.azure.com) 右上角点 `>_` 打开 **Cloud Shell**（选 Bash，已登录、已装好 az 和 git），
依次粘贴：

```bash
# 1. 设置参数（NAME 会成为网址的一部分，需在该地区唯一，脚本自动加随机后缀）
LOCATION=japaneast
NAME=omnichat-$RANDOM
DOMAIN=$NAME.$LOCATION.cloudapp.azure.com
BRANCH=main          # 代码还没合并到 main 时改为 claude/omnichat-webapp

# 2. 获取部署脚本
git clone https://github.com/callaumyan-design/dsh.git && cd dsh

# 3. 创建资源组和虚拟机（首次启动时自动安装并运行 OmniChat）
az group create --name omnichat-rg --location $LOCATION
az vm create \
  --resource-group omnichat-rg --name omnichat \
  --image Ubuntu2404 --size Standard_B1s \
  --os-disk-size-gb 64 --storage-sku Premium_LRS \
  --admin-username azureuser --generate-ssh-keys \
  --public-ip-sku Standard --public-ip-address-dns-name $NAME \
  --tags domain=$DOMAIN branch=$BRANCH \
  --custom-data omnichat/deploy/azure/setup.sh

# 4. 放行网页端口
az vm open-port --resource-group omnichat-rg --name omnichat --port 80,443 --priority 1010

echo "部署完成后访问：https://$DOMAIN"
```

首次启动需要 5～10 分钟（安装 Docker、构建应用）。查看进度：

```bash
az vm run-command invoke -g omnichat-rg -n omnichat --command-id RunShellScript \
  --scripts 'tail -n 20 /var/log/cloud-init-output.log'
```

看到 `OmniChat is running at https://…` 后，打开该地址，按提示创建管理员账户。
手机打开同一地址登录即可同步，在浏览器菜单里选「添加到主屏幕」就能像 App 一样使用。

> SSH 登录：`ssh azureuser@$DOMAIN`（密钥保存在 Cloud Shell 的 `~/.ssh`）。
> 为安全起见，可在门户 → 虚拟机 → 网络 中把 22 端口限制为你的 IP，或干脆删除该规则，需要时用上面的 `run-command`。

### 使用自己的域名

把域名的 A 记录指向虚拟机的公共 IP（`az vm show -d -g omnichat-rg -n omnichat --query publicIps -o tsv`），然后：

```bash
az vm update -g omnichat-rg -n omnichat --set tags.domain=chat.example.com
az vm restart -g omnichat-rg -n omnichat      # 重启时自动应用新设置
```

不设置 `domain` 标签时只提供 HTTP（`http://IP`），不能「添加到主屏幕」，剪贴板等功能也受限。

## 日常维护

```bash
# 更新到最新代码（拉取并重新构建，数据不受影响）
az vm run-command invoke -g omnichat-rg -n omnichat --command-id RunShellScript --scripts 'omnichat-update'

# 忘记管理员密码
az vm run-command invoke -g omnichat-rg -n omnichat --command-id RunShellScript \
  --scripts 'docker exec omnichat node dist/server/index.mjs reset-password admin 新密码'

# 暂时不用：停止并释放（不计虚拟机费用；Standard 静态 IP 仍会计费）
az vm deallocate -g omnichat-rg -n omnichat
az vm start -g omnichat-rg -n omnichat

# 彻底删除所有资源
az group delete --name omnichat-rg
```

- 数据保存在虚拟机的 `/var/lib/omnichat`（数据库 + 加密密钥文件）。
- 备份：在 OmniChat「设置 → 数据管理」导出，或在门户里给系统盘创建快照。

## 用学生额度调用 Azure OpenAI

Azure OpenAI 属于 Azure 服务，用量可以直接从学生额度里扣，相当于用额度「白嫖」GPT 系列模型
（学生订阅可能对部分模型、地区或配额有限制，以门户显示为准）。

1. 门户搜索 **Azure OpenAI**（或 Azure AI Foundry）→ 创建资源，地区选有你想要模型的地区（如 `eastus2`、`swedencentral`、`japaneast`）。
2. 进入资源 → **模型部署**，部署一个模型（例如 `gpt-4o-mini`、`gpt-4.1-mini`）。记下 **部署名称**。
3. 在资源的「密钥和终结点」页复制 **密钥** 和资源名。
4. OmniChat「设置 → 模型服务 → 添加服务商 → Azure OpenAI」：
   - 接口地址：`https://你的资源名.openai.azure.com/openai/v1`
   - API 密钥：上一步复制的密钥
   - 模型：手动添加，**填写部署名称**（不是模型名）。然后点「测试连接」。

建议优先使用 mini 系列，便宜很多。Claude 等第三方模型在 Foundry 中通常走市场计费，学生额度一般不能抵扣。

## 其他提示

- OpenAI / Claude / Gemini 等其他服务商照常添加即可，请求由日本 / 新加坡的服务器发出，不受你本地网络影响。
- 从中国大陆访问海外 IP 可能偶尔不稳定；如遇到，可换到其他地区重建，或在前面加一层 CDN。
