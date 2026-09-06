/* Виджет «Расписание 307» для Scriptable (iOS).
   Транзит-минимализм: капс-метка состояния, крупный герой (минуты или
   абсолютное время), подпись «МИНУТ ДО 13:40», полоса прогресса во всю
   ширину. Цвет цифр и полосы — светофор оставшегося времени: зелёный
   от 20 минут, жёлтый 6–19, красный 5 и меньше. Когда пар нет — только
   текст: метка состояния и строка «когда следующая пара».
   Поминутный формат без живого таймера: весь текст статичный и считается
   при прогоне, поэтому счёт вверх после нуля (документированное поведение
   системного timer-стиля) в принципе невозможен. Прогоны — только по
   событиям: в дальней зоне раз в 2–3 часа с заходом на отметку 90 минут,
   в последние 90 минут — лестница 30/20/5/3, последний шаг точно на
   границу события; бюджет обновлений iOS 40–70 в день расходуется бережно.
   Значок обновления (medium) перезапускает этот же скрипт через
   scriptable:///run?refresh=1&group=… — Scriptable заново тянет данные
   и пересобирает виджет, бюджет WidgetKit не расходуется. В small у
   элементов нет собственных ссылок (одна tap-зона), значок не показывается.
   Данные: https://adelechik.github.io/classgrid/data.js, кэш в FileManager.local().
   Параметр виджета: «А» или «Б». Тап по виджету открывает сайт. */

const DATA_URL = "https://adelechik.github.io/classgrid/data.js";
const SITE_URL = "https://adelechik.github.io/classgrid/";
const SEMESTER_START = new Date(2026, 8, 1);   // 2026-09-01
const MAX_WEEK = 17;
const WIDGET_CACHE = "schedule307-data.json";

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS_SHORT = ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН",
  "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК"];

/* Цвета по докам Scriptable: Color.dynamic(light, dark) и new Color("#hex"). */
const C_TEXT = Color.dynamic(new Color("#000000"), new Color("#ffffff"));
const C_SUB = Color.dynamic(new Color("#6e6e73"), new Color("#98989f"));
const C_BG = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));

/* Короткие имена пар в духе Транзита: корень дисциплины без канцелярита,
   уникальные пары — короткое чистое имя, повторяющиеся — с различителем
   в скобках, чтобы без труда ассоциировались с полным названием.
   Неизвестные показываем как есть. */
const SHORT_NAMES = {
  "Аудирование текстов (второй иностранный язык)": "Аудирование",
  "К/В Культура иноязычного общения (на английском языке)": "Культура общения",
  "К/В Практикум по межкультурному общению (на английском языке)": "Межкульт. практикум",
  "К/В Современная письменная коммуникация на английском языке": "Письм. коммуникация",
  "Методика обучения и воспитания в области второго иностранного языка": "Методика (2 иностр.)",
  "Методика обучения и воспитания в области первого иностранного (английского) языка": "Методика (англ. яз.)",
  "Практика по профилю подготовки (в области иностранных языков)": "Практика",
  "Практический курс английского языка": "Англ. яз. (практ.)",
  "Практический курс второго иностранного языка": "2 иностр. (практ.)",
  "Синтаксис второго иностранного языка": "Синтаксис",
  "Стилистика английского языка": "Стилистика",
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
    /* Кэш перезаписываем только валидной схемой: битый ответ сайта не должен
       затирать рабочую офлайн-копию. */
    if (data && data.times && data.groups) {
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

function todayIndex(d) {
  const n = d || new Date();
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

/* После предлога «через» — винительный падеж: «через 21 минуту»;
   формы «минуты» и «минут» в обоих падежах совпадают. */
function minWordAcc(n) {
  const w = minWord(n);
  return w === "минута" ? "минуту" : w;
}

/* ---------- состояние «сейчас / скоро / свободно» ---------- */
/* kind: now — пара идёт; next — до начала есть время; idle — сегодня пар нет. */
function liveState(data, timesMin, group) {
  return liveStateAt(data, timesMin, group, new Date());
}

function liveStateAt(data, timesMin, group, now) {
  const nm = now.getHours() * 60 + now.getMinutes();
  const dow = todayIndex(now);
  const week = weekOf(now);
  const nextInfo = nextLesson(data, timesMin, group, now);
  if (!nextInfo) return { kind: "idle", title: "Каникулы" };

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

  const nextAt = new Date(nextInfo.date.getFullYear(), nextInfo.date.getMonth(),
    nextInfo.date.getDate(), 0, nextInfo.first.start);
  return { kind: "idle", title: "Сегодня пар нет",
    nextAt: nextAt, dayLessons: nextInfo.lessons, now: new Date(now.getTime()) };
}

/* ---------- светофор оставшегося времени ---------- */
/* Зелёный — спокойный запас (от 20 минут), жёлтый — пора собираться (6–19),
   красный — пять минут и меньше. Тот же цвет получают цифры-герой и полоса. */
function trafficColor(min) {
  const dark = Device.isUsingDarkAppearance();
  if (min <= 5) return new Color(dark ? "#ff453a" : "#ff3b30");
  if (min < 20) return new Color(dark ? "#ff9f0a" : "#ff9500");
  return new Color(dark ? "#30d158" : "#34c759");
}

/* ---------- полоса прогресса (DrawContext, без живых элементов) ---------- */
/* Статичный снимок доли прошедшего времени: обновляется только при прогоне,
   между прогонами честно замирает. Рисуем в 3x для чёткости на Retina.
   Внутри канвы dynamic-цвета запрещены — выбираем по оформлению устройства. */
function barImage(frac, widthPt, min) {
  const S = 3;
  const W = Math.round(widthPt * S), H = 4 * S;
  const dark = Device.isUsingDarkAppearance();
  const trackC = new Color(dark ? "#38383a" : "#e5e5ea");
  const accC = trafficColor(min);
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
  t1.lineLimit = 1;
  t1.minimumScaleFactor = 0.8;
  h.addSpacer();
  const week = weekOf(new Date());
  const t2 = h.addText(week >= 1 && week <= MAX_WEEK ? "Нед. " + week : "");
  t2.font = Font.regularSystemFont(10);
  t2.textColor = C_SUB;
  t2.lineLimit = 1;
  if (!isSmall) {
    /* Значок обновления: тап перезапускает сам скрипт через URL-схему.
       Scriptable заново тянет данные и Script.setWidget пересобирает
       виджет — бюджет WidgetKit не расходуется. В small элементные
       ссылки не поддерживаются, поэтому значок только в medium. */
    h.addSpacer(5);
    const sym = SFSymbol.named("arrow.clockwise");
    sym.applyFont(Font.mediumSystemFont(11));
    const ic = h.addImage(sym.image);
    ic.tintColor = C_SUB;
    ic.imageSize = new Size(11, 11);
    ic.url = "scriptable:///run/" + encodeURIComponent(Script.name()) +
      "?refresh=1&group=" + encodeURIComponent(group);
  }
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

/* Метка состояния капсом — первая строка, серым. */
function stateLabel(st) {
  if (st.kind === "now") return "ИДЁТ ПАРА";
  if (st.kind === "next") return st.inBreak ? "ПЕРЕРЫВ" : "ДО ПАРЫ";
  return st.title === "Каникулы" ? "КАНИКУЛЫ" : "ПАР НЕТ";
}

/* Подпись под героем: сколько и до какой минуты. */
function heroCaption(st, far) {
  if (far) return "НАЧАЛО ПАРЫ";
  const min = st.kind === "now" ? st.leftMin : st.waitMin;
  const t = st.kind === "now" ? st.lesson.end : st.lesson.start;
  return minWord(min).toUpperCase() + " ДО " + hhmm(t);
}

/* Строка «пар нет»: когда ближайшая пара. */
function idleMeta(st) {
  if (!st.nextAt) return "РАСПИСАНИЕ ЗАКОНЧИЛОСЬ";
  const d = st.nextAt;
  return "ДАЛЕЕ: " + DAY_SHORT[(d.getDay() + 6) % 7] + ", " + d.getDate() + " " +
    MONTHS_SHORT[d.getMonth()] + ", " + hhmm(d.getHours() * 60 + d.getMinutes());
}

/* Правая колонка medium: следующая пара либо расписание ближайшего дня. */
function addSidePanel(right, st, now, far) {
  if (st.kind === "idle") {
    if (!st.nextAt || !st.dayLessons || !st.dayLessons.length) {
      const none = right.addText("ДАЛЬШЕ ПАР НЕТ");
      none.font = Font.semiboldSystemFont(10);
      none.textColor = C_SUB;
      none.lineLimit = 1;
      return;
    }
    const d = st.nextAt;
    const hdr = right.addText(DAY_SHORT[(d.getDay() + 6) % 7].toUpperCase() + ", " +
      d.getDate() + " " + MONTHS_SHORT[d.getMonth()]);
    hdr.font = Font.semiboldSystemFont(10);
    hdr.textColor = C_SUB;
    hdr.lineLimit = 1;
    for (const l of st.dayLessons.slice(0, 3)) addLessonRow(right, l);
    return;
  }
  const nm = now.getHours() * 60 + now.getMinutes();
  const nxt = st.kind === "next" ? st.lesson : (st.later || [])[0];
  /* В дальней зоне герой уже показывает время начала — в заголовке
     колонки оно задвоилось бы. */
  const head = right.addText(nxt ? ("ДАЛЕЕ" + (far ? "" : ", " + hhmm(nxt.start))) : "ДАЛЬШЕ ПАР НЕТ");
  head.font = Font.semiboldSystemFont(10);
  head.textColor = C_SUB;
  head.lineLimit = 1;
  if (!nxt) return;
  const name = right.addText(shortName(nxt.name));
  name.font = Font.semiboldSystemFont(14);
  name.textColor = C_TEXT;
  name.lineLimit = 2;
  name.minimumScaleFactor = 0.8;
  right.addSpacer(2);
  const aud = right.addText(nxt.aud ? "ауд. " + nxt.aud : "");
  aud.font = Font.regularSystemFont(12);
  aud.textColor = C_SUB;
  aud.lineLimit = 1;
  const until = Math.max(1, nxt.start - nm);
  const when = right.addText("через " + until + " " + minWordAcc(until));
  when.font = Font.regularSystemFont(12);
  when.textColor = C_SUB;
  when.lineLimit = 1;
  when.minimumScaleFactor = 0.8;
}

async function createWidget(data, timesMin, group) {
  const st = liveState(data, timesMin, group);
  const w = new ListWidget();
  w.setPadding(12, 15, 12, 15);   // по вертикали теснее: метка, имя, герой, подпись и полоса должны влезать в 134pt
  w.backgroundColor = C_BG;
  w.url = SITE_URL;   // тап по виджету открывает сайт в браузере по умолчанию
  const now = st.now || new Date();
  const isMed = config.widgetFamily === "medium";

  addHeader(w, group, !isMed);
  w.addSpacer(4);

  /* Дальняя зона — до пары больше 90 минут: герой показывает абсолютное
     время, которое не устаревает между редкими прогонами. */
  const far = st.kind === "next" && st.waitMin > 90;

  /* medium: слева состояние и герой, справа — «далее». */
  let left = w;
  if (isMed) {
    const body = w.addStack();
    body.layoutHorizontally();
    left = body.addStack();
    left.layoutVertically();
    left.spacing = 2;
    left.size = new Size(120, 0);
    body.addSpacer(10);
    const right = body.addStack();
    right.layoutVertically();
    right.spacing = 3;
    right.addSpacer();
    addSidePanel(right, st, now, far);
    right.addSpacer();
  }

  const label = left.addText(stateLabel(st));
  label.font = Font.semiboldSystemFont(10);
  label.textColor = C_SUB;
  label.lineLimit = 1;

  if (st.kind === "idle") {
    /* Только текст: строка «когда пара» по центру свободного места.
       В medium она не нужна — расписание ближайшего дня в правой колонке. */
    if (!isMed) {
      left.addSpacer();
      const meta = left.addText(idleMeta(st));
      meta.font = Font.semiboldSystemFont(11);
      meta.textColor = C_SUB;
      meta.lineLimit = 1;
      meta.minimumScaleFactor = 0.7;
    }
  } else {
    /* Имя пары — узнаваемое сокращение в одну строку. В medium у «до пары»
       и дальней зоны имя уже в правой колонке — дублировать не нужно. */
    if (!isMed || st.kind === "now") {
      const name = left.addText(shortName(st.lesson.name));
      name.font = Font.semiboldSystemFont(13);
      name.textColor = C_TEXT;
      name.lineLimit = 1;
      name.minimumScaleFactor = 0.6;
      left.addSpacer(2);
    }
    const rem = st.kind === "now" ? st.leftMin : st.waitMin;
    const big = left.addText(far ? hhmm(st.lesson.start) : String(rem));
    big.font = Font.boldRoundedSystemFont(far ? 38 : 44);
    big.textColor = trafficColor(far ? 999 : rem);
    big.lineLimit = 1;
    big.minimumScaleFactor = 0.6;
    const cap = left.addText(heroCaption(st, far));
    cap.font = Font.semiboldSystemFont(11);
    cap.textColor = C_SUB;
    cap.lineLimit = 1;
    cap.minimumScaleFactor = 0.7;
  }
  left.addSpacer();

  /* Статичная полоса прогресса во всю ширину; цвет — светофор времени.
     Обновляется при прогоне, между прогонами честно замирает. */
  if (st.frac != null) {
    const barW = isMed ? 308 : 128;
    w.addSpacer(4);
    const bar = w.addImage(barImage(st.frac, barW, st.kind === "now" ? st.leftMin : st.waitMin));
    bar.imageSize = new Size(barW, 4);
  }

  /* Прогон заказывается по лестнице ниже; сам план — в nextRefreshDate. */
  w.refreshAfterDate = nextRefreshDate(st, now);
  return w;
}

/* ---------- план прогонов: событийно, бережно к бюджету 40–70/день ---------- */
/* Лестница сгущается у границы: дальше 30 минут — шаг 30, дальше 15 — шаг 20,
   дальше 6 — шаг 5, потом шаг 3; шаг не перелетает границу события —
   прогон попадает точно на начало или конец пары. В дальней зоне шаг 3 часа
   с заходом на отметку 90 минут, где герой переключается со времени на
   минуты. Ночных прогонов нет — до полуночи или до ближайшей границы. */
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
  return new Date(now.getTime() + Math.min(step, rem) * 60000);
}

/* ---------- запуск ---------- */
/* Прогон бывает обычным (виджет или предпросмотр в Scriptable) и
   перезапуском по значку обновления: тогда Scriptable сам открывает
   скрипт с queryParameters, группу берём оттуда, чтобы виджет «Б»
   обновился как «Б». При перезапуске предпросмотр не показываем —
   иначе каждый тап по значку открывал бы весь экран Scriptable. */
const qp = (typeof args !== "undefined" && args.queryParameters) || {};
const fromRefresh = qp.refresh === "1";
let group = String(qp.group || args.widgetParameter || "А").trim().toUpperCase();
if (group !== "А" && group !== "Б" && group !== "A" && group !== "B") group = "А";
if (group === "A") group = "А";
if (group === "B") group = "Б";
const inWidget = config.runsInWidget || fromRefresh;

const data = await fetchSchedule();
if (!data || !data.times || !data.groups) {
  console.error("Итог: нет данных — " + (fetchError || "нет сети и кэша"));
  const err = new ListWidget();
  err.url = SITE_URL;
  err.addText("Расписание 307");
  err.addText("Нет данных — нет сети и кэша");
  err.addText("Откройте Scriptable при наличии интернета — расписание сохранится для офлайна");
  err.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  if (!inWidget) await err.presentSmall();
  Script.setWidget(err);
  Script.complete();
} else {
  let widget = null;
  let renderError = "";
  try {
    widget = await createWidget(data, parseTimes(data.times), group);
  } catch (e) {
    renderError = "сбой отрисовки: " + String(e).slice(0, 60);
    console.error("Итог: " + renderError);
  }
  if (!widget) {
    const err = new ListWidget();
    err.url = SITE_URL;
    err.addText("Расписание 307");
    err.addText("Ошибка показа: " + renderError);
    err.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
    if (!inWidget) await err.presentSmall();
    Script.setWidget(err);
  } else if (inWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentSmall();
  }
  Script.complete();
}
