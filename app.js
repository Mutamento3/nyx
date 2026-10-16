/* Nychthemeron — the chat page. Talks to a companion relay:
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

  /* ---------- paper ---------- */
  function grain(dark) {
    var S = 180, c = document.createElement("canvas"); c.width = c.height = S;
    var x = c.getContext("2d"), d = x.createImageData(S, S);
    for (var i = 0; i < d.data.length; i += 4) {
      var v = Math.random(); if (v < .5) continue;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = dark ? 235 : 40; d.data[i + 3] = (v - .5) * (dark ? 30 : 38);
    }
    x.putImageData(d, 0, 0); return "url(" + c.toDataURL() + ")";
  }
  // marks along the thread: short ticks of uneven length, a few ink dots, now and then a small four-point star
  function marks(col) {
    var s = "", R = Math.random, cx = 22;
    for (var y = 6; y < 640; y += 5 + R() * 9) {
      var r = R();
      if (r < .6) { var L = 2 + Math.pow(R(), 2) * 12, o = (.14 + R() * .3).toFixed(2); s += '<line x1="' + (cx - L * .4).toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + (cx + L).toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke-opacity="' + o + '"/>'; }
      else if (r < .88) s += '<circle cx="' + (cx + (R() - .5) * 12).toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (.6 + R() * 1.4).toFixed(2) + '" fill="' + col + '" stroke="none" fill-opacity="' + (.2 + R() * .3).toFixed(2) + '"/>';
      else if (r < .94) { var k = 2.5 + R() * 1.5, a = cx + 8 + R() * 5; s += '<path d="M' + a + ' ' + (y - k) + 'Q' + a + ' ' + y + ' ' + (a + k) + ' ' + y + 'Q' + a + ' ' + y + ' ' + a + ' ' + (y + k) + 'Q' + a + ' ' + y + ' ' + (a - k) + ' ' + y + 'Q' + a + ' ' + y + ' ' + a + ' ' + (y - k) + 'Z" fill="' + col + '" stroke="none" fill-opacity=".4"/>'; y += 6; }
      else y += 18 + R() * 28;
    }
    return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="640"><g stroke="' + col + '" stroke-width="1" stroke-linecap="round">' + s + "</g></svg>") + '")';
  }
  var PAPER = { sun: [grain(false), marks("#221E1C")], moon: [grain(true), marks("#C07A5C")] };
  function paintSide() {
    var s = root.dataset.side, p = PAPER[s];
    root.style.setProperty("--grain", p[0]); root.style.setProperty("--marks", p[1]);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = s === "moon" ? "#0C0A09" : "#ECE8E1";
  }
  paintSide();
  $("flip").onclick = function () {
    root.dataset.side = root.dataset.side === "moon" ? "sun" : "moon";
    try { localStorage.setItem("nyx_side", root.dataset.side); } catch (e) {}
    paintSide();
  };

  /* ---------- relay ---------- */
  function api(path, opt) {
    opt = opt || {}; opt.headers = Object.assign({ "Authorization": "Bearer " + key }, opt.headers || {});
    return fetch(RELAY + path, opt).then(function (r) {
      if (r.status === 401) { var e = new Error("unauthorized"); e.auth = true; throw e; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function setState(on, label) {
    $("state").classList.toggle("on", !!on);
    $("state").querySelector("em").textContent = label || (on ? "online" : "offline");
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
    el.querySelectorAll("img.stk").forEach(function (im) { im.onerror = function () { if (!/\.gif$/.test(im.src)) im.src = C.stickers + im.dataset.n + ".gif"; else im.replaceWith(document.createTextNode("[" + decodeURIComponent(im.dataset.n) + "]")); }; });
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

  /* ---------- gate ---------- */
  function enter(k) {
    key = k;
    return api("/app/history?limit=200").then(function (d) {
      try { localStorage.setItem("nyx_key", k); } catch (e) {}
      $("gate").hidden = true; $("room").hidden = false; $("aiName").textContent = AI;
      log.innerHTML = ""; byId.clear(); lastId = 0;
      (d.messages || []).forEach(put); toBottom(); openStream();
    });
  }
  function logout() {
    key = null; if (streamCtl) streamCtl.abort(); streamCtl = null;
    try { localStorage.removeItem("nyx_key"); } catch (e) {}
    $("room").hidden = true; $("gate").hidden = false;
  }
  $("gateTitle").textContent = C.title || "Nychthemeron";
  $("gateForm").onsubmit = function (e) {
    e.preventDefault(); var k = $("gateKey").value.trim(); if (!k) return;
    $("gateErr").textContent = "";
    enter(k).catch(function (err) { $("gateErr").textContent = err.auth ? "That key didn't open it." : "Can't reach the relay right now."; key = null; });
  };
  document.addEventListener("visibilitychange", function () { if (!document.hidden && key) { catchUp(); if (!streamCtl) openStream(); } });

  var saved = null; try { saved = localStorage.getItem("nyx_key"); } catch (e) {}
  if (saved) enter(saved).catch(function (e) { if (e.auth) logout(); else { $("gate").hidden = true; $("room").hidden = false; $("aiName").textContent = AI; setState(false, "reconnecting…"); setTimeout(function () { enter(saved).catch(function () {}); }, 3000); } });
  else $("gate").hidden = false;
})();
