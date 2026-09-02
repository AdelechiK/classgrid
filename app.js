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
  var diff = Math.floor((now - SEMESTER_START) / 6048e5);   // 7 суток
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
  return '<section class="day"><h2>' + DAYS[di] + ", " + dayDate(week, di) + "</h2>" + rows + "</section>";
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
  return '<section class="mday"><h2>' + DAYS[di] + ", " + dayDate(week, di) + "</h2>" + rows + "</section>";
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
      " — неделя " + TODAY.week;
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

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(function () {});
}
