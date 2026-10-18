/* Nyx — the chat page. Talks to a companion relay:
   GET  {relay}/app/history?since=&limit=   → { messages:[{id, ts, from:"human"|"ai", kind, text, meta}] }
   GET  {relay}/app/stream                   → server-sent events, one JSON per "data:" line
   POST {relay}/app/send  {text, side, quote} → { id }
   Every call carries "Authorization: Bearer <key>". */
(function () {
  "use strict";
  var C = window.NYX || {}, RELAY = C.relay || "/relay", AI = C.aiName || "Companion", ME = C.meName || "Me";
  var root = document.documentElement, $ = function (id) { return document.getElementById(id); };
  var key = null, lastId = 0, byId = new Map(), drafts = new Map(), quote = null;
  var log = $("log"), text = $("text"), sendBtn = $("send");

  var paintSide = NyxPaper.paint;
  function flip() {
    var from = root.dataset.side, to = from === "moon" ? "sun" : "moon";
    root.dataset.side = to;
    try { localStorage.setItem("nyx_side", to); } catch (e) {}
    paintSide(); if (window.NyxSplash) NyxSplash(from, to, C.splash);
    if (home) setTimeout(home.refresh, 400);
  }
  $("flip").onclick = flip; $("flip2").onclick = flip;

  /* ---------- home, drawer ---------- */
  var APPS = (C.apps && C.apps.length ? C.apps : [{ id: "chat", en: "Chat", zh: "聊天" }]), home = null;
  function show(which) {
    $("home").hidden = which !== "home"; $("room").hidden = which !== "room";
    if (which === "home") { $("glyph").textContent = root.dataset.side === "moon" ? "\u263E" : "\u2609"; home.refresh(); }
    if (which === "room") { toBottom(); }
    try { history.replaceState(null, "", which === "room" ? "#chat" : "#"); } catch (e) {}
  }
  var hold = null;   // the board and the heart (hold.js), made once the key is in
  function openApp(a) {
    closeDrawer();
    if (a.id === "chat") show("room");
    else if (a.apps && hold) hold.folder(a, openApp);
    else if ((a.id === "board" || a.id === "heart") && hold) hold[a.id]();
    else if (a.href) location.href = a.href;
    else if (a.id === "memory" && hold) hold.memory();
  }
  $("back").onclick = function () { show("home"); };
  function openDrawer() { $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); }
  function closeDrawer() { $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); }
  $("menu").onclick = openDrawer; $("drawer").querySelector(".sh").onclick = closeDrawer;
  $("drawerTitle").textContent = C.title || "Nyx"; $("homeTitle").textContent = (C.title || "Nyx").toUpperCase();
  // the drawer, as in Shoreless: a line icon on each row; a folder becomes a small clay heading with its rooms under it
  var IC = { chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/>',
    listen: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    attic: '<path d="M3 10l9-6 9 6"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/><path d="M8 12h.01M16 12h.01"/>',
    room: '<path d="M6 20V9a6 6 0 0 1 12 0v11"/><path d="M4 20h16"/><path d="M14.5 14h.01"/>',
    bedroom: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 18h18M5 10V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V10"/><path d="M7 10h4v-2H7zM13 10h4v-2h-4z"/>',
    memory: '<path d="M12 3.5c.8 5 3.5 7.7 8.5 8.5-5 .8-7.7 3.5-8.5 8.5-.8-5-3.5-7.7-8.5-8.5 5-.8 7.7-3.5 8.5-8.5Z"/>',
    board: '<rect x="3.5" y="4" width="17" height="16" rx="2.2"/><path d="M9 4v16M15 4v16"/><path d="M5.5 8h1.8M11 8h1.8M11 11.5h1.8M17 8h1.8"/>',
    heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z"/><path d="M7 12h2.5l1.2-2.2 2 4.4 1.3-2.2H17"/>',
    kitchen: '<path d="M4 11h16"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M9 6.5c0-1 1-1.5 1-2.5M13 6.5c0-1 1-1.5 1-2.5"/><path d="M12 18v2.5M8.5 20.5h7"/>',
    link: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M17 14v5H5V7h5"/>' };
  function icon(a) { var d = IC[a.icon || a.id] || IC.link; return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var rows = [], row = function (a) { rows.push(a); return '<button type="button" class="ctr" data-r="' + (rows.length - 1) + '">' + icon(a) + "<span>" + esc(a.en) + (a.zh ? "<small>" + esc(a.zh) + "</small>" : "") + "</span></button>"; };
  $("drawerList").innerHTML = APPS.map(function (a) {
    return a.apps ? '<div class="gp">' + esc(a.en) + (a.zh ? "<small>" + esc(a.zh) + "</small>" : "") + "</div>" + a.apps.map(row).join("") : row(a);
  }).join("");
  $("drawerList").querySelectorAll(".ctr").forEach(function (b) { b.onclick = function () { openApp(rows[+b.dataset.r]); }; });
  // swipe right opens the drawer, left closes it (home only)
  (function () { var sx = null, sy = 0, H = $("home");
    H.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    document.addEventListener("touchend", function (e) { if (sx === null) return; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return; if (dx > 0 && !H.hidden) openDrawer(); else closeDrawer(); }, { passive: true }); })();

  /* two homes: NyxInk (the river poster) and NyxTree; the choice is kept per device */
  function homeKind() { var k = null; try { k = localStorage.getItem("nyx_home"); } catch (e) {} return k === "tree" || k === "ink" ? k : (C.home === "tree" ? "tree" : "ink"); }
  function makeHome() {
    if (home && home.stop) home.stop();
    var kind = homeKind();
    document.documentElement.dataset.home = kind;
    home = kind === "tree" && window.NyxTree ? NyxTree($("poster"), APPS, openApp, { photo: C.treePhoto })
      : NyxHome($("poster"), APPS, openApp, C.tagline, { me: C.meName, drawer: openDrawer, ask: C.clawd && C.clawd.path ? askClawd : null });
    document.querySelectorAll("#homes button").forEach(function (b) { b.classList.toggle("on", b.dataset.h === kind); });
  }
  document.querySelectorAll("#homes button").forEach(function (b) { b.onclick = function () {
    try { localStorage.setItem("nyx_home", b.dataset.h); } catch (e) {}
    closeDrawer(); makeHome(); if (!$("home").hidden) home.refresh();
  }; });

  /* Clawd on the home poster talks to whatever your relay mounts at NYX.clawd.path (see README) */
  function askClawd(text, side, history) {
    return api(C.clawd.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, side: side, history: history }) })
      .then(function (d) { return d.reply; });
  }

  /* ---------- relay ---------- */
  function api(path, opt) {
    opt = opt || {}; opt.headers = Object.assign({ "Authorization": "Bearer " + key }, opt.headers || {});
    return fetch(RELAY + path, opt).then(function (r) {
      if (r.status === 401) { var e = new Error("unauthorized"); e.auth = true; throw e; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  var stateLabel = "offline", spinT = 0;
  function setState(on, label) {
    $("state").classList.toggle("on", !!on);
    stateLabel = label || (on ? "online" : "offline");
    if (!spinT) $("state").querySelector("em").textContent = stateLabel;
  }
  // while it's answering: the Claude Code star turning in the header, and a new word every two seconds (as in Shoreless)
  var SPIN = ["\u00b7", "\u2722", "\u2736", "\u273b", "\u273d", "\u273b", "\u2736", "\u2722"];
  var VERBS = C.verbs || ["Pondering", "Noodling", "Percolating", "Mulling", "Brewing", "Musing", "Doodling", "Simmering", "Whisking", "Daydreaming", "Scheming", "Painting"];
  function spin(on) {
    var em = $("state").querySelector("em");
    if (on && !spinT) {
      var pick = function (p) { var v; do { v = VERBS[Math.floor(Math.random() * VERBS.length)]; } while (v === p && VERBS.length > 1); return v; };
      var verb = pick(), i = 0, n = 0;
      em.innerHTML = '<b class="spin">\u00b7</b><span>' + verb + "\u2026</span>";
      var sp = em.querySelector(".spin"), vb = em.querySelector("span");
      spinT = setInterval(function () { i = (i + 1) % SPIN.length; sp.textContent = SPIN[i]; if (++n % 17 === 0) { verb = pick(verb); vb.textContent = verb + "\u2026"; } }, 120);
    } else if (!on && spinT) { clearInterval(spinT); spinT = 0; em.textContent = stateLabel; }
  }

  var streamCtl = null, retry = 0, watchdog = 0;
  function openStream() {
    if (streamCtl) streamCtl.abort();
    var ctl = streamCtl = new AbortController();
    fetch(RELAY + "/app/stream", { headers: { "Authorization": "Bearer " + key }, signal: ctl.signal, cache: "no-store" }).then(function (r) {
      if (!r.ok || !r.body) throw new Error("stream " + r.status);
      // a half-written reply from before the drop won't get the rest of its pieces; the finished message comes through catchUp
      retry = 0; setState(true); drafts.forEach(function (d) { d.el.remove(); }); drafts.clear(); catchUp();
      var rd = r.body.getReader(), dec = new TextDecoder(), buf = "";
      function pump() {
        return rd.read().then(function (c) {
          if (c.done) throw new Error("stream closed");
          kick(); buf += dec.decode(c.value, { stream: true });
          var cut; while ((cut = buf.indexOf("\n\n")) >= 0) { frame(buf.slice(0, cut)); buf = buf.slice(cut + 2); }
          return pump();
        });
      }
      kick(); return pump();
    }).catch(function () {
      if (ctl.signal.aborted && ctl !== streamCtl) return;
      setState(false, "reconnecting…");
      setTimeout(openStream, Math.min(15000, 1000 * Math.pow(2, retry++)));
    });
  }
  // the relay pings every 15 s; if nothing arrives for 40 s the line is dead even if the socket says otherwise
  function kick() { clearTimeout(watchdog); watchdog = setTimeout(function () { if (streamCtl) streamCtl.abort(); streamCtl = null; openStream(); }, 40000); }
  function frame(block) {
    var data = block.split("\n").filter(function (l) { return l.indexOf("data:") === 0; }).map(function (l) { return l.slice(5).trim(); }).join("\n");
    if (!data) return;
    try { onEvent(JSON.parse(data)); } catch (e) {}
  }
  function onEvent(ev) {
    if (ev.id != null && ev.from) { put(ev); return; }
    switch (ev.type) {
      case "typing": typing(ev.active); break;
      case "reply_delta": case "thinking_delta": draft(ev); break;
    }
  }
  function catchUp() {
    return api("/app/history?since=" + lastId + "&limit=200").then(function (d) { (d.messages || []).forEach(put); }).catch(function (e) { if (e.auth) logout(); });
  }

  /* ---------- rendering ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var STK = /\[(?:sticker|表情)[:：]([^\]\n]{1,40})\]/g;
  function rich(s) {
    return esc(s || "")
      .replace(STK, function (all, name) { return C.stickers ? '<img class="stk" alt="' + name + '" src="' + C.stickers + encodeURIComponent(name) + '.png" data-n="' + encodeURIComponent(name) + '">' : all; }).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"，。！？）]/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + "</a>"; }).replace(/\n/g, "<br>");
  }
  function hm(ts) { var d = new Date(ts); return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function dayOf(ts) { var d = new Date(ts); return isNaN(d) ? "" : d.toDateString(); }
  function dayLabel(ts) {
    var d = new Date(ts), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
  }

  // uploads sit behind the key, so images are fetched with the header and shown from a local blob (the key never goes in a URL)
  var blobs = new Map();
  function blobOf(url) {
    if (!blobs.has(url)) blobs.set(url, fetch(url, { headers: { "Authorization": "Bearer " + key } }).then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(URL.createObjectURL));
    return blobs.get(url);
  }
  function wireAtts(el, atts) {
    el.querySelectorAll(".att [data-i]").forEach(function (n) {
      var a = atts[+n.dataset.i]; if (!a || !a.url) return;
      if (n.tagName === "IMG") { blobOf(a.url).then(function (u) { n.src = u; n.onload = function () { if (nearBottom(300)) toBottom(); }; }).catch(function () { n.alt = "image unavailable"; });
        n.onclick = function () { var z = document.createElement("div"); z.id = "zoom"; z.innerHTML = '<img src="' + n.src + '">'; z.onclick = function () { z.remove(); }; document.body.appendChild(z); }; }
      else n.onclick = function () { blobOf(a.url).then(function (u) { var l = document.createElement("a"); l.href = u; l.download = a.name || "file"; l.click(); }); };
    });
  }
  // a sticker may be .png, .gif, .jpg or .webp — try them in turn, then fall back to the bracketed name
  var EXT = [".png", ".gif", ".jpg", ".webp"];
  function stkFallback(im) { var i = 0; im.onerror = function () { if (++i < EXT.length) im.src = C.stickers + im.dataset.n + EXT[i]; else im.replaceWith(document.createTextNode("[" + decodeURIComponent(im.dataset.n) + "]")); }; }
  function build(m) {
    var me = m.from === "human", kind = m.kind || "reply", el = document.createElement("div");
    el.className = "msg " + (me ? "me" : "ai") + (kind === "thinking" ? " think" : kind === "act" ? " act" : "");
    el.dataset.id = m.id; el.dataset.from = m.from; el.dataset.ts = m.ts;
    var q = m.meta && m.meta.quote, inner = q ? '<span class="q">' + esc((q.who ? q.who + "  " : "") + (q.text || "")) + "</span>" : "";
    if (kind === "thinking") inner += '<details><summary>thinking…</summary>' + rich(m.text) + "</details>";
    else {
      var atts = (m.meta && m.meta.attachments) || [];
      if (atts.length) inner += '<div class="att">' + atts.map(function (a, i) { return a.kind === "image" ? '<img data-i="' + i + '" alt="">' : '<span class="file" data-i="' + i + '">' + esc(a.name || "file") + "</span>"; }).join("") + "</div>";
      inner += rich(m.text);
      if (C.stickers && !atts.length && String(m.text || "").replace(STK, "").trim() === "" && STK.test(m.text || "")) el.classList.add("only-stk");
      STK.lastIndex = 0;
    }
    el.innerHTML = '<div class="body">' + inner + '<span class="t">' + hm(m.ts) + "</span></div>";
    wireAtts(el, (m.meta && m.meta.attachments) || []);
    el.querySelectorAll("img.stk").forEach(stkFallback);
    el.ondblclick = function () { setQuote({ id: m.id, who: me ? ME : AI, text: m.text }); };
    return el;
  }
  // put one message in its place by id (history and stream can both deliver it; the second copy just replaces)
  function put(m) {
    if (!m || m.id == null) return;
    var id = +m.id; if (id > lastId) lastId = id;
    if (m.meta && m.meta.stream_id) dropDraft(m.meta.stream_id + ":" + (m.kind === "thinking" ? "thinking" : "reply"));
    if (m.from === "human") { var p = log.querySelector('.msg.pending[data-text="' + CSS.escape(m.text || "") + '"]'); if (p) p.remove(); }
    var el = build(m), old = byId.get(id), stick = nearBottom();
    if (old) { old.replaceWith(el); byId.set(id, el); return; }
    byId.set(id, el);
    var after = null; // walk back to the last message older than this one
    for (var n = log.lastElementChild; n; n = n.previousElementSibling) if (n.dataset && n.dataset.id && +n.dataset.id < id) { after = n; break; }
    var ref = after ? after.nextSibling : log.firstChild;
    var prevDay = after ? dayOf(after.dataset.ts) : null;
    if (dayOf(m.ts) !== prevDay) { var dd = document.createElement("div"); dd.className = "day"; dd.textContent = dayLabel(m.ts); log.insertBefore(dd, ref); }
    else if (after && after.dataset.from === m.from) el.classList.add("cont");
    log.insertBefore(el, ref);
    keepTyping(); if (stick) toBottom();
  }
  function draft(ev) {
    var k = ev.stream_id + ":" + (ev.type === "thinking_delta" ? "thinking" : "reply"), d = drafts.get(k);
    if (!d) {
      d = { text: "", el: build({ id: "", from: "ai", kind: ev.type === "thinking_delta" ? "thinking" : "reply", text: "", ts: new Date().toISOString(), meta: {} }) };
      d.el.classList.add("draft"); drafts.set(k, d); log.appendChild(d.el); keepTyping();
    }
    d.text += ev.text || "";
    var b = d.el.querySelector(".body");
    if (ev.type === "thinking_delta") b.querySelector("details").innerHTML = "<summary>thinking…</summary>" + rich(d.text);
    else b.innerHTML = rich(d.text);
    if (nearBottom(160)) toBottom();
  }
  function dropDraft(k) { var d = drafts.get(k); if (d) { d.el.remove(); drafts.delete(k); } }

  var typingEl = null;
  function typing(on) {
    spin(on);
    if (on && !typingEl) { typingEl = document.createElement("div"); typingEl.id = "typing"; typingEl.innerHTML = "<i></i><i></i><i></i>"; log.appendChild(typingEl); if (nearBottom(160)) toBottom(); }
    if (!on && typingEl) { typingEl.remove(); typingEl = null; }
  }
  function keepTyping() { if (typingEl) log.appendChild(typingEl); }
  function nearBottom(px) { return log.scrollHeight - log.scrollTop - log.clientHeight < (px || 80); }
  function toBottom() { log.scrollTop = log.scrollHeight; }

  /* ---------- writing ---------- */
  function setQuote(q) {
    quote = q; var box = $("quote");
    if (!q) { box.hidden = true; return; }
    box.querySelector("span").textContent = q.who + ": " + q.text; box.hidden = false; text.focus();
  }
  $("quote").querySelector("button").onclick = function () { setQuote(null); };
  function grow() { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, innerHeight * .4) + "px"; }
  text.addEventListener("input", grow);
  text.addEventListener("keydown", function (e) {
    // Enter sends, Shift+Enter breaks the line; never while an input method is still composing (Chinese, Japanese…)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
  });
  sendBtn.onclick = send;
  /* attachments: pick → upload right away → they ride along with the next send */
  var tray = [], trayEl = $("tray");
  $("clip").onclick = function () { $("file").click(); };
  $("file").onchange = function () {
    Array.prototype.forEach.call(this.files, function (f) {
      var it = { name: f.name, done: null, el: document.createElement("div") };
      it.el.className = "it up"; it.el.innerHTML = '<button type="button" aria-label="Remove">×</button>' + (f.type.indexOf("image/") ? esc(f.name.slice(0, 14)) : "");
      if (!f.type.indexOf("image/")) it.el.style.backgroundImage = "url(" + URL.createObjectURL(f) + ")";
      it.el.querySelector("button").onclick = function () { tray = tray.filter(function (x) { return x !== it; }); it.el.remove(); trayEl.hidden = !tray.length; };
      trayEl.appendChild(it.el); trayEl.hidden = false; tray.push(it);
      it.job = fetch(RELAY + "/app/upload?name=" + encodeURIComponent(f.name), { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": f.type || "application/octet-stream" }, body: f })
        .then(function (r) { if (!r.ok) throw new Error("upload " + r.status); return r.json(); })
        .then(function (a) { it.done = a; it.el.classList.remove("up"); }, function () { it.el.classList.remove("up"); it.el.style.outline = "1px solid var(--accent)"; });
    });
    this.value = "";
  };
  /* emoji & stickers: emoji go into the text, a sticker is sent on its own straight away */
  var EMO = "😀😂🥹😭🥺😳😌😏🙃🤔😴🤤😤😵‍💫🫠🤍🖤💛🧡🔥✨🌙☀️👀🙏👍👏🫶🤝🦀🍜☕️".match(/\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu) || [];
  (function () { var pop = $("emoPop"), stk = (C.stickers && C.stickerList) || [];
    pop.innerHTML = (stk.length ? '<div class="stks">' + stk.map(function (n) { return '<button type="button" data-s="' + esc(n) + '"><img class="stk" data-n="' + encodeURIComponent(n) + '" alt="' + esc(n) + '" src="' + C.stickers + encodeURIComponent(n) + '.png"></button>'; }).join("") + "</div>" : "") +
      '<div class="emos">' + EMO.map(function (e) { return '<button type="button" data-e="' + e + '">' + e + "</button>"; }).join("") + "</div>";
    pop.querySelectorAll("img.stk").forEach(stkFallback);
    pop.onclick = function (e) { var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.e) { var s = text.selectionStart || text.value.length; text.value = text.value.slice(0, s) + b.dataset.e + text.value.slice(text.selectionEnd || s); grow(); }
      else if (b.dataset.s) { var keep = text.value; text.value = "[sticker:" + b.dataset.s + "]"; send(); text.value = keep; grow(); pop.hidden = true; } };
    $("emo").onclick = function () { pop.hidden = !pop.hidden; };
    log.addEventListener("click", function () { pop.hidden = true; }); })();
  function send() {
    var t = text.value.trim(); if ((!t && !tray.length) || !key) return;
    if (tray.some(function (x) { return !x.done && x.job; })) { Promise.all(tray.map(function (x) { return x.job; })).then(send); return; }
    var atts = tray.filter(function (x) { return x.done; }).map(function (x) { return x.done; });
    tray = []; trayEl.innerHTML = ""; trayEl.hidden = true;
    var pending = build({ id: "", from: "human", text: t, ts: new Date().toISOString(), meta: Object.assign(quote ? { quote: quote } : {}, { attachments: atts }) });
    pending.classList.add("pending"); pending.dataset.text = t; log.appendChild(pending); keepTyping(); toBottom();
    var body = { text: t, side: root.dataset.side }; if (quote) body.quote = quote; if (atts.length) body.attachments = atts;
    text.value = ""; grow(); setQuote(null);
    api("/app/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function () { setTimeout(catchUp, 1500); })   // the stream normally echoes it; this is the safety net
      .catch(function (e) { pending.classList.remove("pending"); pending.classList.add("failed"); pending.querySelector(".t").textContent = e.auth ? "key rejected" : "not sent — tap to retry";
        pending.onclick = function () { pending.remove(); text.value = t; grow(); send(); }; if (e.auth) logout(); });
  }

  /* ---------- the floating ball: GET /app/meter, POST /app/model ---------- */
  var meterData = null, meterT = 0;
  function pct(v) { return v == null ? null : Math.max(0, Math.min(100, Math.round(v))); }
  function whenReset(t) {
    if (!t) return "";
    var d = new Date(t * 1000), now = new Date(), hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toDateString() === now.toDateString() ? hm : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
  }
  function paintOrb() {
    var m = meterData, orb = $("orb");
    orb.hidden = false; $("fan").querySelector('[data-k="gauge"]').hidden = !m;   // the board and the heart are there even before a meter
    if (!m) { orb.querySelector(".a1").setAttribute("stroke-dasharray", "0 100"); orb.querySelector(".a2").setAttribute("stroke-dasharray", "0 100"); $("orbNum").textContent = "\u00b7"; return; }
    var ls = m.limits || [], wide = ls[ls.length - 1], narrow = ls.length > 1 ? ls[0] : null;
    orb.querySelector(".a1").setAttribute("stroke-dasharray", (pct(wide && wide.used) || 0) + " 100");
    orb.querySelector(".a2").setAttribute("stroke-dasharray", (pct(narrow ? narrow.used : m.context && m.context.used_pct) || 0) + " 100");
    $("orbNum").textContent = wide && wide.used != null ? pct(wide.used) : "·";
    orb.classList.toggle("hot", ls.some(function (l) { return l.used >= 90; }));
  }
  function ringHTML(l) {
    var v = pct(l.used) || 0;
    return '<div class="ring' + (v >= 90 ? " hot" : "") + '"><svg viewBox="0 0 76 76"><circle class="tk" cx="38" cy="38" r="33"/>' +
      '<circle class="v" cx="38" cy="38" r="33" pathLength="100" stroke-dasharray="' + v + ' 100"/></svg><b>' + (l.used == null ? "–" : v + "%") + "</b>" +
      "<span>" + esc(l.label || l.key) + "</span><small>" + (l.resets_at ? "resets " + whenReset(l.resets_at) : "") + "</small></div>";
  }
  function paintMeter() {
    var m = meterData; if (!m) return;
    $("mModel").textContent = (m.model && (m.model.name || m.model.id)) || AI;
    $("mPlan").textContent = [m.backend, m.plan].filter(Boolean).join(" · ");
    $("mRings").innerHTML = (m.limits || []).map(ringHTML).join("") || '<p class="none">no usage limits reported</p>';
    var c = m.context || {}, cv = pct(c.used_pct);
    $("mCtx").hidden = cv == null;
    $("mCtx").querySelector("b").style.width = (cv || 0) + "%";
    $("mCtx").querySelector("em").textContent = cv == null ? "" : cv + "%";
    var cur = m.chosen || (m.model && m.model.id);
    $("mList").innerHTML = (m.models || []).map(function (x) {
      return '<button type="button" data-id="' + esc(x.id) + '"' + (x.id === cur ? ' class="on"' : "") + ">" + esc(x.name || x.id) + "</button>";
    }).join("");
    $("mNote").textContent = m.model_applies === "next" ? "A new pick applies from the next message." :
      m.model_applies === "restart" ? "A new pick applies the next time the session starts." : "";
  }
  /* the window: context line, compact, new window, old windows (GET /app/window …) */
  var win = null;
  function kfmt(n) { return n >= 1000 ? Math.round(n / 1000) + "k" : String(n || 0); }
  function paintWin() {
    var w = win; $("mWin").hidden = !w; if (!w) return;
    if (document.activeElement !== $("mLine")) $("mLine").value = w.line_k || 0;
    var k = +$("mLine").value; $("mLineV").textContent = k ? k + "k" : "none";
    var ctx = $("mCtx"); ctx.hidden = false;
    var size = w.size || (meterData && meterData.context && meterData.context.size) || 1000000;
    if (!(meterData && meterData.context && meterData.context.used_pct != null)) { ctx.querySelector("b").style.width = Math.min(100, 100 * (w.used || 0) / size) + "%"; }
    ctx.querySelector("em").textContent = kfmt(w.used) + (w.line_k ? " / " + w.line_k + "k" : "");
    var s0 = w.started_at, sec = typeof s0 === "number" ? (s0 > 1e12 ? s0 / 1000 : s0) : s0 ? Date.parse(s0) / 1000 : 0;   // ms, s or ISO
    $("mWinNote").textContent = sec ? "This window opened " + whenReset(sec) + "." : "";
  }
  function loadWin() { return api("/app/window").then(function (d) { win = d; paintWin(); }).catch(function () { win = null; paintWin(); }); }
  var lineT = 0;
  $("mLine").addEventListener("input", function () { var k = +this.value; $("mLineV").textContent = k ? k + "k" : "none";
    clearTimeout(lineT); lineT = setTimeout(function () { api("/app/window/line", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line_k: k }) }).then(loadWin).catch(function () {}); }, 500); });
  function winAct(path, ask, done) {
    if (ask && !confirm(ask)) return;
    $("mWinNote").textContent = "…";
    api(path, { method: "POST" }).then(function () { $("mWinNote").textContent = done; setTimeout(function () { loadWin(); loadMeter(); }, 2500); })
      .catch(function (e) { $("mWinNote").textContent = /409/.test(e.message) ? "It's waiting on a question in the terminal — answer that first." : "Didn't work: " + e.message; });
  }
  $("mCompact").onclick = function () { winAct("/app/window/compact", "", "Compacting — give it a minute."); };
  $("mNew").onclick = function () { winAct("/app/window/new", "Open a new window for " + AI + "? This one closes; what isn't in memory doesn't come along. You can come back to it from Windows.", "New window open."); };
  $("mWins").onclick = function () { if (hold) hold.windows(function () { loadWin(); loadMeter(); }); };
  function loadMeter() {
    if (!key) return Promise.resolve();
    return api("/app/meter").then(function (d) { meterData = d; paintOrb(); if (!$("meter").hidden) { paintMeter(); paintWin(); } }).catch(function () { meterData = null; paintOrb(); });
  }
  function openMeter() { paintMeter(); paintWin(); $("meter").hidden = false; loadMeter(); loadWin(); }
  function closeMeter() { $("meter").hidden = true; }
  $("meter").addEventListener("click", function (e) { if (e.target === $("meter")) closeMeter(); });
  $("mList").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-id]"); if (!b) return;
    $("mNote").textContent = "…";
    api("/app/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: b.dataset.id }) })
      .then(function () { if (meterData) { meterData.chosen = b.dataset.id; paintMeter(); } setTimeout(loadMeter, 1500); })
      .catch(function (err) { $("mNote").textContent = /409/.test(err.message) ? "It's busy right now — try again when it has finished." : "Couldn't switch: " + err.message; });
  });
  (function drag() {
    var orb = $("orb"), sx, sy, ox, oy, moved = false;
    try { var p = JSON.parse(localStorage.getItem("nyx_orb") || "null"); if (p) { orb.style.right = p.r + "px"; orb.style.bottom = p.b + "px"; } } catch (e) {}
    orb.addEventListener("pointerdown", function (e) { sx = e.clientX; sy = e.clientY; ox = parseFloat(getComputedStyle(orb).right); oy = parseFloat(getComputedStyle(orb).bottom); moved = false; orb.setPointerCapture(e.pointerId); });
    orb.addEventListener("pointermove", function (e) {
      if (sx == null) return; var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return; moved = true;
      var room = $("room").getBoundingClientRect();
      orb.style.right = Math.max(6, Math.min(room.width - 58, ox - dx)) + "px";
      orb.style.bottom = Math.max(70, Math.min(room.height - 120, oy - dy)) + "px";
    });
    orb.addEventListener("pointerup", function () {
      sx = null;
      if (moved) { try { localStorage.setItem("nyx_orb", JSON.stringify({ r: parseFloat(orb.style.right), b: parseFloat(orb.style.bottom) })); } catch (e) {} }
      else fan(!$("fan").classList.contains("open"));
    });
  })();
  // tap the ball: three fan out to its left — the gauge, the board, the heart (as in Shoreless)
  function fan(open) {
    var f = $("fan"), orb = $("orb");
    if (open) { f.style.right = (parseFloat(getComputedStyle(orb).right) + 58) + "px"; f.style.bottom = (parseFloat(getComputedStyle(orb).bottom) + 4) + "px"; }
    f.classList.toggle("open", open); f.setAttribute("aria-hidden", open ? "false" : "true");
  }
  $("fan").addEventListener("click", function (e) {
    var b = e.target.closest("[data-k]"); if (!b) return; fan(false);
    if (b.dataset.k === "gauge") openMeter(); else if (hold) hold[b.dataset.k]();
  });
  document.addEventListener("pointerdown", function (e) { if ($("fan").classList.contains("open") && !e.target.closest("#fan, #orb")) fan(false); });
  setInterval(function () { if (!document.hidden && !$("room").hidden) loadMeter(); }, 60000);

  /* ---------- gate ---------- */
  function enter(k) {
    key = k;
    return api("/app/history?limit=200").then(function (d) {
      try { localStorage.setItem("nyx_key", k); } catch (e) {}
      $("gate").hidden = true; $("aiName").textContent = AI;
      log.innerHTML = ""; byId.clear(); lastId = 0;
      (d.messages || []).forEach(put); openStream(); loadMeter();
      if (!hold && window.NyxHold) hold = NyxHold(api, { me: ME });
      if (!home) makeHome();
      show(location.hash === "#chat" ? "room" : "home");
    });
  }
  function logout() {
    key = null; if (streamCtl) streamCtl.abort(); streamCtl = null;
    try { localStorage.removeItem("nyx_key"); } catch (e) {}
    $("room").hidden = true; $("home").hidden = true; $("gate").hidden = false;
  }
  $("gateTitle").textContent = C.title || "Nyx";
  $("gateForm").onsubmit = function (e) {
    e.preventDefault(); var k = $("gateKey").value.trim(); if (!k) return;
    $("gateErr").textContent = "";
    enter(k).catch(function (err) { $("gateErr").textContent = err.auth ? "That key didn't open it." : "Can't reach the relay right now."; key = null; });
  };
  document.addEventListener("visibilitychange", function () { if (!document.hidden && key) { catchUp(); if (!streamCtl) openStream(); } });

  if (window.NyxSplash) NyxSplash(root.dataset.side, root.dataset.side, C.splash);
  var saved = null; try { saved = localStorage.getItem("nyx_key"); } catch (e) {}
  if (saved) enter(saved).catch(function (e) { if (e.auth) logout(); else { $("gate").hidden = true; $("room").hidden = false; $("aiName").textContent = AI; setState(false, "reconnecting…"); setTimeout(function () { enter(saved).catch(function () {}); }, 3000); } });
  else $("gate").hidden = false;
})();
