/**
 * BLE 常量。全部取自 9eSIM 官方 eLPA 固件源码（github.com/9esim/eLPA，
 * src/ble_sim_uart_tt.cpp，提交 e0bd5dc），并与 MiniToolFirmware 中
 * V2.1.0 / V2.2.1 固件二进制里的字符串核对一致。
 */

/** 固件中 `BLEDevice::init("eSIM_Writer")` 设置的广播名。 */
export const DEVICE_NAME = 'eSIM_Writer';

/** 类 Nordic UART Service。 */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/** 浏览器 → 设备（固件里是 PROPERTY_WRITE，仅支持带响应写入）。 */
export const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
/** 设备 → 浏览器（PROPERTY_NOTIFY | PROPERTY_READ）。 */
export const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

/**
 * 固件 `#define BLE_MTU 256`。
 *
 * - 接收：onWrite 收到的值按 256 字节切成多个 ble_pack_t 放入队列，
 *   recv_data_task 对 **每一包单独** 调用 message_handler()。所以超过 256 字节的
 *   命令会被拆成两条互不相干的“命令”执行，而不是被重组。
 * - pack.data 是 256 字节数组，满 256 字节时没有 '\0' 结尾。
 *
 * 因此单条命令（UTF-8 编码后）必须 ≤ 255 字节，并且必须在一次 Characteristic
 * Write 中完整发出。超过时本应用直接拒绝发送，绝不截断或分包。
 */
export const FIRMWARE_RX_PACK_SIZE = 256;
export const MAX_COMMAND_BYTES = FIRMWARE_RX_PACK_SIZE - 1;

/** 固件发送时也按 256 字节一段调用 notify()，消息之间没有任何分隔符。 */
export const FIRMWARE_TX_CHUNK_SIZE = 256;

/** Web Bluetooth 规范允许的单次特征值写入上限。 */
export const WEB_BLUETOOTH_MAX_WRITE = 512;
