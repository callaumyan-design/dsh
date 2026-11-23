/**
 * 检测浏览器是否真的能用 Web Bluetooth。只看 `navigator.bluetooth` 是否存在不够：
 * - 必须是安全上下文（https:// 或 http://localhost）；
 * - Brave 默认关闭该 API；Linux 版 Chrome 可能需要打开实验性开关；
 * - iOS 上所有浏览器都是 WebKit 内核，均不支持；Safari / Firefox 也不支持；
 * - 即便 API 存在，电脑也可能没有蓝牙适配器（getAvailability() 为 false）。
 */

export type Availability = 'unknown' | 'available' | 'unavailable';

export interface PlatformInfo {
  isIOS: boolean;
  isAndroid: boolean;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  isChromeOS: boolean;
  isSafari: boolean;
  isFirefox: boolean;
  isChromium: boolean;
  isBrave: boolean;
}

export type FrameContext = 'top' | 'same-origin-frame' | 'cross-origin-frame';

export interface BluetoothSupport {
  apiPresent: boolean;
  /** 页面是否被嵌入 iframe。Chrome 禁止跨源 iframe 调用 requestDevice。 */
  frame: FrameContext;
  /** 权限策略是否允许 bluetooth（null 表示浏览器不支持查询）。 */
  policyAllows: boolean | null;
  secureContext: boolean;
  protocol: string;
  hostname: string;
  availability: Availability;
  platform: PlatformInfo;
  /** API 存在且处于安全上下文——可以尝试打开设备选择器。 */
  usable: boolean;
  /** 给用户看的问题列表（中文）。为空表示没有发现问题。 */
  problems: string[];
  /** 给用户看的建议。 */
  hints: string[];
}

interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  bluetooth?: Bluetooth;
  brave?: unknown;
}

export function detectPlatform(nav: NavigatorLike): PlatformInfo {
  const ua = nav.userAgent || '';
  const isIPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || isIPadOS;
  const isAndroid = /Android/.test(ua);
  const isChromeOS = /CrOS/.test(ua);
  const isFirefox = /Firefox\/|FxiOS/.test(ua);
  const isChromium = /Chrome\/|Chromium\/|Edg\/|CriOS/.test(ua) && !isFirefox;
  const isSafari = /Safari\//.test(ua) && !isChromium && !isFirefox && !/Android/.test(ua);
  return {
    isIOS,
    isAndroid,
    isMac: /Macintosh|Mac OS X/.test(ua) && !isIOS,
    isWindows: /Windows/.test(ua),
    isLinux: /Linux/.test(ua) && !isAndroid && !isChromeOS,
    isChromeOS,
    isSafari,
    isFirefox,
    isChromium,
    isBrave: typeof nav.brave === 'object' && nav.brave !== null,
  };
}

export function evaluateSupport(input: {
  nav: NavigatorLike;
  secureContext: boolean;
  protocol: string;
  hostname: string;
  availability?: Availability;
  frame?: FrameContext;
  policyAllows?: boolean | null;
}): BluetoothSupport {
  const { nav, secureContext, protocol, hostname } = input;
  const frame = input.frame ?? 'top';
  const policyAllows = input.policyAllows ?? null;
  const platform = detectPlatform(nav);
  const apiPresent = typeof nav.bluetooth === 'object' && nav.bluetooth !== null && typeof nav.bluetooth.requestDevice === 'function';
  const availability = input.availability ?? 'unknown';
  const problems: string[] = [];
  const hints: string[] = [];

  if (!secureContext) {
    problems.push(`当前页面不是安全上下文（${protocol}//${hostname}）。Web Bluetooth 只能在 https:// 或 http://localhost 下使用。`);
    hints.push('本地开发请用 `npm run dev` 后访问 http://localhost:5173；部署时必须使用 HTTPS。');
  }

  if (!apiPresent) {
    if (platform.isIOS) {
      problems.push('iOS / iPadOS 上的所有浏览器（包括 Chrome、Edge）都使用 WebKit 内核，不支持 Web Bluetooth。');
      hints.push('请改用电脑（Windows / macOS / Linux / ChromeOS）上的 Chrome 或 Edge，或 Android 上的 Chrome。');
    } else if (platform.isSafari) {
      problems.push('Safari 不支持 Web Bluetooth。');
      hints.push('请使用 Chrome、Edge 或其他 Chromium 内核浏览器。');
    } else if (platform.isFirefox) {
      problems.push('Firefox 不支持 Web Bluetooth。');
      hints.push('请使用 Chrome、Edge 或其他 Chromium 内核浏览器。');
    } else if (platform.isBrave) {
      problems.push('Brave 默认关闭了 Web Bluetooth。');
      hints.push('在 brave://flags/#brave-web-bluetooth-api 中启用后重启浏览器。');
    } else if (platform.isChromium && platform.isLinux) {
      problems.push('此 Linux 版 Chromium 没有暴露 Web Bluetooth API。');
      hints.push('尝试在 chrome://flags/#enable-experimental-web-platform-features 中启用实验性功能，并确认 BlueZ 正常运行。');
    } else if (secureContext) {
      problems.push('此浏览器没有提供 navigator.bluetooth。');
      hints.push('请使用桌面版 Chrome / Edge（版本 ≥ 70）或 Android 版 Chrome。');
    }
  }

  if (apiPresent && frame === 'cross-origin-frame') {
    problems.push('本页面被嵌入在其他网站的 iframe 中。Chrome 不允许跨源 iframe 使用 Web Bluetooth。');
    hints.push('请在浏览器新标签页中直接打开本页面。');
  } else if (apiPresent && policyAllows === false) {
    problems.push('页面的权限策略（Permissions-Policy）禁止使用蓝牙。');
    hints.push('请在浏览器新标签页中直接打开本页面，或检查托管服务器的 Permissions-Policy 响应头。');
  }

  if (apiPresent && availability === 'unavailable') {
    problems.push('浏览器报告当前没有可用的蓝牙适配器（navigator.bluetooth.getAvailability() = false）。');
    hints.push('请确认电脑蓝牙已打开、系统已允许浏览器使用蓝牙。');
  }

  return {
    apiPresent,
    frame,
    policyAllows,
    secureContext,
    protocol,
    hostname,
    availability,
    platform,
    usable: apiPresent && secureContext && frame !== 'cross-origin-frame' && policyAllows !== false,
    problems,
    hints,
  };
}

export function detectFrame(): FrameContext {
  if (typeof window === 'undefined' || window.top === window.self) return 'top';
  try {
    // 跨源时访问 top.location.href 会抛异常
    void window.top!.location.href;
    return 'same-origin-frame';
  } catch {
    return 'cross-origin-frame';
  }
}

export function detectPolicy(): boolean | null {
  type Policy = { allowsFeature(f: string): boolean; features?: () => string[] };
  const doc = typeof document !== 'undefined' ? (document as unknown as { permissionsPolicy?: Policy; featurePolicy?: Policy }) : null;
  const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;
  if (!policy) return null;
  try {
    // 浏览器不认识 bluetooth 特性时 allowsFeature 也返回 false，这种情况视为“未知”
    if (typeof policy.features === 'function' && !policy.features().includes('bluetooth')) return null;
    return policy.allowsFeature('bluetooth');
  } catch {
    return null;
  }
}

/** 读取当前浏览器环境。getAvailability 失败不视为致命错误。 */
export async function detectBluetoothSupport(): Promise<BluetoothSupport> {
  const nav = navigator as unknown as NavigatorLike;
  let availability: Availability = 'unknown';
  if (nav.bluetooth && typeof nav.bluetooth.getAvailability === 'function') {
    try {
      availability = (await nav.bluetooth.getAvailability()) ? 'available' : 'unavailable';
    } catch {
      availability = 'unknown';
    }
  }
  return evaluateSupport({
    nav,
    secureContext: window.isSecureContext,
    protocol: location.protocol,
    hostname: location.hostname,
    availability,
    frame: detectFrame(),
    policyAllows: detectPolicy(),
  });
}

export function detectBluetoothSupportSync(): BluetoothSupport {
  return evaluateSupport({
    nav: navigator as unknown as NavigatorLike,
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    protocol: typeof location !== 'undefined' ? location.protocol : '',
    hostname: typeof location !== 'undefined' ? location.hostname : '',
    frame: detectFrame(),
    policyAllows: detectPolicy(),
  });
}
