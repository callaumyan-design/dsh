# 起始页说明

网站首页（`index.html`）是一个个人导航起始页：时钟、搜索框、AI 问答、功能导航、设置面板。
纯静态网站，没有构建步骤，也没有任何第三方依赖——把仓库里的文件原样放到任何静态托管上就能用。

原首页（README）的内容在 `/about/`。

## 文件在哪

| 想改什么 | 改哪个文件 |
| --- | --- |
| 导航入口 | `config/nav.js` |
| 默认背景、AI（catgpt）地址 | `config/site.js` |
| 页面名称（浏览器标签、主屏幕图标下的名字） | `index.html` 里的 `<title>`，`manifest.webmanifest` 里的 `name` / `short_name` |
| 样式 | `assets/css/main.css` |
| 功能代码 | `assets/js/`（每个文件开头有一句话说明它管什么） |
| /about 页面 | `about/index.html`（README 改了要手动同步这里） |

## 新增一个导航入口

1. 打开 `config/nav.js`。
2. 在 `export default [` 和最后的 `];` 之间加一段（注意每行末尾的逗号）：

   ```js
   {
     name: "名称",
     icon: "globe",
     url: "https://example.com/",
     desc: "一句话描述",
     group: "分组名",
     newTab: true,
   },
   ```

3. `icon` 可以填：本地图标库里的名字（`assets/js/icons.js` 里每一行开头引号里的词，如 `globe`、`download`、`cat`）、
   仓库里一张图片的路径（如 `./assets/img/logo.png`）、或者一个表情 / 一两个字。
4. 保存、提交、上线。分组名相同的入口会排在一起；分组的先后按它们在文件里第一次出现的顺序。

后台、管理面板这类**私密入口不要写进这个文件**（它是公开的）。在页面右上角点铅笔按钮进入编辑模式，
用“添加入口”来加——只保存在你自己这台设备的浏览器里。

一个入口都没有时，导航区不显示，首页只有时钟和搜索框。

## 换默认背景

打开 `config/site.js`：

- 换成另一套内置背景：把 `DEFAULT_BACKGROUND = "aurora"` 改成 `"dusk"`（暮色）或 `"mist"`（晨雾）。
- 用自己的图片：把图片放进仓库（比如 `assets/img/bg.jpg`），在 `BACKGROUND_PRESETS` 里把某一套的
  `css: "..."` 那一行换成 `image: "./assets/img/bg.jpg"`，再把 `color` 改成和图片主色接近的颜色
  （图片加载出来之前先显示它），`tone` 按图片偏暗 / 偏亮填 `"dark"` / `"light"`。

默认背景只影响“还没自己设置过背景”的访客；每个人在设置面板里选的背景只存在他自己的浏览器里。

## 接入 AI（catgpt）

`config/site.js` 里的 `AI`：

| 填法 | 效果 |
| --- | --- |
| 两个地址都空着（现在的状态） | AI 模式提示“还没有接入”，并提供“改用搜索引擎搜” |
| 只填 `pageUrl` | 提问后带着 `?q=问题` 跳转到 catgpt 页面 |
| 填了 `apiUrl` | 在起始页里弹出对话面板，直接调用 catgpt 后端，流式显示 |

**这里只能填地址。API Key 绝不能写进这个仓库的任何文件**，它只应该存在于 catgpt 的服务端。

要让“弹出对话面板”能用，catgpt 的后端需要满足（接口格式不同的话，只需改 `assets/js/ai/client.js` 这一个文件）：

1. **对话接口**：`POST`，请求体 `{ "messages": [{ "role": "user", "content": "..." }], "stream": true }`；
   回复是 SSE 流（OpenAI 兼容格式），也接受纯文本流或一次性 JSON。
2. **跨域白名单**：允许起始页所在的域名访问——
   `Access-Control-Allow-Origin: <起始页域名>`，`Access-Control-Allow-Headers: Content-Type, Authorization`，并正确回应 `OPTIONS` 预检请求。
3. **访问密码**（建议）：从服务端环境变量读取；请求头里带 `Authorization: Bearer <密码>`，没带或不对时返回 `401`。
   起始页会弹出密码输入框，验证通过后在本机记住 30 天。
4. **限流**（建议）：按 IP 做简单限流，超限返回 `429`，起始页会提示“问得太快了”。
5. **`?q=` 参数**：catgpt 的网页读到 `?q=问题` 时自动填入并发送，“在 catgpt 中打开”按钮才有意义。

## 部署

没有构建步骤。用 GitHub Pages 的话：仓库 Settings → Pages → Source 选 “Deploy from a branch”，
Branch 选 `main`、目录选 `/ (root)`，保存即可。之后每次合并到 `main` 都会自动更新。

所有路径都是相对路径，放在域名根目录或子目录（如 `用户名.github.io/dsh/`）下都能用。
“添加到主屏幕”和离线打开需要 https（GitHub Pages 自带）。

## 检查

- 逻辑检查：在仓库根目录运行 `node --test`（需要 Node.js 20 以上，不用安装任何东西）。
- 本地预览：在仓库根目录运行 `python3 -m http.server 8080`，浏览器打开 `http://localhost:8080/`。

## 图标来源

`assets/js/icons.js` 里的图标取自 [Lucide](https://lucide.dev)（ISC 许可，见 `assets/icons/LICENSE-lucide.txt`）。
