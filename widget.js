/* Виджет «Расписание 307» для Scriptable (iOS).
   Поминутный формат без живого таймера: весь текст статичный и считается
   при прогоне, поэтому счёт вверх после нуля (документированное поведение
   системного timer-стиля) в принципе невозможен. Герой — «N минут» до
   конца/начала пары; в дальних диапазонах — абсолютное время «12:10»,
   которое не устаревает между прогонами. Прогоны — только по событиям:
   в дальних диапазонах раз в 2–3 часа, в последний час — лестница 30/20/5/3
   минуты; бюджет обновлений iOS 40–70 в день расходуется бережно.
   Данные: https://adelechik.github.io/classgrid/data.js, кэш в FileManager.local().
   Параметр виджета: «А» или «Б». Тап по виджету открывает сайт. */

const DATA_URL = "https://adelechik.github.io/classgrid/data.js";
const SITE_URL = "https://adelechik.github.io/classgrid/";
const SEMESTER_START = new Date(2026, 8, 1);   // 2026-09-01
const MAX_WEEK = 17;
const WIDGET_CACHE = "schedule307-data.json";

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/* Цвета по докам Scriptable: Color.dynamic(light, dark) и new Color("#hex"). */
const C_TEXT = Color.dynamic(new Color("#000000"), new Color("#ffffff"));
const C_SUB = Color.dynamic(new Color("#6e6e73"), new Color("#98989f"));
const C_BG = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
const C_ACCENT = Color.dynamic(new Color("#007aff"), new Color("#0a84ff"));

/* Короткие имена пар для компактного показа; неизвестные показываем как есть. */
const SHORT_NAMES = {
  "Аудирование текстов (второй иностранный язык)": "Аудирование (2-й иностр.)",
  "К/В Культура иноязычного общения (на английском языке)": "Культура общения",
  "К/В Практикум по межкультурному общению (на английском языке)": "Межкульт. практикум",
  "К/В Современная письменная коммуникация на английском языке": "Письм. коммуникация",
  "Методика обучения и воспитания в области второго иностранного языка": "Методика (2-й иностр.)",
  "Методика обучения и воспитания в области первого иностранного (английского) языка": "Методика (англ. яз.)",
  "Практика по профилю подготовки (в области иностранных языков)": "Практика",
  "Практический курс английского языка": "Англ. яз. (практ.)",
  "Практический курс второго иностранного языка": "2-й иностр. (практ.)",
  "Синтаксис второго иностранного языка": "Синтаксис (2-й иностр.)",
  "Финансово-экономический практикум": "Фин.-экон. практикум",
  "Чтение художественного текста на английском языке": "Чтение (англ. яз.)"
};
function shortName(n) { return SHORT_NAMES[n] || n; }

/* ---------- загрузка данных ---------- */
/* По докам Scriptable: Request.loadString/loadJSON/load — Promise-based, await обязателен. */
let fetchError = "";   // причина последнего сбоя — показываем в заглушке
async function fetchSchedule() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), WIDGET_CACHE);
  try {
    console.log("Сеть: запрашиваю " + DATA_URL);
    const req = new Request(DATA_URL);
    const txt = await req.loadString();
    if (typeof txt !== "string") throw new Error("пустой ответ");
    let data = null, raw = null;
    for (const line of txt.split("\n")) {
      if (line.indexOf("window.SCHEDULE_DATA") < 0) continue;
      const s = line.indexOf("{"), e = line.lastIndexOf("}");
      if (s >= 0 && e > s) { raw = line.slice(s, e + 1); break; }
    }
    if (raw) data = JSON.parse(raw);
    if (data) {
      fm.writeString(path, raw);
      console.log("Сеть: данные получены, кэш записан");
      return data;
    }
    fetchError = "ответ без расписания";
    console.error("Сеть: ответ получен, но без SCHEDULE_DATA");
  } catch (e) {
    fetchError = String(e).slice(0, 80);
    console.error("Сеть: ошибка — " + fetchError);
  }
  if (fm.fileExists(path)) {
    try {
      const cached = JSON.parse(fm.readString(path));
      console.log("Кэш: читаю сохранённую копию");
      return cached;
    } catch (e) { return null; }
  }
  console.error("Кэш: пуст — данных нет");
  return null;
}

/* ---------- логика расписания ---------- */
function pad2(n) { return (n < 10 ? "0" : "") + n; }

function parseTimes(times) {
  return times.map(t => {
    const p = t.split("–");
    const a = p[0].split(":");
    const b = p[1].split(":");
    return { start: (+a[0]) * 60 + (+a[1]), end: (+b[0]) * 60 + (+b[1]) };
  });
}

function todayIndex() {
  const n = new Date();
  return (n.getDay() + 6) % 7;   // 0 = Пн … 6 = Вс
}

function weekOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.floor(Math.round((d - SEMESTER_START) / 864e5) / 7) + 1;
  return diff;
}

function itemsAt(data, group, dayIdx, timeIdx, week) {
  const byDay = data.groups[group] || {};
  const slots = byDay[DAYS[dayIdx]] || [];
  let items = [];
  for (const slot of slots) {
    if (slot.time === data.times[timeIdx]) { items = slot.items; break; }
  }
  return items.filter(it => it.weeks && it.weeks.indexOf(week) >= 0);
}

/* Аудитория из dmeta: «…— ауд. 402» или перечень «ауд. 403 (14 нед.), 401 (15–16 нед.)»
   с выбором по текущей неделе. */
function audOf(dmeta, week) {
  const i = (dmeta || "").lastIndexOf("ауд.");
  if (i < 0) return "";
  const tail = dmeta.slice(i + 4).trim();
  const parts = tail.split(/,\s*/);
  if (parts.length === 1) return tail;
  let pick = "", fallback = "";
  for (const part of parts) {
    const m = /^([^(]+?)\s*(?:\(([^)]*)\))?$/.exec(part.trim());
    if (!m) continue;
    if (!fallback) fallback = m[1].trim();
    if (week != null && m[2]) {
      const r = m[2].split("–");
      const from = parseInt(r[0], 10), to = r.length > 1 ? parseInt(r[1], 10) : from;
      if (week >= from && week <= to) { pick = m[1].trim(); break; }
    }
  }
  return pick || fallback || tail;
}

/* Все занятия дня: [{ti, name, aud, start, end}] */
function lessonsOfDay(data, timesMin, group, dayIdx, week) {
  const res = [];
  for (let ti = 0; ti < data.times.length; ti++) {
    const its = itemsAt(data, group, dayIdx, ti, week);
    if (its.length) {
      const audM = audOf(its[0].dmeta, week); // строка, а не match
      res.push({
        ti: ti,
        name: its[0].name,
        aud: audM,
        start: timesMin[ti].start,
        end: timesMin[ti].end
      });
    }
  }
  return res;
}

/* Ближайшее занятие: в k=0 только пары, которые ещё не закончились. */
function nextLesson(data, timesMin, group, afterDate) {
  const nowMin = afterDate.getHours() * 60 + afterDate.getMinutes();
  for (let k = 0; k <= MAX_WEEK * 7; k++) {
    const d = new Date(afterDate.getFullYear(), afterDate.getMonth(), afterDate.getDate() + k);
    const raw = weekOf(d);
    if (raw > MAX_WEEK) return null;
    if (raw < 1) continue;
    const di = (d.getDay() + 6) % 7;
    if (di > 5) continue;
    const ls = lessonsOfDay(data, timesMin, group, di, raw);
    const rest = k === 0 ? ls.filter(l => l.end > nowMin) : ls;
    if (rest.length) {
      return { date: d, dayIdx: di, week: raw, first: rest[0], count: rest.length, lessons: rest };
    }
  }
  return null;
}

function hhmm(min) { return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); }

/* Русские склонения для героя «N минут»: 1 минута, 2 минуты, 5 минут, 21 минута. */
function minWord(n) {
  const d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return "минута";
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return "минуты";
  return "минут";
}

/* ---------- состояние «сейчас / скоро / свободно» ---------- */
/* kind: now — пара идёт; next — до начала есть время; idle — сегодня пар нет. */
function liveState(data, timesMin, group) {
  return liveStateAt(data, timesMin, group, new Date());
}

function liveStateAt(data, timesMin, group, now) {
  const nm = now.getHours() * 60 + now.getMinutes();
  const dow = todayIndex();
  const week = weekOf(now);
  const nextInfo = nextLesson(data, timesMin, group, now);
  if (!nextInfo) return { kind: "idle", title: "Каникулы", meta: "" };

  const inWeek = dow <= 5 && week >= 1 && week <= MAX_WEEK;
  const ls = inWeek ? lessonsOfDay(data, timesMin, group, dow, week) : [];
  const rest = ls.filter(l => l.end > nm);

  if (rest.length && rest[0].start <= nm) {
    const cur = rest[0];
    return {
      kind: "now", lesson: cur,
      leftMin: Math.max(1, cur.end - nm),
      frac: (nm - cur.start) / (cur.end - cur.start),
      later: rest.slice(1), now: new Date(now.getTime())
    };
  }
  if (rest.length) {
    const nxt = rest[0];
    /* Полоса прогресса «до пары» заполняется от конца предыдущей пары (или за 2 ч до первой). */
    const prevEnd = ls.filter(l => l.end <= nm).pop();
    const from = prevEnd ? prevEnd.end : nxt.start - 120;
    const span = Math.max(1, nxt.start - from);
    return {
      kind: "next", lesson: nxt, inBreak: !!prevEnd,
      waitMin: Math.max(1, nxt.start - nm),
      frac: Math.max(0, Math.min(1, (nm - from) / span)),
      later: rest.slice(1), now: new Date(now.getTime())
    };
  }

  const when = DAY_SHORT[nextInfo.dayIdx] + ", " + nextInfo.date.getDate() + " " +
    MONTHS[nextInfo.date.getMonth()] + ", " + hhmm(nextInfo.first.start);
  const nextAt = new Date(nextInfo.date.getFullYear(), nextInfo.date.getMonth(),
    nextInfo.date.getDate(), 0, nextInfo.first.start);
  return { kind: "idle", title: "Сегодня пар нет", meta: "Далее: " + when,
    nextAt: nextAt, dayLessons: nextInfo.lessons, now: new Date(now.getTime()) };
}

/* ---------- полоса прогресса (DrawContext, без живых элементов) ---------- */
/* Статичный снимок доли прошедшего времени: обновляется только при прогоне,
   между прогонами честно замирает. Рисуем в 3x для чёткости на Retina.
   Внутри канвы dynamic-цвета запрещены — выбираем по оформлению устройства. */
function barImage(frac, widthPt) {
  const S = 3;
  const W = Math.round(widthPt * S), H = 4 * S;
  const dark = Device.isUsingDarkAppearance();
  const trackC = new Color(dark ? "#38383a" : "#e5e5ea");
  const accC = new Color(dark ? "#0a84ff" : "#007aff");
  const dc = new DrawContext();
  dc.size = new Size(W, H);
  dc.opaque = false;
  dc.setFillColor(trackC);
  dc.fillRect(new Rect(0, 0, W, H));
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0.005) {
    dc.setFillColor(accC);
    dc.fillRect(new Rect(0, 0, Math.max(2 * S, Math.round(W * f)), H));
  }
  return dc.getImage();
}

/* ---------- отрисовка ---------- */
function addHeader(w, group, isSmall) {
  const h = w.addStack();
  h.layoutHorizontally();
  const t1 = h.addText(isSmall ? "Расписание 307" : "Расписание 307, " + group);
  t1.font = Font.semiboldSystemFont(10);
  t1.textColor = C_SUB;
  h.addSpacer();
  const week = weekOf(new Date());
  const t2 = h.addText(week >= 1 && week <= MAX_WEEK ? "Нед. " + week : "");
  t2.font = Font.regularSystemFont(10);
  t2.textColor = C_SUB;
  return h;
}

function addLessonRow(list, l) {
  const row = list.addStack();
  row.layoutHorizontally();
  row.spacing = 6;
  row.centerAlignContent();
  const tc = row.addStack();
  tc.layoutHorizontally();
  tc.size = new Size(42, 0);
  const time = tc.addText(hhmm(l.start));
  time.font = Font.mediumSystemFont(13);
  time.textColor = C_TEXT;
  time.lineLimit = 1;
  time.minimumScaleFactor = 0.8;
  const name = row.addText(shortName(l.name));
  name.font = Font.regularSystemFont(14);
  name.textColor = C_TEXT;
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.8;
  row.addSpacer();
  const right = row.addText(l.aud ? "ауд. " + l.aud : "");
  right.font = Font.regularSystemFont(12);
  right.textColor = C_SUB;
  right.lineLimit = 1;
  return row;
}

/* Заголовок состояния — первая строка, серым. */
function stateTitle(st) {
  if (st.kind === "idle") return st.title;   // «Сегодня пар нет» / «Каникулы»
  if (st.kind === "now") return "Сейчас";
  return st.inBreak ? "Перерыв" : "До пары";
}

async function createWidget(data, timesMin, group) {
  const st = liveState(data, timesMin, group);
  const w = new ListWidget();
  w.setPadding(12, 15, 12, 15);   // по вертикали теснее: двухстрочное имя + герой + полоса должны влезать в 158pt
  w.backgroundColor = C_BG;
  w.url = SITE_URL;   // тап по виджету открывает сайт в браузере по умолчанию
  const now = st.now || new Date();
  const isMed = config.widgetFamily === "medium";

  addHeader(w, group, !isMed);
  w.addSpacer(4);

  /* medium: слева состояние и герой, справа — последующие пары дня. */
  let left = w;
  let rows = [];
  if (st.kind === "now" || st.kind === "next") rows = (st.later || []).slice(0, 3);
  if (st.kind === "idle" && st.dayLessons) rows = st.dayLessons.slice(0, 3);
  if (isMed && rows.length) {
    const body = w.addStack();
    body.layoutHorizontally();
    left = body.addStack();
    left.layoutVertically();
    left.spacing = 3;
    left.size = new Size(120, 0);
    body.addSpacer(8);
    const right = body.addStack();
    right.layoutVertically();
    right.spacing = 7;
    right.addSpacer();
    for (const l of rows) addLessonRow(right, l);
    right.addSpacer();
  }

  /* Дальняя зона — до пары больше 90 минут: герой показывает абсолютное
     время, которое не устаревает между редкими прогонами. */
  const far = st.kind === "next" && st.waitMin > 90;

  const label = left.addText(stateTitle(st));
  label.font = Font.semiboldSystemFont(10);
  label.textColor = C_SUB;
  label.lineLimit = 1;

  /* Герой: число в ближней зоне, абсолютное время в дальней. Слово
     («минут до конца пары») вынесено в подпись, чтобы число дышало
     даже в узкой колонке medium. Весь текст статичный и считается при
     прогоне: между прогонами ничего не тикает, счёт вверх невозможен. */
  let heroBig = "", heroSub = "";
  if (st.kind === "now") {
    heroBig = String(st.leftMin);
    heroSub = minWord(st.leftMin) + " до конца пары";
  } else if (st.kind === "next") {
    if (far) { heroBig = hhmm(st.lesson.start); heroSub = "начало пары"; }
    else { heroBig = String(st.waitMin); heroSub = minWord(st.waitMin) + " до начала пары"; }
  } else if (st.kind === "idle" && st.nextAt) {
    const nmin = st.nextAt.getHours() * 60 + st.nextAt.getMinutes();
    heroBig = hhmm(nmin);
    const d = st.nextAt;
    heroSub = DAY_SHORT[(d.getDay() + 6) % 7] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
  }

  const bigFont = Font.semiboldRoundedSystemFont(26);
  const subFont = Font.regularSystemFont(11);

  if (far || st.kind === "idle") {
    /* Дальняя зона и «пар нет»: сначала время, потом что за пара. */
    const big = left.addText(heroBig);
    big.font = bigFont;
    big.textColor = C_TEXT;
    big.lineLimit = 1;
    big.minimumScaleFactor = 0.8;
    const sub = left.addText(heroSub);
    sub.font = subFont;
    sub.textColor = C_SUB;
    sub.lineLimit = 1;
    sub.minimumScaleFactor = 0.85;
    if (st.kind === "next") {
      const name = left.addText(shortName(st.lesson.name));
      name.font = Font.semiboldSystemFont(15);
      name.textColor = C_TEXT;
      name.lineLimit = 2;
      name.minimumScaleFactor = 0.85;
      const meta = left.addText(st.lesson.aud ? "ауд. " + st.lesson.aud : "сегодня");
      meta.font = subFont;
      meta.textColor = C_SUB;
      meta.lineLimit = 1;
      meta.minimumScaleFactor = 0.85;
    }
  } else if (st.kind === "next" || st.kind === "now") {
    /* Ближняя зона: что за пара, герой — сколько минут. */
    const name = left.addText(shortName(st.lesson.name));
    name.font = Font.semiboldSystemFont(15);
    name.textColor = C_TEXT;
    name.lineLimit = 2;
    name.minimumScaleFactor = 0.85;
    const aud = st.lesson.aud ? ", ауд. " + st.lesson.aud : "";
    const meta = left.addText((st.kind === "now" ? "до " : "в ") +
      hhmm(st.kind === "now" ? st.lesson.end : st.lesson.start) + aud);
    meta.font = subFont;
    meta.textColor = C_SUB;
    meta.lineLimit = 1;
    meta.minimumScaleFactor = 0.85;
    left.addSpacer();
    const big = left.addText(heroBig);
    big.font = bigFont;
    big.textColor = C_TEXT;
    big.lineLimit = 1;
    big.minimumScaleFactor = 0.8;
    const sub = left.addText(heroSub);
    sub.font = subFont;
    sub.textColor = C_SUB;
    sub.lineLimit = 1;
    sub.minimumScaleFactor = 0.85;
  }

  /* Статичная полоса прогресса: обновляется при прогоне, между прогонами
     честно замирает. */
  if (st.frac != null) {
    const barW = isMed ? 308 : 128;
    w.addSpacer(4);
    const bar = w.addImage(barImage(st.frac, barW));
    bar.imageSize = new Size(barW, 4);
  }

  /* Прогон заказывается по лестнице ниже; сам план — в nextRefreshDate. */
  w.refreshAfterDate = nextRefreshDate(st, now);
  return w;
}

/* ---------- план прогонов: событийно, бережно к бюджету 40–70/день ---------- */
/* Лестница сгущается у границы: дальше 30 минут — шаг 30, дальше 15 — шаг 20,
   дальше 6 — шаг 5, потом шаг 3. В дальней зоне шаг 3 часа с заходом на
   отметку 90 минут, где герой переключается со времени на минуты.
   Ночных прогонов нет — до полуночи или до ближайшей границы. */
function nextRefreshDate(st, now) {
  if (st.kind === "idle") {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
    return st.nextAt
      ? new Date(Math.min(st.nextAt.getTime() - 2 * 60000, midnight.getTime()))
      : midnight;
  }
  const nm = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const target = st.kind === "now" ? st.lesson.end : st.lesson.start;
  const rem = target - nm;
  if (rem > 90) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t90 = new Date(base.getTime() + (target - 90) * 60000);
    return new Date(Math.min(now.getTime() + 3 * 3600000,
      Math.max(t90.getTime(), now.getTime() + 120000)));
  }
  let step;
  if (rem > 30) step = 30;
  else if (rem > 15) step = 20;
  else if (rem > 6) step = 5;
  else step = 3;
  return new Date(now.getTime() + step * 60000);
}

/* ---------- запуск ---------- */
let group = (args.widgetParameter || "А").trim().toUpperCase();
if (group !== "А" && group !== "Б" && group !== "A" && group !== "B") group = "А";
if (group === "A") group = "А";
if (group === "B") group = "Б";

const data = await fetchSchedule();
if (!data || !data.times || !data.groups) {
  console.error("Итог: нет данных — " + (fetchError || "нет сети и кэша"));
  const err = new ListWidget();
  err.url = SITE_URL;
  err.addText("Расписание 307");
  err.addText("Нет данных: " + (fetchError || "нет сети и кэша"));
  err.addText("Откройте Scriptable при интернете — расписание сохранится для офлайна");
  err.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  if (!config.runsInWidget) await err.presentSmall();
  Script.setWidget(err);
  Script.complete();
} else {
  let widget = null;
  try {
    widget = await createWidget(data, parseTimes(data.times), group);
  } catch (e) {
    fetchError = fetchError || "сбой отрисовки: " + String(e).slice(0, 60);
    console.error("Итог: " + fetchError);
  }
  if (!widget) {
    const err = new ListWidget();
    err.url = SITE_URL;
    err.addText("Расписание 307");
    err.addText("Ошибка показа: " + fetchError);
    err.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
    if (!config.runsInWidget) await err.presentSmall();
    Script.setWidget(err);
  } else if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentSmall();
  }
  Script.complete();
}
