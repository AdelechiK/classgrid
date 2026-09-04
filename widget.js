/* Виджет «Расписание 307» для Scriptable (iOS).
   Минималистичный нативный дизайн: лейбл, название пары, кольцо-таймер
   (сколько осталось до конца текущей пары или до начала следующей).
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
  const diff = Math.floor((d - SEMESTER_START) / 6048e5) + 1;
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

/* Минуты в компактный вид для кольца: «45 мин», «1 ч 20». */
/* Дата-граница состояния: конец текущей пары или начало следующей.
   На неё ставим refreshAfterDate, её же показывает живой WidgetDate. */
function boundaryDate(st) {
  const b = st.kind === "now" ? st.lesson.end : st.lesson.start;
  const n = st.now || new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, b);
}

/* ---------- состояние «сейчас / скоро / свободно» ---------- */
/* kind: now — пара идёт; next — до начала есть время; idle — сегодня пар нет. */
function liveState(data, timesMin, group) {
  const now = new Date();
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
      leftMin: cur.end - nm,
      frac: (nm - cur.start) / (cur.end - cur.start),
      later: rest.slice(1), now: new Date(now.getTime())
    };
  }
  if (rest.length) {
    const nxt = rest[0];
    /* Дуга «до пары» заполняется от конца предыдущей пары (или за 2 ч до первой). */
    const prevEnd = ls.filter(l => l.end <= nm).pop();
    const from = prevEnd ? prevEnd.end : nxt.start - 120;
    const span = Math.max(1, nxt.start - from);
    return {
      kind: "next", lesson: nxt,
      waitMin: nxt.start - nm,
      frac: Math.max(0, Math.min(1, (nm - from) / span)),
      later: rest.slice(1), now: new Date(now.getTime())
    };
  }

  const title = !inWeek && week > MAX_WEEK ? "Каникулы" : "Сегодня пар нет";
  const when = DAY_SHORT[nextInfo.dayIdx] + ", " + nextInfo.date.getDate() + " " +
    MONTHS[nextInfo.date.getMonth()] + ", " + hhmm(nextInfo.first.start);
  return { kind: "idle", title: title, meta: "Далее: " + when, now: new Date(now.getTime()) };
}

/* Ближайшая пара после текущей/следующей — для строки «Далее: …». */
function nextAfter(data, timesMin, group, st) {
  if (st.later && st.later.length) {
    return { name: st.later[0].name, start: st.later[0].start, dayIdx: todayIndex() };
  }
  const base = st.now || new Date();
  const nx = nextLesson(data, timesMin, group, new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));
  if (!nx) return null;
  return { name: nx.first.name, start: nx.first.start, dayIdx: nx.dayIdx };
}

/* ---------- кольцо-таймер (DrawContext + Path) ---------- */
/* Дуга — кубические Безье (у Path нет arc), концы закруглены эллипсами.
   Рисуем в 3x: фон ячейки 48pt с канвой 144px — чётко на Retina.
   Центр оставляем пустым: там живой WidgetDate, тикающий между запусками.
   Внутри канвы dynamic-цвета запрещены — выбираем по оформлению устройства. */
function ringImage(frac, pt) {
  const S = pt * 3;
  const lw = Math.max(8, Math.round(S * 0.085));
  const r = (S - lw) / 2;
  const dark = Device.isUsingDarkAppearance();
  const trackC = new Color(dark ? "#38383a" : "#e5e5ea");
  const accC = new Color(dark ? "#0a84ff" : "#007aff");
  const dc = new DrawContext();
  dc.size = new Size(S, S);
  dc.opaque = false;
  dc.setStrokeColor(trackC);
  dc.setLineWidth(lw);
  dc.strokeEllipse(new Rect(lw / 2, lw / 2, S - lw, S - lw));

  const f = Math.max(0, Math.min(1, frac));
  if (f > 0.005) {
    const cx = S / 2, cy = S / 2;
    const ptOn = a => new Point(cx + r * Math.sin(a), cy - r * Math.cos(a));
    const total = f * 2 * Math.PI;
    const p = new Path();
    p.move(ptOn(0));
    for (let a = 0; a < total - 1e-6; a += Math.PI / 2) {
      const b = Math.min(a + Math.PI / 2, total);
      const k = (4 / 3) * Math.tan((b - a) / 4);
      const t1 = new Point(Math.cos(a), Math.sin(a));
      const t2 = new Point(Math.cos(b), Math.sin(b));
      const P1 = ptOn(b);
      p.addCurve(P1,
        new Point(ptOn(a).x + t1.x * r * k, ptOn(a).y + t1.y * r * k),
        new Point(P1.x - t2.x * r * k, P1.y - t2.y * r * k));
    }
    dc.addPath(p);
    dc.setStrokeColor(accC);
    dc.strokePath();
    dc.setFillColor(accC);
    for (const q of [ptOn(0), ptOn(total)]) {
      dc.fillEllipse(new Rect(q.x - lw / 2, q.y - lw / 2, lw, lw));
    }
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

async function createWidget(data, timesMin, group) {
  const st = liveState(data, timesMin, group);
  const w = new ListWidget();
  w.setPadding(14, 15, 14, 15);
  w.backgroundColor = C_BG;
  w.url = SITE_URL;   // тап по виджету открывает сайт в браузере по умолчанию
  const now = st.now || new Date();

  addHeader(w, group, config.widgetFamily !== "medium");
  w.addSpacer(8);

  if (st.kind === "idle") {
    const title = w.addText(st.title);
    title.font = Font.semiboldSystemFont(15);
    title.textColor = C_TEXT;
    title.lineLimit = 2;
    if (st.meta) {
      w.addSpacer(3);
      const meta = w.addText(st.meta);
      meta.font = Font.regularSystemFont(11);
      meta.textColor = C_SUB;
      meta.lineLimit = 1;
      meta.minimumScaleFactor = 0.85;
    }
  } else {
    const body = w.addStack();
    body.layoutHorizontally();
    body.centerAlignContent();
    const left = body.addStack();
    left.layoutVertically();
    left.spacing = 3;
    const label = left.addText(st.kind === "now" ? "Сейчас" : "Следующая");
    label.font = Font.semiboldSystemFont(10);
    label.textColor = C_SUB;
    const name = left.addText(shortName(st.lesson.name));
    name.font = Font.semiboldSystemFont(15);
    name.textColor = C_TEXT;
    name.lineLimit = 2;
    name.minimumScaleFactor = 0.85;
    const aud = st.lesson.aud ? ", ауд. " + st.lesson.aud : "";
    const metaTxt = st.kind === "now"
      ? "до " + hhmm(st.lesson.end) + aud
      : "в " + hhmm(st.lesson.start) + aud;
    const meta = left.addText(metaTxt);
    meta.font = Font.regularSystemFont(11);
    meta.textColor = C_SUB;
    meta.lineLimit = 1;
    meta.minimumScaleFactor = 0.85;

    body.addSpacer();
    /* Кольцо — фон ячейки, а внутри живой WidgetDate: система сама тикает
       отсчётом между запусками скрипта, снимок виджета сам не обновится. */
    const cell = body.addStack();
    cell.layoutVertically();
    cell.size = new Size(48, 48);
    cell.backgroundImage = ringImage(st.frac, 48);
    cell.addSpacer();
    const mid = cell.addStack();
    mid.layoutHorizontally();
    mid.addSpacer();
    const live = mid.addDate(boundaryDate(st));
    live.applyTimerStyle();
    live.font = Font.semiboldSystemFont(10);
    live.textColor = C_TEXT;
    live.minimumScaleFactor = 0.75;
    mid.addSpacer();
    cell.addSpacer();
  }

  /* Перезапрос снимка: на границе состояния, но не реже чем раз в 15 минут
     (бюджет обновлений iOS ограничен; сам отсчёт при этом тикает всегда). */
  const refreshAt = new Date(now.getTime() + 15 * 60 * 1000);
  const boundary = st.kind === "idle" ? null : boundaryDate(st);
  if (boundary && boundary > now) {
    const atBoundary = new Date(boundary.getTime() + 30 * 1000);
    if (atBoundary < refreshAt) refreshAt.setTime(atBoundary.getTime());
  }
  w.refreshAfterDate = refreshAt;

  /* Строка «Далее: …» — что идёт после показанной пары (кроме medium: там список). */
  if (st.kind !== "idle" && config.widgetFamily !== "medium") {
    const nx = nextAfter(data, timesMin, group, st);
    if (nx) {
      w.addSpacer();
      const sameDay = nx.dayIdx === todayIndex();
      const tail = sameDay ? hhmm(nx.start)
        : DAY_SHORT[nx.dayIdx] + ", " + hhmm(nx.start);
      const foot = w.addText("Далее: " + shortName(nx.name) + ", " + tail);
      foot.font = Font.regularSystemFont(10);
      foot.textColor = C_SUB;
      foot.lineLimit = 1;
      foot.minimumScaleFactor = 0.8;
    }
  }

  /* medium: герой уже показан, ниже — до двух последующих пар без дублей */
  if (config.widgetFamily === "medium" && st.kind !== "idle" && st.later.length) {
    w.addSpacer(6);
    const list = w.addStack();
    list.layoutVertically();
    list.spacing = 7;
    for (let i = 0; i < Math.min(2, st.later.length); i++) {
      addLessonRow(list, st.later[i]);
    }
  }

  return w;
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
  err.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (!config.runsInWidget) await err.presentSmall();
  Script.setWidget(err);
  Script.complete();
} else {
  const timesMin = parseTimes(data.times);
  const widget = await createWidget(data, timesMin, group);
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    widget.presentSmall();
  }
  Script.complete();
}
