// 调用 catgpt 后端对话接口，边收边显示（流式）。
//
// 这个文件是起始页和 catgpt 之间唯一的"接口适配层"：如果 catgpt 的接口格式和下面写的不一样，
// 只需要改这一个文件。API Key 不在这里，也不应该在任何前端代码里 —— 它只存在于 catgpt 的服务端。
//
// 约定的请求格式（OpenAI 兼容，绝大多数对话后端都支持）：
//   POST {apiUrl}
//   请求头  Content-Type: application/json
//           Authorization: Bearer <访问密码>      （catgpt 设置了访问密码时才带）
//   请求体  { "messages": [{ "role": "user" | "assistant", "content": "..." }], "stream": true, "model": "可选" }
//
// 能识别的回复格式：
//   1. SSE 流（text/event-stream）：data: {"choices":[{"delta":{"content":"字"}}]} … data: [DONE]
//   2. 逐行 JSON 流（application/x-ndjson）
//   3. 纯文本流（text/plain）
//   4. 一次性返回的 JSON（application/json）
// 状态码：401/403 = 需要访问密码或密码不对；429 = 请求太频繁（被限流）。

const FIRST_BYTE_TIMEOUT = 45000; // 等待开始回答的最长时间
const IDLE_TIMEOUT = 60000; // 回答中途卡住的最长时间

/** kind: "auth" | "rate" | "network" | "server" | "timeout" | "empty" */
export class AIError extends Error {
  constructor(kind, detail = "") {
    super(detail || kind);
    this.name = "AIError";
    this.kind = kind;
  }
}

const firstText = (...values) => values.find((v) => typeof v === "string" && v) || "";

/** 从一段 JSON 里取出文字，兼容几种常见的接口格式 */
function pickText(data) {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  return firstText(
    choice?.delta?.content, // OpenAI 流式
    choice?.message?.content, // OpenAI 非流式
    choice?.text,
    data.delta?.text, // Anthropic 流式
    data.delta?.content,
    data.message?.content, // Ollama
    Array.isArray(data.content) ? data.content[0]?.text : data.content,
    data.response,
    data.text,
    data.answer,
    data.reply
  );
}

function errorText(data) {
  const e = data && typeof data === "object" ? data.error : null;
  if (!e) return "";
  return typeof e === "string" ? e : typeof e.message === "string" ? e.message : "error";
}

/**
 * 发起一次对话。onDelta(文字) 会被多次调用，每次是新增的一小段。
 * 正常结束时返回；出错时抛出 AIError；用户主动中止时抛出 AbortError。
 */
export async function streamChat({ apiUrl, model, messages, password, signal, onDelta }) {
  // 超时控制：内部再包一层"中止开关"，既响应用户的停止，也响应超时
  const controller = new AbortController();
  let timedOut = false;
  let timer = 0;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  const onUserAbort = () => controller.abort();
  signal?.addEventListener("abort", onUserAbort);

  const headers = { "Content-Type": "application/json", Accept: "text/event-stream, application/json, text/plain" };
  if (password) headers.Authorization = `Bearer ${password}`;
  const body = { messages, stream: true };
  if (model) body.model = model;

  let got = false;
  const emit = (text) => {
    if (!text) return;
    got = true;
    onDelta(text);
  };

  try {
    arm(FIRST_BYTE_TIMEOUT);
    let res;
    try {
      res = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new AIError(timedOut ? "timeout" : "network");
    }

    if (res.status === 401 || res.status === 403) throw new AIError("auth");
    if (res.status === 429) throw new AIError("rate");
    if (!res.ok) throw new AIError("server", `HTTP ${res.status}`);

    const type = (res.headers.get("content-type") || "").toLowerCase();

    // 一次性返回的 JSON
    if (type.includes("application/json")) {
      const data = await res.json().catch(() => null);
      if (errorText(data)) throw new AIError("server", errorText(data));
      emit(pickText(data));
      if (!got) throw new AIError("empty");
      return;
    }
    if (!res.body) {
      emit(await res.text());
      if (!got) throw new AIError("empty");
      return;
    }

    const isSSE = type.includes("text/event-stream");
    const isNDJSON = type.includes("ndjson") || type.includes("jsonl");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines = []; // SSE：一个事件可以有多行 data
    let eventName = "";
    let finished = false;

    const handleJSON = (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return emit(raw); // 不是 JSON，就当普通文字
      }
      if (errorText(data)) throw new AIError("server", errorText(data));
      emit(pickText(data));
    };

    // SSE 规则：空行表示一个事件结束
    const dispatch = () => {
      if (!dataLines.length) return;
      const payload = dataLines.join("\n");
      const name = eventName;
      dataLines = [];
      eventName = "";
      if (payload.trim() === "[DONE]") return (finished = true);
      if (name === "error") throw new AIError("server", payload.slice(0, 200));
      handleJSON(payload);
    };

    const handleLine = (line) => {
      if (isNDJSON) {
        if (line.trim()) handleJSON(line);
        return;
      }
      if (line === "") return dispatch();
      if (line.startsWith(":")) return; // 注释 / 心跳
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") dataLines.push(value);
      else if (field === "event") eventName = value;
    };

    try {
      while (!finished) {
        arm(IDLE_TIMEOUT);
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!isSSE && !isNDJSON) {
          emit(chunk); // 纯文本流：收到什么显示什么
          continue;
        }
        buffer += chunk;
        let index;
        while (!finished && (index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          handleLine(line);
        }
      }
      if (!finished && (isSSE || isNDJSON)) {
        if (buffer) handleLine(buffer.replace(/\r$/, ""));
        if (isSSE) dispatch();
      }
    } catch (err) {
      if (err instanceof AIError) throw err;
      if (signal?.aborted) throw err;
      throw new AIError(timedOut ? "timeout" : "network");
    } finally {
      reader.cancel().catch(() => {});
    }
    if (!got) throw new AIError("empty");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onUserAbort);
  }
}
