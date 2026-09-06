/* Расписание 307 — логика: группа/неделя/вид, «Окно», «Сегодня», тема, баннер. */
"use strict";

var DATA = window.SCHEDULE_DATA;
var DAYS = DATA.days;               // 6 полных названий, Пн..Сб
var TIMES = DATA.times;             // 7 слотов
var DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
var MAX_WEEK = 17;
var LS_KEY = "schedule307:v1";
var SEMESTER_START = new Date(2026, 8, 1);   // 2026-09-01

/* ---------- состояние ---------- */
function readState() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
  catch (e) { return null; }
}
var saved = readState();
if (!saved || typeof saved.week !== "number" || saved.week < 1 || saved.week > 17 ||
  typeof saved.day !== "number" || saved.day < 0 || saved.day > 5) saved = null;
var state = {
  group: (saved && saved.group === "Б") ? "Б" : "А",
  week: clamp(saved && saved.week, 1, MAX_WEEK),
  view: (saved && saved.view === "week") ? "week" : "day",
  day: clamp(saved && saved.day, 0, 5),
  theme: (saved && saved.theme) || document.documentElement.dataset.theme || "light",
  bannerPermanent: !!(saved && saved.bannerPermanent)
};
document.documentElement.dataset.theme = state.theme;

function clamp(v, lo, hi) {
  v = parseInt(v, 10);
  if (isNaN(v)) return null;
  return Math.min(hi, Math.max(lo, v));
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}

/* ---------- «Сегодня» ---------- */
function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function todayInfo() {
  var now = startOfDay(new Date());
  var diff = Math.floor(Math.round((now - SEMESTER_START) / 864e5) / 7);   // 7 суток, устойчиво к переводу часов
  var rawWeek = diff + 1;
  var dow = (now.getDay() + 6) % 7;                          // 0 = Пн, 6 = Вс
  var dayIdx = dow === 6 ? 0 : dow;                          // воскресенье -> понедельник
  return {
    rawWeek: rawWeek,
    week: clamp(rawWeek, 1, MAX_WEEK) || 1,
    day: dayIdx,
    inSemester: rawWeek >= 1 && rawWeek <= 17
  };
}
var TODAY = todayInfo();
var FIRST_OPEN = !saved;

/* ---------- индекс расписания ---------- */
var INDEX = {};   // INDEX[group][dayIdx][timeIdx] = [items]
["А", "Б"].forEach(function (g) {
  INDEX[g] = DAYS.map(function () { return TIMES.map(function () { return []; }); });
  var byDay = DATA.groups[g] || {};
  DAYS.forEach(function (dayName, di) {
    (byDay[dayName] || []).forEach(function (slot) {
      var ti = TIMES.indexOf(slot.time);
      if (ti >= 0) INDEX[g][di][ti] = slot.items;
    });
  });
});

function itemsFor(group, dayIdx, timeIdx, week) {
  return (INDEX[group][dayIdx][timeIdx] || []).filter(function (it) {
    return it.weeks && it.weeks.indexOf(week) >= 0;
  });
}

/* ---------- утилиты ---------- */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function itemHTML(it) {
  var h = '<div class="it"><div class="name">' + esc(it.name) +
    (it.shared ? '<span class="badge">Смежная</span>' : "") + "</div>" +
    '<div class="meta">' + esc(it.dmeta) + "</div>";
  if (it.link) {
    h += '<div class="meta"><a href="' + esc(it.link.url) +
      '" target="_blank" rel="noopener">' + esc(it.link.text) + "</a></div>";
  }
  return h + "</div>";
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function dayDate(w, di) {
  /* семестр начинается во вторник 01.09.2026: блок недели = вт..пн,
     поэтому Пн блока = start + (w-1)*7 + 6, Вт = start + (w-1)*7 и т.д. */
  var d = new Date(SEMESTER_START);
  d.setDate(d.getDate() + (w - 1) * 7 + (di - 1 + 7) % 7);
  return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
}
function weekRange(w) {
  var a = new Date(SEMESTER_START); a.setDate(a.getDate() + (w - 1) * 7);
  var b = new Date(a); b.setDate(b.getDate() + 6);
  return pad2(a.getDate()) + "." + pad2(a.getMonth() + 1) + "–" +
    pad2(b.getDate()) + "." + pad2(b.getMonth() + 1);
}
function parityOf(w) {
  if (w < 1 || w > MAX_WEEK) return "";
  return w % 2 ? "нечёт" : "чёт";
}
/* один слот: items | «Окно» | пустой край */
function slotHTML(group, di, ti, week, opts) {
  var items = itemsFor(group, di, ti, week);
  var cls = "slot" + (ti === TIMES.length - 1 ? " last" : "");
  var head = '<div class="t">' + TIMES[ti] + "</div>";
  if (items.length) {
    return '<div class="' + cls + '">' + head +
      '<div class="items">' + items.map(itemHTML).join("") + "</div></div>";
  }
  var before = false, after = false;
  for (var i = 0; i < ti; i++) if (itemsFor(group, di, i, week).length) { before = true; break; }
  for (var j = ti + 1; j < TIMES.length; j++) if (itemsFor(group, di, j, week).length) { after = true; break; }
  if (before && after) {
    return '<div class="' + cls + ' win">' + head + '<div class="wtxt">Окно</div></div>';
  }
  return '<div class="' + cls + '">' + head + '<div class="wtxt">&nbsp;</div></div>';
}

function daySectionHTML(group, di, week) {
  var hasAny = false;
  for (var t = 0; t < TIMES.length; t++) if (itemsFor(group, di, t, week).length) { hasAny = true; break; }
  var rows = "";
  if (hasAny) {
    rows = TIMES.map(function (_, ti) { return slotHTML(group, di, ti, week); }).join("");
  } else {
    rows = '<div class="dayempty">В этот день занятий нет</div>';
  }
  return '<section class="day"><h2>' + DAYS[di] + ", " + dayDate(week, di) +
    '<span class="h2w">нед. ' + week + " (" + parityOf(week) + ")</span></h2>" + rows + "</section>";
}

/* мобильная карточка дня для вида «Неделя»: только занятия и «Окна»,
   пустые крайние слоты не выводятся — страница остаётся компактной */
function mdaySectionHTML(group, di, week) {
  var rows = "";
  for (var t = 0; t < TIMES.length; t++) {
    if (itemsFor(group, di, t, week).length) { rows += slotHTML(group, di, t, week); continue; }
    var before = false, after = false;
    for (var i = 0; i < t; i++) if (itemsFor(group, di, i, week).length) { before = true; break; }
    for (var j = t + 1; j < TIMES.length; j++) if (itemsFor(group, di, j, week).length) { after = true; break; }
    if (before && after) rows += slotHTML(group, di, t, week);
  }
  if (!rows) rows = '<div class="dayempty">В этот день занятий нет</div>';
  return '<section class="mday"><h2>' + DAYS[di] + ", " + dayDate(week, di) +
    '<span class="h2w">нед. ' + week + " (" + parityOf(week) + ")</span></h2>" + rows + "</section>";
}

/* неделя: десктоп-сетка (7 колонок × 7 строк) + карточки дней для мобилы */
function weekHTML(group, week) {
  var html = '<div class="table wk-grid">';
  html += '<div class="time"></div>';
  DAYS.forEach(function (n, di) {
    html += '<div class="wk-day' + (di === TODAY.day && TODAY.inSemester ? " is-today" : "") +
      '"><div class="dayh">' + n + "</div></div>";
  });
  TIMES.forEach(function (t, ti) {
    html += '<div class="time">' + t + "</div>";
    for (var di = 0; di < 6; di++) {
      var items = itemsFor(group, di, ti, week);
      if (items.length) {
        html += '<div class="wk-day">' + items.map(function (it) {
          return '<div class="cell"><span class="name">' + esc(it.name) +
            (it.shared ? '<span class="badge">Смежная</span>' : "") + "</span>" +
            '<span class="meta">' + esc(it.dmeta) + "</span></div>";
        }).join("") + "</div>";
      } else {
        var before = false, after = false;
        for (var i = 0; i < ti; i++) if (itemsFor(group, di, i, week).length) { before = true; break; }
        for (var j = ti + 1; j < TIMES.length; j++) if (itemsFor(group, di, j, week).length) { after = true; break; }
        html += '<div class="wk-day">' + (before && after
          ? '<div class="wcell">Окно</div>'
          : '<div class="wcell nowin"></div>') + "</div>";
      }
    }
  });
  html += "</div>";
  html += DAYS.map(function (_, di) { return mdaySectionHTML(group, di, week); }).join("");
  return html;
}

/* ---------- «Сейчас и далее» и статусы слотов ---------- */
var TIMES_MIN = TIMES.map(function (t) {
  var p = t.split("–"), a = p[0].split(":"), b = p[1].split(":");
  return { start: (+a[0]) * 60 + (+a[1]), end: (+b[0]) * 60 + (+b[1]) };
});
var DAY_ACC = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
var nowcardCache = "";

function realDow() {
  var n = new Date();
  return (n.getDay() + 6) % 7;   // 0 = Пн … 5 = Сб, 6 = Вс
}
function nowMinutes() {
  var n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}
function hhmm(min) {
  return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60);
}
function plural(n, one, few, many) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function audOf(dmeta, week) {
  var i = (dmeta || "").lastIndexOf("ауд.");
  if (i < 0) return "";
  var tail = dmeta.slice(i + 4).trim();
  var parts = tail.split(/,\s*/);
  if (parts.length === 1) return tail;
  /* перечень «аудитория (N нед.)» — выбираем по текущей неделе */
  var pick = "", fallback = "";
  for (var p = 0; p < parts.length; p++) {
    var m = /^([^(]+?)\s*(?:\(([^)]*)\))?$/.exec(parts[p].trim());
    if (!m) continue;
    if (!fallback) fallback = m[1].trim();
    if (week != null && m[2]) {
      var r = m[2].split("–");
      var from = parseInt(r[0], 10), to = r.length > 1 ? parseInt(r[1], 10) : from;
      if (week >= from && week <= to) { pick = m[1].trim(); break; }
    }
  }
  return pick || fallback || tail;
}
function lessonsOfDay(group, di, week) {
  var res = [];
  for (var ti = 0; ti < TIMES.length; ti++) {
    var its = itemsFor(group, di, ti, week);
    if (its.length) res.push({ ti: ti, item: its[0], start: TIMES_MIN[ti].start, end: TIMES_MIN[ti].end });
  }
  return res;
}
function nextLessonAfter(group, fromDate) {
  for (var k = 1; k <= MAX_WEEK * 7; k++) {
    var d = new Date(fromDate);
    d.setDate(d.getDate() + k);
    var raw = Math.floor(Math.round((startOfDay(d) - SEMESTER_START) / 864e5) / 7) + 1;
    if (raw > MAX_WEEK) return null;
    if (raw < 1) continue;
    var di = (d.getDay() + 6) % 7;
    if (di > 5) continue;
    var ls = lessonsOfDay(group, di, raw);
    if (ls.length) return { date: d, dayIdx: di, week: raw, first: ls[0], count: ls.length };
  }
  return null;
}
function minsLeft(min) {
  if (min < 60) return "осталось " + min + " мин";
  return "осталось " + Math.floor(min / 60) + " ч " + pad2(min % 60) + " мин";
}
function dayCountdownText(ls) {
  var t = hhmm(ls.first.start);
  var tomorrow = startOfDay(new Date()).getTime() + 864e5;
  var when = ls.date.getTime() === tomorrow
    ? "Завтра"
    : DAY_ACC[ls.dayIdx].charAt(0).toUpperCase() + DAY_ACC[ls.dayIdx].slice(1) +
      ", " + ls.date.getDate() + " " + MONTHS[ls.date.getMonth()];
  return when + ": " + ls.count + " " + plural(ls.count, "пара", "пары", "пар") + ", первая в " + t;
}
function liveInfo() {
  var di = realDow();
  if (di > 5) return null;   // в воскресенье живой карточки нет
  var ls = lessonsOfDay(state.group, di, TODAY.week);
  var nm = nowMinutes();
  if (!ls.length) {
    var nx = nextLessonAfter(state.group, startOfDay(new Date()));
    if (!nx) return null;
    return { label: "Сегодня", isNow: false, title: "Сегодня пар нет",
      sub: "Ближайшая пара — " + DAY_ACC[nx.dayIdx] + ", " + nx.date.getDate() + " " +
        MONTHS[nx.date.getMonth()] + ", в " + hhmm(nx.first.start) + " — " + nx.first.item.name };
  }
  var i, cur = null, next = null;
  for (i = 0; i < ls.length; i++) {
    if (nm >= ls[i].start && nm < ls[i].end) { cur = ls[i]; break; }
  }
  if (cur) {
    var sub = minsLeft(cur.end - nm);
    var nx2 = null;
    for (i = 0; i < ls.length; i++) if (ls[i].start > cur.start) { nx2 = ls[i]; break; }
    if (nx2) {
      sub += ". Далее в " + hhmm(nx2.start) + " — " + nx2.item.name;
      var a2 = audOf(nx2.item.dmeta, TODAY.week);
      if (a2) sub += ", ауд. " + a2;
    } else {
      sub += ". Это последняя пара на сегодня";
    }
    return { label: "Сейчас", isNow: true, title: cur.item.name + ", до " + hhmm(cur.end), sub: sub };
  }
  for (i = 0; i < ls.length; i++) if (ls[i].start > nm) { next = ls[i]; break; }
  if (next) {
    var a = audOf(next.item.dmeta, TODAY.week);
    if (nm < ls[0].start) {
      return { label: "Сегодня", isNow: false, title: "Первая пара в " + hhmm(next.start),
        sub: next.item.name + (a ? ", ауд. " + a : "") };
    }
    return { label: "Сегодня", isNow: false, title: "Окно до " + hhmm(next.start),
      sub: "Далее — " + next.item.name + (a ? ", ауд. " + a : "") };
  }
  var nx3 = nextLessonAfter(state.group, startOfDay(new Date()));
  if (!nx3) return null;
  return { label: "Сегодня", isNow: false, title: "На сегодня всё", sub: dayCountdownText(nx3) };
}
function viewingActualToday() {
  return state.view === "day" && TODAY.inSemester && realDow() <= 5 &&
    state.week === TODAY.week && state.day === TODAY.day;
}
function updateLive() {
  var c = el("content");
  if (!c || !viewingActualToday()) return;
  var sec = c.querySelector("section.day");
  var slots = sec ? sec.querySelectorAll(".slot") : [];
  var nm = nowMinutes(), week = TODAY.week, di = realDow();
  for (var ti = 0; ti < slots.length && ti < TIMES.length; ti++) {
    var s = slots[ti];
    if (!s.querySelector(".it")) continue;   // «Окна» и пустые крайние — без статуса
    var m = TIMES_MIN[ti];
    s.classList.remove("now", "soon", "past");
    if (nm >= m.start && nm < m.end) s.classList.add("now");
    else if (nm < m.start && m.start - nm <= 20) s.classList.add("soon");
    else if (nm >= m.end) s.classList.add("past");
  }
  var info = liveInfo();
  var card = el("nowcard");
  if (!info) { if (card) card.remove(); nowcardCache = ""; return; }
  if (!card) {
    card = document.createElement("div");
    card.id = "nowcard";
    card.className = "nowcard";
    if (sec) c.insertBefore(card, sec); else c.appendChild(card);
    nowcardCache = "";   // карточка новая — кэш от прежнего элемента невалиден
  }
  var html = '<div class="nc-label">' + esc(info.label) + "</div>" +
    '<div class="nc-title">' + esc(info.title) + "</div>" +
    '<div class="nc-sub">' + esc(info.sub) + "</div>";
  if (nowcardCache !== html) {
    card.innerHTML = html;
    card.classList.toggle("is-now", !!info.isNow);
    nowcardCache = html;
  }
  var em = el("emptyMsg");
  if (em) em.hidden = true;   // «Сегодня пар нет» на карточке вместо общей заглушки
}

/* ---------- рендер ---------- */
var el = function (id) { return document.getElementById(id); };
function syncThemeMeta() {
  var m = document.getElementById("metaTheme");
  if (m) m.content = state.theme === "dark" ? "#000000" : "#ffffff";
}

function render() {
  document.body.dataset.view = state.view;

  var gseg = el("groupSeg").querySelectorAll("button");
  for (var i = 0; i < gseg.length; i++) {
    gseg[i].setAttribute("aria-pressed", String(gseg[i].dataset.group === state.group));
  }

  var wseg = el("weekSeg");
  wseg.innerHTML = "";
  for (var w = 1; w <= MAX_WEEK; w++) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = w;
    b.dataset.week = w;
    b.setAttribute("aria-label", "Неделя " + w);
    b.setAttribute("aria-pressed", String(w === state.week));
    b.title = "Неделя " + w + " — " + weekRange(w);
    if (w === TODAY.week && TODAY.inSemester) b.classList.add("istoday");
    wseg.appendChild(b);
  }
  var cur = wseg.querySelector('button[aria-pressed="true"]');
  if (cur) wseg.scrollLeft = cur.offsetLeft - wseg.clientWidth / 2 + cur.clientWidth / 2;
  el("weekPrev").disabled = state.week <= 1;
  el("weekNext").disabled = state.week >= MAX_WEEK;

  var tabs = el("dayTabs");
  tabs.innerHTML = "";
  DAYS.forEach(function (n, di) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.innerHTML = '<span class="dname">' + DAY_SHORT[di] + "</span>" +
      '<span class="ddate">' + dayDate(state.week, di) + "</span>";
    b.setAttribute("aria-label", n + ", " + dayDate(state.week, di));
    b.setAttribute("aria-selected", String(di === state.day && state.view === "day"));
    b.title = n + ", неделя " + state.week +
      (di === TODAY.day && TODAY.inSemester ? ", сегодня" : "");
    b.addEventListener("click", function () {
      state.day = di;
      if (state.view !== "day") state.view = "day";
      save(); render();
    });
    tabs.appendChild(b);
  });
  var wb = document.createElement("button");
  wb.type = "button";
  wb.className = "allweek";
  wb.setAttribute("role", "tab");
  wb.innerHTML = '<span class="dname">Вся неделя</span>' +
    '<span class="ddate">' + weekRange(state.week) + "</span>";
  wb.setAttribute("aria-selected", String(state.view === "week"));
  wb.setAttribute("aria-label", "Вся неделя " + state.week);
  wb.title = "Расписание на всю неделю " + state.week;
  wb.addEventListener("click", function () {
    if (state.view !== "week") { state.view = "week"; save(); render(); }
  });
  tabs.appendChild(wb);

  var showBack = (state.view === "day" && (state.day !== TODAY.day || state.week !== TODAY.week)) ||
    (state.view === "week" && state.week !== TODAY.week);
  el("backToday").hidden = !showBack;

  var badge = el("todayBadge");
  if (TODAY.inSemester) {
    var now = new Date();
    badge.innerHTML = "<b>Сегодня</b>, " + now.getDate() + " " + MONTHS[now.getMonth()] +
      " — неделя " + TODAY.week + " (" + parityOf(TODAY.week) + ")";
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  el("emptyMsg").hidden = true;
  var c = el("content");
  if (state.view === "day") {
    var hasAny = TIMES.some(function (_, ti) { return itemsFor(state.group, state.day, ti, state.week).length; });
    if (hasAny) {
      c.innerHTML = daySectionHTML(state.group, state.day, state.week);
    } else {
      c.innerHTML = "";
      el("emptyMsg").hidden = false;
    }
  } else {
    c.innerHTML = weekHTML(state.group, state.week);
  }
  syncWeekPill();
  updateLive();
}

/* ---------- обновление TODAY при «пробуждении» PWA ---------- */
function refreshToday() {
  var t = todayInfo();
  var changed = t.rawWeek !== TODAY.rawWeek || t.day !== TODAY.day;
  if (!changed) { updateLive(); return; }
  var wasOnToday = state.view === "day" && state.week === TODAY.week && state.day === TODAY.day;
  TODAY = t;
  if (wasOnToday && t.inSemester) {
    state.week = t.week;
    state.day = t.day;
    state.view = "day";
    save();
  }
  render();
}
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    refreshToday();
    checkDataVersion(false);
  }
});
window.addEventListener("pageshow", refreshToday);

/* ---------- версия данных и плашка обновления ---------- */
var DATA_VERSION = (window.SCHEDULE_META && window.SCHEDULE_META.version) || "";
var updateDismissed = false;
var lastVersionCheck = 0;
function checkDataVersion(force) {
  if (updateDismissed || !DATA_VERSION) return;
  var t = Date.now();
  if (!force && t - lastVersionCheck < 18e5) return;   // не чаще раза в 30 минут
  lastVersionCheck = t;
  fetch("data.js", { cache: "no-store" }).then(function (r) {
    return r.ok ? r.text() : null;
  }).then(function (txt) {
    if (!txt || updateDismissed) return;
    var m = /"version"\s*:\s*"([0-9a-f]+)"/.exec(txt);
    if (m && m[1] !== DATA_VERSION) showUpdateBanner();
  }).catch(function () {});
}
function showUpdateBanner() {
  var b = el("updateBanner");
  if (b) { b.hidden = false; return; }
  b = document.createElement("div");
  b.id = "updateBanner";
  b.className = "banner";
  b.setAttribute("role", "dialog");
  b.setAttribute("aria-label", "Доступно обновление расписания");
  b.innerHTML = '<div class="banner-body"><p class="banner-title">Расписание обновилось</p>' +
    '<p class="banner-text">Опубликована новая версия расписания.</p>' +
    '<button class="banner-no" id="updateReload" type="button">Обновить</button></div>' +
    '<button class="banner-x" id="updateClose" type="button" aria-label="Скрыть">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  document.body.appendChild(b);
  el("updateReload").addEventListener("click", function () { location.reload(); });
  el("updateClose").addEventListener("click", function () {
    updateDismissed = true;
    b.hidden = true;
  });
}
function fillDataVersion() {
  var dv = el("dataVersion");
  if (!dv || !window.SCHEDULE_META || !window.SCHEDULE_META.generated) return;
  var g = new Date(window.SCHEDULE_META.generated);
  if (isNaN(g)) return;
  dv.textContent = "Данные от " + g.getDate() + " " + MONTHS[g.getMonth()];
  dv.hidden = false;
}

/* ---------- события ---------- */
el("groupSeg").addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  state.group = b.dataset.group;
  save(); render();
});
el("weekSeg").addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  state.week = parseInt(b.dataset.week, 10);
  save(); render();
});
el("weekPrev").addEventListener("click", function () {
  if (state.week > 1) { state.week--; save(); render(); }
});
el("weekNext").addEventListener("click", function () {
  if (state.week < MAX_WEEK) { state.week++; save(); render(); }
});
el("backToday").addEventListener("click", function () {
  state.day = TODAY.day;
  state.week = TODAY.week;
  state.view = "day";
  save(); render();
});

/* ---------- пилюля недели (свёрнутая лента) ---------- */
function syncWeekPill() {
  var t = el("weekPillText");
  if (t) t.textContent = "Неделя " + state.week + " (" + parityOf(state.week) + "), " + weekRange(state.week);
  var row = el("weekRow"), pill = el("weekPill");
  pill.setAttribute("aria-expanded", row.hidden ? "false" : "true");
}
el("weekPill").addEventListener("click", function () {
  el("weekRow").hidden = !el("weekRow").hidden;
  syncWeekPill();
});
document.addEventListener("click", function (e) {
  var row = el("weekRow");
  if (row.hidden) return;
  if (row.contains(e.target) || el("weekPill").contains(e.target)) return;
  row.hidden = true;
  syncWeekPill();
});

/* ---------- экспорт в календарь (.ics) ---------- */
function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
    .replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function icsLocal(date, min) {
  return "" + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
    "T" + pad2(Math.floor(min / 60)) + pad2(min % 60) + "00";
}
function teacherOf(dmeta) {
  var m = /—\s*([^—]+?)\s*—\s*(?:ауд\.|ЦОР)/.exec(dmeta || "");
  return m ? m[1].trim() : "";
}
function buildICS(group) {
  var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//schedule307//classgrid//RU",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Расписание 307, группа " + group,
    "X-WR-TIMEZONE:Europe/Moscow",
    "BEGIN:VTIMEZONE", "TZID:Europe/Moscow", "BEGIN:STANDARD",
    "DTSTART:19700101T000000", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0300",
    "TZNAME:MSK", "END:STANDARD", "END:VTIMEZONE"];
  var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (var di = 0; di < 6; di++) {
    for (var ti = 0; ti < TIMES.length; ti++) {
      var items = INDEX[group][di][ti] || [];
      for (var n = 0; n < items.length; n++) {
        var it = items[n], tm = TIMES_MIN[ti];
        var weeks = (it.weeks || []).filter(function (w) { return w >= 1 && w <= MAX_WEEK; });
        for (var wi = 0; wi < weeks.length; wi++) {
          var d = new Date(SEMESTER_START);
          d.setDate(d.getDate() + (weeks[wi] - 1) * 7 + (di - 1 + 7) % 7);
          var tch = teacherOf(it.dmeta), aud = audOf(it.dmeta, weeks[wi]);
          lines.push("BEGIN:VEVENT",
            "UID:s307-" + group + "-" + di + "-" + ti + "-" + weeks[wi] + "@classgrid",
            "DTSTAMP:" + stamp,
            "DTSTART;TZID=Europe/Moscow:" + icsLocal(d, tm.start),
            "DTEND;TZID=Europe/Moscow:" + icsLocal(d, tm.end),
            "SUMMARY:" + icsEscape(it.name));
          if (aud) lines.push("LOCATION:" + icsEscape("ауд. " + aud));
          var desc = [];
          if (tch) desc.push(tch);
          if (aud) desc.push("ауд. " + aud);
          if (it.shared) desc.push("смежная с другой группой");
          if (desc.length) lines.push("DESCRIPTION:" + icsEscape(desc.join(", ")));
          lines.push("END:VEVENT");
        }
      }
    }
  }
  lines.push("END:VCALENDAR");
  return { text: lines.join("\r\n"), count: (lines.join("\n").match(/BEGIN:VEVENT/g) || []).length };
}
function downloadICS() {
  var r = buildICS(state.group);
  var blob = new Blob([r.text], { type: "text/calendar;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "raspisanie307-" + state.group + ".ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}
el("icsBtn").addEventListener("click", downloadICS);

/* ---------- свайп влево-вправо: смена дня ---------- */
(function () {
  var sx = 0, sy = 0, tracking = false;
  var main = el("main");
  main.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  main.addEventListener("touchend", function (e) {
    if (!tracking) return;
    tracking = false;
    if (state.view !== "day") return;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) >= Math.abs(dx)) return;
    var dir = dx < 0 ? 1 : -1;   // влево — следующий день
    var nd = state.day + dir, nw = state.week;
    if (nd > 5) { if (nw >= MAX_WEEK) return; nd = 0; nw++; }
    if (nd < 0) { if (nw <= 1) return; nd = 5; nw--; }
    state.day = nd;
    state.week = nw;
    save(); render();
  }, { passive: true });
})();

el("themeBtn").addEventListener("click", function () {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  syncThemeMeta();
  save();
});

/* ---------- баннер установки ---------- */
var deferredPrompt = null;
var bannerShown = false;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredPrompt = e;
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function sessionHidden() {
  try { return sessionStorage.getItem("schedule307:banner") === "1"; }
  catch (e) { return false; }
}
function hideBannerSession() {
  try { sessionStorage.setItem("schedule307:banner", "1"); } catch (e) {}
  el("banner").hidden = true;
}

function showBanner() {
  if (isStandalone() || state.bannerPermanent || bannerShown) return;
  if (sessionHidden()) return;
  bannerShown = true;
  var text = "", act = null;
  if (deferredPrompt) {
    text = "Установите «Расписание 307» на главный экран устройства";
    act = function () {
      deferredPrompt.prompt();
      deferredPrompt = null;
      el("banner").hidden = true;
    };
  } else if (isIOS()) {
    text = "В Safari нажмите «Поделиться» и выберите «На экран “Домой”»";
  } else {
    text = "Добавьте в закладки: ⌘D (Mac) или Ctrl+D (Windows)";
  }
  el("bannerText").textContent = text;
  el("banner").hidden = false;
}
el("bannerClose").addEventListener("click", hideBannerSession);
el("bannerNo").addEventListener("click", function () {
  state.bannerPermanent = true;
  save();
  el("banner").hidden = true;
});
el("resetBanner").addEventListener("click", function () {
  state.bannerPermanent = false;
  save();
  try { sessionStorage.removeItem("schedule307:banner"); } catch (e) {}
  bannerShown = false;
  showBanner();
});

window.addEventListener("appinstalled", function () { el("banner").hidden = true; });

setTimeout(showBanner, 5000);

/* ---------- первый запуск ---------- */
if (FIRST_OPEN) {
  state.week = TODAY.week;
  state.day = TODAY.day;
  state.view = "day";
  save();
}
/* GET-параметры (поделиться ссылкой / QA): group, week, view, day, theme */
try {
  var qs = new URLSearchParams(location.search);
  if (qs.toString()) {
    var qg = qs.get("group"); if (qg === "А" || qg === "Б") state.group = qg;
    var qw = parseInt(qs.get("week"), 10); if (qw >= 1 && qw <= MAX_WEEK) state.week = qw;
    var qv = qs.get("view"); if (qv === "day" || qv === "week") state.view = qv;
    var qd = parseInt(qs.get("day"), 10); if (qd >= 0 && qd <= 5) state.day = qd;
    var qt = qs.get("theme"); if (qt === "light" || qt === "dark") {
      state.theme = qt;
      document.documentElement.dataset.theme = qt;
    }
    save();
  }
} catch (e) {}
syncThemeMeta();
render();
fillDataVersion();
setInterval(updateLive, 30000);
setTimeout(function () { checkDataVersion(true); }, 3000);

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(function () {});
}

/* ---------- мобайл: панель в шапке сворачивается при скролле ---------- */
(function () {
  var hdr = document.querySelector(".hdr");
  if (!hdr) return;
  var on = null;
  window.addEventListener("scroll", function () {
    var v = window.scrollY > 60;
    if (v !== on) { on = v; hdr.classList.toggle("collapsed", v); }
  }, { passive: true });
})();
