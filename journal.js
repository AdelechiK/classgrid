/* Расписание 307 — журнал посещаемости: UI (виды «Отметки/Сводка/Список»,
   шторка причин, снекбар с отменой, heatmap, ростер, настройка синхры).
   Спека: .qa/journal-spec/02-ui-skeleton.md; данные — journal-store.js (01-store-api).
   Хелперы дня/недели/даты и esc/hhmm/plural дублируются из app.js осознанно:
   журнал — отдельная страница и живёт без app.js (app.js не трогаем). */
"use strict";

(function () {

  /* ---------- данные: тихий выход, если что-то не загрузилось ---------- */
  if (!window.SCHEDULE_DATA || !window.SCHEDULE_DATA.days ||
      !window.SCHEDULE_DATA.times || !window.SCHEDULE_DATA.groups || !window.JStore) {
    var bootFail = function () {
      var m = document.getElementById("main");
      if (m) m.innerHTML = '<p class="empty">Не удалось загрузить журнал. Обновите страницу.</p>';
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootFail);
    else bootFail();
    throw new Error("журнал: data.js или journal-store.js не загрузились");
  }

  var JStore = window.JStore;
  var DATA = window.SCHEDULE_DATA;
  var DAYS = DATA.days;               // 6 полных названий, Пн..Сб
  var TIMES = DATA.times;             // 7 слотов «8:30–10:00»…
  var DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var MAX_WEEK = 18;
  var LS_KEY = "journal307:ui";       // состояние UI журнала
  var THEME_KEY = "schedule307:v1";   // тема живёт в хранилище основного сайта
  /* Якорь семестра — понедельник 2026-08-31 (неделя 1), как в app.js. */
  var SEMESTER_START = new Date(2026, 7, 31);
  var SEMESTER_FIRST_DAY = new Date(2026, 8, 1);    // вт 01.09.2026
  var SEMESTER_LAST_DAY = new Date(2026, 11, 31);   // чт 31.12.2026
  /* Причины отсутствия: код клетки -> текст (00-model). Своя причина — произвольная строка. */
  var REASONS = { b: "Болезнь", u: "Уважительная", n: "Неуважительная", ip: "Индивидуальный план обучения" };

  /* ---------- утилиты (дублируются из app.js осознанно) ---------- */
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clamp(v, lo, hi) {
    v = parseInt(v, 10);
    if (isNaN(v)) return null;
    return Math.min(hi, Math.max(lo, v));
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayDate(w, di) {
    var d = new Date(SEMESTER_START);
    d.setDate(d.getDate() + (w - 1) * 7 + di);
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
  }
  function weekRange(w) {
    var a = new Date(SEMESTER_START); a.setDate(a.getDate() + (w - 1) * 7);
    if (a < SEMESTER_FIRST_DAY) a = new Date(SEMESTER_FIRST_DAY);
    var b = new Date(a); b.setDate(b.getDate() + 6 - ((b.getDay() + 6) % 7));
    if (b > SEMESTER_LAST_DAY) b = new Date(SEMESTER_LAST_DAY);
    return pad2(a.getDate()) + "." + pad2(a.getMonth() + 1) + "–" +
      pad2(b.getDate()) + "." + pad2(b.getMonth() + 1);
  }
  function parityOf(w) {
    if (w < 1 || w > MAX_WEEK) return "";
    return w % 2 ? "нечёт" : "чёт";
  }
  function hhmm(min) { return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  /* Дата дня (week w, день di 0=пн) в формате клетки «YYYY-MM-DD» (00-model). */
  function isoDate(w, di) {
    var d = new Date(SEMESTER_START);
    d.setDate(d.getDate() + (w - 1) * 7 + di);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  /* Обратно: ISO-дата -> { week, day }. */
  function weekDayOfDate(iso) {
    var p = iso.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var dow = (d.getDay() + 6) % 7;
    var mon = new Date(d); mon.setDate(mon.getDate() - dow);
    return { week: Math.round((mon - SEMESTER_START) / (7 * 864e5)) + 1, day: dow };
  }
  function dayInSemester(w, di) {
    var d = new Date(SEMESTER_START);
    d.setDate(d.getDate() + (w - 1) * 7 + di);
    return d >= SEMESTER_FIRST_DAY && d <= SEMESTER_LAST_DAY;
  }
  /* Показ имени: «Фамилия Имя» — первый и второй токен (00-model). */
  function displayName(full) {
    var t = String(full === undefined || full === null ? "" : full).trim().split(/\s+/);
    if (!t[0]) return "";
    return t.length > 1 ? t[0] + " " + t[1] : t[0];
  }
  function reasonText(r) {
    var k = String(r === undefined || r === null ? "" : r);
    return hasOwn(REASONS, k) ? REASONS[k] : k;
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function todayInfo() {
    var now = startOfDay(new Date());
    var dow = (now.getDay() + 6) % 7;
    var mon = new Date(now); mon.setDate(mon.getDate() - dow);
    var rawWeek = Math.round((mon - SEMESTER_START) / (7 * 864e5)) + 1;
    return {
      rawWeek: rawWeek,
      week: clamp(rawWeek, 1, MAX_WEEK) || 1,
      day: dow,
      inSemester: rawWeek >= 1 && rawWeek <= MAX_WEEK &&
        now >= SEMESTER_FIRST_DAY && now <= SEMESTER_LAST_DAY
    };
  }

  /* ---------- индекс расписания (как в app.js) ---------- */
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
    if (!INDEX[group] || !INDEX[group][dayIdx]) return [];
    return (INDEX[group][dayIdx][timeIdx] || []).filter(function (it) {
      return it.weeks && it.weeks.indexOf(week) >= 0;
    });
  }
  var TIMES_MIN = TIMES.map(function (t) {
    var p = t.split("–"), a = p[0].split(":"), b = p[1].split(":");
    return { start: (+a[0]) * 60 + (+a[1]), end: (+b[0]) * 60 + (+b[1]) };
  });
  /* Пары дня: по слоту на занятие (первый item слота), как lessonsOfDay в app.js. */
  function lessonsOfDay(group, di, week) {
    var res = [];
    for (var ti = 0; ti < TIMES.length; ti++) {
      var its = itemsFor(group, di, ti, week);
      if (its.length) res.push({ ti: ti, item: its[0], start: TIMES_MIN[ti].start, end: TIMES_MIN[ti].end });
    }
    return res;
  }

  /* ---------- состояние UI ---------- */
  function readUi() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
    catch (e) { return null; }
  }
  var saved = readUi();
  var state = {
    view: (saved && (saved.view === "stats" || saved.view === "roster")) ? saved.view : "marks",
    group: "Б",   // журнал ведётся только для подгруппы Б (решение юзера 06.11)
    week: clamp(saved && saved.week, 1, MAX_WEEK) || 1,
    day: clamp(saved && saved.day, 0, 5) || 0,
    folded: (saved && saved.folded && typeof saved.folded === "object") ? saved.folded : {},
    editingId: null          // inline-правка ростера (не сохраняется)
  };
  var TODAY = todayInfo();
  var FIRST_OPEN = !saved;
  if (FIRST_OPEN) {
    state.week = TODAY.inSemester ? TODAY.week : 1;
    state.day = (TODAY.inSemester && TODAY.day <= 5) ? TODAY.day : 0;
  }
  var storeReady = false;    // бейдж скрыт до готовности store
  var setupOpen = false;     // блок #syncSetup
  var cfgTokenKeep = true;   // после сохранения конфига токен в форме не восстанавливаем
  var sheetCtx = null;       // { ti, sid } открытой шторки причины
  var pendingDel = null;     // sid в диалоге удаления

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        view: state.view, group: state.group, week: state.week, day: state.day,
        folded: state.folded
      }));
    } catch (e) { /* приватный режим */ }
  }

  var el = function (id) { return document.getElementById(id); };
  function syncThemeMeta() {
    var m = document.getElementById("metaTheme");
    if (m) m.content = document.documentElement.dataset.theme === "dark" ? "#000000" : "#ffffff";
  }

  /* В неделе 1 нет пн 31.08, в неделе 18 нет пт–вс: открытый день вытесняем
     в ближайший существующий (как в app.js render). */
  function normalizeDay() {
    if (dayInSemester(state.week, state.day)) return;
    var days = [], di;
    for (di = 0; di < 6; di++) if (dayInSemester(state.week, di)) days.push(di);
    if (!days.length) return;
    var best = days[0];
    for (var i = 1; i < days.length; i++) {
      if (Math.abs(days[i] - state.day) < Math.abs(best - state.day)) best = days[i];
    }
    state.day = best;
  }

  /* ---------- снекбар: один активный, 5 с, «Отменить» = новая правка ---------- */
  var snackTimer = null, snackUndoFn = null;
  function showSnack(text, undoFn) {
    el("snackText").textContent = text;
    snackUndoFn = undoFn || null;
    el("snackUndo").hidden = !snackUndoFn;
    el("snackbar").hidden = false;
    if (snackTimer) clearTimeout(snackTimer);
    snackTimer = setTimeout(hideSnack, 5000);
  }
  function hideSnack() {
    if (snackTimer) { clearTimeout(snackTimer); snackTimer = null; }
    el("snackbar").hidden = true;
    snackUndoFn = null;
  }
  function failSnack(e) {
    showSnack((e && e.message) ? String(e.message) : "Ошибка", null);
  }

  /* Перерисовка в следующем микротаске: store мутирует память в первом же
     микротаске после вызова, а запись IDB/зеркала догоняет позже; DOM должен
     отреагировать на клик сразу, не дожидаясь persist (notify store приходит
     только после записи). Вызывать строго после JStore.* в том же блоке. */
  function refreshSoon() { Promise.resolve().then(renderAll); }

  /* Снимок клетки до правки; undo повторяет действие с НОВЫМ t (setMark сам ставит
     Date.now) — отмена это новая правка, не путешествие во времени (02). */
  function snapshotCell(g, date, ti, sid) {
    var c = JStore.getMark(g, date, ti, sid);
    return c ? { v: c.v, r: c.r === undefined ? null : c.r, t: c.t, dv: c.dv } : null;
  }
  function undoCell(g, date, ti, sid, prev) {
    if (!prev) return JStore.clearMark(g, date, ti, sid);
    return JStore.setMark(g, date, ti, sid, prev.v, prev.r);
  }
  function studentName(g, sid) {
    var list = JStore.rosterList(g), i;
    for (i = 0; i < list.length; i++) if (list[i].id === sid) return list[i].name;
    return "";
  }

  /* ---------- рендер: шапка ---------- */
  function renderHeader() {
    var i;
    var vseg = el("viewSeg").querySelectorAll("button");
    for (i = 0; i < vseg.length; i++) {
      vseg[i].setAttribute("aria-pressed", String(vseg[i].dataset.view === state.view));
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
    for (var di = 0; di < 6; di++) {
      if (!dayInSemester(state.week, di)) continue;
      var isT = di === TODAY.day && TODAY.inSemester && state.week === TODAY.week;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.dataset.day = di;
      btn.innerHTML = '<span class="dname">' + DAY_SHORT[di] + "</span>" +
        '<span class="ddate">' + dayDate(state.week, di) + "</span>";
      btn.setAttribute("aria-label", DAYS[di] + ", " + dayDate(state.week, di));
      btn.setAttribute("aria-selected", String(di === state.day && state.view === "marks"));
      if (isT) btn.classList.add("istoday");
      btn.title = DAYS[di] + ", неделя " + state.week + (isT ? ", сегодня" : "");
      tabs.appendChild(btn);
    }

    el("weekPillText").textContent =
      "Неделя " + state.week + " (" + parityOf(state.week) + "), " + weekRange(state.week);
    var row = el("weekRow");
    el("weekPill").setAttribute("aria-expanded", row.hidden ? "false" : "true");

    var showBack = TODAY.inSemester && TODAY.day <= 5 && state.view !== "roster" &&
      (state.week !== TODAY.week || state.day !== TODAY.day);
    el("backToday").hidden = !showBack;
  }

  /* ---------- рендер: вид «Отметки» ---------- */
  function marksHTML(date, lessons, students) {
    var g = state.group;
    return lessons.map(function (ls) {
      var i, c, marked = 0, anyUnc = false;
      for (i = 0; i < students.length; i++) {
        c = JStore.getMark(g, date, ls.ti, students[i].id);
        if (c && c.v === "p") marked++;
        if (!c) anyUnc = true;
      }
      /* дефолт: свернуть, если есть отмеченные (в развёрнутом виде они не нужны) */
      var fold = state.folded[ls.ti] === undefined ? marked > 0 : state.folded[ls.ti];
      var rows = students.map(function (s) {
        c = JStore.getMark(g, date, ls.ti, s.id);
        var st = !c ? "st-unc" : (c.v === "p" ? "st-p" : "st-a");
        var reason = (c && c.v === "a" && c.r) ? reasonText(c.r) : "";
        return '<div class="strow ' + st + (reason ? " with-reason" : "") +
          (fold && st === "st-p" ? " st-fold" : "") +
          '" data-sid="' + esc(s.id) + '" data-ti="' + ls.ti + '">' +
          '<div class="st-name">' + esc(displayName(s.name)) + "</div>" +
          (reason ? '<div class="st-reason">' + esc(reason) + "</div>" : "") +
          '<div class="st-actions">' +
          '<button class="pill pill-was" type="button" data-act="p" aria-pressed="' +
            (st === "st-p") + '">Был</button>' +
          '<button class="pill pill-abs" type="button" data-act="a" aria-pressed="' +
            (st === "st-a") + '">Не был</button>' +
          "</div></div>";
      }).join("");
      var head = '<div class="pc-head">' +
        '<div class="pc-time">' + esc(TIMES[ls.ti]) + "</div>" +
        '<div class="pc-name">' + esc(ls.item.name) +
        (ls.item.shared ? '<span class="badge">Смежная</span>' : "") + "</div>" +
        (!anyUnc && students.length ? '<span class="pc-done">Пара отмечена</span>' : "") +
        '<button class="pc-all" type="button" data-ti="' + ls.ti + '">Все были</button></div>';
      var foldBtn = marked > 0
        ? '<button class="pc-fold" type="button" data-ti="' + ls.ti + '" aria-expanded="' +
          String(!fold) + '">Отмечено ' + marked + " из " + students.length + " – " +
          (fold ? "показать" : "свернуть") +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>'
        : "";
      return '<div class="paircard">' + head + foldBtn + '<div class="pc-rows">' + rows + "</div></div>";
    }).join("");
  }
  function renderMarks() {
    var date = isoDate(state.week, state.day);
    var lessons = lessonsOfDay(state.group, state.day, state.week);
    var students = JStore.activeStudents(state.group);
    var marks = 0, abs = 0, i, j, c;
    if (lessons.length && students.length) {
      for (i = 0; i < lessons.length; i++)
        for (j = 0; j < students.length; j++) {
          c = JStore.getMark(state.group, date, lessons[i].ti, students[j].id);
          if (c) { marks++; if (c.v === "a") abs++; }
        }
    }
    var line = (lessons.length && students.length)
      ? '<p class="dayline">Отметок ' + marks + " из " + (lessons.length * students.length) +
        (abs ? ", не были " + abs : "") + "</p>"
      : "";
    el("viewMarks").innerHTML = line + marksHTML(date, lessons, students);
    el("emptyMsg").hidden = lessons.length > 0;
  }

  /* ---------- рендер: вид «Сводка» ---------- */
  function absentsByDate(g) {
    var cells = JStore.state().cells, out = {}, k, p;
    for (k in cells) {
      if (!hasOwn(cells, k)) continue;
      p = k.split("|");
      if (p[0] !== g || !cells[k] || cells[k].v !== "a") continue;
      out[p[1]] = (out[p[1]] || 0) + 1;
    }
    return out;
  }
  function skipHTML(g, daysWithLessons) {
    var rows = [], i, j, k;
    var students = JStore.activeStudents(g);
    for (i = 0; i < students.length; i++) {
      var dates = [];
      for (j = 0; j < daysWithLessons.length; j++) {
        var d = daysWithLessons[j], all = true;
        for (k = 0; k < d.tis.length; k++) {
          var c = JStore.getMark(g, d.date, d.tis[k], students[i].id);
          if (!c || c.v !== "a") { all = false; break; }
        }
        if (all) dates.push(d);
      }
      if (dates.length) rows.push({ name: displayName(students[i].name), dates: dates });
    }
    rows.sort(function (a, b) { return b.dates.length - a.dates.length; });
    var h = "<h3>Совсем не приходили</h3>";
    if (!rows.length) return h + '<p class="empty">Таких нет – уже хорошо</p>';
    for (i = 0; i < rows.length; i++) {
      var parts = [];
      var ds = rows[i].dates.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      for (j = 0; j < ds.length; j++) parts.push(DAY_SHORT[ds[j].di] + " " + dayDate(ds[j].w, ds[j].di));
      var n = rows[i].dates.length;
      h += '<div class="skip-row"><div class="skip-name">' + esc(rows[i].name) + "</div>" +
        '<div class="skip-count">' + n + " " + plural(n, "день", "дня", "дней") + "</div>" +
        '<div class="skip-dates" hidden>' + esc(parts.join(", ")) + "</div></div>";
    }
    return h;
  }
  function statsHTML() {
    var g = state.group;
    var abs = absentsByDate(g);
    var h = '<p class="heat-title">Пропуски по дням семестра</p><div class="heat">';
    var daysWithLessons = [];
    for (var w = 1; w <= MAX_WEEK; w++) {
      h += '<div class="heat-col">';
      for (var di = 0; di < 6; di++) {
        if (!dayInSemester(w, di)) {
          h += '<div class="heat-cell" style="visibility:hidden"></div>';
          continue;
        }
        var date = isoDate(w, di);
        var ls = lessonsOfDay(g, di, w);
        if (ls.length) {
          var tis = [];
          for (var i = 0; i < ls.length; i++) tis.push(ls[i].ti);
          daysWithLessons.push({ w: w, di: di, date: date, tis: tis });
        }
        var n = abs[date] || 0;
        var lvl = n >= 4 ? 4 : n;
        h += '<div class="heat-cell l' + lvl + '" data-date="' + date + '" data-lvl="' + lvl +
          '" title="' + esc(DAY_SHORT[di] + " " + dayDate(w, di) + " – " + n + " " +
          plural(n, "не был", "не были", "не были")) + '"></div>';
      }
      h += "</div>";
    }
    h += '</div><div class="heat-legend">меньше';
    for (var L = 0; L <= 4; L++) h += '<div class="heat-cell l' + L + '"></div>';
    h += "больше</div>";
    h += '<div id="skipList">' + skipHTML(g, daysWithLessons) + "</div>";
    return h;
  }
  function renderStats() {
    el("viewStats").innerHTML = statsHTML();
  }

  /* ---------- рендер: вид «Список» ---------- */
  function renderRoster() {
    var sec = el("viewRoster");
    /* Значения полей выживают перестройку секции (notify может прийти во время ввода). */
    var ids = ["addName", "pasteImport", "cfgOwner", "cfgRepo"];
    if (cfgTokenKeep) ids.push("cfgToken");
    var keep = {}, i, n;
    for (i = 0; i < ids.length; i++) { n = el(ids[i]); if (n) keep[ids[i]] = n.value; }
    var editInput = sec.querySelector('.rrow input[data-edit="1"]');
    var editVal = editInput ? editInput.value : null;

    var meta = JStore.state().meta;
    var list = JStore.rosterList(state.group);
    var h = '<div class="roster-head">' +
      '<input id="addName" type="text" placeholder="Имя и фамилия студента">' +
      '<button id="addGo" type="button">Добавить</button></div><div id="rosterList">';
    if (!list.length) {
      h += '<div class="dayempty">Список пуст — добавьте студентов или вставьте списком.</div>';
    }
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      var gone = !!(e.del || e.wipe);
      if (state.editingId === e.id) {
        h += '<div class="rrow" data-sid="' + esc(e.id) + '">' +
          '<input data-edit="1" type="text" value="' + esc(editVal !== null ? editVal : e.name) + '">' +
          '<button class="r-edit" type="button" data-act="save">Сохранить</button>' +
          '<button class="r-del" type="button" data-act="cancel">Отмена</button></div>';
      } else {
        h += '<div class="rrow' + (gone ? " is-gone" : "") + '" data-sid="' + esc(e.id) + '">' +
          '<div class="r-name">' + esc(displayName(e.name)) +
          (gone ? '<span class="r-gone">выбыл</span>' : "") + "</div>" +
          '<button class="r-edit" type="button" data-act="edit">Править</button>' +
          '<button class="r-del" type="button" data-act="del">Удалить</button></div>';
      }
    }
    h += '</div><textarea id="pasteImport" placeholder="Вставьте список – по одному студенту в строке"></textarea>' +
      '<button id="importGo" type="button">Вставить список</button>';
    if (setupOpen) {
      h += '<div id="syncSetup">' +
        '<input id="cfgOwner" type="text" placeholder="owner — владелец репозитория" value="' + esc(meta.owner || "") + '">' +
        '<input id="cfgRepo" type="text" placeholder="repo — название репозитория" value="' + esc(meta.repo || "") + '">' +
        '<input id="cfgToken" type="password" placeholder="Personal access token" autocomplete="off">' +
        '<button id="cfgSave" type="button">Сохранить</button>' +
        '<button id="cfgOff" type="button">Отключить</button></div>';
    }
    sec.innerHTML = h;
    for (i = 0; i < ids.length; i++) {
      n = el(ids[i]);
      if (n && keep[ids[i]] !== undefined) n.value = keep[ids[i]];
    }
    if (!cfgTokenKeep) cfgTokenKeep = true;
  }

  /* ---------- бейдж синхронизации ---------- */
  function updateSyncBadge() {
    var b = el("syncBadge");
    if (!b) return;
    if (!storeReady) { b.hidden = true; return; }
    var st = JStore.syncStatus();
    var offline = (typeof navigator !== "undefined" && navigator.onLine === false);
    var text, cls = "";
    /* Оффлайн важнее прочего: данные на устройстве независимо от конфига. */
    if (offline || st.state === "offline") {
      text = "Оффлайн – данные на устройстве";
      cls = "sync-warn";
    } else if (st.state === "synced") {
      text = "Синхронизировано";
    } else if (st.state === "pending") {
      text = "Отправка… " + st.pending;
      cls = "sync-warn";
    } else if (st.state === "error") {
      text = "Ошибка синхронизации – подробности по тапу";
      cls = "sync-err";
    } else {
      text = "Синхронизация не настроена";
    }
    b.className = "sub" + (cls ? " " + cls : "");
    /* кольцо загрузки — только на «Отправка…» (в полёте есть изменения) */
    b.innerHTML = (st.state === "pending" ? '<span class="spin"></span>' : "") + esc(text);
    b.hidden = false;
  }

  /* ---------- общий рендер ---------- */
  function renderAll() {
    normalizeDay();
    el("viewMarks").hidden = state.view !== "marks";
    el("viewStats").hidden = state.view !== "stats";
    el("viewRoster").hidden = state.view !== "roster";
    el("emptyMsg").hidden = true;
    renderHeader();
    if (state.view === "marks") renderMarks();
    else if (state.view === "stats") renderStats();
    else renderRoster();
    updateSyncBadge();
  }

  /* ---------- шторки ---------- */
  var openSheetEl = null, closeTimer = null;
  function openSheet(sh) {
    hideSnack();   // снекбар (z-index 70) лежит поверх шторки (60) — не оставляем его под ней
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    var bd = el("sheetBd");
    el("reasonSheet").classList.remove("out");
    el("delSheet").classList.remove("out");
    bd.classList.remove("out");
    bd.hidden = false;
    sh.hidden = false;
    openSheetEl = sh;
  }
  function closeSheets(immediate) {
    var bd = el("sheetBd"), sh = openSheetEl;
    sheetCtx = null;
    pendingDel = null;
    if (!sh) { bd.hidden = true; return; }
    openSheetEl = null;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (immediate) {
      sh.classList.remove("out");
      bd.classList.remove("out");
      sh.hidden = true;
      bd.hidden = true;
      return;
    }
    sh.classList.add("out");
    bd.classList.add("out");
    closeTimer = setTimeout(function () {
      closeTimer = null;
      sh.classList.remove("out");
      bd.classList.remove("out");
      sh.hidden = true;
      bd.hidden = true;
    }, 260);
  }

  /* ---------- отметки: действия ---------- */
  function onMarkPresent(ti, sid) {
    var g = state.group, date = isoDate(state.week, state.day);
    var prev = snapshotCell(g, date, ti, sid);
    JStore.setMark(g, date, ti, sid, "p", null).catch(failSnack);
    refreshSoon();
    showSnack(displayName(studentName(g, sid)) + " — был", function () {
      return undoCell(g, date, ti, sid, prev);
    });
  }
  function onAllWere(ti) {
    var g = state.group, date = isoDate(state.week, state.day);
    var students = JStore.activeStudents(g);
    var sids = [], prev = {}, i, c;
    /* Уже «был» не переписываем: их t не трогаем (02). Снимок — до действия. */
    for (i = 0; i < students.length; i++) {
      c = JStore.getMark(g, date, ti, students[i].id);
      if (!c || c.v !== "p") {
        sids.push(students[i].id);
        prev[students[i].id] = snapshotCell(g, date, ti, students[i].id);
      }
    }
    if (!sids.length) { showSnack("Все уже отмечены как был", null); return; }
    JStore.markAllPresent(g, date, ti, sids).catch(failSnack);
    refreshSoon();
    showSnack("Все были отмечены на паре", function () {
      /* Все undo запускаются сразу (не цепочкой): каждая мутация — свой
         микротаск, снимок возвращается целиком за один кадр (02). */
      var prs = [], j;
      for (j = 0; j < sids.length; j++) {
        prs.push(undoCell(g, date, ti, sids[j], prev[sids[j]]));
      }
      return Promise.all(prs);
    });
  }
  function openReasonSheet(ti, sid) {
    var g = state.group;
    sheetCtx = { ti: ti, sid: sid };
    var ls = null, lessons = lessonsOfDay(g, state.day, state.week), i;
    for (i = 0; i < lessons.length; i++) if (lessons[i].ti === ti) { ls = lessons[i]; break; }
    el("sheetWho").textContent = displayName(studentName(g, sid)) +
      " — " + (ls ? ls.item.name + ", начало в " + hhmm(ls.start) : TIMES[ti]);
    el("rsnText").value = "";
    openSheet(el("reasonSheet"));
  }
  function applyAbsence(reason) {
    if (!sheetCtx) { closeSheets(); return; }
    var g = state.group, ti = sheetCtx.ti, sid = sheetCtx.sid;
    var date = isoDate(state.week, state.day);
    var prev = snapshotCell(g, date, ti, sid);
    JStore.setMark(g, date, ti, sid, "a", reason).catch(failSnack);
    refreshSoon();
    closeSheets();
    showSnack(displayName(studentName(g, sid)) + " — не был: " + reasonText(reason), function () {
      return undoCell(g, date, ti, sid, prev);
    });
  }
  function clearCurrentMark() {
    if (!sheetCtx) { closeSheets(); return; }
    var g = state.group, ti = sheetCtx.ti, sid = sheetCtx.sid;
    var date = isoDate(state.week, state.day);
    var prev = snapshotCell(g, date, ti, sid);
    JStore.clearMark(g, date, ti, sid).catch(failSnack);
    refreshSoon();
    closeSheets();
    showSnack("Отметка убрана", function () {
      return undoCell(g, date, ti, sid, prev);
    });
  }

  /* ---------- список: действия ---------- */
  function onAddStudent() {
    var inp = el("addName");
    var v = inp ? inp.value.trim() : "";
    if (!v) { if (inp) inp.focus(); return; }
    /* дедуп как у вставки списком: точное имя среди активных — не добавляем */
    var list = JStore.activeStudents(state.group), i;
    for (i = 0; i < list.length; i++) {
      if (list[i].name === v) { showSnack(displayName(v) + " уже в списке", null); return; }
    }
    /* поле чистим сразу после дедуп-проверки: отложенная очистка в .then
       теряла второй ввод, набранный до сохранения первого (баг-хант 07.11) */
    if (inp) inp.value = "";
    JStore.addStudent(state.group, v).catch(failSnack);
    refreshSoon();
  }
  function onPasteImport() {
    var ta = el("pasteImport");
    if (!ta || !ta.value.trim()) return;
    var lines = ta.value.split("\n");
    JStore.importRoster(state.group, lines).then(function (res) {
      var n = el("pasteImport");
      if (n) n.value = "";
      showSnack("Добавлено " + res.added + ", пропущено " + res.skipped, null);
    }).catch(failSnack);
    refreshSoon();
  }
  function commitRename(sid) {
    var inp = el("viewRoster").querySelector('.rrow input[data-edit="1"]');
    var v = inp ? inp.value.trim() : "";
    if (!v) { renderAll(); return; }   // пустое имя — правка не применяется
    state.editingId = null;
    JStore.renameStudent(state.group, sid, v).catch(failSnack);
    refreshSoon();
  }
  function onCfgSave() {
    var owner = el("cfgOwner").value.trim();
    var repo = el("cfgRepo").value.trim();
    var meta = JStore.state().meta;
    /* токен: срезать ВСЕ пробельные символы — вставка с переносами строк
       внутри (типовая потеря при переносе на телефон) ломала заголовок */
    var token = el("cfgToken").value.replace(/\s+/g, "") || meta.token || "";
    if (!owner || !repo || !token) { showSnack("Нужны owner, repo и token", null); return; }
    cfgTokenKeep = false;
    JStore.setSyncConfig({ owner: owner, repo: repo, token: token }).then(function () {
      setupOpen = false;
      showSnack("Настройки синхронизации сохранены", null);
    }).catch(function (e) { cfgTokenKeep = true; failSnack(e); });
  }
  function onCfgOff() {
    JStore.setSyncConfig(null).then(function () {
      setupOpen = false;
      showSnack("Синхронизация отключена", null);
    }).catch(failSnack);
  }

  /* ---------- события ---------- */
  function bindEvents() {
    el("viewSeg").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || !b.dataset.view || b.dataset.view === state.view) return;
      state.view = b.dataset.view;
      state.editingId = null;
      closeSheets(true);
      save(); renderAll();
      /* смена раздела — новый контекст: страница возвращается наверх
         (заодно sticky-шапка не мешает fullPage-скриншотам секций) */
      window.scrollTo(0, 0);
    });
    el("weekSeg").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || !b.dataset.week) return;
      state.week = parseInt(b.dataset.week, 10);
      save(); renderAll();
    });
    el("weekPrev").addEventListener("click", function () {
      if (state.week > 1) { state.week--; save(); renderAll(); }
    });
    el("weekNext").addEventListener("click", function () {
      if (state.week < MAX_WEEK) { state.week++; save(); renderAll(); }
    });
    el("dayTabs").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || !b.dataset.day) return;
      state.day = parseInt(b.dataset.day, 10);
      if (state.view !== "marks") state.view = "marks";
      save(); renderAll();
    });
    el("backToday").addEventListener("click", function () {
      state.week = TODAY.week;
      state.day = TODAY.day;
      save(); renderAll();
    });

    /* пилюля недель: сворачивает/разворачивает ленту (как в index.html) */
    el("weekPill").addEventListener("click", function () {
      var row = el("weekRow");
      row.hidden = !row.hidden;
      el("weekPill").setAttribute("aria-expanded", row.hidden ? "false" : "true");
    });
    document.addEventListener("click", function (e) {
      var row = el("weekRow");
      if (row.hidden) return;
      if (row.contains(e.target) || el("weekPill").contains(e.target)) return;
      row.hidden = true;
      el("weekPill").setAttribute("aria-expanded", "false");
    });

    /* вид «Отметки»: делегирование на секции */
    el("viewMarks").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      var row;
      if (btn) {
        if (btn.classList.contains("pc-all")) {
          onAllWere(parseInt(btn.dataset.ti, 10));
          return;
        }
        if (btn.classList.contains("pc-fold")) {
          var ti = parseInt(btn.dataset.ti, 10);
          /* кнопка существует только при отмеченных, чей дефолт — свернуто */
          var cur = state.folded[ti] === undefined ? true : state.folded[ti];
          state.folded[ti] = !cur;
          save(); renderAll();
          return;
        }
        if (btn.classList.contains("pill")) {
          row = btn.closest(".strow");
          if (!row) return;
          var ti = parseInt(row.dataset.ti, 10), sid = row.dataset.sid;
          if (btn.dataset.act === "p") onMarkPresent(ti, sid);
          else openReasonSheet(ti, sid);
          return;
        }
        return;
      }
      row = e.target.closest(".strow");
      /* клик по строке отсутствующего — сменить причину, присутствующего — та же
         шторка (там есть «Убрать отметку», без тапа «Не был») (02) */
      if (row && (row.classList.contains("st-a") || row.classList.contains("st-p"))) {
        openReasonSheet(parseInt(row.dataset.ti, 10), row.dataset.sid);
      }
    });

    /* шторка причины */
    el("reasonSheet").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.classList.contains("rsn") && b.dataset.r) { applyAbsence(b.dataset.r); return; }
      if (b.id === "rsnGo") {
        var v = el("rsnText").value.trim();
        if (!v) { el("rsnText").focus(); return; }
        applyAbsence(v);
        return;
      }
      if (b.id === "rsnClear") clearCurrentMark();
    });
    el("rsnText").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var v = el("rsnText").value.trim();
      if (v) applyAbsence(v);
    });

    /* диалог удаления */
    el("delSheet").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var sid = pendingDel;
      closeSheets();
      if (sid && b.id === "delKeep") { JStore.deleteStudent(state.group, sid, "keep").catch(failSnack); refreshSoon(); }
      else if (sid && b.id === "delWipe") { JStore.deleteStudent(state.group, sid, "wipe").catch(failSnack); refreshSoon(); }
    });

    /* вид «Список» */
    el("viewRoster").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var row = b.closest(".rrow");
      if (row && b.dataset.act === "del") {
        pendingDel = row.dataset.sid;
        el("delSub").textContent = displayName(studentName(state.group, pendingDel)) +
          ". Оставить в истории – отметки сохранятся; стереть полностью – отметки удалятся.";
        openSheet(el("delSheet"));
        return;
      }
      if (row && b.dataset.act === "edit") {
        state.editingId = row.dataset.sid;
        renderAll();
        var inp = el("viewRoster").querySelector('.rrow input[data-edit="1"]');
        if (inp) inp.focus();
        return;
      }
      if (row && b.dataset.act === "save") { commitRename(row.dataset.sid); return; }
      if (row && b.dataset.act === "cancel") { state.editingId = null; renderAll(); return; }
      if (b.id === "addGo") { onAddStudent(); return; }
      if (b.id === "importGo") { onPasteImport(); return; }
      if (b.id === "cfgSave") { onCfgSave(); return; }
      if (b.id === "cfgOff") { onCfgOff(); }
    });
    el("viewRoster").addEventListener("keydown", function (e) {
      var t = e.target;
      if (!t || !t.dataset) return;
      if (e.key === "Enter" && t.dataset.edit) {
        e.preventDefault();
        var row = t.closest(".rrow");
        if (row) commitRename(row.dataset.sid);
      } else if (e.key === "Enter" && t.id === "addName") {
        e.preventDefault();
        onAddStudent();
      } else if (e.key === "Escape" && t.dataset.edit) {
        state.editingId = null;
        renderAll();
      }
    });

    /* вид «Сводка»: тап по ячейке -> день, тап по строке -> даты */
    el("viewStats").addEventListener("click", function (e) {
      var cell = e.target.closest(".heat-cell[data-date]");
      if (cell) {
        var wd = weekDayOfDate(cell.dataset.date);
        if (wd.week >= 1 && wd.week <= MAX_WEEK && wd.day <= 5 && dayInSemester(wd.week, wd.day)) {
          state.week = wd.week;
          state.day = wd.day;
          state.view = "marks";
          save(); renderAll();
        }
        return;
      }
      var row = e.target.closest(".skip-row");
      if (row) {
        var d = row.querySelector(".skip-dates");
        if (d) d.hidden = !d.hidden;
      }
    });

    /* футер: экспорт/импорт/синхронизация */
    el("exportBtn").addEventListener("click", function () {
      var blob = new Blob([JStore.exportJSON()], { type: "application/json;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "journal-307-backup.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    });
    el("importBtn").addEventListener("click", function () { el("importFile").click(); });
    el("importFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        JStore.importJSON(String(r.result)).then(function (res) {
          showSnack("Импортировано: отметок " + res.cells + ", студентов " + res.roster, null);
        }).catch(failSnack);
      };
      r.onerror = function () { showSnack("Не удалось прочитать файл", null); };
      r.readAsText(f);
      this.value = "";
    });
    el("syncCfg").addEventListener("click", function () {
      setupOpen = !setupOpen;
      if (setupOpen && state.view !== "roster") {
        state.view = "roster";
        state.editingId = null;
      }
      save(); renderAll();
    });

    /* бейдж: ошибка -> подробности, не настроена -> блок настроек */
    el("syncBadge").addEventListener("click", function () {
      if (!storeReady) return;
      var st = JStore.syncStatus();
      if (st.state === "error") {
        showSnack(st.detail || "Ошибка синхронизации", null);
      } else if (st.state === "unset") {
        setupOpen = true;
        if (state.view !== "roster") state.view = "roster";
        save(); renderAll();
      }
    });

    /* тема — как в app.js: dataset + meta + хранилище основного сайта */
    el("themeBtn").addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      syncThemeMeta();
      try {
        var o = {};
        try { o = JSON.parse(localStorage.getItem(THEME_KEY) || "{}") || {}; } catch (e1) {}
        o.theme = next;
        localStorage.setItem(THEME_KEY, JSON.stringify(o));
      } catch (e2) { /* приватный режим */ }
    });

    /* снекбар */
    el("snackUndo").addEventListener("click", function () {
      var fn = snackUndoFn;
      hideSnack();
      if (fn) {
        Promise.resolve().then(function () {
          var r = fn();
          /* renderAll после мутаций, поставленных fn в этом же микротаске */
          refreshSoon();
          return r;
        }).catch(failSnack);
      }
    });

    /* шторки: клик по фону и Escape закрывают */
    el("sheetBd").addEventListener("click", function () { closeSheets(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openSheetEl) closeSheets();
    });

    /* ---------- свайп влево-вправо: смена дня (порт из app.js) ---------- */
    (function () {
      var sx = 0, sy = 0, tracking = false;
      var mn = el("main");
      mn.addEventListener("touchstart", function (e) {
        if (e.touches.length !== 1) { tracking = false; return; }
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        tracking = true;
      }, { passive: true });
      mn.addEventListener("touchend", function (e) {
        if (!tracking) return;
        tracking = false;
        if (state.view !== "marks") return;
        var t = e.changedTouches[0];
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < 60 || Math.abs(dy) >= Math.abs(dx)) return;
        var dir = dx < 0 ? 1 : -1;   // влево — следующий день
        var nd = state.day + dir, nw = state.week;
        if (nd > 5) { nd = 0; if (nw >= MAX_WEEK) return; nw++; }
        else if (nd < 0) { nd = 5; if (nw <= 1) return; nw--; }
        if (!dayInSemester(nw, nd)) return;
        state.day = nd;
        state.week = nw;
        save(); renderAll();
      }, { passive: true });
    })();

    /* «Сегодня» при пробуждении PWA — как в app.js */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refreshToday();
    });
    window.addEventListener("pageshow", refreshToday);
    window.addEventListener("online", updateSyncBadge);
    window.addEventListener("offline", updateSyncBadge);

    /* любая мутация store (в т.ч. слияние синхры) перестраивает экран */
    JStore.on(function () { renderAll(); });
  }

  /* ---------- «Сегодня» ---------- */
  function refreshToday() {
    var t = todayInfo();
    if (t.rawWeek !== TODAY.rawWeek || t.day !== TODAY.day) {
      var wasOnToday = state.week === TODAY.week && state.day === TODAY.day;
      TODAY = t;
      if (wasOnToday && t.inSemester && t.day <= 5) {
        state.week = t.week;
        state.day = t.day;
        save();
      }
      renderAll();
    }
    updateSyncBadge();
  }

  /* ---------- запуск ---------- */
  bindEvents();
  /* мгновенный рендер по data.js (ростер подтянется после ready) — карточки дня
     видны сразу, до открытия IDB */
  renderAll();
  JStore.ready().then(function () {
    storeReady = true;
    renderAll();
  });

  /* service worker — как в app.js:846-848 */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

})();
