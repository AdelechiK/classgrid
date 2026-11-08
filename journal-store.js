/* Расписание 307 — журнал посещаемости: ядро данных (store).
   Спеки: .qa/journal-spec/00-model.md, 01-store-api.md. Без DOM, без модулей,
   ES5-стиль. Глобал JStore (window/globalThis). Сеть — только через _setNet/fetch. */
"use strict";

(function () {

  /* ---------- утилиты ---------- */

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

  /* Детерминированный JSON: рекурсивная сортировка ключей объектов по возрастанию,
     порядок массивов сохраняется — стабильные диффы state.json. */
  function stableValue(v) {
    var i, out, keys, k;
    if (v === null || typeof v !== "object") return v;
    if (Object.prototype.toString.call(v) === "[object Array]") {
      out = [];
      for (i = 0; i < v.length; i++) out[i] = stableValue(v[i]);
      return out;
    }
    keys = Object.keys(v).sort();
    out = {};
    for (i = 0; i < keys.length; i++) { k = keys[i]; out[k] = stableValue(v[k]); }
    return out;
  }

  function stableStringify(obj) { return JSON.stringify(stableValue(obj)); }

  /* "d_"+8 байт hex (deviceId) и "s_"+hex (id студента) — один генератор. */
  function genId(prefix) {
    var bytes = null, i, s = "";
    if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
      try {
        bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
      } catch (e) { bytes = null; }
    }
    if (!bytes) {
      bytes = [];
      for (i = 0; i < 8; i++) bytes.push(Math.floor(Math.random() * 256));
    }
    for (i = 0; i < 8; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return prefix + s;
  }

  function mkErr(msg, status) {
    var e = new Error(msg);
    if (status) e.status = status;
    return e;
  }

  /* Ключ клетки: "<g>|<date>|<ti>|<sid>" (00-model). */
  function cellKey(g, date, ti, sid) { return g + "|" + date + "|" + ti + "|" + sid; }

  function isCellKeyOf(k, g, sid) {
    var prefix = g + "|", suffix = "|" + sid;
    return k.indexOf(prefix) === 0 && k.slice(k.length - suffix.length) === suffix;
  }

  /* ---------- состояние в памяти ---------- */

  var _cells = {};                                  // { "<key>": {v,r,t,dv} }
  var _roster = { "А": [], "Б": [] };               // { "А": [{id,name,t,del?,wipe?}] }
  var _meta = {};                                   // { deviceId, owner, repo, token, lastSyncSha, lastPushAt }

  var _adapter = null;
  var _readyPromise = null;
  var _listeners = [];
  var _online = (typeof navigator !== "undefined" && navigator.onLine === false) ? false : true;
  var _netFn = null;                                // подмена сети (тесты); null = настоящий fetch
  var _inCycle = false, _cyclePromise = null;
  var _debounceTimer = null, _backoffTimer = null;
  var _lastResult = null;                           // {state, detail} исхода последнего цикла
  var _consecutiveErrors = 0;
  var _lastSyncCells = null, _lastSyncRoster = null; // снапшот на момент последнего успешного пуша

  var GROUPS = ["А", "Б"];
  var DEBOUNCE_MS = 3000, TIMEOUT_MS = 10000, BACKOFF1_MS = 60000, BACKOFF2_MS = 300000;

  function isConfigured() { return !!(_meta.token && _meta.owner && _meta.repo); }

  function deviceId() { return _meta.deviceId || ""; }   // автор правки для dv

  /* ---------- адаптеры хранилища ---------- */

  function memoryAdapter() {
    var p = {}, m = {};
    return {
      get: function (k) { return Promise.resolve(hasOwn(p, k) ? deepCopy(p[k]) : null); },
      put: function (k, v) { p[k] = deepCopy(v); return Promise.resolve(); },
      mirrorGet: function (k) { return Promise.resolve(hasOwn(m, k) ? deepCopy(m[k]) : null); },
      mirrorPut: function (k, v) { m[k] = deepCopy(v); return Promise.resolve(); }
    };
  }

  /* Браузерный: get/put — IDB (база journal307, стор kv), mirror* — localStorage
     "journal307:v1" целиком {cells, roster, meta}. Нет IDB — работаем на зеркале. */
  function browserAdapter() {
    var LS_KEY = "journal307:v1";
    var idbOk = typeof indexedDB !== "undefined";
    var dbPromise = null;

    function openDb() {
      if (!idbOk) return Promise.reject(mkErr("IndexedDB недоступна"));
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        var req;
        try { req = indexedDB.open("journal307", 1); }
        catch (e) { idbOk = false; reject(e); return; }
        req.onupgradeneeded = function () {
          try { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); }
          catch (e2) { /* стор мог уже существовать */ }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { idbOk = false; reject(req.error || mkErr("IndexedDB не открылась")); };
        req.onblocked = function () { /* ждём освобождения; таймаут не критичен */ };
      });
      dbPromise.catch(function () { idbOk = false; });
      return dbPromise;
    }

    function idbGet(key) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx, st, rq;
          try {
            tx = db.transaction("kv", "readonly");
            st = tx.objectStore("kv");
            rq = st.get(key);
          } catch (e) { idbOk = false; reject(e); return; }
          rq.onsuccess = function () { resolve(rq.result === undefined ? null : rq.result); };
          rq.onerror = function () { reject(rq.error || mkErr("IDB get failed")); };
        });
      });
    }

    function idbPut(key, value) {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx, st;
          try {
            tx = db.transaction("kv", "readwrite");
            st = tx.objectStore("kv");
            st.put(value, key);
          } catch (e) { idbOk = false; reject(e); return; }
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error || mkErr("IDB put failed")); };
          tx.onabort = function () { reject(tx.error || mkErr("IDB put aborted")); };
        });
      });
    }

    function lsRead() {
      try {
        var raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }  // битое зеркало трактуем как пустое, не чистим
    }
    function lsWrite(obj) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) { /* переполнение/приватный режим */ }
    }
    function mirrorRead(key) {
      var o = normMirrorObj(lsRead());
      return (o && o[key] !== undefined) ? o[key] : null;
    }
    function mirrorWrite(key, value) {
      var o = normMirrorObj(lsRead());
      o[key] = value;
      lsWrite(o);
    }

    return {
      get: function (key) {
        if (!idbOk) return Promise.resolve(mirrorRead(key));
        return idbGet(key).catch(function () { return mirrorRead(key); });
      },
      put: function (key, value) {
        if (!idbOk) { mirrorWrite(key, value); return Promise.resolve(); }
        return idbPut(key, value).catch(function () { idbOk = false; mirrorWrite(key, value); });
      },
      mirrorGet: function (key) { return Promise.resolve(mirrorRead(key)); },
      mirrorPut: function (key, value) { mirrorWrite(key, value); return Promise.resolve(); }
    };
  }

  /* Примитив или массив в зеркале (порча руками, сбой записи) не должен
     ронять lsWrite — такой контент отбрасывается, зеркало самолечится
     следующей мутацией (данные страхует IDB). */
  function normMirrorObj(o) {
    if (!o || typeof o !== "object") return {};
    if (Object.prototype.toString.call(o) === "[object Array]") return {};
    return o;
  }

  function defaultAdapter() {
    if (typeof window !== "undefined" && typeof indexedDB !== "undefined") return browserAdapter();
    return memoryAdapter();
  }
  _adapter = defaultAdapter();

  /* Сначала IDB, затем зеркало; сбой primary не роняет мутацию — зеркало страхует.
     Адаптер фиксируется на момент ЗАПРОСА записи: безаваит-хвост persistMap
     (adoptSynced) исполняется микротасками позже и при чтении _adapter в момент
     записи догонял уже подменённый адаптер (_setAdapter/_resetForTests) —
     отложенная meta-запись предыдущего состояния утекала в новый (тест 14). */
  function persistMap(key, value) {
    var ad = _adapter;
    return Promise.resolve().then(function () { return ad.put(key, value); })
      .catch(function () { return null; })
      .then(function () {
        return Promise.resolve().then(function () { return ad.mirrorPut(key, value); })
          .catch(function () { return null; });
      });
  }

  function persistState() {
    return persistMap("cells", _cells).then(function () { return persistMap("roster", _roster); });
  }

  function notify() {
    var i;
    for (i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) { /* слушатель не должен ломать store */ }
    }
  }

  /* Общий хвост мутации: память -> IDB -> зеркало -> on() -> scheduleSync(). */
  function afterMutation(mapKey, value) {
    return persistMap(mapKey, value).then(function () {
      notify();
      scheduleSync();
    });
  }

  /* ---------- нормализация и слияние (00-model) ---------- */

  function normCells(v) {
    var out = {}, k;
    if (v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object Array]") {
      for (k in v) if (hasOwn(v, k)) out[k] = v[k];
    }
    return out;
  }

  function normRoster(v) {
    var out = { "А": [], "Б": [] }, gi, arr, i, list;
    if (v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object Array]") {
      for (gi = 0; gi < GROUPS.length; gi++) {
        arr = v[GROUPS[gi]];
        if (Object.prototype.toString.call(arr) === "[object Array]") {
          list = [];
          for (i = 0; i < arr.length; i++) {
            if (arr[i] && typeof arr[i] === "object" && typeof arr[i].id === "string") list.push(arr[i]);
          }
          out[GROUPS[gi]] = list;
        }
      }
    }
    return out;
  }

  function normMeta(v) {
    var out = {}, k;
    if (v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object Array]") {
      for (k in v) if (hasOwn(v, k)) out[k] = v[k];
    }
    return out;
  }

  /* Конфликт клеток: свежий t; при равных t — детерминизм по dv (max). */
  function mergeCell(a, b) {
    if (!a) return b;
    if (!b) return a;
    var at = (a && typeof a.t === "number") ? a.t : 0;
    var bt = (b && typeof b.t === "number") ? b.t : 0;
    if (at !== bt) return at > bt ? a : b;
    return (a.dv || "") >= (b.dv || "") ? a : b;
  }

  /* Дубликат ростера: запись с большим t целиком; при равных t —
     детерминизм по стабильной строке (аргументы не должны влиять). */
  function mergeEntry(x, y) {
    if (!x) return y;
    if (!y) return x;
    var xt = (x && typeof x.t === "number") ? x.t : 0;
    var yt = (y && typeof y.t === "number") ? y.t : 0;
    if (xt !== yt) return xt > yt ? x : y;
    return stableStringify(x) >= stableStringify(y) ? x : y;
  }

  /* Порядок: как у первой группы, новые из второй — в конец. */
  function mergeRoster(aList, bList) {
    var a = Object.prototype.toString.call(aList) === "[object Array]" ? aList : [];
    var b = Object.prototype.toString.call(bList) === "[object Array]" ? bList : [];
    var order = [], byId = {}, i, e, id;
    for (i = 0; i < a.length; i++) {
      e = a[i];
      id = e && e.id;
      if (id === undefined || id === null || hasOwn(byId, id)) continue;
      byId[id] = e;
      order.push(id);
    }
    for (i = 0; i < b.length; i++) {
      e = b[i];
      id = e && e.id;
      if (id === undefined || id === null) continue;
      if (!hasOwn(byId, id)) { byId[id] = e; order.push(id); }
      else byId[id] = mergeEntry(byId[id], e);
    }
    var out = [];
    for (i = 0; i < order.length; i++) out.push(byId[order[i]]);
    return out;
  }

  /* Wipe стирает прошлое: клетки студента с t <= wipe удаляются,
     поставленные после wipe (другим устройством) живут. */
  function applyWipe(cells, roster) {
    var gi, i, k, e, list;
    for (gi = 0; gi < GROUPS.length; gi++) {
      list = roster[GROUPS[gi]] || [];
      for (i = 0; i < list.length; i++) {
        e = list[i];
        if (!e || typeof e.wipe !== "number") continue;
        for (k in cells) {
          if (hasOwn(cells, k) && isCellKeyOf(k, GROUPS[gi], e.id) &&
              cells[k] && typeof cells[k].t === "number" && cells[k].t <= e.wipe) {
            delete cells[k];
          }
        }
      }
    }
  }

  /* Чистая функция: объединение карт, конфликт — более свежий t. */
  function mergeStates(localState, remoteState) {
    var l = localState || {}, r = remoteState || {};
    var lc = normCells(l.cells), rc = normCells(r.cells);
    var cells = {}, k;
    for (k in lc) if (hasOwn(lc, k)) cells[k] = lc[k];
    for (k in rc) if (hasOwn(rc, k)) cells[k] = mergeCell(cells[k], rc[k]);
    var ln = normRoster(l.roster), rn = normRoster(r.roster);
    var roster = {
      "А": mergeRoster(ln["А"], rn["А"]),
      "Б": mergeRoster(ln["Б"], rn["Б"])
    };
    applyWipe(cells, roster);
    return { cells: cells, roster: roster };
  }

  /* meta: primary, недостающие поля — fallback mirror. */
  function mergeMeta(primary, mirror) {
    var out = {}, k;
    for (k in mirror) if (hasOwn(mirror, k)) out[k] = mirror[k];
    for (k in primary) if (hasOwn(primary, k)) out[k] = primary[k];
    return out;
  }

  /* ---------- pending ---------- */

  /* Число правок после последнего успешного пуша: клетки, которых нет
     в снапшоте или с более свежим t; удаления клеток; изменившиеся ростеры. */
  function pendingCount() {
    var n = 0, k, i, c, s;
    var snap = _lastSyncCells;
    for (k in _cells) {
      if (!hasOwn(_cells, k)) continue;
      c = _cells[k];
      s = snap ? snap[k] : undefined;
      if (!s) n += 1;
      else if (typeof c.t === "number" && typeof s.t === "number" && c.t !== s.t) { if (c.t > s.t) n += 1; }
      else if (stableStringify(c) !== stableStringify(s)) n += 1;
    }
    if (snap) {
      for (k in snap) if (hasOwn(snap, k) && !hasOwn(_cells, k)) n += 1;  // удалённые клетки
    }
    if (!_lastSyncRoster) {
      for (i = 0; i < GROUPS.length; i++) {
        if ((_roster[GROUPS[i]] || []).length > 0) n += 1;
      }
    } else {
      for (i = 0; i < GROUPS.length; i++) {
        if (stableStringify(_roster[GROUPS[i]] || []) !== stableStringify(_lastSyncRoster[GROUPS[i]] || [])) n += 1;
      }
    }
    return n;
  }

  /* ---------- boot ---------- */

  function ready() {
    if (_readyPromise) return _readyPromise;
    _readyPromise = Promise.resolve()
      .then(function () {
        return Promise.all([_adapter.get("cells"), _adapter.get("roster"), _adapter.get("meta")]);
      })
      .then(function (prim) {
        return Promise.all([_adapter.mirrorGet("cells"), _adapter.mirrorGet("roster"), _adapter.mirrorGet("meta")])
          .then(function (mir) { return { prim: prim, mir: mir }; });
      })
      .then(function (src) {
        /* Защита от частичной очистки (Safari выносит одно из хранилищ):
           сливаем primary и зеркало по правилам 00 и пишем слитое в оба. */
        var local = { cells: normCells(src.prim[0]), roster: normRoster(src.prim[1]) };
        var mirrored = { cells: normCells(src.mir[0]), roster: normRoster(src.mir[1]) };
        var merged = mergeStates(local, mirrored);
        _cells = merged.cells;
        _roster = merged.roster;
        _meta = mergeMeta(normMeta(src.prim[2]), normMeta(src.mir[2]));
        if (!_meta.deviceId) _meta.deviceId = genId("d_");
        return persistMap("cells", _cells)
          .then(function () { return persistMap("roster", _roster); })
          .then(function () { return persistMap("meta", _meta); })
          .then(function () { notify(); });
      })
      .then(function () {
        /* триггер boot: если синхра настроена — сразу цикл */
        if (isConfigured() && _online && !_inCycle) startCycle();
      })
      .catch(function () {
        /* хранилища недоступны целиком: данные из них не удаляли,
           работаем с пустой памятью и новым deviceId */
        _cells = {};
        _roster = { "А": [], "Б": [] };
        _meta = { deviceId: genId("d_") };
      });
    return _readyPromise;
  }

  /* ---------- отметки ---------- */

  function getMark(g, date, ti, sid) {
    var c = _cells[cellKey(g, date, ti, sid)];
    /* надгробие (v="d", снятая отметка) снаружи не видно — UI/статистика видят null */
    if (!c || c.v === "d") return null;
    return c;
  }

  function setMark(g, date, ti, sid, v, r) {
    return Promise.resolve().then(function () {
      if (v !== "p" && v !== "a") throw mkErr('setMark: v должен быть "p" или "a"');
      var cell = {
        v: v,
        r: v === "a" ? (r === undefined || r === null ? null : String(r)) : null,
        t: Date.now(),
        dv: deviceId()
      };
      _cells[cellKey(g, date, ti, sid)] = cell;
      return afterMutation("cells", _cells);
    });
  }

  /* НАДГРОБИЕ вместо удаления: если ключ стереть, локальной клетки нет —
     слияние вернёт живую отметку из облака (resurrection, живой баг 08.11).
     Повторная setMark поверх надгробия возвращает отметку — новый t побеждает. */
  function clearMark(g, date, ti, sid) {
    return Promise.resolve().then(function () {
      _cells[cellKey(g, date, ti, sid)] = {
        v: "d", r: null, t: Date.now(), dv: deviceId()
      };
      return afterMutation("cells", _cells);
    });
  }

  /* Одним t на всю партию; снимок прежних клеток — вызывающему (пакетная отмена). */
  function markAllPresent(g, date, ti, sids) {
    return Promise.resolve().then(function () {
      var arr = Object.prototype.toString.call(sids) === "[object Array]" ? sids : [];
      var t = Date.now(), prev = {}, i, k, old;
      for (i = 0; i < arr.length; i++) {
        k = cellKey(g, date, ti, arr[i]);
        old = hasOwn(_cells, k) ? _cells[k] : null;
        /* надгробие в снимке = null, как видит getMark: иначе вызывающий вернул бы
           {v:"d"} через setMark, который принимает только p/a */
        prev[k] = (old && old.v !== "d")
          ? { v: old.v, r: old.r === undefined ? null : old.r, t: old.t, dv: old.dv }
          : null;
      }
      for (i = 0; i < arr.length; i++) {
        k = cellKey(g, date, ti, arr[i]);
        _cells[k] = { v: "p", r: null, t: t, dv: deviceId() };
      }
      return afterMutation("cells", _cells).then(function () { return { prev: prev }; });
    });
  }

  /* ---------- ростер ---------- */

  function rosterList(g) {
    var arr = _roster[g];
    return arr ? arr.slice() : [];
  }

  function activeStudents(g) {
    return rosterList(g)
      .filter(function (e) { return !e.del && !e.wipe; })
      .map(function (e) { return { id: e.id, name: e.name }; });
  }

  function findStudent(g, id) {
    var list = _roster[g] || [], i;
    for (i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function addStudent(g, fullName) {
    return Promise.resolve().then(function () {
      var name = String(fullName === undefined || fullName === null ? "" : fullName).trim();
      if (!name) throw mkErr("addStudent: пустое имя");
      if (!_roster[g]) _roster[g] = [];
      var entry = { id: genId("s_"), name: name, t: Date.now() };
      _roster[g].push(entry);
      return afterMutation("roster", _roster).then(function () { return entry.id; });
    });
  }

  function renameStudent(g, id, newName) {
    return Promise.resolve().then(function () {
      var e = findStudent(g, id);
      if (!e) throw mkErr("renameStudent: студент не найден");
      var name = String(newName === undefined || newName === null ? "" : newName).trim();
      if (!name) throw mkErr("renameStudent: пустое имя");
      e.name = name;
      e.t = Date.now();
      return afterMutation("roster", _roster);
    });
  }

  function deleteStudent(g, id, mode) {
    return Promise.resolve().then(function () {
      var e = findStudent(g, id);
      if (!e) throw mkErr("deleteStudent: студент не найден");
      var ts = Date.now();
      e.del = ts;   // tombstone: «выбыл, история сохранена»
      e.t = ts;
      var wiped = mode === "wipe";
      if (wiped) {
        e.wipe = ts;
        var k;
        for (k in _cells) {
          if (hasOwn(_cells, k) && isCellKeyOf(k, g, id)) delete _cells[k];
        }
      }
      var done = persistMap("roster", _roster);
      if (wiped) done = done.then(function () { return persistMap("cells", _cells); });
      return done.then(function () {
        notify();
        scheduleSync();
      });
    });
  }

  /* Строки trim, пустые мимо (не в skipped); точный дубликат имени среди
     активных = skip; каждый добавленный — свой id. */
  function importRoster(g, lines) {
    return Promise.resolve().then(function () {
      var arr = Object.prototype.toString.call(lines) === "[object Array]" ? lines : [];
      if (!_roster[g]) _roster[g] = [];
      var list = _roster[g];
      var byName = {}, i, e;
      for (i = 0; i < list.length; i++) {
        e = list[i];
        if (e && !e.del && !e.wipe) byName[e.name] = true;
      }
      var added = 0, skipped = 0;
      for (i = 0; i < arr.length; i++) {
        var name = String(arr[i] === undefined || arr[i] === null ? "" : arr[i]).trim();
        if (!name) continue;
        if (byName[name]) { skipped += 1; continue; }
        var entry = { id: genId("s_"), name: name, t: Date.now() };
        list.push(entry);
        byName[name] = true;
        added += 1;
      }
      return afterMutation("roster", _roster).then(function () {
        return { added: added, skipped: skipped };
      });
    });
  }

  /* ---------- экспорт/импорт ---------- */

  /* { v:1, cells, roster } без meta — токен и deviceId не утекают. */
  function exportJSON() {
    return stableStringify({ v: 1, cells: _cells, roster: _roster });
  }

  function importJSON(str) {
    return Promise.resolve().then(function () {
      var data;
      try { data = JSON.parse(String(str)); }
      catch (e) { throw mkErr("importJSON: некорректный JSON"); }
      if (!data || typeof data !== "object" ||
          Object.prototype.toString.call(data) === "[object Array]" || data.v !== 1) {
        throw mkErr("importJSON: ожидается {v:1, cells, roster}");
      }
      var incoming = { cells: normCells(data.cells), roster: normRoster(data.roster) };
      var counts = {
        cells: Object.keys(incoming.cells).length,
        roster: incoming.roster["А"].length + incoming.roster["Б"].length
      };
      var merged = mergeStates({ cells: _cells, roster: _roster }, incoming);
      _cells = merged.cells;
      _roster = merged.roster;
      return persistState().then(function () {
        notify();
        scheduleSync();
        return counts;
      });
    });
  }

  /* ---------- синхронизация: клиент GitHub Contents API ---------- */

  function apiUrl() {
    /* cache-buster: Safari исполняет no-store в запросах только с 27.0
       (WebKit игнорировал Cache-Control request directives) — уникальный
       параметр URL гарантированно бьёт HTTP-кэш в любом движке. */
    return "https://api.github.com/repos/" + encodeURIComponent(_meta.owner) + "/" +
      encodeURIComponent(_meta.repo) + "/contents/state.json?_=" + Date.now();
  }

  function ghHeaders(withBody) {
    var h = {
      "Authorization": "Bearer " + _meta.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (withBody) h["Content-Type"] = "application/json";
    return h;
  }

  function b64encode(s) {
    if (typeof btoa !== "function") throw mkErr("btoa недоступен");
    return btoa(unescape(encodeURIComponent(s)));
  }

  function b64decode(s) {
    if (typeof atob !== "function") throw mkErr("atob недоступен");
    return decodeURIComponent(escape(atob(String(s).replace(/\s+/g, ""))));
  }

  /* Таймаут 10 c через AbortController (01-store-api). cache: "no-store" обязателен:
     GitHub отдаёт Contents API с Cache-Control: max-age=60, и Chromium после 409
     возвращал GET из HTTP-кэша с протухшим sha — все ретраи слияния 409-ились
     (живой кейс 06.11, второе устройство не могло допушить клетку). */
  function fetchTimeout(method, url, body) {
    var opts = { method: method, headers: ghHeaders(!!body), cache: "no-store" };
    if (body) opts.body = body;
    var timer = null;
    if (typeof AbortController !== "undefined") {
      var ac = new AbortController();
      opts.signal = ac.signal;
      timer = setTimeout(function () { try { ac.abort(); } catch (e) { /* уже завершён */ } }, TIMEOUT_MS);
    }
    return Promise.resolve()
      .then(function () {
        if (typeof fetch !== "function") throw mkErr("fetch недоступен");
        return fetch(url, opts);
      })
      .then(
        function (res) { if (timer) clearTimeout(timer); return res; },
        function (e) {
          if (timer) clearTimeout(timer);
          if (e && e.name === "AbortError") throw mkErr("Таймаут " + (TIMEOUT_MS / 1000) + " с");
          if (e && e.name === "TypeError") throw mkErr("Сеть недоступна: " + (e.message || "TypeError"));
          throw e;
        }
      );
  }

  /* 404 = файла ещё нет; ответ -> { sha, json }. */
  function realGet() {
    return fetchTimeout("GET", apiUrl(), null).then(function (res) {
      if (res.status === 404) return { sha: null, json: null };
      if (res.status !== 200) throw mkErr("HTTP " + res.status, res.status);
      return res.json().then(function (data) {
        var json = null;
        if (data && typeof data.content === "string" && data.content.length > 0 &&
            (data.encoding === "base64" || !data.encoding)) {
          json = JSON.parse(b64decode(data.content));
        }
        return { sha: (data && data.sha) || null, json: json };
      }, function () { throw mkErr("Некорректный ответ GET"); });
    });
  }

  function realPut(content, sha) {
    var bodyObj = { message: "journal: " + pendingCount() + " правок, " + new Date().toISOString(),
                    content: b64encode(content) };
    if (sha) bodyObj.sha = sha;   // sha обязателен только при обновлении существующего файла
    return fetchTimeout("PUT", apiUrl(), JSON.stringify(bodyObj)).then(function (res) {
      if (res.status === 200 || res.status === 201) {
        return res.json().then(function (data) {
          var newSha = data && ((data.content && data.content.sha) || data.sha || (data.commit && data.commit.sha)) || null;
          return { sha: newSha };
        }, function () { throw mkErr("Некорректный ответ PUT"); });
      }
      throw mkErr("HTTP " + res.status, res.status);
    });
  }

  /* Вся сеть — только через этот вход (подменяется в тестах). */
  function netGet() {
    if (typeof _netFn === "function") {
      return Promise.resolve().then(function () { return _netFn({ method: "get" }); });
    }
    return realGet();
  }

  function netPut(content, sha) {
    if (typeof _netFn === "function") {
      return Promise.resolve().then(function () { return _netFn({ method: "put", content: content, sha: sha }); });
    }
    return realPut(content, sha);
  }

  function fail(e) {
    _lastResult = { state: "error", detail: (e && e.message) || String(e) || "Ошибка сети" };
    _consecutiveErrors += 1;
    if (_backoffTimer) clearTimeout(_backoffTimer);
    _backoffTimer = setTimeout(function () {
      _backoffTimer = null;
      if (isConfigured() && _online && !_inCycle) startCycle();
    }, _consecutiveErrors === 1 ? BACKOFF1_MS : BACKOFF2_MS);
    notify();
  }

  /* Успех: sha запоминаем в meta, pending обнуляется снапшотом, on(). */
  function adoptSynced(sha, pushed) {
    _meta.lastSyncSha = sha || null;
    if (pushed) _meta.lastPushAt = Date.now();
    _lastSyncCells = deepCopy(_cells);
    _lastSyncRoster = deepCopy(_roster);
    _lastResult = { state: "synced", detail: "" };
    _consecutiveErrors = 0;
    persistMap("meta", _meta);
    notify();
  }

  function integrateRemote(r) {
    var changed = false;
    if (r && r.json && typeof r.json === "object") {
      var remoteState = { cells: normCells(r.json.cells), roster: normRoster(r.json.roster) };
      var merged = mergeStates({ cells: _cells, roster: _roster }, remoteState);
      if (stableStringify({ cells: _cells, roster: _roster }) !== stableStringify(merged)) {
        _cells = merged.cells;
        _roster = merged.roster;
        changed = true;
      }
    }
    if (changed) {
      return persistState().then(function () { notify(); return r; });
    }
    return r;
  }

  function pushIfNeeded(r) {
    var content = stableStringify({ v: 1, cells: _cells, roster: _roster });
    var remoteStable = (r && r.json && typeof r.json === "object")
      ? stableStringify({ v: 1, cells: normCells(r.json.cells), roster: normRoster(r.json.roster) })
      : null;
    if (content === remoteStable) {
      /* локальное уже равно удалённому — пуш не нужен, принимаем sha */
      adoptSynced(r && r.sha ? r.sha : (_meta.lastSyncSha || null), false);
      return undefined;
    }
    var putSha = (r && r.sha) ? r.sha : null;
    return Promise.resolve().then(function () { return netPut(content, putSha); })
      .then(function (res) {
        var newSha = res && (res.sha || (res.content && res.content.sha) || (res.commit && res.commit.sha)) ||
          (r && r.sha) || null;
        adoptSynced(newSha, true);
      });
  }

  /* Цикл GET -> merge -> PUT; 409/422 (устаревший sha) — re-GET, re-merge,
     до 3 повторов; прочие ошибки — статус error + бэкофф. */
  function attempt(retriesLeft) {
    return Promise.resolve()
      .then(function () { return netGet(); })
      .then(function (r) { return integrateRemote(r); })
      .then(function (r) { return pushIfNeeded(r); })
      .catch(function (e) {
        if (e && (e.status === 409 || e.status === 422) && retriesLeft > 0) return attempt(retriesLeft - 1);
        fail(e);
        return undefined;   // цикл завершается ошибкой статуса, не исключением
      });
  }

  function startCycle() {
    if (_inCycle) return _cyclePromise;
    if (!isConfigured()) return Promise.resolve();
    if (!_online) { _lastResult = { state: "offline", detail: "" }; return Promise.resolve(); }
    _inCycle = true;
    var done = function () { _inCycle = false; };
    _cyclePromise = attempt(3).then(done, done);
    return _cyclePromise;
  }

  function syncNow() {
    if (!isConfigured()) return Promise.resolve();
    if (!_online) { _lastResult = { state: "offline", detail: "" }; return Promise.resolve(); }
    return startCycle();
  }

  /* Дебаунс 3 c после последней правки; активный цикл не плодится. */
  function scheduleSync() {
    if (!isConfigured()) return;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function () {
      _debounceTimer = null;
      if (!_online) return;   // оффлайн: дождёмся события online
      if (_inCycle) {
        var p = _cyclePromise || Promise.resolve();
        p.then(function () {
          if (isConfigured() && _online && !_inCycle && pendingCount() > 0) startCycle();
        });
        return;
      }
      startCycle();
    }, DEBOUNCE_MS);
  }

  /* Событие online / visible перезапускает синхру, в т.ч. после ошибки. */
  function handleWake() {
    if (!isConfigured() || !_online || _inCycle) return;
    startCycle();
  }

  function setOnlineFlag(v) {
    var was = _online;
    _online = !!v;
    if (!was && _online) handleWake();
  }

  function clearTimers() {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (_backoffTimer) { clearTimeout(_backoffTimer); _backoffTimer = null; }
  }

  function setSyncConfig(cfg) {
    return Promise.resolve().then(function () {
      if (cfg === null || cfg === undefined) {
        /* явное действие юзера: токен стирается с устройства */
        delete _meta.token;
        delete _meta.owner;
        delete _meta.repo;
        delete _meta.lastSyncSha;
        delete _meta.lastPushAt;
        _lastSyncCells = null;
        _lastSyncRoster = null;
        _lastResult = { state: "unset", detail: "" };
        _consecutiveErrors = 0;
        clearTimers();
        return persistMap("meta", _meta).then(function () { notify(); });
      }
      if (typeof cfg !== "object") throw mkErr("setSyncConfig: ожидается объект или null");
      _meta.owner = String(cfg.owner === undefined || cfg.owner === null ? "" : cfg.owner);
      _meta.repo = String(cfg.repo === undefined || cfg.repo === null ? "" : cfg.repo);
      _meta.token = String(cfg.token === undefined || cfg.token === null ? "" : cfg.token);
      delete _meta.lastSyncSha;
      delete _meta.lastPushAt;
      _lastSyncCells = null;
      _lastSyncRoster = null;
      _lastResult = null;
      _consecutiveErrors = 0;
      return persistMap("meta", _meta).then(function () {
        notify();
        return syncNow();   // после установки — немедленный цикл
      });
    });
  }

  function syncStatus() {
    if (!isConfigured()) return { state: "unset", pending: pendingCount(), detail: "" };
    if (!_online) return { state: "offline", pending: pendingCount(), detail: "" };
    if (_lastResult && _lastResult.state === "error") {
      return { state: "error", pending: pendingCount(), detail: _lastResult.detail || "" };
    }
    var p = pendingCount();
    if (p > 0) return { state: "pending", pending: p, detail: "" };
    return { state: "synced", pending: 0, detail: "" };
  }

  /* ---------- публичный объект ---------- */

  var JStore = {
    ready: ready,
    state: function () { return { cells: _cells, roster: _roster, meta: _meta }; },
    deviceId: function () { return _meta.deviceId || ""; },
    on: function (fn) {
      if (typeof fn !== "function") return function () {};
      _listeners.push(fn);
      return function () {
        var i = _listeners.indexOf(fn);
        if (i >= 0) _listeners.splice(i, 1);
      };
    },
    getMark: getMark,
    setMark: setMark,
    clearMark: clearMark,
    markAllPresent: markAllPresent,
    rosterList: rosterList,
    activeStudents: activeStudents,
    addStudent: addStudent,
    renameStudent: renameStudent,
    deleteStudent: deleteStudent,
    importRoster: importRoster,
    syncStatus: syncStatus,
    syncNow: syncNow,
    setSyncConfig: setSyncConfig,
    exportJSON: exportJSON,
    importJSON: importJSON,
    _setAdapter: function (a) {
      if (a && typeof a.get === "function" && typeof a.put === "function" &&
          typeof a.mirrorGet === "function" && typeof a.mirrorPut === "function") {
        _adapter = a;
        _readyPromise = null;
      }
    },
    _setNet: function (fn) { _netFn = (typeof fn === "function") ? fn : null; },
    _setOnline: setOnlineFlag,
    _merge: mergeStates,
    _stable: stableStringify,
    _normMirrorObj: normMirrorObj,
    _resetForTests: function () {
      _cells = {};
      _roster = { "А": [], "Б": [] };
      _meta = {};
      _listeners = [];
      _readyPromise = null;
      _netFn = null;
      _inCycle = false;
      _cyclePromise = null;
      clearTimers();
      _lastResult = null;
      _consecutiveErrors = 0;
      _lastSyncCells = null;
      _lastSyncRoster = null;
      _online = true;
      _adapter = defaultAdapter();
    }
  };

  var ROOT = typeof window !== "undefined" ? window : globalThis;
  ROOT.JStore = JStore;
  if (typeof globalThis !== "undefined" && ROOT !== globalThis) globalThis.JStore = JStore;

  /* Слушатели браузера: online/offline и visible перезапускают синхру. */
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", function () { setOnlineFlag(true); });
    window.addEventListener("offline", function () { setOnlineFlag(false); });
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") handleWake();
    });
  }

})();
