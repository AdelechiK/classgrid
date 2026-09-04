/* Виджет «Расписание 307» для Scriptable (iOS).
   Показывает текущую или следующую пару для группы А или Б.
   Данные: https://classgrid.pages.dev/data.js, кэш в FileManager.local().
   Параметр виджета: «А» или «Б». */

const DATA_URL = "https://classgrid.pages.dev/data.js";
const SEMESTER_START = new Date(2026, 8, 1);   // 2026-09-01
const MAX_WEEK = 17;
const WIDGET_CACHE = "schedule307-data.json";

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DAY_ACC = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/* ---------- загрузка данных ---------- */
function fetchSchedule() {
  const fm = FileManager.local();
  const path = fm.joinPath(FileManager.documentsDirectory(), WIDGET_CACHE);
  try {
    const req = new Request(DATA_URL, { timeoutInterval: 10 });
    const txt = req.loadString();
    let data = null, raw = null;
    for (const line of txt.split("\n")) {
      if (line.indexOf("window.SCHEDULE_DATA") < 0) continue;
      const s = line.indexOf("{"), e = line.lastIndexOf("}");
      if (s >= 0 && e > s) { raw = line.slice(s, e + 1); break; }
    }
    if (raw) data = JSON.parse(raw);
    if (data) {
      fm.writeString(path, raw);
      return data;
    }
  } catch (e) { /* сеть недоступна — читаем кэш */ }
  if (fm.fileExists(path)) {
    try { return JSON.parse(fm.readString(path)); } catch (e) { return null; }
  }
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

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ---------- состояние «сейчас/далее» ---------- */
function liveState(data, timesMin, group) {
  const now = new Date();
  const nm = now.getHours() * 60 + now.getMinutes();
  const dow = todayIndex();
  const week = weekOf(now);
  const todayText = (info, tail) => {
    const when = info.date.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
      ? "Завтра" : DAY_ACC[info.dayIdx] + ", " + info.date.getDate() + " " + MONTHS[info.date.getMonth()];
    return when + ": " + info.count + " " + plural(info.count, "пара", "пары", "пар") + ", первая в " + hhmm(info.first.start) + (tail ? tail(info.first) : "");
  };

  if (dow > 5 || week < 1 || week > MAX_WEEK) {
    const nx = nextLesson(data, timesMin, group, now);
    if (!nx) return { title: "Каникулы", sub: "" };
    return { title: "Сегодня пар нет", sub: todayText(nx) };
  }

  const ls = lessonsOfDay(data, timesMin, group, dow, week);
  if (!ls.length) {
    const nx = nextLesson(data, timesMin, group, now);
    if (!nx) return { title: "Сегодня пар нет", sub: "" };
    return { title: "Сегодня пар нет", sub: todayText(nx) };
  }

  let cur = null, nextToday = null;
  for (const l of ls) {
    if (nm >= l.start && nm < l.end) { cur = l; }
    if (!nextToday && l.start > nm) { nextToday = l; }
  }

  if (cur) {
    const left = cur.end - nm;
    const leftTxt = left < 60 ? "осталось " + left + " мин"
      : "осталось " + Math.floor(left / 60) + " ч " + pad2(left % 60) + " мин";
    const aud = cur.aud ? ", ауд. " + cur.aud : "";
    return { title: "Сейчас: " + cur.name + aud, sub: "до " + hhmm(cur.end) + ", " + leftTxt, now: true };
  }
  if (nextToday) {
    const wait = nextToday.start - nm;
    const waitTxt = wait < 60 ? "через " + wait + " мин"
      : "через " + Math.floor(wait / 60) + " ч " + pad2(wait % 60) + " мин";
    const aud = nextToday.aud ? ", ауд. " + nextToday.aud : "";
    return { title: waitTxt + ", в " + hhmm(nextToday.start) + " — " + nextToday.name + aud, sub: "" };
  }
  const nx = nextLesson(data, timesMin, group, now);
  if (!nx) return { title: "На сегодня всё", sub: "" };
  return { title: "На сегодня всё", sub: todayText(nx) };
}

/* ---------- отрисовка ---------- */
function makeRow(stack, name, sub, isBold) {
  const t = stack.addText(name);
  t.font = isBold ? Font.semiboldSystemFont(13) : Font.regularSystemFont(12);
  t.textColor = isBold ? Color.primary() : Color.secondaryText();
  t.lineLimit = 2;
  if (sub) {
    const s = stack.addText(sub);
    s.font = Font.regularSystemFont(11);
    s.textColor = Color.secondaryText();
    s.lineLimit = 2;
  }
}

async function createWidget(data, timesMin, group) {
  const w = new ListWidget();
  w.setPadding(14, 14, 14, 14);
  const bg = Device.isUsingDarkAppearance() ? new Color("#1c1c1e") : new Color("#ffffff");
  w.backgroundColor = bg;
  const now = new Date();

  const st = liveState(data, timesMin, group);
  const head = w.addText("Расписание 307 — " + group);
  head.font = Font.mediumSystemFont(10);
  head.textColor = Color.secondaryText();
  head.textOpacity = 0.9;
  w.addSpacer(4);

  const title = w.addText(st.title);
  title.font = Font.semiboldSystemFont(14);
  title.textColor = Color.primary();
  title.lineLimit = 3;
  if (st.sub) {
    w.addSpacer(2);
    const sub = w.addText(st.sub);
    sub.font = Font.regularSystemFont(12);
    sub.textColor = Color.secondaryText();
    sub.lineLimit = 3;
  }

  /* medium: ещё 1–2 следующие пары */
  if (config.widgetFamily === "medium") {
    const dow = todayIndex();
    const week = weekOf(now);
    let pool = [];
    if (dow <= 5 && week >= 1 && week <= MAX_WEEK) {
      pool = lessonsOfDay(data, timesMin, group, dow, week)
        .filter(l => l.end > now.getHours() * 60 + now.getMinutes())
        .slice(0, 2);
    }
    if (!pool.length) {
      const nx = nextLesson(data, timesMin, group, now);
      pool = nx ? nx.lessons.slice(0, 2) : [];
    }
    if (pool.length) {
      w.addSpacer(6);
      for (const l of pool) {
        makeRow(w, hhmm(l.start) + "  " + l.name, l.aud ? "ауд. " + l.aud : "", false);
        w.addSpacer(2);
      }
    }
  }

  w.addSpacer();
  const upd = w.addText("Обновлено " + pad2(now.getHours()) + ":" + pad2(now.getMinutes()));
  upd.font = Font.regularSystemFont(9);
  upd.textColor = Color.secondaryText();
  upd.textOpacity = 0.7;
  return w;
}

/* ---------- запуск ---------- */
let group = (args.widgetParameter || "А").trim().toUpperCase();
if (group !== "А" && group !== "Б" && group !== "A" && group !== "B") group = "А";
if (group === "A") group = "А";
if (group === "B") group = "Б";

const data = fetchSchedule();
if (!data || !data.times || !data.groups) {
  const err = new ListWidget();
  err.addText("Расписание 307");
  err.addText("Нет данных — открой Scriptable при интернете");
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
