# UQ 新成绩推送

自动盯着你在昆士兰大学（UQ）的成绩：

- **Learn.UQ（Blackboard）**：每项作业、测验、考试的成绩；
- **my.UQ**：课程最终成绩。

一有**新成绩发布**或**成绩发生变化**，就通过 [Bark](https://apps.apple.com/app/bark-customed-notifications/id1403753865) 推送到你的 iPhone。只查成绩，不管公告、截止日期。

**全程只读**：程序只“打开页面”和“读取数据”，从不点击提交、从不修改任何东西。
**不保存密码**：你在弹出的浏览器窗口里自己登录（包括多重验证），程序只保留浏览器的登录状态。
**数据只在你的电脑上**：不上传任何数据，没有任何统计。

支持 **Windows 10/11** 和 **macOS**。

---

## 目录

1. [它是怎么工作的](#一它是怎么工作的)
2. [准备工作（只做一次）](#二准备工作只做一次)
3. [第一次使用（按顺序做）](#三第一次使用按顺序做)
4. [日常使用](#四日常使用)
5. [命令一览](#五命令一览)
6. [配置文件说明](#六配置文件说明)
7. [推送长什么样](#七推送长什么样)
8. [出错了怎么办](#八出错了怎么办)
9. [隐私与安全](#九隐私与安全)
10. [给开发者：测试与代码结构](#十给开发者测试与代码结构)

---

## 一、它是怎么工作的

```
登录（一次）  →  探查录制（一次）  →  手动运行一次（记录基准）  →  安装定时任务  →  之后全自动
```

1. **登录**：程序弹出一个浏览器窗口，你像平时一样登录 Learn.UQ 和 my.UQ。登录状态保存在本机。
2. **探查录制**：程序再弹出浏览器，你手动点开每门课的成绩页面。程序在旁边**记录网页背后的数据请求**（自动去掉 cookie、令牌等凭证），然后：
   - 生成一份报告给你检查；
   - 告诉你它识别出了哪些成绩（让你对照网页核对）；
   - 记下以后自动查询要访问的地址。**程序里没有写死任何“猜出来的”网址，全部来自你的这次录制。**
3. **第一次运行**：把当前所有成绩记下来作为对比基准，**不推送**。
4. **之后**：后台每 30–60 分钟（随机）查一次，和上次的记录对比，只有**新出成绩**或**成绩变化**时才推送。

---

## 二、准备工作（只做一次）

### 1. iPhone 上安装 Bark

1. 在 App Store 搜索 **Bark** 并安装（图标是一个铃铛，开发者 Fin）。
2. 打开 Bark，允许通知。
3. Bark 首页会显示一条类似这样的链接：
   `https://api.day.app/AbCdEfGh123456/这里改成你自己的推送内容`
   中间那段 `AbCdEfGh123456` 就是你的**密钥**。等会儿要用，可以先用“复制”按钮复制整条链接，通过备忘录/微信文件传输助手等发到电脑上。

### 2. 下载本工具，放到合适的位置

1. 在 GitHub 仓库页面点绿色的 **Code** 按钮 → **Download ZIP**，下载后解压。
2. 解压出来的文件夹里有一个 **`uq-grade-notifier`** 文件夹，这就是本工具。把它**移动**到下面推荐的位置：

| 系统 | 推荐位置 | 不要放在 |
|---|---|---|
| Windows | `C:\Users\你的用户名\uq-grade-notifier` | 由 OneDrive 同步的“桌面”“文档”里（成绩和登录状态会被同步到云端） |
| Mac | 个人文件夹 `/Users/你的用户名/uq-grade-notifier`（在访达里按 ⇧⌘H 打开个人文件夹） | “桌面”“文稿”“下载”里（macOS 不允许后台任务访问这几个文件夹，定时任务会失败；而且可能被 iCloud 同步） |

> 路径里最好不要有中文和空格（有也能用，但出问题时更难排查）。

### 3. 打开终端

之后所有命令都是在“终端”里**输入一行，按回车**。

- **Windows**：点开始菜单，输入 `PowerShell`，打开 **Windows PowerShell**（蓝色或黑色窗口）。
- **Mac**：按 `⌘ + 空格`，输入 `终端`（或 `Terminal`），按回车。

> 复制命令时只复制代码框里的内容。粘贴：Windows PowerShell 里**点鼠标右键**；Mac 终端里按 `⌘V`。

### 4. 安装 uv（它会自动帮你装好 Python 和其他依赖）

**Windows**（在 PowerShell 里粘贴这一整行，回车）：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**Mac**（在终端里粘贴这一整行，回车）：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

装完以后，**把终端窗口关掉，再重新打开一个**，然后输入下面这行检查：

```
uv --version
```

看到类似 `uv 0.x.x` 就说明装好了。

### 5. 进入工具文件夹

**每次新打开终端，都要先进入工具文件夹**，后面的命令才能用。

- **Windows**（工具放在推荐位置时）：
  ```powershell
  cd $HOME\uq-grade-notifier
  ```
- **Mac**（工具放在推荐位置时）：
  ```bash
  cd ~/uq-grade-notifier
  ```

> 放在别处也没关系：先输入 `cd`，再输入一个空格，然后**把文件夹从资源管理器/访达直接拖进终端窗口**，按回车即可。

### 6. 安装依赖和浏览器

依次运行这两行（第一次会下载 Python、依赖和一个专用的 Chromium 浏览器，共两三百 MB，需要几分钟）：

```
uv sync
uv run playwright install chromium
```

最后一行没有红色报错就算成功。

---

## 三、第一次使用（按顺序做）

以下命令都在**工具文件夹里**运行（见上面第 5 步）。

### 第 1 步：填写推送设置

```
uv run uqgrades init
```

程序会问三个问题：

1. **Bark 密钥**：粘贴刚才复制的 Bark 链接（整条链接或只粘贴密钥都行），回车。
2. **隐私模式**：输入 `y` 回车表示打开（锁屏通知只显示“某门课有新成绩”，不显示分数）；直接回车表示不打开。
3. **免打扰时段**：直接回车使用 `23:00-07:00`；输入别的时段如 `00:00-08:00`；输入 `无` 表示不设置。

完成后会生成 `config.toml`，以后想改可以直接编辑它（见[第六节](#六配置文件说明)）。

### 第 2 步：测试推送

```
uv run uqgrades test-push
```

iPhone 应该收到 2 条通知：一条“UQ 成绩推送测试”，一条示例成绩（内容是假的）。没收到请看[出错了怎么办](#八出错了怎么办)。

### 第 3 步：登录 UQ

```
uv run uqgrades login
```

1. 会弹出一个浏览器窗口，里面有 **Learn.UQ** 和 **my.UQ** 两个标签页。
2. 在浏览器里正常登录（输入学号密码、完成多重验证）。两个标签页都要能看到登录后的页面；第二个标签页如果还停在登录页，刷新一下即可。
3. 如果出现 **“保持登录 / Stay signed in / Remember me”**，请选**是**，这样登录能维持更久。
4. 回到终端窗口，按**回车**。

看到下面这样就成功了：

```
  Learn.UQ：已登录 ✓
  my.UQ：已登录 ✓
登录状态已保存。
```

> 程序**不会**看到或保存你的密码。它只保存浏览器本身的登录状态（和你平时浏览器“记住登录”是一回事），存在 `data/` 文件夹里。

### 第 4 步：探查录制

```
uv run uqgrades probe
```

1. 会弹出浏览器（已经是登录状态；如果要求登录，就在里面再登录一次）。
2. **依次打开每门课的成绩页面**：
   - **Learn.UQ**：建议先打开 **Courses（课程列表）** 页面看一眼（这样程序能学会“内部编号 ↔ 课程代码”的对应关系），然后进入每一门课 → 左侧菜单的 **My Grades**（或 Ultra 课程的 **Grades / 成绩**）。
   - **my.UQ**：找到显示课程成绩的页面（例如 **Results / Grades / My grades**）。
3. **每打开一个成绩页面、看到成绩以后，回到终端按一次回车**。终端会显示“已保存 N 个页面快照……识别出 X 条成绩记录”。
4. 所有页面都看完后，在终端输入 **`q`** 再按回车（按 `Ctrl+C` 也可以，已记录的内容会保存）。

结束后，终端会列出：

- **识别出的成绩**：请对照网页核对课程代码、评估项名称和分数是否正确；
- **以后自动查询会访问的地址**；
- **探查报告的位置**，例如 `data/probe/20261117-143000/report.md`。

打开报告检查（用记事本、文本编辑或 VS Code 都行）：

- Windows：`notepad data\probe\<时间>\report.md`，或运行 `explorer data\probe` 打开文件夹后双击；
- Mac：`open -e data/probe/<时间>/report.md`，或运行 `open data/probe` 打开文件夹。

报告里有：识别出的成绩、要用到的地址、所有记录到的请求（地址、方法、状态）、每个 JSON 返回内容的**数据结构**、登录过程经过的主机。cookie、Authorization、token、session、nonce 等凭证都已去掉。

> **如果识别结果不对，或者一条都没识别出来**：说明 UQ 网页的实际格式和现有解析器不一样。请先自己检查报告（里面有你的成绩、姓名等个人信息，但没有凭证），确认可以分享后，把整个 `data/probe/<时间>/` 文件夹交给开发者（例如在 Claude 里上传），按真实格式补一个解析器即可。这正是“先探查、再实现”的设计：解析器要以真实录制为准。

### 第 5 步：手动运行一次（记录基准）

```
uv run uqgrades run
```

程序会在后台（不弹窗口）打开刚才记录的地址，读取成绩。第一次运行会显示：

```
这是第一次运行：当前成绩已记录为对比基准，不发送推送。以后有新成绩或变化时才推送。
```

### 第 6 步：安装定时任务

```
uv run uqgrades install
```

- **Windows**：在“任务计划程序”里创建一个叫 `UQGradesNotifier` 的任务；用电池时也运行，不会弹出黑色窗口；电脑睡眠时错过的会在醒来后补上。
- **Mac**：在 `~/Library/LaunchAgents/` 里创建 `com.uqgrades.notifier.plist`，由系统的 launchd 定时运行。

定时任务每 10 分钟“醒来”一次，程序自己判断：没到时间就什么都不做；到时间了（距上次 30–60 分钟随机）才真正查询；在免打扰时段内不查询。

到这里就全部设置好了 🎉

---

## 四、日常使用

- **什么都不用做**。电脑开着、登录着你的系统账户（锁屏也可以），就会自动查询。电脑睡眠或关机时不查询，醒来后会补上。
- **收到“请重新登录”的推送**：打开终端，进入工具文件夹，运行
  ```
  uv run uqgrades login
  ```
  登录后下一次定时查询会马上恢复。同一次失效只提醒一次（24 小时后还没处理会再提醒）。
- **新学期 / 选课变了**：重新运行 `uv run uqgrades probe`，把新课程的成绩页面都打开一遍。默认会**替换**原来的地址列表；如果只想**追加**某门课，用 `uv run uqgrades probe --add`。新加入的页面第一次抓到的成绩只作为基准，不会一下子推送一大堆。
- **看看现在怎么样了**：
  ```
  uv run uqgrades status
  ```
  会显示：配置、定时任务是否安装、上次和下次查询时间、连续失败次数、登录是否失效、最近的成绩变化。
- **想马上查一次**：`uv run uqgrades run`（只查不推送：`uv run uqgrades run --no-push`）。
- **暂停**：`uv run uqgrades uninstall`；**恢复**：`uv run uqgrades install`。
- **改设置**：直接编辑 `config.toml`，保存后下一次查询就生效，不用重装定时任务（只有 `wake_interval_minutes` 改了以后需要重新运行一次 `install`）。

---

## 五、命令一览

都要在工具文件夹里、以 `uv run uqgrades` 开头：

| 命令 | 作用 |
|---|---|
| `uv run uqgrades init` | 生成配置文件（Bark 密钥、隐私模式、免打扰时段）。`--force` 覆盖已有配置 |
| `uv run uqgrades login` | **登录**：弹出浏览器手动登录，保存登录状态 |
| `uv run uqgrades probe` | **探查录制**：手动打开成绩页面，记录数据请求并生成报告。`--add` 追加而不替换 |
| `uv run uqgrades run` | **手动运行一次**。`--no-push` 只查询不推送 |
| `uv run uqgrades test-push` | **发送测试推送** |
| `uv run uqgrades install` | **安装定时任务** |
| `uv run uqgrades uninstall` | **卸载定时任务** |
| `uv run uqgrades status` | 查看状态 |
| `uv run uqgrades tick` | 给定时任务用的，一般不用手动运行 |
| `uv run uqgrades --help` | 显示帮助 |

---

## 六、配置文件说明

配置文件是工具文件夹里的 `config.toml`（由 `init` 生成，模板是 `config.example.toml`）。

- Windows 用**记事本**打开：`notepad config.toml`
- Mac 用**文本编辑**打开：`open -e config.toml`

写法规则：文字用英文双引号括起来，开关写 `true` / `false`，`#` 开头的行是说明。

| 设置 | 默认值 | 说明 |
|---|---|---|
| `[bark] key` | — | Bark 密钥（或整条 Bark 链接） |
| `[bark] server` | `"https://api.day.app"` | Bark 服务器；自建服务器就填自己的地址 |
| `[bark] privacy_mode` | `false` | 隐私开关：`true` 时通知只显示“某门课有新成绩” |
| `[bark] group` | `"UQ 成绩"` | 推送在 Bark 里的分组 |
| `[bark] level` | `"active"` | `"timeSensitive"` 可以在专注模式下也提醒；`"passive"` 静默 |
| `[bark] sound` | `""` | 提示音名称，留空用默认 |
| `[schedule] min_interval_minutes` | `30` | 查询间隔下限（分钟，不能小于 5） |
| `[schedule] max_interval_minutes` | `60` | 查询间隔上限，实际间隔在上下限之间随机 |
| `[schedule] max_backoff_minutes` | `360` | 出错时间隔逐次加倍，最长不超过这个值 |
| `[schedule] quiet_hours` | `"23:00-07:00"` | 免打扰时段，可写多个：`"23:00-07:00, 12:00-13:00"`；`""` 表示不设置 |
| `[schedule] wake_interval_minutes` | `10` | 定时任务唤醒频率（改了要重新 `install`） |
| `[advanced] browser_channel` | `""` | 改用系统浏览器：`"msedge"`（Windows 自带）或 `"chrome"` |
| `[advanced] extra_login_patterns` | `[]` | 额外的“登录页面”识别规则（一般不用改） |

**出错时会怎样**：连续失败时间隔会逐步拉长（例如 60 → 120 → 240 → 360 分钟），恢复正常后立刻回到 30–60 分钟。连续失败 3 次会推送一次“查询连续失败”提醒。

---

## 七、推送长什么样

**普通模式**（同一门课的多项变化合并成一条，点通知直接打开对应成绩页面）：

```
COMP3506 有新成绩                       ← 标题
Learn.UQ                                ← 副标题
Quiz 1：8/10                            ← 内容
```

```
MATH1051 成绩有变化
Learn.UQ
Problem Set 1：18/20 → 19/20
```

```
COMP3506 有新成绩
my.UQ
最终成绩（Semester 2, 2026）：7
```

**隐私模式**（不显示评估项名称和分数）：

```
UQ 成绩提醒
Learn.UQ
MATH1051 有新成绩
```

**其他提醒**：

- `UQ 成绩推送：请重新登录` —— 登录失效，按提示运行 `uv run uqgrades login`。
- `UQ 成绩推送：查询连续失败` —— 运行 `uv run uqgrades status` 看原因。
- `UQ 成绩推送：有页面读不到成绩了` —— 某个页面以前能读到成绩，最近 3 次都读不到，可能登录失效或网页改版。先 `login`，不行再 `probe`。

---

## 八、出错了怎么办

先运行 `uv run uqgrades status` 看看状态；详细日志在 `data/logs/uqgrades.log`（Windows：`notepad data\logs\uqgrades.log`；Mac：`open -e data/logs/uqgrades.log`）。

### 安装相关

**输入 `uv` 提示“无法将‘uv’项识别为 cmdlet……”（Windows）或 `command not found: uv`（Mac）**
- 装完 uv 以后要**关掉终端重新打开**。
- Mac 仍然不行：运行 `source $HOME/.local/bin/env`，或者重启电脑。
- Windows 仍然不行：重启电脑后再试；或者重新运行一遍安装 uv 的命令。

**Windows 提示“因为在此系统上禁止运行脚本”**
- 安装 uv 时请原样使用上面那条带 `-ExecutionPolicy ByPass` 的命令。

**`uv sync` 下载很慢或失败**
- 检查网络；如果开了 VPN/代理，试试关掉或换一个节点后重新运行 `uv sync`（可以重复运行，不会出问题）。

**提示“找不到 Playwright 的浏览器。请先运行：uv run playwright install chromium”**
- 照做即可。

**命令提示 `No such file or directory: pyproject.toml` 或 `uqgrades` 找不到**
- 你没有在工具文件夹里。先 `cd` 进入工具文件夹（见[第二节第 5 步](#5-进入工具文件夹)）。

### 推送相关

**`test-push` 提示“Bark 服务器说密钥不对”**
- 重新从 Bark App 复制链接，运行 `uv run uqgrades init --force` 重新填写。

**`test-push` 提示“连不上 Bark 服务器”**
- 检查电脑网络；公司/学校网络可能拦截，换个网络或关掉代理试试。

**命令显示发送成功，但 iPhone 没收到**
- iPhone“设置 → 通知 → Bark”里允许通知；
- 检查是否开了专注模式/勿扰；需要在专注模式下也提醒，可以把 `level` 改成 `"timeSensitive"`；
- 打开 Bark App 看看历史记录里有没有。

### 登录相关

**`login` 结束后显示“未登录 ✗”**
- 要等浏览器里**看到登录后的页面**（例如 Learn.UQ 的课程/动态页面）再回终端按回车。
- 第二个标签页（my.UQ）停在登录页时，在那个标签页里刷新或登录一下。

**提示“浏览器配置正被另一个窗口占用”**
- 之前打开的 login / probe 浏览器窗口没关。关掉它们再试。

**提示“另一个查询或登录正在进行中”**
- 后台定时任务正在查询，等一两分钟再试。

**经常收到“请重新登录”**
- 登录时选择“保持登录 / Stay signed in”。登录能维持多久由 UQ 的安全策略决定，多重验证过期后必须重新登录，这是正常的。

### 探查 / 识别相关

**探查后显示“没有识别出任何成绩”**
- 确认打开的是**成绩页面**，并且**看到成绩之后**才按回车。
- 仍然不行，说明网页格式需要适配：检查报告后，把 `data/probe/<时间>/` 文件夹交给开发者（例如 Claude），按真实格式补解析器。

**识别出的课程代码是 `_123456_1` 这种编号**
- 重新 `probe`，这次先打开 Learn.UQ 的 **Courses（课程列表）** 页面并按回车，程序就能学到编号和课程代码的对应关系。

**识别结果有多余的项或缺项**
- 同样把报告交给开发者调整解析规则。

### 定时任务相关

**定时任务好像没在运行**
- 运行 `uv run uqgrades status`，看“定时任务：已安装”和“上次查询”时间。
- Windows：开始菜单搜“任务计划程序” → 左侧“任务计划程序库” → 找到 `UQGradesNotifier`，看“上次运行结果”。也可以右键 →“运行”。
- Mac：在终端运行 `launchctl list | grep uqgrades`，有一行输出说明已加载；错误信息在 `data/logs/launchd.err.log`。

**Mac：安装定时任务时提示工具文件夹在“桌面/文稿/下载”里**
- 按提示把整个文件夹移到个人文件夹，然后在新位置运行 `uv sync` 和 `uv run uqgrades install`。

**我移动了工具文件夹 / 改了文件夹名字**
- 在新位置依次运行：`uv sync`、`uv run uqgrades install`。

**Windows 上 `install` 提示“拒绝访问”**
- 极少数公司电脑禁止普通用户创建计划任务。可以右键 PowerShell 选“以管理员身份运行”再试。

### 配置文件相关

**提示“配置文件有问题……格式有误”**
- 文字两边要用英文双引号 `"..."`。中文引号程序会自动纠正，但其他符号（如中文冒号、中文逗号）需要改成英文的。
- Mac 的“文本编辑”可能把文件变成富文本：菜单“格式 → 制作纯文本”后再保存。
- 实在改乱了：`uv run uqgrades init --force` 重新生成。

### 彻底删除

1. `uv run uqgrades uninstall`
2. 删除整个工具文件夹（里面的 `data/` 就是全部登录状态和成绩记录）。
3. 如果不再使用 Bark，也可以在 iPhone 上删除 Bark。

---

## 九、隐私与安全

- **不保存密码**：登录在你自己操作的浏览器窗口里完成，程序只读取浏览器的登录状态（cookie）。
- **所有个人数据都在 `data/` 文件夹里，只在本机**：
  - `data/browser-profile/`：浏览器登录状态；
  - `data/session-cookies.json`：浏览器关闭时会丢失的“会话 cookie”的备份（下次启动时补回去，否则每次都要重新登录）；
  - `data/grades.sqlite3`：成绩记录和变化历史；
  - `data/targets.json`：探查得到的查询地址；
  - `data/probe/`：探查报告；
  - `data/logs/`：运行日志。
- `config.toml`（含 Bark 密钥）和整个 `data/` 都写进了 `.gitignore`，不会被提交到 Git。
- **只读**：自动查询时只发送读取请求（GET）、只打开页面，从不提交表单或修改数据。
- **不上传任何数据、没有任何统计**。程序对外只连接三个地方：Learn.UQ、my.UQ（读取你的成绩），以及 Bark 服务器（发送推送）。
- **注意**：推送内容会经过 Bark 的服务器转发到你的 iPhone。如果不希望分数经过第三方服务器，可以打开隐私模式（推送里只有课程代码），或者自建 Bark 服务器。
- 探查报告去掉了凭证，但**仍然包含成绩、姓名、学号等个人信息**，分享前请检查。

---

## 十、给开发者：测试与代码结构

运行全部自动化测试：

```
uv run pytest
```

测试会在本机启动一组**假的 UQ 网站**（SSO 登录服务器、Learn.UQ、my.UQ）和**假的 Bark 服务器**，用真实的无头 Chromium 完整走一遍：登录 → 探查录制 → 第一次运行只记基准 → 成绩变化推送 → 隐私模式 → 单点登录自动续期 → 登录失效只提醒一次 → 重新登录后恢复；并检查探查记录里没有泄露任何 cookie、令牌、密码。`tests/test_interactive_cli.py` 用“看得见的”浏览器把 `login → probe → run → tick → status` 这些命令完整跑一遍（Linux 上用 Xvfb；Windows/macOS 上设置环境变量 `UQGRADES_HEADED_TESTS=1` 才运行，会弹出浏览器窗口）。

代码结构（`src/uqgrades/`）：

| 文件 | 作用 |
|---|---|
| `cli.py` | 命令行入口 |
| `config.py` | 读取和检查 `config.toml` |
| `browser.py` | 持久化浏览器、会话 cookie 备份、等待页面稳定、登录页识别 |
| `login.py` | 交互式登录 |
| `probe.py` | 探查录制、生成报告 |
| `sanitize.py` | 去掉凭证（请求头白名单、敏感字段、令牌、网页隐藏字段） |
| `targets.py` | 从录制结果挑出抓取目标（数据接口 / 网页 / 浏览器打开） |
| `fetcher.py` | 按目标抓取（只读） |
| `extract/` | 解析器：Blackboard My Grades 网页、Blackboard 成绩 JSON、my.UQ 通用 JSON / 表格 |
| `detect.py` | 和上次记录对比，找出新成绩 / 变化 |
| `store.py` | SQLite 本地记录 |
| `notify.py` | Bark 推送（含隐私模式） |
| `schedule.py` | 随机间隔、出错退避、免打扰时段 |
| `runner.py` | 一次完整查询 + 定时任务调度 |
| `service.py` | Windows 任务计划程序 / macOS launchd 安装卸载 |

**根据真实探查结果补解析器**：Learn.UQ 部分按 Blackboard 的标准格式（原版课程 My Grades 网页、Ultra 的成绩栏 + 成绩 JSON）编写；my.UQ 部分目前是通用识别（同一对象里有课程代码和成绩字段的 JSON、表头含 Course 和 Grade 的表格）。拿到真实的探查报告后，如果识别不准，在 `extract/` 里按真实结构加一个解析器，并把报告里的数据结构（去掉个人信息后）做成 `tests/fixtures/` 里的测试样例即可。
