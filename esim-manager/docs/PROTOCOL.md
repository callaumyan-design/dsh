# 9eSIM 旧版 eLPA 蓝牙协议研究笔记

本文记录本项目实现所依据的源码事实。所有结论都来自源码阅读，**尚未在真实设备上验证**；
实机测试结果与这里不一致时，以实机为准（见 [DEVICE-TESTING.md](DEVICE-TESTING.md)）。

## 研究对象

| 仓库 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| [9esim/eLPA](https://github.com/9esim/eLPA) | `e0bd5dc`（2024-12-20） | 自有代码 MIT；`src/app`、`src/driver`、`src/euicc` 为 lpac 移植（LGPL/AGPL，见其 README）；cJSON MIT | 官方固件源码，协议的主要依据 |
| [9esim/MiniToolFirmware](https://github.com/9esim/MiniToolFirmware) | `9460e52` | MIT | 官方发布的 V2.1.0 / V2.2.1 固件二进制，用来核对源码是否与发布版一致 |
| [iebb/NekokoLPA](https://github.com/iebb/NekokoLPA) | `58ef9ec` | MIT | `SimLinkDevice.ts` 中的 APDU JSON 蓝牙协议 |
| [estkme-group/lpac](https://github.com/estkme-group/lpac) | `654215e` | `src/` AGPL-3.0，`euicc/` LGPL-2.1 | 核对 ES10x 命令与 lpac CLI 行为 |

本项目 **没有复制** 上述项目的代码；ES10x 编码依据 GSMA SGP.22 规范独立实现，仅用 lpac 交叉核对。

### 源码与发布固件是否一致

对 MiniToolFirmware 中两个固件的 `firmware.bin` 做字符串检索：

| 字符串 | V2.1.0 | V2.2.1 |
| --- | --- | --- |
| `eSIM_Writer`、三个 NUS UUID | ✓ | ✓ |
| `getElpaInfo` `getWifiInfo` `setWifiInfo` `upgradeSoftware` `checkUpdate` | ✓ | ✓ |
| `Is not a json message, try to parse it as a command` | ✓ | ✓ |
| `cardStatus` / `cardInserted` | ✗ | ✓ |
| `chipInfo` `profileList` `dataType` | ✓ | ✓ |
| `{"cmd":"APDU"…}` 相关处理 | ✗ | ✗ |

结论：源码对应 V2.2.1（`elpa.cpp` 中 `software = "2.2.1"`）；V2.1.0 没有 `cardStatus`；
两个版本都 **不支持** NekokoLPA 的 APDU JSON 协议。

## BLE 层（`src/ble_sim_uart_tt.cpp`）

- 广播名：`BLEDevice::init("eSIM_Writer")`。广播包中 **没有** 服务 UUID（只调用了 `getAdvertising()->start()`），所以浏览器只能按名称过滤。
- 服务 `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
  - RX `6E400002-…`：`PROPERTY_WRITE`（仅带响应写入）
  - TX `6E400003-…`：`PROPERTY_NOTIFY | PROPERTY_READ`，带 2902 描述符
- `#define BLE_MTU 256`

### 接收：每次写入的每 256 字节被当作一条独立命令

```c
// ble_recv_data()
do {
    pack.rx_len = len > BLE_MTU ? BLE_MTU : len;
    memcpy(pack.data, data + send_len, pack.rx_len);
    xQueueSend(ble_data_queue, &pack, 0);
    ...
} while (len > 0);

// recv_data_task()
message_handler((const char*)pack.data);   // 每一包单独处理
```

- 固件 **不做重组**：超过 256 字节的写入会被拆成两条互不相干的“命令”执行。
- `pack.data` 是 256 字节数组，满 256 字节时没有 `'\0'` 结尾。
- 因此：**单条命令 UTF-8 编码后必须 ≤ 255 字节，并且必须在一次 Characteristic Write 中完整发出**。
  本应用超过上限时直接拒绝，不截断、不分包（`MAX_COMMAND_BYTES = 255`）。
- 浏览器单次写入超过 ATT MTU−3 时，由系统自动使用 Prepared Write（长写）；Arduino-ESP32 BLE 库在
  `ESP_GATTS_EXEC_WRITE_EVT` 时才回调 `onWrite`，所以长写会以一个完整值到达。*（待设备验证）*

### 发送：按 256 字节切段 notify，无分隔符

```c
// ble_send_data()
do {
    send_size = len > BLE_MTU ? BLE_MTU : len;
    pTxCharacteristic->setValue(data + send_len, send_size);
    pTxCharacteristic->notify();
    ...
} while (len > 0);
```

- 每条消息从一次新的 notify 开始，消息之间没有分隔符或长度头。
- 除最后一段外，每段恰好 256 字节。本应用利用这一点做完整性校验：跨多个分片的消息里，
  如果某个中间分片不是 256 字节，说明数据在协议栈被截断（通常是 MTU < 259），即使拼出来的
  JSON 恰好仍然合法也丢弃。（测试中复现过：MTU=185 时截断恰好切在字段边界，拼接结果是合法 JSON
  但缺了 3 个字段。）
- 两段之间没有延时（`vTaskDelay` 被注释掉），极长的回复理论上可能导致协议栈拥塞丢包。

## 命令分发（`src/message_handler.cpp`）

```c
cJSON* root = cJSON_Parse(message);
if (root == NULL) {                       // 不是 JSON → lpac CLI
    if (!card_inserted) { 回复 {"cmd":"cardStatus","cardInserted":false}; return; }   // 仅 V2.2.1
    return parse_command_into_cli(message);
}
cmd = root["cmd"]; 在 {setWifiInfo, getWifiInfo, getElpaInfo, upgradeSoftware, checkUpdate} 中查找
```

- 不认识的 `cmd` **没有任何回复**（这也是向旧固件发送 `{"cmd":"APDU",…}` 不会产生副作用的依据）。
- `cmd` 不是字符串时 `strcmp(NULL, …)` 会崩溃；本应用只发送字符串。

### JSON 控制命令

| 命令 | 回复 | 说明 |
| --- | --- | --- |
| `{"cmd":"getElpaInfo"}` | `{"cmd":"getElpaInfo","data":{ssid,password,connected,rssi,time,hardware,firmware,software,hasNewSoftware,newSoftwareVersion,mac}}` | **含明文 Wi-Fi 密码**。cJSON_Print 格式（带换行/制表符）。NTP 同步后检测到新版本时固件也会主动推送一次 |
| `{"cmd":"getWifiInfo"}` | `{"cmd":"getWifiInfo","data":{ssid,password,connected,rssi,time}}` | 同样含明文密码 |
| `{"cmd":"setWifiInfo","ssid":"…","password":"…"}` | **无回复** | 保存到 NVS 并重连。本应用随后轮询 getWifiInfo 确认 |
| `{"cmd":"checkUpdate"[,"url":"…"]}` | 有新版本时推送 getElpaInfo | 让设备访问更新服务器；**本应用不发送** |
| `{"cmd":"upgradeSoftware"[,"url":"…"]}` | `{"cmd":"upgrade","state":…,"total":…,"current":…}` | 从 URL 下载并刷写固件；公开源码中默认地址为 `https://example.com/` 占位符；**本应用不发送** |

## lpac CLI（`src/lpac_wrapper.cpp` + `src/app/`）

```c
// parse_command_into_cli()
char* argv[20] = { 0 };                 // 没有越界检查
char* p = strtok(cmd, " ");             // 只按空格切分，不支持引号
while (p != NULL) { argv[argc++] = p; p = strtok(NULL, " "); }
return main(argc, argv);                // lpac 的 main
```

```c
// src/app/applet.c: applet_entry()
if (argc < 2) { applet_usage(argv[0], entries); return -1; }
while ((entry = *entries_cpy++))
    if (strcmp(argv[1], entry->name) == 0) return entry->main(argc - 1, argv + 1);
printf("Unknown command: %s\n", argv[1]);   // 只打印到串口
```

**关键发现：argv[0] 被当作程序名。** 发送 `chip info` 会被解析成“程序名 chip、applet info”，
匹配失败后错误只 `printf` 到串口，蓝牙端 **收不到任何回复**。正确格式是：

```
lpac chip info
lpac profile list
```

第一个词可以是任意占位符，本应用固定使用 `lpac`。其他约束：

- 参数中不能有空格（因此昵称不能含空格）；
- 参数总数 ≤ 20（含程序名）；
- 末尾不能带换行（会成为参数的一部分）。

### 回复格式（`src/app/jprint.c`）

```json
{"type":"lpa","payload":{"code":0,"message":"success","dataType":"<类型>","data":<数据或 null>}}
{"type":"lpa","payload":{"code":-1,"message":"<失败的函数名>","data":"<细节>"}}
{"type":"progress","payload":{"code":0,"message":"<函数名>","data":"<细节>","step":n,"total_steps":m}}
```

回复中没有请求 ID。固件在单个任务里串行处理命令，所以本应用同一时间只允许一个请求，
并按 `dataType`（成功）或预期的函数名（失败）匹配回复。

`main.c` 中 `main_init_euicc()` 失败后 **不会退出**（`exit(-1)` 被注释），会先报
`euicc_init` 错误，后续步骤再报一次。本应用把 `euicc_init` 视为非终止错误，等待后续的真正错误。

### 已实现的命令

| 命令 | 成功 dataType | 可能的错误 message | 源码 |
| --- | --- | --- | --- |
| `lpac version` | `version` | — | `applet/version.c` |
| `lpac chip info` | `chipInfo` | `es10c_get_eid` | `applet/chip/info.c` |
| `lpac profile list` | `profileList` | `es10c_get_profiles_info` | `applet/profile/list.c` |
| `lpac profile enable <iccid>` | `enableProfile` | `es10c_enable_profile` | `applet/profile/enable.c` |
| `lpac profile disable <iccid>` | `disableProfile` | `es10c_disable_profile` | `applet/profile/disable.c` |
| `lpac profile delete <iccid>` | `deleteProfile` | `es10c_delete_profile` | `applet/profile/delete.c` |
| `lpac profile nickname <iccid> [名称]` | `setNickname` | `es10c_set_nickname` | `applet/profile/nickname.c` |
| `lpac profile download -s <smdp> [-m <id>] [-c <code>]` | `downloadProfile` | 9 个步骤的函数名等 | `applet/profile/download.c` |
| `lpac profile discovery` | `discovery` | `es11_authenticate_client` 等 | `applet/profile/discovery.c` |
| `lpac notification list` | `notificationList` | `es10b_list_notification` | `applet/notification/list.c` |
| `lpac notification process -a [-r]` | `notificationProcess` | … | `applet/notification/process.c` |
| `lpac notification remove -a` | `notificationRemove` | … | `applet/notification/remove.c` |

`enable` / `disable` 不传 refreshflag，使用固件默认值 0（请求中不带 refreshFlag 字段）。

### 故意不提供的命令

- `lpac chip purge yes`：清空整张 eUICC；
- `lpac chip defaultsmdp <地址>`：修改默认 SM-DP+；
- `upgradeSoftware` / `checkUpdate`：见上文。

诊断页的只读控制台会拒绝这些命令。

## 固件缺陷与对应的处理

| 位置 | 问题 | 本应用的处理 |
| --- | --- | --- |
| `ble_recv_data` | 写入按 256 字节切分后逐包执行，不重组 | 命令 > 255 字节直接拒绝 |
| `applet_entry` | argv[0] 被当作程序名 | 所有 CLI 命令加 `lpac` 前缀 |
| `parse_command_into_cli` | argv[20] 无越界检查；只按空格切分 | 参数数量与空白字符校验 |
| `download.c` `-a` 解析 | `strtok(…, "$")` 合并连续分隔符，空字段导致字段错位 | 在浏览器解析激活码，用 `-s`/`-m`/`-c` 传参 |
| `download.c` 参数循环 | `strncmp(argv[i], "-s", 2)` 前缀匹配所有 argv，包括参数值；选项在末尾时 `argv[i+1]` 为 NULL | 参数值不得以 `-` 开头；总是成对传参 |
| `notification process/remove` | `argc_seq_offset` 在循环中对每个参数都自增，导致按序号处理的循环永远不执行，却仍报告成功 | 只提供 `-a`（全部）操作，并在界面说明 |
| `main.c` | `euicc_init` 失败后继续执行 | 视为非终止错误 |
| `esp32_http.cpp` | `HTTPClient::begin(url)` 未设置 CA 证书；在 Arduino-ESP32 2.x 中这通常意味着不校验 SM-DP+ 的 TLS 证书 *（推断，待核实）* | 无法在网页侧修复；Profile 的真实性仍由 eUICC 在 ES10b AuthenticateServer 中校验 SM-DP+ 证书链（GSMA CI）保证。已在文档中说明 |
| `ble_send_data` | 分段间无延时 | 解析器有超时清理、重新同步与完整性校验 |

## APDU JSON 协议（NekokoLPA）

`src/lpa/adapters/SimLinkDevice.ts` 对名为 `eSIM_Writer` 的设备使用：

```
{"cmd":"APDU","action":0}            打开
{"cmd":"APDU","action":1,"data":hex} 透传 APDU，回复 {"data":"<hex+SW>"}
{"cmd":"APDU","action":2}            关闭
错误：{"error":"APDU channel not open!"} 等
```

另外：GET RESPONSE 的 Le 限制在 0x4F 以内、STORE DATA 分段 63 字节、写入按 MTU 分段。
这说明存在一个支持该协议的（更新的、未开源的）9eSIM 固件，但 **官方 V2.x 固件没有**。

本应用的 `ApduJsonAdapter` 只实现只读的 EID 与 Profile 列表读取，只在用户手动选择或手动探测后使用。
写操作与下载未实现：前者需要先实机验证协议；后者需要浏览器直接访问 SM-DP+ 的 ES9+ 接口，
SM-DP+ 不返回 CORS 头，浏览器无法完成。
