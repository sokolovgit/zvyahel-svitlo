// Світло · Звягель — Scriptable widget
// https://github.com/sokolovgit/zvyahel-svitlo

const REPO_RAW = "https://raw.githubusercontent.com/sokolovgit/zvyahel-svitlo/main";
const SCHEDULE_URL = `${REPO_RAW}/data/schedule.json`;
const ADDRESSES_URL = `${REPO_RAW}/data/addresses.json`;
const SOURCE_URL = "https://www.ztoe.com.ua/unhooking-search.php";
const SUBQUEUES = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2", "4.1", "4.2", "5.1", "5.2", "6.1", "6.2"];
const SLOTS = 48;
const SLOT_MIN = 30;

const C = {
  bgTop: new Color("#262a33"),
  bgBottom: new Color("#14161b"),
  text: new Color("#f4f5f7"),
  dim: new Color("#9aa0ab"),
  off: new Color("#e07a73"),
  on: new Color("#6fc596"),
  unknown: new Color("#3a3f4a"),
  marker: Color.white(),
};

const fm = FileManager.local();
const dir = fm.joinPath(fm.libraryDirectory(), "zvyahel-svitlo");
if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
const file = (name) => fm.joinPath(dir, name);

function readJSON(name) {
  try {
    return fm.fileExists(file(name)) ? JSON.parse(fm.readString(file(name))) : null;
  } catch (e) {
    return null;
  }
}
const writeJSON = (name, value) => fm.writeString(file(name), JSON.stringify(value));

async function fetchCached(url, name, maxAgeMin) {
  const path = file(name);
  const cached = readJSON(name);
  if (cached && maxAgeMin && (Date.now() - fm.modificationDate(path).getTime()) / 60000 < maxAgeMin) return cached;
  try {
    const req = new Request(url);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    if (req.response.statusCode !== 200) throw new Error(`HTTP ${req.response.statusCode}`);
    writeJSON(name, data);
    return data;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

// ---------- time ----------

function kyivNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60,
  };
}

function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const hhmm = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// ---------- schedule analysis ----------

// Slots of yesterday + today + tomorrow; '0' = світло є, '1' = відключення, '?' = графіка ще немає.
function timeline(schedule, subqueue, today) {
  const day = (offset) => schedule.days.find((d) => d.date === shiftDate(today, offset))?.queues[subqueue] ?? "?".repeat(SLOTS);
  return day(-1) + day(0) + day(1);
}

function runAt(line, idx) {
  const state = line[idx];
  let start = idx;
  let end = idx + 1;
  while (start > 0 && line[start - 1] === state) start--;
  while (end < line.length && line[end] === state) end++;
  return { state, start, end };
}

// Minutes relative to today's midnight.
const slotMin = (idx) => (idx - SLOTS) * SLOT_MIN;

function analyze(schedule, subqueue, now) {
  const line = timeline(schedule, subqueue, now.date);
  const idx = SLOTS + Math.floor(now.minutes / SLOT_MIN);
  const current = runAt(line, idx);
  const next = current.end < line.length ? runAt(line, current.end) : null;
  const nextOff = current.state === "1" ? current : [next, next && next.end < line.length ? runAt(line, next.end) : null].find((r) => r?.state === "1");
  return {
    line,
    state: current.state,
    current: { ...current, from: slotMin(current.start), to: slotMin(current.end), openEnd: current.end === line.length || line[current.end] === "?" },
    next: next && { ...next, from: slotMin(next.start), to: slotMin(next.end) },
    nextOff: nextOff && { from: slotMin(nextOff.start), to: slotMin(nextOff.end) },
    nextChangeMin: current.end < line.length ? slotMin(current.end) : null,
  };
}

const dayLabel = (min) => (min >= 1440 ? " (завтра)" : "");

function describe(a) {
  if (a.state === "?") {
    return { status: "Немає графіка", color: C.dim, label: "Графік на сьогодні ще не опубліковано", big: "—", sub: "" };
  }
  if (a.state === "1") {
    const after = a.next?.state === "0" ? `Потім світло до ${hhmm(a.next.to)}${dayLabel(a.next.to)}` : "";
    return {
      status: "Без світла",
      color: C.off,
      label: "Відключення триває",
      big: `${hhmm(a.current.from)} – ${a.current.openEnd ? "…" : hhmm(a.current.to)}`,
      sub: after,
    };
  }
  if (a.nextOff && a.nextOff.from < 2880) {
    return {
      status: "Є світло",
      color: C.on,
      label: `Наступне відключення${dayLabel(a.nextOff.from)}`,
      big: `${hhmm(a.nextOff.from)} – ${hhmm(a.nextOff.to)}`,
      sub: `Світло до ${hhmm(a.current.to)}${dayLabel(a.current.to)}`,
    };
  }
  return { status: "Є світло", color: C.on, label: "Відключень не заплановано", big: a.current.openEnd ? "до кінця графіка" : `до ${hhmm(a.current.to)}`, sub: "" };
}

// ---------- drawing ----------

function fillRounded(ctx, rect, r) {
  const path = new Path();
  path.addRoundedRect(rect, r, r);
  ctx.addPath(path);
  ctx.fillPath();
}

function drawBar(ctx, line, x, y, w, h) {
  const today = line.slice(SLOTS, SLOTS * 2);
  const slotW = w / SLOTS;
  const r = h / 2;
  let i = 0;
  while (i < SLOTS) {
    let j = i;
    while (j < SLOTS && today[j] === today[i]) j++;
    ctx.setFillColor(today[i] === "1" ? C.off : today[i] === "0" ? C.on : C.unknown);
    const sx = x + i * slotW;
    const sw = (j - i) * slotW;
    if (i === 0 || j === SLOTS) {
      fillRounded(ctx, new Rect(sx, y, sw, h), Math.min(r, sw / 2));
      const inner = i === 0 && j === SLOTS ? null : i === 0 ? new Rect(sx + r, y, Math.max(0, sw - r), h) : new Rect(sx, y, Math.max(0, sw - r), h);
      if (inner) ctx.fillRect(inner);
    } else {
      ctx.fillRect(new Rect(sx, y, sw, h));
    }
    i = j;
  }
}

function barImage({ line, nowMin, width = 640, barH = 18, labels = true }) {
  const height = labels ? barH + 40 : barH + 10;
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const pad = 14;
  drawBar(ctx, line, pad, 5, width - pad * 2, barH);
  if (labels) {
    ctx.setFont(Font.mediumSystemFont(20));
    ctx.setTextColor(C.dim);
    ctx.setTextAlignedCenter();
    for (let hr = 0; hr <= 24; hr += 3) {
      const tx = pad + (hr / 24) * (width - pad * 2);
      ctx.setFillColor(C.dim);
      ctx.fillRect(new Rect(tx - 1, barH + 9, 2, 6));
      ctx.drawTextInRect(String(hr), new Rect(tx - 20, barH + 15, 40, 24));
    }
  }
  if (nowMin != null) {
    const mx = pad + (nowMin / 1440) * (width - pad * 2);
    ctx.setFillColor(C.marker);
    ctx.fillRect(new Rect(mx - 2, 1, 4, barH + 8));
  }
  return ctx.getImage();
}

function overviewImage(schedule, now, highlight) {
  const width = 640;
  const rowH = 30;
  const labelW = 56;
  const pad = 6;
  const height = SUBQUEUES.length * rowH + 34;
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const barX = labelW;
  const barW = width - labelW - pad;
  SUBQUEUES.forEach((q, i) => {
    const y = i * rowH;
    ctx.setFont(q === highlight ? Font.boldSystemFont(19) : Font.mediumSystemFont(19));
    ctx.setTextColor(q === highlight ? C.text : C.dim);
    ctx.drawTextInRect(q, new Rect(pad, y + 3, labelW, rowH));
    drawBar(ctx, timeline(schedule, q, now.date), barX, y + 6, barW, rowH - 12);
    if (q === highlight) {
      ctx.setStrokeColor(C.text);
      ctx.setLineWidth(2);
      ctx.strokeRect(new Rect(barX - 1, y + 5, barW + 2, rowH - 10));
    }
  });
  const ticksY = SUBQUEUES.length * rowH;
  ctx.setFont(Font.mediumSystemFont(18));
  ctx.setTextColor(C.dim);
  ctx.setTextAlignedCenter();
  for (let hr = 0; hr <= 24; hr += 3) {
    const tx = barX + (hr / 24) * barW;
    ctx.drawTextInRect(String(hr), new Rect(tx - 20, ticksY + 6, 40, 24));
  }
  const mx = barX + (now.minutes / 1440) * barW;
  ctx.setFillColor(C.marker);
  ctx.fillRect(new Rect(mx - 1.5, 0, 3, ticksY));
  return ctx.getImage();
}

// ---------- widgets ----------

function baseWidget() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [C.bgTop, C.bgBottom];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.url = SOURCE_URL;
  return w;
}

function addText(stack, text, font, color, opts = {}) {
  const t = stack.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = opts.scale ?? 0.6;
  if (opts.center) t.centerAlignText();
  if (opts.right) t.rightAlignText();
  return t;
}

function header(w, settings, schedule, d, compact) {
  const row = w.addStack();
  row.layoutHorizontally();
  const left = row.addStack();
  left.layoutVertically();
  addText(left, "Звягель", Font.boldSystemFont(compact ? 14 : 16), C.text);
  addText(left, settings.subqueue ? `Підчерга ${settings.subqueue}` : "Не вимикається", Font.systemFont(compact ? 11 : 12), C.dim);
  row.addSpacer();
  const right = row.addStack();
  right.layoutVertically();
  const status = right.addStack();
  status.addSpacer();
  addText(status, `● ${d.status}`, Font.semiboldSystemFont(compact ? 13 : 16), d.color, { right: true });
  if (!compact && schedule?.updatedAt) {
    const upd = right.addStack();
    upd.addSpacer();
    upd.centerAlignContent();
    const icon = upd.addImage(SFSymbol.named("arrow.clockwise").image);
    icon.imageSize = new Size(10, 10);
    icon.tintColor = C.dim;
    upd.addSpacer(3);
    addText(upd, schedule.updatedAt.slice(11, 16), Font.systemFont(12), C.dim);
  }
}

function fixedDescription() {
  return { status: "Є світло", color: C.on, label: "Ваша адреса", big: "Не вимикається", sub: "за графіком (крім аварійних)" };
}

function mediumWidget(settings, schedule, a, now) {
  const d = a ? describe(a) : fixedDescription();
  const w = baseWidget();
  w.setPadding(14, 16, 10, 16);
  header(w, settings, schedule, d, false);
  w.addSpacer();
  addText(w, d.label, Font.systemFont(12), C.dim, { center: true });
  w.addSpacer(1);
  addText(w, d.big, Font.semiboldRoundedSystemFont(30), C.text, { center: true, scale: 0.5 });
  if (d.sub) addText(w, d.sub, Font.systemFont(11), C.dim, { center: true });
  w.addSpacer();
  if (a) {
    const img = w.addImage(barImage({ line: a.line, nowMin: now.minutes }));
    img.centerAlignImage();
  }
  return w;
}

function smallWidget(settings, schedule, a, now) {
  const d = a ? describe(a) : fixedDescription();
  const w = baseWidget();
  w.setPadding(12, 12, 10, 12);
  addText(w, settings.subqueue ? `Звягель · ${settings.subqueue}` : "Звягель", Font.semiboldSystemFont(12), C.dim);
  w.addSpacer(4);
  addText(w, `● ${d.status}`, Font.semiboldSystemFont(15), d.color);
  w.addSpacer();
  if (a && a.state === "1") {
    addText(w, "до", Font.systemFont(11), C.dim);
    addText(w, a.current.openEnd ? "…" : hhmm(a.current.to), Font.semiboldRoundedSystemFont(30), C.text);
  } else if (a && a.nextOff) {
    addText(w, "відключення о", Font.systemFont(11), C.dim);
    addText(w, hhmm(a.nextOff.from), Font.semiboldRoundedSystemFont(30), C.text);
  } else {
    addText(w, d.big, Font.semiboldRoundedSystemFont(18), C.text);
  }
  w.addSpacer();
  if (a) w.addImage(barImage({ line: a.line, nowMin: now.minutes, width: 320, barH: 14, labels: false }));
  return w;
}

function largeWidget(settings, schedule, a, now) {
  const w = mediumWidget(settings, schedule, a, now);
  w.addSpacer(8);
  addText(w, "Усі підчерги на сьогодні", Font.semiboldSystemFont(12), C.dim);
  w.addSpacer(4);
  w.addImage(overviewImage(schedule, now, settings.subqueue));
  return w;
}

function accessoryWidget(settings, a, family) {
  const w = new ListWidget();
  const d = a ? describe(a) : fixedDescription();
  let short;
  if (!a) short = "не вимикається";
  else if (a.state === "1") short = `без світла до ${a.current.openEnd ? "…" : hhmm(a.current.to)}`;
  else if (a.nextOff) short = `відкл. ${hhmm(a.nextOff.from)}–${hhmm(a.nextOff.to)}`;
  else short = "відключень немає";

  if (family === "accessoryInline") {
    addText(w, `${a?.state === "1" ? "🕯️" : "💡"} ${short}`, Font.systemFont(12), Color.white());
  } else if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    addText(w, a?.state === "1" ? "OFF" : "ON", Font.boldSystemFont(14), Color.white(), { center: true });
    const target = a?.state === "1" ? a.current.to : a?.nextOff?.from;
    if (target != null) addText(w, hhmm(target), Font.systemFont(12), Color.white(), { center: true });
  } else {
    addText(w, `Звягель${settings.subqueue ? " · " + settings.subqueue : ""}`, Font.semiboldSystemFont(13), Color.white());
    addText(w, d.status, Font.boldSystemFont(15), Color.white());
    addText(w, short, Font.systemFont(13), Color.white());
  }
  return w;
}

function messageWidget(title, text) {
  const w = baseWidget();
  w.setPadding(14, 16, 14, 16);
  addText(w, title, Font.boldSystemFont(15), C.text);
  w.addSpacer(6);
  const t = w.addText(text);
  t.font = Font.systemFont(12);
  t.textColor = C.dim;
  w.url = URLScheme.forRunningScript();
  return w;
}

// ---------- settings & setup ----------

const SETTINGS_FILE = "settings.json";
const loadSettings = () => readJSON(SETTINGS_FILE);
const saveSettings = (s) => writeJSON(SETTINGS_FILE, s);

function settingsFromParameter(param) {
  const p = (param ?? "").trim().replace(",", ".");
  return SUBQUEUES.includes(p) ? { subqueue: p, address: null } : null;
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[’'`ʼ]/g, "")
    .replace(/(^|\s)(вулиця|вул|провулок|пров|проспект|просп|площа|пл|бульвар|бульв|майдан|тупик|туп|проїзд)(\.|\s|$)\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
const normHouse = (h) => h.toLowerCase().replace(/[\s\-–]/g, "");

async function pickFromList(title, items) {
  const table = new UITable();
  table.showSeparators = true;
  const head = new UITableRow();
  head.isHeader = true;
  head.addText(title);
  table.addRow(head);
  let picked = null;
  items.forEach((item) => {
    const row = new UITableRow();
    row.height = item.subtitle ? 60 : 44;
    row.addText(item.title, item.subtitle);
    row.dismissOnSelect = true;
    row.onSelect = () => (picked = item);
    table.addRow(row);
  });
  await table.present(false);
  return picked;
}

async function ask(title, message, placeholder) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addTextField(placeholder, "");
  a.addAction("Далі");
  a.addCancelAction("Скасувати");
  return (await a.presentAlert()) === -1 ? null : a.textFieldValue(0).trim();
}

async function info(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

const entryLabel = (e) => (e.subqueue ? `підчерга ${e.subqueue}` : "не вимикається") + (e.household ? "" : " · юр. особи");

async function setupByAddress() {
  let data;
  try {
    data = await fetchCached(ADDRESSES_URL, "addresses.json", 24 * 60);
  } catch (e) {
    await info("Немає зʼєднання", "Не вдалося завантажити список адрес. Спробуй ще раз або обери підчергу вручну.");
    return null;
  }
  const query = await ask("Вулиця", "Введи назву вулиці (можна частину)", "напр. Шевченка");
  if (!query) return null;
  const matches = data.streets.filter((s) => norm(s.name).includes(norm(query)));
  if (!matches.length) {
    await info("Не знайдено", `Немає вулиці «${query}» у Звягелі. Спробуй іншу частину назви.`);
    return null;
  }
  const street = matches.length === 1 ? matches[0] : await pickFromList("Обери вулицю", matches.map((s) => ({ title: s.name, street: s }))).then((p) => p?.street);
  if (!street) return null;

  const house = await ask(street.name, "Номер будинку", "напр. 12А");
  if (house === null) return null;
  const household = street.entries.filter((e) => e.household);
  const pool = household.length ? household : street.entries;
  let found = house ? pool.filter((e) => e.houses.split(",").some((h) => normHouse(h) === normHouse(house))) : [];
  const distinct = [...new Set(found.map((e) => e.subqueue))];
  let entry;
  if (distinct.length === 1) entry = found[0];
  else {
    const candidates = (found.length ? found : street.entries).map((e) => ({ title: entryLabel(e), subtitle: `буд. ${e.houses}`, entry: e }));
    entry = (await pickFromList(found.length ? "Кілька варіантів — обери свій" : "Будинок не знайдено — обери зі списку", candidates))?.entry;
  }
  if (!entry) return null;
  const address = `${street.name}${house ? ", " + house : ""}`;
  await info("Готово", `${address}\n${entry.subqueue ? "Підчерга " + entry.subqueue : "Ця адреса не вимикається за графіком"}`);
  return { subqueue: entry.subqueue, address };
}

async function setupManual() {
  const picked = await pickFromList(
    "Обери підчергу",
    SUBQUEUES.map((q) => ({ title: `Підчерга ${q}`, q }))
  );
  return picked ? { subqueue: picked.q, address: null } : null;
}

async function menu() {
  const settings = loadSettings();
  const a = new Alert();
  a.title = "Світло · Звягель";
  a.message = settings
    ? `Зараз: ${settings.address ? settings.address + " → " : ""}${settings.subqueue ? "підчерга " + settings.subqueue : "не вимикається"}`
    : "Спочатку обери свою адресу або підчергу.";
  const actions = [];
  const add = (title, fn) => {
    a.addAction(title);
    actions.push(fn);
  };
  add("Знайти підчергу за адресою", async () => {
    const s = await setupByAddress();
    if (s) saveSettings(s);
  });
  add("Обрати підчергу вручну", async () => {
    const s = await setupManual();
    if (s) saveSettings(s);
  });
  if (settings) {
    add("Переглянути віджет", async () => (await render("medium")).presentMedium());
    add("Переглянути великий віджет", async () => (await render("large")).presentLarge());
  }
  add("Як додати на екран", () =>
    info(
      "Додавання віджета",
      "1. Довге натискання на домашньому екрані → «+» (або «Редагувати» → «Додати віджет»).\n2. Знайди Scriptable, обери розмір (середній — як на скріні).\n3. Натисни на віджет → Script: обери цей скрипт.\n4. Parameter можна лишити порожнім (тоді буде твоя адреса) або вписати підчергу, напр. 3.2."
    )
  );
  a.addCancelAction("Закрити");
  const i = await a.presentSheet();
  if (i >= 0) await actions[i]();
}

// ---------- entry ----------

async function render(family) {
  const settings = settingsFromParameter(args.widgetParameter) ?? loadSettings();
  if (!settings) return messageWidget("Світло · Звягель", "Натисни, щоб обрати адресу або підчергу.");
  let schedule;
  try {
    schedule = await fetchCached(SCHEDULE_URL, "schedule.json", 0);
  } catch (e) {
    return messageWidget("Немає даних", "Не вдалося завантажити графік. Перевір інтернет.");
  }
  const now = kyivNow();
  const a = settings.subqueue ? analyze(schedule, settings.subqueue, now) : null;

  let w;
  if (family === "small") w = smallWidget(settings, schedule, a, now);
  else if (family === "large" || family === "extraLarge") w = largeWidget(settings, schedule, a, now);
  else if (family?.startsWith("accessory")) w = accessoryWidget(settings, a, family);
  else w = mediumWidget(settings, schedule, a, now);

  const refreshIn = a?.nextChangeMin != null ? Math.min(15, Math.max(1, a.nextChangeMin - now.minutes)) : 15;
  w.refreshAfterDate = new Date(Date.now() + refreshIn * 60000);
  return w;
}

if (globalThis.__SVITLO_TEST__) {
  globalThis.__SVITLO_TEST__({ analyze, describe, hhmm, kyivNow, norm, normHouse, render, settingsFromParameter });
} else if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(await render(config.widgetFamily));
} else {
  await menu();
}
Script.complete();
