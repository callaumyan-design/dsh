// 搜索框的语音输入：用浏览器自带的语音识别（Web Speech API）。点麦克风按钮时才加载这个文件。
//
// 声音由浏览器交给它自己的语音服务识别（iPhone / Mac 的 Safari 交给苹果，Chrome 交给谷歌），不经过本站，本站也不保存。
// 识别语言在"设置 → 搜索"里选（普通话 / English），默认普通话（夹着几个英文单词一般也认得出）。

const MAX_LISTEN = 15000; // 最多听多久（有的浏览器停顿以后不会自己停）

/** 浏览器支不支持语音识别 */
export const voiceSupported = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// 识别出错时给的说明（error 的取值见 Web Speech API）
const ERRORS = {
  "not-allowed": "没有麦克风权限。iPhone 上在 设置 → App → Safari → 麦克风 里允许，或者在地址栏的网站设置里允许麦克风。",
  "service-not-allowed": "这个浏览器现在不能用语音识别（iPhone 上要在 设置 → Siri 里打开“听写”）。",
  "no-speech": "没听到声音，再试一次。",
  "audio-capture": "找不到麦克风。",
  network: "语音识别要联网，检查一下网络。",
  "language-not-supported": "这个浏览器不支持所选的识别语言。",
};
export const voiceError = (code) => ERRORS[code] || "语音识别出错了，再试一次。";

/**
 * 开始听。
 *   onText(文字)   识别过程中文字变化时（边说边显示）
 *   onDone(文字)   结束时；没识别出东西（或者出错、被取消）时是 ""
 *   onError(代码)  出错时（用户自己取消的不算）
 * 返回 { stop() 说完了、按现在听到的结束, abort() 取消、什么都不要 }
 */
export function listen({ lang = "zh-CN", onText, onDone, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let heard = "";
  let cancelled = false;
  let ended = false;
  const timer = setTimeout(() => rec.stop(), MAX_LISTEN);
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    onDone(cancelled ? "" : heard.trim());
  };
  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    heard = text;
    onText(heard.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "aborted") return;
    cancelled = true;
    onError(e.error);
  };
  rec.onend = finish;
  try {
    rec.start();
  } catch {
    cancelled = true;
    onError("start-failed");
    finish();
  }
  return {
    stop: () => rec.stop(),
    abort: () => {
      cancelled = true;
      rec.abort();
      setTimeout(finish, 300); // 有的浏览器取消以后不发"结束"
    },
  };
}
