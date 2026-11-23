/**
 * e2e 专用：把固件模拟器 + 伪 Web Bluetooth 打包成 IIFE，通过 page.addInitScript 注入。
 * 这是 Mock BLE，用于验证界面流程，不代表真实硬件验证。
 */
import { FirmwareSimulator, type SimOptions } from '../../src/test/firmwareSimulator';
import { makeFakeBluetooth } from '../../src/test/fakeBluetooth';

declare global {
  interface Window {
    __fakeBle?: { sim: FirmwareSimulator; device: ReturnType<typeof makeFakeBluetooth>['device'] };
    __FAKE_BLE_OPTIONS__?: SimOptions;
  }
}

const sim = new FirmwareSimulator(window.__FAKE_BLE_OPTIONS__ ?? {});
const { bluetooth, device } = makeFakeBluetooth(sim);
Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true });
window.__fakeBle = { sim, device };
