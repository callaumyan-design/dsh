// 设置面板（右上角齿轮）：背景、搜索、链接、主题、小组件、数据导出/导入/恢复默认。
// 所有改动立刻生效，并保存在浏览器本地。
import { BACKGROUND_PRESETS, AI } from "../../config/site.js";
import { store, safeTemplate, safeUrl, uid, defaultSettings } from "./store.js";
import { addUploads, addImageUrl, removeImage, selectImage, shownImageId, shuffleBackground, thumbFor, nextOnlineWallpaper, ONLINE_SOURCES, onCredit } from "./background.js";
import { FONT_CHOICES, WEIGHT_NAMES } from "./typography.js";
import { listEngines } from "./engines.js";
import { searchHistory } from "./search.js";
import { buildExport, applyImport, pruneImages } from "./backup.js";
import { aiAuth } from "./ai/auth.js";
import { userApi } from "./ai/api.js";
import { AI_PRESETS, testApi, fetchModels } from "./ai/api-tools.js";
import { h, icon, iconButton, toast, openDialog, confirmDialog, downloadText } from "./ui.js";

let dialog = null;
const syncers = []; // 每个控件登记一个"按当前设置刷新自己"的函数
const sections = {}; // 名字 → 区块元素（用来直接跳到某一块）

const refresh = () => syncers.forEach((fn) => fn(store.get()));

// ---------- 通用控件 ----------
function section(key, iconName, title, ...children) {
  const el = h("section", { class: "set-section", "aria-label": title, tabindex: "-1" }, h("h3", null, icon(iconName), title), ...children);
  sections[key] = el;
  return el;
}

let idSeq = 0;
const nextId = (prefix) => `${prefix}-${++idSeq}`;

/** 开关一行 */
function switchRow(label, hint, get, set) {
  const id = nextId("sw");
  const input = h("input", { type: "checkbox", id, role: "switch", onchange: () => store.update((s) => set(s, input.checked)) });
  syncers.push((s) => (input.checked = get(s)));
  return h("div", { class: "set-row" }, h("label", { for: id }, label, hint && h("small", null, hint)), h("label", { class: "switch" }, input, h("span")));
}

/** 分段单选。用户选择时调用 onPick(值)；传了 get 就会按设置自动刷新选中项 */
function segmented(label, options, get, onPick) {
  const name = nextId("seg");
  const inputs = options.map(([value, text, iconName]) => {
    const input = h("input", { type: "radio", name, value, onchange: () => onPick(value) });
    return { input, el: h("label", null, input, h("span", null, iconName && icon(iconName), text)) };
  });
  if (get) syncers.push((s) => inputs.forEach(({ input }) => (input.checked = input.value === get(s))));
  return h("div", { class: "segmented", role: "radiogroup", "aria-label": label }, inputs.map((i) => i.el));
}

/** 滑块一行。unit 可以是单位（如 "px"），也可以是一个"把数值变成显示文字"的函数 */
function rangeRow(label, min, max, unit, get, set, step = 1) {
  const id = nextId("rg");
  const out = h("output", { for: id });
  const show = (value) => (typeof unit === "function" ? unit(value) : value + unit);
  const input = h("input", {
    type: "range",
    id,
    min: String(min),
    max: String(max),
    step: String(step),
    oninput: () => {
      out.textContent = show(Number(input.value));
      store.update((s) => set(s, Number(input.value)));
    },
  });
  syncers.push((s) => {
    input.value = String(get(s));
    out.textContent = show(get(s));
  });
  return h("div", { class: "range-row" }, h("div", { class: "range-head" }, h("label", { for: id }, label), out), input);
}

/** 下拉选择一行 */
function selectRow(label, hint, getOptions, get, set) {
  const id = nextId("sel");
  const select = h("select", { class: "input", id, onchange: () => store.update((s) => set(s, select.value)) });
  syncers.push((s) => {
    select.replaceChildren(...getOptions(s).map(([value, text]) => h("option", { value }, text)));
    select.value = get(s);
  });
  return h("div", { class: "set-row" }, h("label", { for: id }, label, hint && h("small", null, hint)), select);
}

// ---------- 背景 ----------
function backgroundSection() {
  // 预设
  const swatches = h(
    "div",
    { class: "swatches", role: "group", "aria-label": "内置背景" },
    BACKGROUND_PRESETS.map((p) => {
      const btn = h("button", { type: "button", class: `swatch tone-${p.tone === "light" ? "light" : "dark"}`, dataset: { id: p.id }, onclick: () => store.update((s) => { s.bg.type = "preset"; s.bg.preset = p.id; }) }, p.name);
      if (p.image) btn.style.backgroundImage = `url("${encodeURI(p.image)}")`;
      else btn.style.background = p.css;
      return btn;
    })
  );
  syncers.push((s) => swatches.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(s.bg.type === "preset" && b.dataset.id === s.bg.preset))));
  const presetPane = h("div", { class: "bg-pane" }, swatches);

  // 纯色 / 渐变
  const c1 = h("input", { type: "color", "aria-label": "颜色一", oninput: () => store.update((s) => (s.bg.color.c1 = c1.value)) });
  const c2 = h("input", { type: "color", "aria-label": "颜色二", oninput: () => store.update((s) => (s.bg.color.c2 = c2.value)) });
  const c2Label = h("label", null, "颜色二", c2);
  const angle = rangeRow("渐变方向", 0, 360, "°", (s) => s.bg.color.angle, (s, v) => (s.bg.color.angle = v));
  syncers.push((s) => {
    c1.value = s.bg.color.c1;
    c2.value = s.bg.color.c2;
    c2Label.hidden = angle.hidden = !s.bg.color.gradient;
  });
  const colorPane = h(
    "div",
    { class: "bg-pane" },
    h("div", { class: "color-row" }, h("label", null, "颜色一", c1), c2Label),
    switchRow("渐变", "关掉就是纯色", (s) => s.bg.color.gradient, (s, v) => (s.bg.color.gradient = v)),
    angle
  );

  // 图片
  const thumbs = h("div", { class: "thumbs", role: "group", "aria-label": "我的背景图片", hidden: true });
  let thumbsSignature = "";
  async function renderThumbs(s) {
    const list = s.bg.images;
    const signature = list.map((i) => i.id).join(",");
    if (signature !== thumbsSignature) {
      thumbsSignature = signature;
      const nodes = await Promise.all(
        list.map(async (item, index) => {
          const src = await thumbFor(item);
          const label = item.kind === "url" ? `图片链接 ${index + 1}` : `上传的图片 ${index + 1}`;
          const pick = h("button", { type: "button", class: "thumb-pick", "aria-label": `使用${label}`, title: item.kind === "url" ? item.url : label, dataset: { id: item.id }, onclick: () => selectImage(item.id) });
          if (src) pick.append(h("img", { src, alt: "", loading: "lazy", decoding: "async" }));
          return h("div", { class: "thumb" }, pick, iconButton("x", `删除${label}`, { class: "thumb-del", onclick: () => removeImage(item.id).then(pruneImages) }));
        })
      );
      if (signature !== thumbsSignature) return; // 等缩略图的时候列表又变了，交给后一次刷新
      thumbs.replaceChildren(...nodes);
      thumbs.hidden = !nodes.length;
    }
    const shown = s.bg.type === "image" ? shownImageId() : "";
    thumbs.querySelectorAll(".thumb-pick").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === shown)));
  }
  syncers.push(renderThumbs);

  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const uploadBtn = h("button", { type: "button", class: "btn", onclick: () => fileInput.click() }, icon("upload"), "上传图片");
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    if (!files.length) return;
    uploadBtn.disabled = true;
    const { ok, failed } = await addUploads(files);
    uploadBtn.disabled = false;
    if (ok) toast(`已添加 ${ok} 张图片（已自动压缩）` + (failed ? `，${failed} 张无法识别` : ""));
    else toast("图片没能添加：可能是格式不支持，或浏览器不允许网站保存数据");
  });

  const urlInput = h("input", { class: "input", type: "url", inputMode: "url", placeholder: "https://…/图片.jpg", "aria-label": "图片链接", autocomplete: "off", autocapitalize: "off", spellcheck: false });
  const urlForm = h("form", { class: "inline-form", novalidate: true }, urlInput, h("button", { type: "submit", class: "btn" }, "添加链接"));
  urlForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!urlInput.value.trim()) return;
    if (addImageUrl(urlInput.value)) urlInput.value = "";
    else toast("图片链接需要以 http:// 或 https:// 开头");
  });

  const shuffleBtn = h("button", { type: "button", class: "btn", onclick: shuffleBackground }, icon("shuffle"), "换一张");
  const randomRow = switchRow("随机切换", "每次打开页面，从上面的图片里随机选一张", (s) => s.bg.random, (s, v) => { s.bg.random = v; if (v) s.bg.type = "image"; });
  const randomBox = h("div", null, randomRow, h("div", { class: "btn-row" }, shuffleBtn));
  syncers.push((s) => {
    randomBox.hidden = s.bg.images.length < 2;
    shuffleBtn.hidden = !s.bg.random;
  });

  const imagePane = h(
    "div",
    { class: "bg-pane" },
    thumbs,
    h("div", { class: "btn-row" }, uploadBtn, fileInput),
    h("p", { class: "hint" }, "上传的图片只保存在这台设备的浏览器里，会自动压缩。"),
    h("div", { class: "field" }, urlForm),
    randomBox
  );

  // 在线壁纸
  let wantCustom = false; // 用户选了"自定义接口"但还没填地址
  const sourceId = nextId("sel");
  const sourceSelect = h(
    "select",
    {
      class: "input",
      id: sourceId,
      onchange: () => {
        wantCustom = sourceSelect.value === "custom" && !store.get().bg.online.url;
        if (wantCustom) return refresh(); // 先让用户填地址，填好了再生效
        store.update((s) => (s.bg.online.source = sourceSelect.value));
      },
    },
    ONLINE_SOURCES.map((src) => h("option", { value: src.id }, src.name))
  );
  const apiInput = h("input", { class: "input", type: "url", inputMode: "url", placeholder: "https://…（打开就返回一张图片的地址）", "aria-label": "壁纸接口地址", autocomplete: "off", autocapitalize: "off", spellcheck: false });
  const apiForm = h("form", { class: "inline-form", novalidate: true }, apiInput, h("button", { type: "submit", class: "btn" }, "使用"));
  apiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = safeUrl(apiInput.value);
    if (!url) return toast("接口地址需要以 http:// 或 https:// 开头");
    wantCustom = false;
    store.update((s) => {
      s.bg.online.source = "custom";
      s.bg.online.url = url;
    });
    toast("已切换到自定义壁纸接口");
  });
  const apiBox = h("div", { class: "field" }, apiForm, h("p", { class: "hint" }, "填一个“每次打开都返回一张图片”的地址。地址里可以用 {w}、{h} 代表需要的宽和高。"));
  const everyRow = selectRow(
    "多久换一张",
    null,
    () => [["open", "每次打开页面"], ["hour", "每小时"], ["day", "每天"], ["manual", "只在我点“换一张”时"]],
    (s) => s.bg.online.every,
    (s, v) => (s.bg.online.every = v)
  );
  const nextRow = h(
    "div",
    { class: "btn-row" },
    h("button", { type: "button", class: "btn", onclick: nextOnlineWallpaper }, icon("shuffle"), "换一张")
  );
  const dailyHint = h("p", { class: "hint" }, "这个来源每天自动换成当天的那一张。");

  // 当前这张壁纸是什么、谁拍的、出自哪里（和主页最底下那行小字是同一份）
  const infoBox = h("p", { class: "hint wall-info", hidden: true });
  onCredit((value) => {
    infoBox.hidden = !value;
    if (!value) return;
    infoBox.replaceChildren(
      "当前这张：",
      value.title && h("strong", null, value.title),
      value.title && value.credit ? " — " : "",
      value.credit,
      value.link && " ",
      value.link && h("a", { href: value.link, target: "_blank", rel: "noopener noreferrer" }, "查看出处")
    );
  });

  syncers.push((s) => {
    const known = ONLINE_SOURCES.some((src) => src.id === s.bg.online.source);
    sourceSelect.value = wantCustom ? "custom" : known ? s.bg.online.source : ONLINE_SOURCES[0].id;
    apiBox.hidden = sourceSelect.value !== "custom";
    if (document.activeElement !== apiInput) apiInput.value = s.bg.online.url;
    // "每日一图"这类来源每天自动换，不需要"多久换一张"和"换一张"
    const daily = !!ONLINE_SOURCES.find((src) => src.id === sourceSelect.value)?.daily;
    everyRow.hidden = nextRow.hidden = daily;
    dailyHint.hidden = !daily;
  });
  const onlinePane = h(
    "div",
    { class: "bg-pane" },
    h("div", { class: "set-row" }, h("label", { for: sourceId }, "壁纸来源"), sourceSelect),
    apiBox,
    everyRow,
    nextRow,
    dailyHint,
    infoBox,
    h("p", { class: "hint" }, "壁纸从网上加载，连不上时会自动显示内置背景。必应的图由本站代取，必应看不到你的网络地址；其他来源由浏览器直接去取。都看不到你搜索的内容。")
  );

  // 几种类型切换。切到"图片"但一张图都没有时，先停在这个页签等用户添加
  let pane = "";
  const tabs = segmented("背景类型", [["preset", "内置"], ["color", "纯色渐变"], ["image", "图片"], ["online", "在线"]], null, (value) => {
    pane = value;
    if (pane !== "image" || store.get().bg.images.length) store.update((s) => (s.bg.type = pane));
    else showPane();
  });
  function showPane() {
    presetPane.hidden = pane !== "preset";
    colorPane.hidden = pane !== "color";
    imagePane.hidden = pane !== "image";
    onlinePane.hidden = pane !== "online";
    tabs.querySelectorAll("input").forEach((i) => (i.checked = i.value === pane));
  }
  let lastType = "";
  syncers.push((s) => {
    // 设置里的类型变了才跟着切页签；否则保留用户正在看的页签
    if (s.bg.type !== lastType || !pane) {
      lastType = s.bg.type;
      pane = s.bg.type;
    }
    showPane();
  });

  return section(
    "background",
    "image",
    "背景",
    tabs,
    presetPane,
    colorPane,
    imagePane,
    onlinePane,
    rangeRow("模糊", 0, 30, "px", (s) => s.bg.blur, (s, v) => (s.bg.blur = v)),
    rangeRow("暗度遮罩", 0, 80, "%", (s) => s.bg.dim, (s, v) => (s.bg.dim = v))
  );
}

// ---------- 文字 ----------
function textSection() {
  const customId = nextId("font");
  const customInput = h("input", {
    class: "input",
    id: customId,
    maxLength: 40,
    placeholder: "例如：霞鹜文楷、LXGW WenKai",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: false,
  });
  const customBox = h("label", { class: "field", for: customId }, h("span", null, "字体名称（要用这台设备上已经安装的字体）"), customInput);
  let wantCustomFont = false; // 选了"自定义"但还没填字体名
  const familyId = nextId("sel");
  const family = h("select", {
    class: "input",
    id: familyId,
    onchange: () => {
      wantCustomFont = family.value === "custom" && !store.get().font.custom;
      if (wantCustomFont) {
        refresh();
        return customInput.focus();
      }
      store.update((s) => (s.font.family = family.value));
    },
  }, FONT_CHOICES.map(([value, text]) => h("option", { value }, text)));
  customInput.addEventListener("change", () => {
    const name = customInput.value.trim();
    wantCustomFont = !name; // 清空了就回到系统默认字体，但输入框先留着
    store.update((s) => {
      s.font.custom = name;
      s.font.family = name ? "custom" : "system";
    });
  });
  syncers.push((s) => {
    family.value = wantCustomFont ? "custom" : s.font.family;
    customBox.hidden = family.value !== "custom";
    if (document.activeElement !== customInput) customInput.value = s.font.custom;
  });

  const resetBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        wantCustomFont = false;
        store.update((s) => (s.font = defaultSettings().font));
        toast("文字设置已恢复默认");
      },
    },
    icon("rotate-ccw"),
    "恢复默认文字"
  );

  return section(
    "text",
    "type",
    "文字",
    h("div", { class: "set-row" }, h("label", { for: familyId }, "字体", h("small", null, "用的是设备自带的字体，不同设备看到的可能不一样")), family),
    customBox,
    rangeRow("字号", 85, 130, "%", (s) => s.font.scale, (s, v) => (s.font.scale = v), 5),
    rangeRow("粗细", 300, 700, (v) => WEIGHT_NAMES[v] || v, (s) => s.font.weight, (s, v) => (s.font.weight = v), 100),
    rangeRow("时钟大小", 60, 160, "%", (s) => s.font.clockScale, (s, v) => (s.font.clockScale = v), 10),
    rangeRow("时钟粗细", 100, 900, (v) => WEIGHT_NAMES[v] || v, (s) => s.font.clockWeight, (s, v) => (s.font.clockWeight = v), 100),
    h("div", { class: "btn-row" }, resetBtn)
  );
}

// ---------- 搜索 ----------
function searchSection() {
  const engineOptions = (s) => listEngines(s).map((e) => [e.id, e.name]);

  // 自定义引擎列表
  const list = h("ul", { class: "engine-list", "aria-label": "自定义搜索引擎" });
  syncers.push((s) => {
    list.replaceChildren(
      ...s.search.custom.map((c) =>
        h(
          "li",
          null,
          h("div", { class: "engine-meta" }, c.name + (c.bang ? `（!${c.bang}）` : ""), h("small", null, c.url)),
          iconButton("trash-2", `删除搜索引擎“${c.name}”`, {
            onclick: () =>
              store.update((st) => {
                st.search.custom = st.search.custom.filter((x) => x.id !== c.id);
                if (st.search.engine === c.id) st.search.engine = "google";
                if (st.search.last === c.id) st.search.last = "";
              }),
          })
        )
      )
    );
    list.hidden = !s.search.custom.length;
  });

  // 添加自定义引擎
  const name = h("input", { class: "input", maxLength: 30, placeholder: "例如：GitHub", autocomplete: "off" });
  const url = h("input", { class: "input", type: "url", inputMode: "url", placeholder: "https://github.com/search?q=%s", autocomplete: "off", autocapitalize: "off", spellcheck: false });
  const bang = h("input", { class: "input", maxLength: 12, placeholder: "例如：gh（之后输入 !gh 关键词）", autocomplete: "off", autocapitalize: "off", spellcheck: false });
  const error = h("p", { class: "error-text", role: "alert", hidden: true });
  const form = h(
    "form",
    { class: "sub-form", novalidate: true, "aria-label": "添加自定义搜索引擎" },
    h("label", { class: "field" }, h("span", null, "名称"), name),
    h("label", { class: "field" }, h("span", null, "网址模板（用 %s 代表关键词）"), url),
    h("label", { class: "field" }, h("span", null, "直达前缀（可不填）"), bang),
    error,
    h("button", { type: "submit", class: "btn" }, icon("plus"), "添加搜索引擎")
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fail = (msg, field) => {
      error.textContent = msg;
      error.hidden = false;
      field.focus();
    };
    const cleanName = name.value.trim();
    const template = safeTemplate(url.value);
    const prefix = bang.value.trim().replace(/^!+/, "").replace(/\s+/g, "").toLowerCase();
    if (!cleanName) return fail("请填写名称。", name);
    if (!template) return fail("网址模板需要以 http:// 或 https:// 开头，并且包含 %s。", url);
    if (prefix && listEngines(store.get()).some((en) => en.bangs.includes(prefix))) return fail(`前缀 !${prefix} 已经被别的引擎占用了。`, bang);
    error.hidden = true;
    store.update((s) => s.search.custom.push({ id: uid("c-"), name: cleanName, url: template, bang: prefix }));
    name.value = url.value = bang.value = "";
    toast(`已添加搜索引擎“${cleanName}”`);
  });

  const clearBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        searchHistory.clear();
        toast("搜索历史已清空");
      },
    },
    icon("trash-2"),
    "清空搜索历史"
  );

  return section(
    "search",
    "search",
    "搜索",
    selectRow("默认搜索引擎", null, engineOptions, (s) => s.search.engine, (s, v) => { s.search.engine = v; s.search.last = v; }),
    switchRow("记住上次用的引擎", "关掉后，每次打开都用默认引擎", (s) => s.search.remember, (s, v) => (s.search.remember = v)),
    switchRow("按 Tab 切换引擎", "在搜索框里按 Tab 换引擎，按 Esc 离开搜索框", (s) => s.search.tabSwitch, (s, v) => (s.search.tabSwitch = v)),
    switchRow("记录搜索历史", "只保存在这台设备上，不会上传", (s) => s.search.history, (s, v) => (s.search.history = v)),
    h("div", { class: "btn-row" }, clearBtn),
    h("p", { class: "hint" }, "快捷键：按 / 聚焦搜索框，Enter 搜索。输入“!g 关键词”直接用 Google 搜，“!b”Bing，“!bd”百度，“!d”DuckDuckGo，“!ai 问题”直接问 AI。"),
    h("h4", { class: "field-label" }, "自定义搜索引擎"),
    list,
    form
  );
}

// ---------- AI ----------
function aiSection() {
  // ----- 自己填接口：地址 + API Key + 模型 -----
  const urlId = nextId("ai");
  const keyId = nextId("ai");
  const modelId = nextId("ai");
  const listId = nextId("ai");
  const text = { autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: false };
  const urlInput = h("input", { class: "input", id: urlId, type: "url", inputMode: "url", placeholder: "例如 https://api.deepseek.com", maxLength: 500, ...text });
  const keyInput = h("input", { class: "input", id: keyId, type: "password", placeholder: "例如 sk-…", maxLength: 500, ...text });
  const modelInput = h("input", { class: "input", id: modelId, type: "text", placeholder: "例如 deepseek-chat", maxLength: 120, ...text });
  modelInput.setAttribute("list", listId);
  const modelList = h("datalist", { id: listId });
  const status = h("p", { class: "hint ai-status", role: "status" });
  const say = (message, kind = "") => {
    status.textContent = message;
    status.dataset.kind = kind; // ok 绿色 / bad 红色 / 空 普通
  };
  const filled = () => ({ url: urlInput.value.trim(), key: keyInput.value.trim(), model: modelInput.value.trim() });

  // 选服务商：自动填好地址（模型名固定的顺便填上）
  const presetSelect = h(
    "select",
    {
      class: "input",
      "aria-label": "选择服务商，自动填好接口地址",
      onchange: () => {
        const preset = AI_PRESETS.find((p) => p.id === presetSelect.value);
        presetSelect.value = "";
        if (!preset) return;
        urlInput.value = preset.url;
        if (preset.model) modelInput.value = preset.model;
        modelList.replaceChildren();
        say(`已填好 ${preset.name} 的接口地址。${preset.model ? "" : "模型可以点“读取模型列表”来选。"}接着填 API Key，再点“保存并测试”。`);
        keyInput.focus();
      },
    },
    h("option", { value: "" }, "选服务商，自动填地址…"),
    AI_PRESETS.map((p) => h("option", { value: p.id }, p.name))
  );

  // API Key 默认不显示，点眼睛可以看
  const eyeBtn = iconButton("eye", "显示 API Key", {
    onclick: () => {
      const show = keyInput.type === "password";
      keyInput.type = show ? "text" : "password";
      eyeBtn.replaceChildren(icon(show ? "eye-off" : "eye"));
      eyeBtn.setAttribute("aria-label", show ? "隐藏 API Key" : "显示 API Key");
      eyeBtn.title = show ? "隐藏 API Key" : "显示 API Key";
    },
  });

  const modelsBtn = h("button", { type: "button", class: "btn" }, icon("refresh-cw"), "读取模型列表");
  modelsBtn.addEventListener("click", async () => {
    const { url, key } = filled();
    if (!safeUrl(url)) return say("先填接口地址（以 http:// 或 https:// 开头）。", "bad");
    modelsBtn.disabled = true;
    say("正在读取模型列表…");
    try {
      const ids = await fetchModels({ url, key });
      modelList.replaceChildren(...ids.map((id) => h("option", { value: id })));
      if (!modelInput.value.trim() && ids.length === 1) modelInput.value = ids[0];
      say(`读到 ${ids.length} 个模型：点一下“模型”那一栏就能选，也可以直接输入。`, "ok");
      modelInput.focus();
    } catch (err) {
      say(`没读到模型列表：${err.message}（也可以直接手动填模型名）`, "bad");
    }
    modelsBtn.disabled = false;
  });

  const saveBtn = h("button", { type: "submit", class: "btn btn-primary" }, icon("check"), "保存并测试");
  const clearBtn = h("button", { type: "button", class: "btn" }, icon("trash-2"), "清除");
  clearBtn.addEventListener("click", () => {
    userApi.clear();
    urlInput.value = keyInput.value = modelInput.value = "";
    modelList.replaceChildren();
    toast("已清除填写的 AI 接口和 API Key");
    refresh();
  });

  const form = h(
    "form",
    { class: "ai-form-set", novalidate: true },
    h("div", { class: "field" }, presetSelect),
    h("label", { class: "field", for: urlId }, h("span", null, "接口地址"), urlInput),
    h("div", { class: "field" }, h("label", { class: "field-label", for: keyId }, "API Key"), h("div", { class: "inline-form" }, keyInput, eyeBtn)),
    h("div", { class: "field" }, h("label", { class: "field-label", for: modelId }, "模型"), h("div", { class: "inline-form" }, modelInput, modelsBtn), modelList),
    h("div", { class: "btn-row" }, saveBtn, clearBtn),
    status
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = filled();
    if (!safeUrl(value.url)) return say("接口地址需要以 http:// 或 https:// 开头。", "bad");
    if (!value.model) return say("还要填模型名（不知道填什么，可以点“读取模型列表”）。", "bad");
    // 先保存，再测试：就算测试没过，填的内容也不会丢
    userApi.save(value);
    refresh();
    saveBtn.disabled = true;
    say("已保存，正在测试…");
    try {
      const url = await testApi(value);
      if (url !== value.url) {
        urlInput.value = url; // 地址少写了 /v1，已经自动补上
        userApi.save({ ...value, url });
      }
      say("测试通过，可以用了：在搜索框左边的标记里选“AI”，或者直接输入 !ai 加问题。", "ok");
    } catch (err) {
      say(`已保存，但测试没通过：${err.message}`, "bad");
    }
    saveBtn.disabled = false;
  });

  // ----- 站点配置里的 catgpt（配置了才显示） -----
  const siteStatus = h("p", { class: "hint" });
  const clearPassword = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        aiAuth.clear();
        toast("已清除保存的访问密码");
        refresh();
      },
    },
    "清除访问密码"
  );
  const siteBox = h("div", null, siteStatus, h("div", { class: "btn-row" }, clearPassword));

  syncers.push(() => {
    const saved = userApi.get();
    // 正在输入的时候不要把框里的字冲掉
    if (!form.contains(document.activeElement)) {
      urlInput.value = saved.url;
      keyInput.value = saved.key;
      modelInput.value = saved.model;
    }
    clearBtn.hidden = !(saved.url || saved.key || saved.model);
    const hasSite = !!(AI.apiUrl || AI.pageUrl);
    siteBox.hidden = !hasSite;
    if (hasSite) {
      const days = aiAuth.daysLeft();
      const mode = AI.apiUrl ? `本站还接入了 ${AI.name}：没填上面的接口时，在本页弹出对话面板。` : `本站还接入了 ${AI.name}：没填上面的接口时，提问后跳转到 ${AI.name} 页面。`;
      siteStatus.textContent = mode + (days ? ` 访问密码已保存在本机，还有 ${days} 天到期。` : "");
      clearPassword.hidden = !days;
    }
  });

  return section(
    "ai",
    "sparkles",
    "AI",
    h("p", { class: "hint" }, "填上你自己的 AI 接口，就能在搜索框里直接提问。支持“OpenAI 兼容”的接口：DeepSeek、OpenAI、硅基流动、OpenRouter 等大多数服务都是。"),
    form,
    h("p", { class: "hint" }, "API Key 只保存在这台设备的浏览器里：提问时由浏览器直接发给你填的接口地址，不经过本站服务器，“导出设置”也不会带上它。不要在公用电脑上填。"),
    siteBox
  );
}

// ---------- 数据 ----------
function dataSection() {
  const withImages = h("input", { type: "checkbox", id: "export-images", role: "switch", checked: true });

  const exportBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: async () => {
        exportBtn.disabled = true;
        try {
          const data = await buildExport(withImages.checked);
          // 文件名只用英文和数字，避免个别系统把中文文件名弄乱
          downloadText(`start-page-settings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
          toast("已导出。搜索历史、AI 的 API Key 和访问密码不会包含在文件里");
        } catch {
          toast("导出失败，请重试");
        }
        exportBtn.disabled = false;
      },
    },
    icon("download"),
    "导出设置"
  );

  const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, "aria-hidden": "true", tabindex: "-1" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast("这个文件不是有效的设置文件");
    }
    const ok = await confirmDialog({ title: "导入设置？", message: "当前的设置、背景图片和导航改动会被文件里的内容替换。", okText: "导入" });
    if (!ok) return;
    try {
      await applyImport(data);
      toast("导入完成");
    } catch {
      toast("导入失败：这不是起始页导出的设置文件，或浏览器不允许网站保存数据");
    }
  });
  const importBtn = h("button", { type: "button", class: "btn", onclick: () => fileInput.click() }, icon("upload"), "导入设置");

  const resetBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: async () => {
        const ok = await confirmDialog({
          title: "恢复默认设置？",
          message: "所有设置回到初始状态，上传的背景图片、搜索历史和填写的 AI 接口（含 API Key）会被删除。导航的改动不受影响（在编辑模式里单独恢复）。",
          okText: "恢复默认",
          danger: true,
        });
        if (!ok) return;
        userApi.clear(); // 先清掉，下面换设置时界面会跟着刷新
        store.replace(null);
        searchHistory.clear();
        await pruneImages();
        toast("已恢复默认设置");
      },
    },
    icon("rotate-ccw"),
    "恢复默认"
  );

  return section(
    "data",
    "hard-drive",
    "数据",
    h("p", { class: "hint" }, "设置只保存在这台设备的浏览器里。换设备时，在旧设备导出、在新设备导入即可。"),
    h("div", { class: "set-row" }, h("label", { for: "export-images" }, "导出时包含上传的背景图片", h("small", null, "文件会比较大")), h("label", { class: "switch" }, withImages, h("span"))),
    h("div", { class: "btn-row" }, exportBtn, importBtn, fileInput, resetBtn)
  );
}

// ---------- 组装 ----------
function build() {
  const body = h(
    "div",
    { class: "panel-body" },
    section(
      "theme",
      "palette",
      "外观",
      segmented("主题", [["system", "跟随系统", "monitor"], ["light", "浅色", "sun"], ["dark", "深色", "moon"]], (s) => s.theme, (v) => store.update((s) => (s.theme = v))),
      rangeRow("搜索框透明度", 0, 100, "%", (s) => s.search.transparency, (s, v) => (s.search.transparency = v), 5),
      h("p", { class: "hint" }, "0% 是完全不透明，100% 是完全透明。里面的文字会自动在白字和深字之间切换，保证看得清。")
    ),
    backgroundSection(),
    textSection(),
    searchSection(),
    section(
      "links",
      "external-link",
      "链接",
      selectRow(
        "打开方式",
        "“按每个入口的设置”时，搜索结果在当前页打开",
        () => [["auto", "按每个入口的设置"], ["new", "全部在新标签页"], ["same", "全部在当前页"]],
        (s) => s.linkTarget,
        (s, v) => (s.linkTarget = v)
      )
    ),
    section("widgets", "layout-dashboard", "小组件", switchRow("时间、日期和问候语", null, (s) => s.widgets.clock, (s, v) => (s.widgets.clock = v))),
    aiSection(),
    dataSection(),
    h("p", { class: "hint panel-foot" }, h("a", { href: "about/index.html" }, "关于本站"))
  );
  dialog = h(
    "dialog",
    { class: "drawer", "aria-labelledby": "settings-title" },
    h("div", { class: "panel-head" }, h("h2", { id: "settings-title" }, "设置"), iconButton("x", "关闭设置", { onclick: () => dialog.close() })),
    body
  );
  store.subscribe(() => dialog.open && refresh());
}

/** 打开设置面板；section 可以指定直接跳到某一块（如 "search"） */
export function openSettingsPanel(sectionKey) {
  if (!dialog) build();
  refresh();
  openDialog(dialog);
  if (sectionKey && sections[sectionKey]) {
    sections[sectionKey].scrollIntoView({ block: "start" });
    sections[sectionKey].focus({ preventScroll: true });
  }
}
