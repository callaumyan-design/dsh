// AI 对话面板：在起始页里直接和 catgpt 对话（流式显示、Markdown、可追问）。
// 这里只有界面；catgpt 的代码没有复制过来，所有回答都来自 catgpt 自己的后端接口。
import { renderMarkdown } from "./markdown.js";
import { streamChat, AIError } from "./client.js";
import { aiAuth, passwordDays } from "./auth.js";
import { aiConfig, aiMode, catgptUrl } from "./link.js";
import { fallbackEngine } from "../search.js";
import { h, icon, iconButton, openDialog, toast } from "../ui.js";

let dialog = null;
let logEl, textarea, sendBtn, openLink, liveEl;
let messages = []; // 对话记录 [{ role: "user" | "assistant", content }]
let busy = false;
let controller = null; // 用来中止正在进行的回答
let runId = 0; // 第几次请求；被新对话顶掉的旧请求靠它识别自己"已经过期"
let searchWeb = () => {};

const lastQuestion = () => [...messages].reverse().find((m) => m.role === "user")?.content || "";

// ---------- 搭建面板 ----------
function build() {
  logEl = h("div", { class: "ai-log", tabindex: "0", role: "group", "aria-label": "对话内容" });
  liveEl = h("p", { class: "sr-only", "aria-live": "polite" });

  textarea = h("textarea", {
    rows: 1,
    placeholder: "继续追问…",
    title: "Enter 发送，Shift+Enter 换行",
    "aria-label": "输入问题",
    enterKeyHint: "send",
    autocomplete: "off",
  });
  sendBtn = h("button", { type: "submit", class: "ai-send", "aria-label": "发送" }, icon("arrow-up"));
  const form = h("form", { class: "ai-form" }, textarea, sendBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return controller?.abort(); // 回答过程中，这个按钮是"停止"
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    autosize();
    ask(text);
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  textarea.addEventListener("input", autosize);

  const head = h(
    "div",
    { class: "panel-head" },
    h("h2", { class: "ai-title", id: "ai-title" }, h("span", { class: "chip-mark is-ai", "aria-hidden": "true" }, icon("sparkles")), "AI", h("span", { class: "label-long" }, ` · ${aiConfig.name}`))
  );
  if (aiConfig.pageUrl) {
    // 把当前问题带到 catgpt 页面（?q=问题），在那边继续
    openLink = h("a", { class: "btn ai-head-btn", href: catgptUrl(""), target: "_blank", rel: "noopener" }, icon("external-link"), `在 ${aiConfig.name} 中打开`);
    head.append(openLink);
  }
  head.append(iconButton("plus", "新对话", { onclick: newChat }), iconButton("x", "关闭", { onclick: () => dialog.close() }));

  dialog = h("dialog", { class: "ai-dialog", "aria-labelledby": "ai-title" }, head, logEl, liveEl, form);
  // 关掉面板时停止正在生成的回答，不浪费额度
  dialog.addEventListener("close", () => controller?.abort());
}

function autosize() {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(140, textarea.scrollHeight + 2) + "px";
}

function setBusy(value) {
  busy = value;
  sendBtn.dataset.busy = String(value);
  sendBtn.setAttribute("aria-label", value ? "停止回答" : "发送");
  sendBtn.replaceChildren(icon(value ? "square" : "arrow-up"));
}

function syncOpenLink() {
  if (openLink) openLink.href = catgptUrl(lastQuestion());
}

/** 清空对话，重新开始。正在进行的回答会被中止并作废 */
function resetChat() {
  runId++;
  controller?.abort();
  controller = null;
  setBusy(false);
  messages = [];
  logEl.replaceChildren();
  syncOpenLink();
}

function newChat() {
  resetChat();
  textarea.focus();
}

// ---------- 对话内容的显示 ----------
const nearBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
const scrollToBottom = () => (logEl.scrollTop = logEl.scrollHeight);

function addUserBubble(text) {
  logEl.append(h("div", { class: "msg msg-user" }, text));
  scrollToBottom();
}

/** 一条 AI 回答：流式过程中不断刷新，结束后加上"复制"按钮 */
function addAnswer() {
  const body = h("div", { class: "md" }, h("span", { class: "typing", role: "img", "aria-label": "正在思考" }));
  const box = h("div", { class: "msg msg-ai" }, body);
  logEl.append(box);
  scrollToBottom();

  let latest = "";
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    const stick = nearBottom();
    body.innerHTML = renderMarkdown(latest); // renderMarkdown 的输出已做过转义，只含白名单标签
    if (stick) scrollToBottom();
  };
  return {
    update(text) {
      latest = text;
      // 合并刷新：再快也是每一帧画一次，长回答不会卡
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(paint);
      }
    },
    finish(text) {
      latest = text;
      paint();
      box.append(
        h(
          "div",
          { class: "msg-tools" },
          h(
            "button",
            {
              type: "button",
              class: "btn btn-ghost",
              onclick: () =>
                navigator.clipboard?.writeText(text).then(
                  () => toast("已复制"),
                  () => toast("复制失败，请手动选择文字复制")
                ),
            },
            icon("copy"),
            "复制"
          )
        )
      );
    },
    remove: () => box.remove(),
  };
}

const clearCards = () => logEl.querySelectorAll(".ai-card").forEach((el) => el.remove());

/** 提示卡片：标题 + 说明 + 若干按钮 */
function addCard(iconName, title, text, ...actions) {
  const card = h("div", { class: "ai-card", role: "alert" }, h("h3", null, icon(iconName), title), h("p", null, text), h("div", { class: "btn-row" }, actions));
  logEl.append(card);
  scrollToBottom();
  return card;
}

/** "改用搜索引擎搜"按钮 */
function webSearchButton(primary) {
  const question = lastQuestion();
  if (!question) return null;
  return h(
    "button",
    { type: "button", class: `btn${primary ? " btn-primary" : ""}`, onclick: () => searchWeb(question) },
    icon("search"),
    `改用 ${fallbackEngine().name} 搜`
  );
}

function openInCatgptButton() {
  if (!aiConfig.pageUrl) return null;
  return h("a", { class: "btn", href: catgptUrl(lastQuestion()), target: "_blank", rel: "noopener" }, icon("external-link"), `在 ${aiConfig.name} 中打开`);
}

const retryButton = () => h("button", { type: "button", class: "btn btn-primary", onclick: () => run() }, icon("refresh-cw"), "重试");

const ERROR_TEXT = {
  network: "连不上 AI 服务。可能是它暂时没开，也可能是网络问题。",
  server: "AI 服务出了点问题，没能给出回答。",
  timeout: "AI 服务很久没有回应。",
  empty: "AI 服务没有返回任何内容。",
};

function showError(kind, { typedPassword, usedSaved } = {}) {
  if (kind === "auth") return showPasswordCard(typedPassword ? "密码不对，请再试一次。" : usedSaved ? "之前保存的访问密码已失效，请重新输入。" : "这个 AI 需要访问密码才能使用。");
  if (kind === "rate") {
    return addCard("triangle-alert", "问得太快了", "请求太频繁，被暂时限制了。请稍等一会儿再试。", retryButton(), webSearchButton());
  }
  addCard("triangle-alert", `${aiConfig.name} 暂时用不了`, ERROR_TEXT[kind] || ERROR_TEXT.server, retryButton(), webSearchButton(), openInCatgptButton());
}

function showPasswordCard(text) {
  const input = h("input", { class: "input", type: "password", autocomplete: "current-password", "aria-label": "访问密码", placeholder: "访问密码" });
  const form = h("form", { class: "inline-form" }, input, h("button", { type: "submit", class: "btn btn-primary" }, "确认"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value) run({ typedPassword: input.value });
  });
  const card = addCard("lock", "需要访问密码", `${text} 验证通过后会在这台设备上记住 ${passwordDays} 天。`, webSearchButton());
  card.querySelector(".btn-row").before(form);
  input.focus();
}

// ---------- 发送 ----------
function ask(question) {
  // 上一个问题没得到回答（出错了）就不再重复发送它
  if (messages.at(-1)?.role === "user") messages.pop();
  messages.push({ role: "user", content: question });
  addUserBubble(question);
  syncOpenLink();
  run();
}

/** 把当前对话发给 catgpt。typedPassword 是用户刚输入、还没验证过的密码 */
async function run({ typedPassword } = {}) {
  if (busy) return;
  clearCards();

  if (aiMode() !== "embed") {
    addCard("info", "AI 还没有接入", "本站还没有配置 AI 服务的地址，暂时不能直接提问。你可以先用搜索引擎搜这个问题。", webSearchButton(true), openInCatgptButton());
    return;
  }

  const saved = aiAuth.get();
  const password = typedPassword || saved;
  const answer = addAnswer();
  let text = "";
  setBusy(true);
  liveEl.textContent = "AI 正在回答";
  controller = new AbortController();
  const mine = controller;
  const id = ++runId;

  try {
    await streamChat({
      apiUrl: aiConfig.apiUrl,
      model: aiConfig.model,
      messages,
      password,
      signal: mine.signal,
      onDelta: (delta) => {
        text += delta;
        answer.update(text);
      },
    });
    if (id !== runId) return; // 期间用户开了新对话，这次的结果作废
    if (typedPassword) aiAuth.save(typedPassword); // 新密码验证通过了才记住
    messages.push({ role: "assistant", content: text });
    answer.finish(text);
    liveEl.textContent = "回答完成";
  } catch (err) {
    if (id !== runId) return;
    // 已经显示出来的部分保留，并记入对话，方便接着追问
    if (text) {
      messages.push({ role: "assistant", content: text });
      answer.finish(text);
    } else answer.remove();

    if (mine.signal.aborted && !(err instanceof AIError)) {
      liveEl.textContent = "已停止";
      if (!text && dialog.open) addCard("info", "已停止", "这次回答被中止了。", retryButton());
    } else {
      const kind = err instanceof AIError ? err.kind : "server";
      if (kind === "auth" && saved && !typedPassword) aiAuth.clear();
      liveEl.textContent = "出错了";
      showError(kind, { typedPassword, usedSaved: !!saved });
    }
  } finally {
    if (id === runId) {
      controller = null;
      setBusy(false);
    }
  }
}

// ---------- 对外入口 ----------
/**
 * 从搜索框提问。question 为空时只是重新打开面板（保留之前的对话）。
 * helpers.searchWeb(关键词)：AI 用不了时改用搜索引擎。
 */
export function askAI(question, helpers = {}) {
  if (helpers.searchWeb) searchWeb = helpers.searchWeb;
  if (!dialog) build();
  openDialog(dialog);
  if (question) {
    // 从搜索框来的新问题：开一段新对话
    resetChat();
    ask(question);
  }
  // 手机上不主动弹键盘；有键盘的设备把光标放进输入框，方便直接追问
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) textarea.focus();
  else logEl.focus();
}
