#!/usr/bin/env bash
# 科技晨读：一键部署服务器到你自己的 Azure 订阅。
#
# 在 Azure Cloud Shell（Bash）里运行，已经登录、自带 az / node / zip：
#   bash <(curl -fsSL https://raw.githubusercontent.com/callaumyan-design/dsh/main/news/server/deploy/azure-setup.sh)
#
# 做的事（可重复运行，已有的资源和密钥会保留）：
#   1. 建资源组、存储账户、Flex Consumption 函数应用（Node 22，附 Application Insights 日志）
#   2. 写入配置：AI 接口与密钥（在这里输入，不经过任何第三方）、通行密钥域名、推送密钥、管理密钥
#   3. 下载代码、打包部署，手动触发生成第一期
#   4. 建一个托管身份并信任本仓库 main 分支的 GitHub Actions，以后合并到 main 自动部署
#
# 可用环境变量覆盖默认值：LOCATION、RESOURCE_GROUP、APP_NAME、BRANCH、REPO
set -euo pipefail

REPO="${REPO:-callaumyan-design/dsh}"
BRANCH="${BRANCH:-main}"
LOCATION="${LOCATION:-southeastasia}"   # 新加坡：离国内近，且在 Anthropic 支持的地区（香港不在）
RESOURCE_GROUP="${RESOURCE_GROUP:-kejichendu}"
PAGES_HOST="${PAGES_HOST:-${REPO%%/*}.github.io}"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
ask()  { local __v; read -r -p "$1" __v </dev/tty; printf '%s' "$__v"; }
ask_secret() { local __v; read -r -s -p "$1" __v </dev/tty; echo >&2; printf '%s' "$__v"; }

az account show >/dev/null 2>&1 || { echo "请先 az login（Cloud Shell 里已登录则不需要）"; exit 1; }
SUB_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SUFFIX=$(printf '%s' "$SUB_ID" | sha1sum | cut -c1-6)
APP_NAME="${APP_NAME:-kejichendu-$SUFFIX}"
STORAGE="${STORAGE:-kjcd${SUFFIX}st}"
IDENTITY="${APP_NAME}-github"

say "订阅：$(az account show --query name -o tsv)（$SUB_ID）"
echo "地区 $LOCATION，资源组 $RESOURCE_GROUP，函数应用 $APP_NAME，存储 $STORAGE"
[ "$(ask '继续？[Y/n] ')" != "n" ] || exit 0

say "注册所需的资源提供程序（首次可能要一两分钟）"
for ns in Microsoft.Web Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait -o none
done

say "资源组与存储账户"
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none
az storage account create -n "$STORAGE" -g "$RESOURCE_GROUP" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
CONN=$(az storage account show-connection-string -n "$STORAGE" -g "$RESOURCE_GROUP" --query connectionString -o tsv)

say "函数应用（Flex Consumption，按用量计费，有每月免费额度）"
if ! az functionapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" -o none 2>/dev/null; then
  az functionapp create -n "$APP_NAME" -g "$RESOURCE_GROUP" -s "$STORAGE" \
    --flexconsumption-location "$LOCATION" --runtime node --runtime-version 22 --instance-memory 2048 -o none
fi
az functionapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --set httpsOnly=true -o none
az functionapp scale config set -n "$APP_NAME" -g "$RESOURCE_GROUP" --maximum-instance-count 10 -o none

setting() { az functionapp config appsettings list -n "$APP_NAME" -g "$RESOURCE_GROUP" --query "[?name=='$1'].value | [0]" -o tsv; }

say "配置"
SETTINGS=("AzureWebJobsStorage=$CONN" "APP_ORIGINS=https://$PAGES_HOST" "RP_ID=$PAGES_HOST")

if [ -z "$(setting VAPID_PUBLIC_KEY)" ]; then
  echo "生成推送密钥对"
  VAPID=$(npx --yes web-push@4.0.0 generate-vapid-keys --json)
  SETTINGS+=("VAPID_PUBLIC_KEY=$(node -pe "JSON.parse(process.argv[1]).publicKey" "$VAPID")"
             "VAPID_PRIVATE_KEY=$(node -pe "JSON.parse(process.argv[1]).privateKey" "$VAPID")"
             "VAPID_SUBJECT=https://$PAGES_HOST")
fi
ADMIN_KEY=$(setting ADMIN_KEY)
if [ -z "$ADMIN_KEY" ]; then
  ADMIN_KEY=$(openssl rand -hex 24)
  SETTINGS+=("ADMIN_KEY=$ADMIN_KEY")
fi

CURRENT_AI=$(setting AI_PROVIDER)
if [ -n "$CURRENT_AI" ] && [ "$(ask "已配置 AI：$CURRENT_AI。要更换吗？[y/N] ")" != "y" ]; then
  :
else
  echo "AI 接口：1) Claude（Anthropic）  2) OpenAI 兼容接口（DeepSeek、通义千问、Azure OpenAI 等）  3) 暂不用 AI（显示原标题）"
  case "$(ask '选择 [1]: ')" in
    2)
      SETTINGS+=("AI_PROVIDER=openai"
                 "AI_BASE_URL=$(ask '接口根地址（如 https://api.deepseek.com/v1）: ')"
                 "AI_MODEL=$(ask '模型名（如 deepseek-chat）: ')")
      [ "$(ask '是 Azure OpenAI 吗？[y/N] ')" = "y" ] && SETTINGS+=("AI_AUTH_HEADER=api-key")
      SETTINGS+=("AI_API_KEY=$(ask_secret 'API 密钥（输入不显示）: ')")
      ;;
    3) SETTINGS+=("AI_PROVIDER=none") ;;
    *) SETTINGS+=("AI_PROVIDER=anthropic" "AI_API_KEY=$(ask_secret 'Anthropic API 密钥 sk-ant-...（输入不显示）: ')") ;;
  esac
fi
az functionapp config appsettings set -n "$APP_NAME" -g "$RESOURCE_GROUP" --settings "${SETTINGS[@]}" -o none

say "下载 $REPO@$BRANCH 并部署代码"
WORK=$(mktemp -d)
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar xz -C "$WORK" --strip-components=1
(
  cd "$WORK/news/server"
  npm ci --omit=dev --no-audit --no-fund
  rm -rf test scripts
  zip -qr "$WORK/package.zip" .
)
az functionapp deployment source config-zip -n "$APP_NAME" -g "$RESOURCE_GROUP" --src "$WORK/package.zip" -o none
rm -rf "$WORK"

API="https://$(az functionapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --query defaultHostName -o tsv)/api"

say "GitHub Actions 自动部署的身份（只信任 $REPO 的 main 分支，只能部署这一个函数应用）"
az identity create -n "$IDENTITY" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
CLIENT_ID=$(az identity show -n "$IDENTITY" -g "$RESOURCE_GROUP" --query clientId -o tsv)
PRINCIPAL_ID=$(az identity show -n "$IDENTITY" -g "$RESOURCE_GROUP" --query principalId -o tsv)
az identity federated-credential create -n github-main --identity-name "$IDENTITY" -g "$RESOURCE_GROUP" \
  --issuer https://token.actions.githubusercontent.com --subject "repo:$REPO:ref:refs/heads/main" \
  --audiences api://AzureADTokenExchange -o none 2>/dev/null || true
APP_ID=$(az functionapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
for i in 1 2 3 4 5; do  # 新建的身份要过一会儿才能被授权
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
    --role "Website Contributor" --scope "$APP_ID" -o none 2>/dev/null && break
  sleep 15
done

say "生成第一期"
for i in $(seq 1 12); do
  if curl -fsS -X POST -H "x-admin-key: $ADMIN_KEY" "$API/admin/run" >/dev/null 2>&1; then
    echo "已开始生成，几分钟后打开 $API/editions/latest 查看"
    break
  fi
  [ "$i" = 12 ] && warn "函数应用还没就绪，稍后手动触发：curl -X POST -H 'x-admin-key: <管理密钥>' $API/admin/run"
  sleep 10
done

say "完成"
cat <<EOF
后端地址：$API

到 GitHub 仓库 Settings → Secrets and variables → Actions → Variables，添加这 5 个变量
（都不是密钥，只是名字和编号；有了它们，合并到 main 就会自动部署服务器和发布 App）：

  AZURE_CLIENT_ID          $CLIENT_ID
  AZURE_TENANT_ID          $TENANT_ID
  AZURE_SUBSCRIPTION_ID    $SUB_ID
  AZURE_FUNCTIONAPP_NAME   $APP_NAME
  NEWS_API_BASE            $API

管理密钥（手动触发生成用）随时可以这样查看：
  az functionapp config appsettings list -n $APP_NAME -g $RESOURCE_GROUP --query "[?name=='ADMIN_KEY'].value" -o tsv
看运行日志：Azure 门户 → $APP_NAME → 监视 → 日志（Application Insights）
EOF

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && [ "$(ask '检测到已登录 gh，要直接把这 5 个变量写进仓库吗？[Y/n] ')" != "n" ]; then
  gh variable set AZURE_CLIENT_ID -R "$REPO" -b "$CLIENT_ID"
  gh variable set AZURE_TENANT_ID -R "$REPO" -b "$TENANT_ID"
  gh variable set AZURE_SUBSCRIPTION_ID -R "$REPO" -b "$SUB_ID"
  gh variable set AZURE_FUNCTIONAPP_NAME -R "$REPO" -b "$APP_NAME"
  gh variable set NEWS_API_BASE -R "$REPO" -b "$API"
  echo "已写入。发布 App："
  gh workflow run news-app.yml -R "$REPO" --ref main && echo "已触发「科技晨读（App）」工作流，几分钟后出现在 https://$PAGES_HOST/${REPO#*/}/news/"
else
  echo "加好变量后，到 Actions 页面手动运行一次「科技晨读（App）」工作流，App 就会发布到 https://$PAGES_HOST/${REPO#*/}/news/"
fi
