// 行情卡片：轻点页面空白处（或按 M）后出现在屏幕中间。第一次打开时才加载这个文件。
//
// 数据：打开时先显示上次存下的行情（连同它的更新时间），同时去后台 /api/quotes 拿新的。
// 刷新：卡片开着、页面在前台时，按设置每 1 / 5 / 15 分钟刷新一次；关注的市场都不在交易时，最多 30 分钟一次。
//       卡片收起或页面切到后台就停；切回来时如果数据已经过期，立刻刷新一次。
// 演示：网址带 ?demo=quotes 时不连后台，用本地假数据，卡片上标出"演示数据"。
import { store, readJSON, writeJSON } from "../store.js";
import { h, icon, iconButton, toast } from "../ui.js";
import { GROUPS, groupOf, isIndex, candidatesFor, MAX_IDS } from "./ids.js";
import { marketStatus, isLive, STATUS_TEXT } from "./hours.js";
import { quotesAuth, tokenDays } from "./auth.js";
import { demoQuotes } from "./demo.js";

const CACHE_KEY = "sp:quotes-cache"; // 上次拿到的行情：{ at, quotes: { 代码: 行情 } }
const DEMO = new URLSearchParams(location.search).get("demo") === "quotes";
const QUIET = 30; // 关注的市场都不在交易时，最多多少分钟刷新一次
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 卡片的样式单独放在 market.css，第一次打开时才加载（地址按这个文件的位置算，线上会自动带上版本号）
const CSS_URL = new URL("../../css/market.css", import.meta.url).href;
let stylesReady = null;
function loadStyles() {
  stylesReady ||= new Promise((resolve) => {
    const link = h("link", { rel: "stylesheet", href: CSS_URL });
    link.addEventListener("load", resolve);
    link.addEventListener("error", resolve); // 样式加载失败也照样打开，只是不好看
    document.head.append(link);
  });
  return stylesReady;
}

let dialog, cardEl, noticeEl, listEl, addEl, footEl, editBtn, refreshBtn;
let returnTo = null;
let closing = false;
let editing = false;
let loading = false;
let phase = "idle"; // idle | ok | partial | error | offline | auth
let authMessage = "";
let failed = new Map(); // 代码 → 这次为什么取不到
let refreshTimer = 0;
let lastAttempt = 0; // 上次去拿数据的时间（不管成没成功）
let tickTimer = 0;
let cache = loadCache();

function loadCache() {
  const raw = readJSON(CACHE_KEY, null);
  const quotes = raw && typeof raw.quotes === "object" && raw.quotes ? raw.quotes : {};
  return { at: Number(raw?.at) || 0, quotes };
}
function saveCache() {
  // 只留还在关注列表里的
  const keep = new Set(store.get().market.list.map((x) => x.id));
  const quotes = Object.fromEntries(Object.entries(cache.quotes).filter(([id]) => keep.has(id)));
  cache.quotes = quotes;
  if (!DEMO) writeJSON(CACHE_KEY, { at: cache.at, quotes });
}

const list = () => store.get().market.list;

// ---------- 数字的样子 ----------
function decimals(id, price) {
  if (id.startsWith("FX:")) return 4;
  if (price < 1) return 4;
  if (id.startsWith("HK:") && !isIndex(id) && price < 10) return 3;
  return 2;
}
const fmt = (n, d) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const signed = (n, d) => (Number.isFinite(n) ? (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d) : "—");
const dirOf = (n) => (!Number.isFinite(n) || n === 0 ? "flat" : n > 0 ? "up" : "down");

/** 代码的简短写法：沪 600519、港 00700、美 NVDA、AUD/CNY */
function shortCode(id) {
  const [market, code] = id.split(":");
  if (market === "FX") return `${code.slice(0, 3)}/${code.slice(3)}`;
  return `${{ SH: "沪", SZ: "深", BJ: "北", HK: "港", US: "美" }[market]} ${code}`;
}

function timeText(at) {
  if (!at) return "";
  const d = new Date(at);
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = d.toDateString() === new Date().toDateString();
  const mins = Math.round((Date.now() - at) / 60000);
  const ago = mins < 1 ? "刚刚" : mins < 60 ? `${mins} 分钟前` : "";
  return `更新于 ${sameDay ? "" : `${d.getMonth() + 1}月${d.getDate()}日 `}${hm}${ago ? `（${ago}）` : ""}`;
}

// ---------- 搭建 ----------
function build() {
  noticeEl = h("div", { class: "mk-notice" });
  listEl = h("div", { class: "mk-groups" });
  addEl = buildAddPanel();
  addEl.hidden = true;
  refreshBtn = iconButton("refresh-cw", "刷新", { class: "mk-tool", onclick: () => refresh({ force: true }) });
  editBtn = iconButton("pencil", "编辑关注列表", { class: "mk-tool", onclick: () => setEditing(!editing) });
  footEl = h("div", { class: "mk-foot-info" });
  cardEl = h(
    "section",
    { class: "mk-card", tabindex: "-1", "aria-labelledby": "mk-title" },
    h(
      "div",
      { class: "mk-head" },
      h("h2", { id: "mk-title" }, icon("trending-up"), "行情"),
      DEMO && h("span", { class: "mk-tag mk-tag-demo" }, "演示数据"),
      iconButton("x", "收起行情卡片", { class: "mk-tool mk-close", onclick: () => close() })
    ),
    noticeEl,
    listEl,
    addEl,
    h("div", { class: "mk-foot" }, footEl, h("div", { class: "mk-foot-tools" }, refreshBtn, editBtn))
  );
  const fog = h("div", { class: "mk-fog", "aria-hidden": "true" });
  dialog = h("dialog", { class: "mk-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "mk-title" }, fog, cardEl);

  // 点卡片外面收起：按下和松开都在外面才算（避免在卡片里拖选文字、拖到外面松手时误关）
  let downOutside = false;
  const outside = (e) => !cardEl.contains(e.target);
  dialog.addEventListener("pointerdown", (e) => (downOutside = outside(e)));
  dialog.addEventListener("pointerup", (e) => {
    if (downOutside && outside(e)) close();
    downOutside = false;
  });
  // Esc：先退出编辑，再收起
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (editing) setEditing(false);
    else close();
  });
  dialog.addEventListener("close", stopTimers);
  document.body.append(dialog);

  document.addEventListener("visibilitychange", () => {
    if (!dialog.open) return;
    if (document.hidden) stopTimers();
    else {
      if (isStale()) refresh();
      startTimers();
    }
  });
  store.subscribe(() => dialog.open && !editing && render());
}

// ---------- 打开 / 收起 ----------
export async function openMarketCard({ returnTo: target } = {}) {
  await loadStyles();
  if (!dialog) build();
  if (dialog.open) return;
  closing = false;
  returnTo = target instanceof HTMLElement && target !== document.body ? target : null;
  setEditing(false, { silent: true });
  cardEl.dataset.colors = store.get().market.colors;
  render();
  dialog.showModal();
  cardEl.focus({ preventScroll: true }); // 焦点放进卡片（不直接落在某个按钮上，免得手机上出现焦点框）
  document.documentElement.classList.add("mk-open");
  if (reduceMotion()) dialog.classList.add("is-in");
  else requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("is-in")));
  // 先显示上次的数据，同时去拿新的（刚拿过的就不重复拿）
  if (list().length && (DEMO || Date.now() - cache.at > 30000 || phase !== "ok")) refresh();
  startTimers();
}

function close() {
  if (!dialog?.open || closing) return;
  closing = true;
  stopTimers();
  dialog.classList.remove("is-in");
  document.documentElement.classList.remove("mk-open");
  const done = () => {
    closing = false;
    dialog.close();
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    returnTo = null;
  };
  if (reduceMotion()) done();
  else setTimeout(done, 260);
}

// ---------- 刷新 ----------
/** 现在该多久刷新一次（毫秒） */
function interval() {
  const minutes = store.get().market.refresh;
  return (anyLive() ? minutes : Math.max(minutes, QUIET)) * 60000;
}
const isStale = () => Date.now() - cache.at >= interval();

function anyLive(now = Date.now()) {
  const groups = new Set(list().map((x) => groupOf(x.id)));
  return [...groups].some((g) => isLive(groupStatus(g, now)));
}

function startTimers() {
  stopTimers();
  if (!dialog?.open || document.hidden) return;
  // 正在拿数据时先不排下一次：拿完以后 refresh() 会按新的时间重新排。
  // 等你输入口令时不自动刷新（免得打断输入）；失败了也按正常间隔再试，不会一直频繁请求
  if (list().length && !DEMO && !loading && phase !== "auth") {
    const wait = Math.max(5000, Math.max(cache.at, lastAttempt) + interval() - Date.now());
    refreshTimer = setTimeout(() => refresh(), wait);
  }
  // 每 30 秒更新一下"几分钟前"和市场状态（不联网）
  tickTimer = setInterval(() => !editing && !noticeEl.contains(document.activeElement) && render(), 30000);
}
function stopTimers() {
  clearTimeout(refreshTimer);
  clearInterval(tickTimer);
}

/** 去后台要数据。访问口令是可选的：后台设了口令（返回 401）才需要，记住的口令会自动带上 */
async function request(ids, { lookup = false, token = quotesAuth.get() } = {}) {
  if (DEMO) return { ok: true, data: demoQuotes(ids) };
  let res;
  try {
    res = await fetch(`./api/quotes?ids=${encodeURIComponent(ids.join(","))}${lookup ? "&lookup=1" : ""}`, {
      headers: token ? { "X-Quotes-Token": token } : {},
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, kind: "offline" };
  }
  if (res.status === 401) return { ok: false, kind: "auth", bad: !!token };
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 下面按出错处理 */
  }
  if (!res.ok || !data || !Array.isArray(data.quotes)) return { ok: false, kind: "error" };
  return { ok: true, data };
}

/** 拿一次最新数据。typedToken：刚在卡片里输入、还没验证过的口令 */
async function refresh({ typedToken } = {}) {
  const ids = list().map((x) => x.id);
  if (!ids.length || loading) return;
  loading = true;
  lastAttempt = Date.now();
  render();
  const result = await request(ids, typedToken ? { token: typedToken } : {});
  loading = false;
  if (result.ok) {
    if (typedToken) quotesAuth.save(typedToken); // 验证通过了才记住
    authMessage = "";
    const errors = Array.isArray(result.data.errors) ? result.data.errors : [];
    for (const q of result.data.quotes) if (q && typeof q.id === "string") cache.quotes[q.id] = q;
    failed = new Map(errors.filter((e) => e && typeof e.id === "string").map((e) => [e.id, String(e.reason || "")]));
    cache.at = Date.now(); // 更新时间按这台设备的时间记（不用服务器的时间，免得两边时钟不一致）
    saveCache();
    phase = !result.data.quotes.length && failed.size ? "error" : failed.size ? "partial" : "ok";
  } else {
    phase = result.kind;
    if (result.kind === "auth") {
      if (result.bad && !typedToken) quotesAuth.clear(); // 记住的口令不对了（比如后台换了口令）
      authMessage = result.bad ? "口令不对，请重新输入。" : "";
    }
  }
  render();
  // 排下一次刷新（出错时也按正常间隔再试，不会因为一直失败而频繁请求）
  if (dialog?.open && !closing) startTimers();
}

// ---------- 显示 ----------
function groupStatus(group, now = Date.now()) {
  const times = list()
    .filter((x) => groupOf(x.id) === group)
    .map((x) => cache.quotes[x.id]?.time)
    .filter((t) => Number.isFinite(t));
  return marketStatus(group, now, times.length ? Math.max(...times) : undefined);
}

function render() {
  if (!cardEl) return;
  cardEl.dataset.colors = store.get().market.colors;
  cardEl.classList.toggle("is-editing", editing);
  cardEl.setAttribute("aria-busy", String(loading));
  refreshBtn.classList.toggle("is-spinning", loading);
  refreshBtn.disabled = loading || DEMO === false && !list().length;
  renderNotice();
  renderGroups();
  renderFoot();
}

function renderNotice() {
  const items = list();
  const parts = [];
  if (!items.length && !editing) {
    parts.push(
      h(
        "div",
        { class: "mk-empty" },
        h("p", null, "还没有关注任何行情。"),
        h("button", { type: "button", class: "btn btn-primary", onclick: () => setEditing(true) }, icon("plus"), "添加")
      )
    );
  } else if (phase === "auth") {
    parts.push(tokenForm());
  } else if (phase === "offline") {
    parts.push(message("triangle-alert", "连不上服务器", "可能是网络断了。下面显示的是上次的数据。", retryButton()));
  } else if (phase === "error") {
    const why = [...failed.values()][0];
    parts.push(message("triangle-alert", "暂时取不到行情", (why ? `原因：${why}。` : "数据源暂时出了问题。") + "下面显示的是上次的数据。", retryButton()));
  } else if (loading && !Object.keys(cache.quotes).length) {
    parts.push(h("p", { class: "mk-loading", role: "status" }, "正在获取行情…"));
  }
  noticeEl.replaceChildren(...parts);
}

const message = (iconName, title, text, ...actions) => h("div", { class: "mk-msg", role: "alert" }, h("h3", null, icon(iconName), title), h("p", null, text), actions.length ? h("div", { class: "btn-row" }, actions) : null);
const retryButton = () => h("button", { type: "button", class: "btn", onclick: () => refresh() }, icon("refresh-cw"), "重试");

function tokenForm() {
  const input = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: "访问口令", "aria-label": "行情访问口令", maxLength: 200 });
  const form = h("form", { class: "inline-form" }, input, h("button", { type: "submit", class: "btn btn-primary" }, "确认"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const token = input.value.trim();
    if (token) refresh({ typedToken: token });
  });
  setTimeout(() => dialog.open && phase === "auth" && !editing && input.focus({ preventScroll: true }), 0);
  return h(
    "div",
    { class: "mk-msg", role: "alert" },
    h("h3", null, icon("lock"), authMessage ? "口令不对" : "输入访问口令"),
    h("p", null, authMessage || `后台设置了访问口令（Cloudflare 后台的 QUOTES_TOKEN），请输入。验证通过后在这台设备上记住 ${tokenDays} 天。`),
    form
  );
}

function renderGroups() {
  const items = list();
  const now = Date.now();
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((x) => groupOf(x.id) === g.id) })).filter((g) => g.items.length);
  listEl.replaceChildren(
    ...groups.map((g) => {
      const status = groupStatus(g.id, now);
      return h(
        "section",
        { class: "mk-group", "aria-label": g.name },
        h("h3", { class: "mk-group-title" }, g.name, h("span", { class: `mk-status is-${status}` }, STATUS_TEXT[status])),
        h("ul", { class: "mk-rows" }, g.items.map((item) => row(item, g)))
      );
    })
  );
}

function row(item, group) {
  const q = cache.quotes[item.id];
  const stale = failed.has(item.id) || (!q && !loading && phase !== "idle");
  const name = item.name || q?.name || shortCode(item.id);
  const d = q ? decimals(item.id, q.price) : 2;
  const currency = q ? q.currency || (isIndex(item.id) ? "点" : "") : "";
  const li = h(
    "li",
    { class: `mk-row${stale ? " is-stale" : ""}`, dataset: { id: item.id, dir: stale ? "flat" : dirOf(q?.change) } },
    h("div", { class: "mk-name" }, h("span", { class: "mk-title" }, name), h("span", { class: "mk-code" }, shortCode(item.id))),
    h("div", { class: "mk-price" }, h("span", { class: "mk-num" }, q ? fmt(q.price, d) : "—"), h("span", { class: "mk-cur" }, currency)),
    h("div", { class: "mk-chg" }, h("span", { class: "mk-num" }, q ? signed(q.change, d) : ""), h("span", { class: "mk-num mk-pct" }, q ? signed(q.changePct, 2) + "%" : ""))
  );
  const notes = [];
  if (q?.extended && !stale) {
    const x = q.extended;
    notes.push(h("span", { class: "mk-ext", dataset: { dir: dirOf(x.change) } }, `${x.label} ${fmt(x.price, d)} ${signed(x.change, d)}（${signed(x.changePct, 2)}%）`));
  }
  if (stale) notes.push(h("span", { class: "mk-fail", title: failed.get(item.id) || "" }, q ? "暂时取不到，显示的是上次的价格" : "暂时取不到"));
  if (q?.reference && !stale) notes.push(h("span", { class: "mk-ref" }, "每日参考价"));
  if (notes.length) li.append(h("div", { class: "mk-notes" }, notes));
  if (editing) li.append(editTools(item, group));
  return li;
}

function renderFoot() {
  const ids = list().map((x) => x.id);
  const shown = ids.map((id) => cache.quotes[id]).filter(Boolean);
  const failing = ids.filter((id) => failed.has(id)).length; // 删掉的代码不算
  const tags = [];
  if (DEMO) tags.push(h("span", { class: "mk-tag mk-tag-demo" }, "演示数据"));
  if (shown.some((q) => q.delayed)) tags.push(h("span", { class: "mk-tag", title: "部分行情是延时的（港股免费行情通常延时约 15 分钟）" }, "延时"));
  if (failing && phase === "partial") tags.push(h("span", { class: "mk-tag mk-tag-warn" }, `${failing} 项暂时取不到`));
  const time = !ids.length ? "" : loading ? "正在刷新…" : timeText(cache.at) || "还没有数据";
  footEl.replaceChildren(time && h("span", { class: "mk-time" }, time), ...tags);
  editBtn.replaceChildren(icon(editing ? "check" : "pencil"));
  editBtn.setAttribute("aria-label", editing ? "完成编辑" : "编辑关注列表");
  editBtn.title = editing ? "完成编辑" : "编辑关注列表";
  editBtn.setAttribute("aria-pressed", String(editing));
}

// ---------- 编辑关注列表 ----------
function setEditing(value, { silent = false } = {}) {
  const added = editing && !value && list().some((x) => !cache.quotes[x.id]);
  editing = value;
  if (addEl) addEl.hidden = !value;
  if (silent) return;
  render();
  if (value) addEl.querySelector('input[type="text"]')?.focus({ preventScroll: false });
  else if (added) refresh(); // 新加的代码还没有数据，马上取一次
}

function updateList(mutate) {
  store.update((s) => {
    const next = s.market.list.map((x) => ({ ...x }));
    mutate(next);
    s.market.list = next;
  });
  render();
}

function editTools(item, group) {
  const same = () => list().filter((x) => groupOf(x.id) === group.id);
  const index = same().findIndex((x) => x.id === item.id);
  /** 在同一个市场里和前一个 / 后一个交换位置 */
  const move = (step) =>
    updateList((all) => {
      const mine = all.filter((x) => groupOf(x.id) === group.id);
      const other = mine[index + step];
      if (!other) return;
      const a = all.findIndex((x) => x.id === item.id);
      const b = all.findIndex((x) => x.id === other.id);
      [all[a], all[b]] = [all[b], all[a]];
    });
  const label = item.name || shortCode(item.id);
  return h(
    "div",
    { class: "mk-edit-tools" },
    iconButton("chevron-up", `上移 ${label}`, { class: "mk-tool", disabled: index === 0, onclick: () => move(-1) }),
    iconButton("chevron-down", `下移 ${label}`, { class: "mk-tool", disabled: index === same().length - 1, onclick: () => move(1) }),
    iconButton("trash-2", `删除 ${label}`, {
      class: "mk-tool mk-del",
      onclick: () => {
        updateList((all) => all.splice(all.findIndex((x) => x.id === item.id), 1));
        toast(`已删除 ${label}`);
      },
    })
  );
}

const HINTS = {
  A: "6 位代码，如 600519。指数：000001 上证指数、399001 深证成指、000300 沪深300。",
  HK: "如 700（腾讯控股）。指数：HSI 恒生指数、HSCEI 国企指数、HSTECH 恒生科技。",
  US: "如 NVDA、BRK.B。指数：.IXIC 纳斯达克综合、.DJI 道琼斯、.INX 标普500。",
  FX: "如 AUDCNY、USDCNH。CNY 是在岸人民币，CNH 是离岸人民币。",
};

function buildAddPanel() {
  let market = "A";
  const hint = h("p", { class: "hint" }, HINTS.A);
  const input = h("input", { class: "input", type: "text", placeholder: "代码", "aria-label": "要添加的代码", autocomplete: "off", autocapitalize: "characters", spellcheck: false, maxLength: 16, enterKeyHint: "search" });
  const results = h("div", { class: "mk-results", role: "status" });
  const marketBox = h(
    "div",
    { class: "segmented mk-markets", role: "radiogroup", "aria-label": "市场" },
    GROUPS.map((g) => {
      const radio = h("input", {
        type: "radio",
        name: "mk-market",
        value: g.id,
        checked: g.id === market,
        onchange: () => {
          market = g.id;
          hint.textContent = HINTS[g.id];
          results.replaceChildren();
          input.focus();
        },
      });
      return h("label", null, radio, h("span", null, g.name));
    })
  );
  const form = h("form", { class: "inline-form" }, input, h("button", { type: "submit", class: "btn btn-primary" }, icon("search"), "查询"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ids = candidatesFor(market, input.value);
    if (!ids.length) return results.replaceChildren(h("p", { class: "mk-fail" }, "代码格式不对。" + HINTS[market]));
    if (list().length >= MAX_IDS) return results.replaceChildren(h("p", { class: "mk-fail" }, `最多关注 ${MAX_IDS} 个。`));
    results.replaceChildren(h("p", { class: "hint" }, "正在查询…"));
    const result = await request(ids, { lookup: true });
    if (!result.ok) {
      if (result.kind === "auth") {
        phase = "auth";
        authMessage = result.bad ? "口令不对，请重新输入。" : "";
        setEditing(false);
        return;
      }
      return results.replaceChildren(h("p", { class: "mk-fail" }, result.kind === "offline" ? "连不上服务器，请稍后再试。" : "查询失败，请稍后再试。"));
    }
    const found = result.data.quotes.filter((q) => ids.includes(q.id));
    if (!found.length) {
      const why = result.data.errors?.[0]?.reason;
      return results.replaceChildren(h("p", { class: "mk-fail" }, "查不到这个代码" + (why ? `（${why}）` : "") + "。"));
    }
    const choices = found.map((q) =>
        h(
          "button",
          {
            type: "button",
            class: "btn mk-pick",
            onclick: () => {
              if (list().some((x) => x.id === q.id)) return toast("已经在列表里了");
              cache.quotes[q.id] = q;
              updateList((all) => all.push({ id: q.id, name: String(q.name || "").slice(0, 40) }));
              saveCache();
              input.value = "";
              results.replaceChildren(h("p", { class: "hint" }, `已添加 ${q.name || shortCode(q.id)}`));
              input.focus();
            },
          },
          icon("plus"),
          `${q.name || shortCode(q.id)}（${shortCode(q.id)}）`
        )
    );
    // （replaceChildren 遇到 null 会把它当成文字 "null" 显示出来，所以只在需要时才放提示）
    if (found.length > 1) choices.unshift(h("p", { class: "hint" }, "这个代码对应不止一个，请选一个："));
    results.replaceChildren(...choices);
  });
  return h("div", { class: "mk-add" }, h("h3", null, "添加关注"), marketBox, form, hint, results);
}
