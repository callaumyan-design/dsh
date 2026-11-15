// 设置面板（右上角齿轮）：背景、搜索、链接、主题、小组件、数据导出/导入/恢复默认。
// 所有改动立刻生效，并保存在浏览器本地。
import { BACKGROUND_PRESETS, AI } from "../../config/site.js";
import { store, safeTemplate, uid } from "./store.js";
import { addUploads, addImageUrl, removeImage, selectImage, shownImageId, shuffleBackground, thumbFor } from "./background.js";
import { listEngines } from "./engines.js";
import { searchHistory } from "./search.js";
import { buildExport, applyImport, pruneImages } from "./backup.js";
import { aiAuth } from "./ai/auth.js";
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

/** 滑块一行 */
function rangeRow(label, min, max, unit, get, set) {
  const id = nextId("rg");
  const out = h("output", { for: id });
  const input = h("input", {
    type: "range",
    id,
    min: String(min),
    max: String(max),
    step: "1",
    oninput: () => {
      out.textContent = input.value + unit;
      store.update((s) => set(s, Number(input.value)));
    },
  });
  syncers.push((s) => {
    input.value = String(get(s));
    out.textContent = get(s) + unit;
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
    else toast("这些文件不是浏览器能识别的图片");
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

  // 三种类型切换。切到"图片"但一张图都没有时，先停在这个页签等用户添加
  let pane = "";
  const tabs = segmented("背景类型", [["preset", "内置"], ["color", "纯色 / 渐变"], ["image", "图片"]], null, (value) => {
    pane = value;
    if (pane !== "image" || store.get().bg.images.length) store.update((s) => (s.bg.type = pane));
    else showPane();
  });
  function showPane() {
    presetPane.hidden = pane !== "preset";
    colorPane.hidden = pane !== "color";
    imagePane.hidden = pane !== "image";
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
    rangeRow("模糊", 0, 30, "px", (s) => s.bg.blur, (s, v) => (s.bg.blur = v)),
    rangeRow("暗度遮罩", 0, 80, "%", (s) => s.bg.dim, (s, v) => (s.bg.dim = v)),
    h("p", { class: "hint" }, "“必应每日一图”需要服务器中转，本站是纯静态网站，暂不提供。")
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
    h("h4", { class: "field-label" }, "自定义搜索引擎"),
    list,
    form
  );
}

// ---------- AI ----------
function aiSection() {
  const status = h("p", { class: "hint" });
  const clearBtn = h(
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
  syncers.push(() => {
    const mode = AI.apiUrl ? `已接入 ${AI.name}：在本页弹出对话面板。` : AI.pageUrl ? `已接入 ${AI.name}：提问后跳转到 ${AI.name} 页面。` : `还没有接入 ${AI.name}（需要站长在 config/site.js 里填写地址）。`;
    const days = aiAuth.daysLeft();
    status.textContent = mode + (days ? ` 访问密码已保存在本机，还有 ${days} 天到期。` : "");
    clearBtn.hidden = !days;
  });
  return section("ai", "sparkles", "AI", status, h("div", { class: "btn-row" }, clearBtn));
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
          downloadText(`起始页设置-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
          toast("已导出。搜索历史和 AI 访问密码不会包含在文件里");
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
      toast("这个文件不是起始页导出的设置文件");
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
          message: "所有设置回到初始状态，上传的背景图片和搜索历史会被删除。导航的改动不受影响（在编辑模式里单独恢复）。",
          okText: "恢复默认",
          danger: true,
        });
        if (!ok) return;
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
      segmented("主题", [["system", "跟随系统", "monitor"], ["light", "浅色", "sun"], ["dark", "深色", "moon"]], (s) => s.theme, (v) => store.update((s) => (s.theme = v)))
    ),
    backgroundSection(),
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
    dataSection()
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
