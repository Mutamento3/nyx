/* Nyx — Listen. A record player on the paper: play your own music, and (with Together on) your relay
   is told what's playing so your companion can listen along.
   Sources (config.js → listen.source):
     "files"   — listen.tracks: [{ src, name, artist, cover, lrc }]; lrc is a URL to a .lrc file (optional)
     "netease" — your own NetEase Cloud Music account through a bridge on your relay; see docs/listen-netease.md
   Song change → POST {relay}/app/music/now { id, name, artist, state, together } (ignored if your relay doesn't have it). */
(function () {
  "use strict";
  var C = window.NYX || {}, L = C.listen || {}, RELAY = (function(){try{return localStorage.getItem("nyx_relay")}catch(e){return null}})() || C.relay || "/relay", AI = (function(){try{return localStorage.getItem("nyx_ai")}catch(e){return null}})() || C.aiName || "your companion";
  var root = document.documentElement, $ = function (id) { return document.getElementById(id); };
  var key = null; try { key = localStorage.getItem("nyx_key"); } catch (e) {}
  if (!key) { location.replace("./"); return; }
  NyxPaper.paint();
  var SRC = L.source === "netease" ? "netease" : "files";
  var audio = $("audio"), queue = [], idx = -1, cur = null, lrc = [], lrcAt = -1, together = true, toastT = 0;
  try { together = localStorage.getItem("nyx_listen_alone") !== "1"; } catch (e) {}

  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("on"); }, 2400); }
  function api(path, body) {
    return fetch(RELAY + path, { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
  }
  function music(a, p) { return api("/app/music/" + a, p); }
  function mmss(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); }
  function ne(s) { var al = s.al || s.album || {}; return { id: s.id, name: s.name, artist: (s.ar || s.artists || []).map(function (a) { return a.name; }).join(" / "), cover: al.picUrl ? al.picUrl + "?param=360y360" : "" }; }

  /* ---------- the record ---------- */
  function deck(big) {
    var g = "";
    for (var r = 44; r < 108; r += 2.6) g += '<circle r="' + r.toFixed(1) + '" fill="none" stroke="rgba(255,255,255,' + (r % 13 < 2.6 ? .09 : .035) + ')" stroke-width=".6"/>';
    return '<svg viewBox="0 0 270 250"><defs><clipPath id="lab' + (big ? "B" : "S") + '"><circle r="38"/></clipPath>' +
      '<linearGradient id="arm' + (big ? "B" : "S") + '" x1="0" x2="1"><stop offset="0" stop-color="var(--arm-hi)"/><stop offset="1" stop-color="var(--arm-lo)"/></linearGradient></defs>' +
      '<g transform="translate(122 128)"><circle r="112" fill="var(--rec)"/><g class="spin">' + g +
      '<circle r="40" fill="var(--lab)"/><image class="lab" href="" x="-38" y="-38" width="76" height="76" preserveAspectRatio="xMidYMid slice" clip-path="url(#lab' + (big ? "B" : "S") + ')"/>' +
      '<path d="M-30 -24 A38 38 0 0 1 -10 -36" stroke="rgba(255,255,255,.25)" stroke-width="1.2" fill="none"/></g>' +
      '<path d="M-96 -48 A108 108 0 0 1 -40 -100" stroke="rgba(255,255,255,.10)" stroke-width="14" fill="none"/><path d="M96 52 A108 108 0 0 1 44 98" stroke="rgba(255,255,255,.06)" stroke-width="10" fill="none"/>' +
      '<circle r="3.2" fill="var(--paper)"/></g>' +
      '<g class="arm"><circle cx="238" cy="30" r="13" fill="url(#arm' + (big ? "B" : "S") + ')"/><circle cx="238" cy="30" r="4.5" fill="var(--rec)"/>' +
      '<path d="M238 30 C236 80 226 132 196 168" fill="none" stroke="url(#arm' + (big ? "B" : "S") + ')" stroke-width="4.2" stroke-linecap="round"/>' +
      '<rect x="183" y="160" width="20" height="11" rx="3" transform="rotate(-38 193 166)" fill="url(#arm' + (big ? "B" : "S") + ')"/></g></svg>';
  }
  // up close: the record goes glassy, the cover fills its middle, rings and a glow around it,
  // and long thin raindrops drift down through it — small and faint behind the disc, larger in front.
  // Three kinds take turns: frosted, finely striped, and two or three outlines laid slightly apart.
  function halo() {
    var R = Math.random, g = "", n = 0;
    for (var r = 90; r < 120; r += 2.4) g += '<circle r="' + r.toFixed(1) + '" fill="none" stroke="rgba(255,255,255,' + (r % 9 < 2.4 ? .14 : .05) + ')" stroke-width=".5"/>';
    var DROP = "M0 -28 C2.8 -16 9 -7 9 1.5 A9 9 0 0 1 -9 1.5 C-9 -7 -2.8 -16 0 -28 Z";
    function drop(x, y, sc, op, fall) {
      var dur = (fall * .55).toFixed(1), beg = (-R() * fall).toFixed(1), k = (n++) % 3, body = "";
      if (k === 0) body = '<path d="' + DROP + '" fill="var(--bird)" filter="url(#frost)"/>';
      else if (k === 1) body = '<path d="' + DROP + '" fill="url(#stripe)" stroke="var(--bird)" stroke-width="1" vector-effect="non-scaling-stroke" stroke-opacity=".7"/>';
      else for (var j = 0, m = 2 + (R() < .5 ? 1 : 0); j < m; j++) { var f = 1 - j * (.16 + R() * .1);
        body += '<path d="' + DROP + '" transform="translate(' + ((R() - .5) * 9).toFixed(1) + " " + ((R() - .3) * 12).toFixed(1) + ") scale(" + f.toFixed(2) + ')" fill="none" stroke="var(--bird)" stroke-width="1.1" vector-effect="non-scaling-stroke"/>'; }
      return '<g transform="translate(' + x + " " + y + ") scale(" + sc * .26 + " " + sc * .45 + ')" opacity="0"><animate attributeName="opacity" values="0;' + op + ";" + op + ';0" keyTimes="0;.15;.8;1" dur="' + dur + 's" begin="' + beg + 's" repeatCount="indefinite"/>' +
        '<animateTransform attributeName="transform" type="translate" additive="sum" values="0 -60;0 ' + (110 / (sc * .45)).toFixed(1) + '" dur="' + dur + 's" begin="' + beg + 's" repeatCount="indefinite"/>' + body + "</g>";
    }
    var back = drop(-128, -96, .9, .5, 16) + drop(112, -120, .7, .45, 19) + drop(-150, 20, .75, .4, 21) + drop(140, -30, .6, .45, 18);
    var front = drop(-112, 60, 1.6, .95, 13) + drop(138, 10, 1.25, .9, 15) + drop(96, 110, 1.05, .85, 12) + drop(-40, -150, 1.2, .8, 14);
    var sp = ""; for (var i = 0; i < 26; i++) { var a = R() * 6.283, rr = 120 + R() * 50; sp += '<circle cx="' + (Math.cos(a) * rr).toFixed(1) + '" cy="' + (Math.sin(a) * rr).toFixed(1) + '" r="' + (.6 + R() * 1.4).toFixed(2) + '" fill="var(--spark)"><animate attributeName="opacity" values="0;1;0" dur="' + (2 + R() * 3).toFixed(1) + 's" begin="-' + (R() * 3).toFixed(1) + 's" repeatCount="indefinite"/></circle>'; }
    return '<svg viewBox="-170 -170 340 340"><defs><filter id="frost" x="-40%" y="-20%" width="180%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.9" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>' +
      '<pattern id="stripe" patternUnits="userSpaceOnUse" width="40" height="5"><rect x="-20" width="80" height="1.8" fill="var(--bird)"/></pattern><radialGradient id="glow"><stop offset=".55" stop-color="var(--glow)" stop-opacity=".55"/><stop offset="1" stop-color="var(--glow)" stop-opacity="0"/></radialGradient>' +
      '<clipPath id="labB"><circle r="84"/></clipPath></defs>' +
      '<circle r="168" fill="url(#glow)"/>' + back +
      '<g class="rings"><circle r="146" fill="none" stroke="var(--thread)" stroke-width=".8"/><circle r="136" fill="none" stroke="var(--ink)" stroke-opacity=".25" stroke-width=".6" stroke-dasharray="2 5"/><circle r="128" fill="none" stroke="var(--thread)" stroke-opacity=".6" stroke-width="1.6" stroke-dasharray="60 14 4 14"/></g>' +
      '<circle r="122" fill="var(--rec)" fill-opacity=".62"/><g class="spin">' + g +
      '<circle r="88" fill="var(--paper)"/><image class="lab" href="" x="-84" y="-84" width="168" height="168" preserveAspectRatio="xMidYMid slice" clip-path="url(#labB)"/>' +
      '<circle r="84" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/></g>' +
      '<path d="M-110 -40 A118 118 0 0 1 -50 -106" stroke="rgba(255,255,255,.22)" stroke-width="6" fill="none" stroke-linecap="round"/>' +
      sp + front + "</svg>";
  }
  $("deck").innerHTML = deck(false); $("npDeck").innerHTML = halo();

  /* ---------- the thread ---------- */
  (function () {
    var R = Math.random;
    // a loose loop of thread: points wander down the page, joined with smooth curves
    function path() { var p = [[-20, 70 + R() * 40], [150 + R() * 50, 40 + R() * 30], [120 + R() * 40, 230 + R() * 40], [40 + R() * 40, 300 + R() * 40], [150 + R() * 60, 380 + R() * 40], [300 + R() * 40, 300 + R() * 50], [250 + R() * 60, 470 + R() * 30], [410, 440 + R() * 40]];
      var d = "M" + p[0][0] + " " + p[0][1];
      for (var i = 0; i < p.length - 1; i++) { var a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
        d += " C" + (b[0] + (c[0] - a[0]) / 4).toFixed(1) + " " + (b[1] + (c[1] - a[1]) / 4).toFixed(1) + " " + (c[0] - (e[0] - b[0]) / 4).toFixed(1) + " " + (c[1] - (e[1] - b[1]) / 4).toFixed(1) + " " + c[0].toFixed(1) + " " + c[1].toFixed(1); }
      return d; }
    var a = path(), b = path();
    $("thread").innerHTML = '<path d="' + a + '" fill="none" stroke="var(--thread)" stroke-width="1.4" stroke-linecap="round"><animate attributeName="d" values="' + a + ";" + b + ";" + a + '" dur="26s" repeatCount="indefinite"/></path>';
  })();
  // the seek bar is a short stretch of the same thread, with an ink drop riding it
  var WAVE = (function () { var d = ""; for (var i = 0; i <= 60; i++) { var x = i * 5; d += (i ? "L" : "M") + x + " " + (12 + Math.sin(i / 60 * Math.PI * 3) * 3.2).toFixed(2); } return d; })();
  $("seek").querySelectorAll(".rest, .done").forEach(function (p) { p.setAttribute("d", WAVE); p.setAttribute("pathLength", "1"); });

  /* ---------- copy ---------- */
  $("lines").innerHTML = (L.lines || ["two of us, one pair of earphones", "change the song, and they know"]).map(esc).join("<br>");
  function paintMode() {
    $("mTo").classList.toggle("on", together); $("mSo").classList.toggle("on", !together);
    $("note").innerHTML = together ? "<b>Together</b> · whatever you play, " + esc(AI) + " hears it." : "<b>Alone</b> · the music stays with you.";
  }
  $("mTo").onclick = function () { together = true; try { localStorage.removeItem("nyx_listen_alone"); } catch (e) {} paintMode(); if (cur) report(true); };
  $("mSo").onclick = function () { together = false; try { localStorage.setItem("nyx_listen_alone", "1"); } catch (e) {} paintMode(); };
  paintMode();

  /* ---------- lists ---------- */
  var TABS = SRC === "netease" ? [["For you", "daily"], ["Playlists", "lists"], ["Recent", "recent"], ["Search", "search"]] : [["Tracks", "files"]];
  $("tabs").innerHTML = TABS.map(function (t) { return '<button type="button" data-t="' + t[1] + '">' + t[0] + "</button>"; }).join("");
  $("tabs").querySelectorAll("button").forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
  function rows(songs, hint) {
    var el = $("list");
    if (!songs.length) { el.innerHTML = '<p class="empty">' + esc(hint || "Nothing here yet.") + "</p>"; return; }
    el.innerHTML = songs.map(function (s, i) { return '<button type="button" class="row" data-i="' + i + '"><span class="cv" style="' + (s.cover ? "background-image:url('" + esc(s.cover) + "')" : "") + '"></span><span class="tx"><b>' + esc(s.name) + "</b><small>" + esc(s.artist) + "</small></span></button>"; }).join("");
    el.querySelectorAll(".row").forEach(function (r) { r.onclick = function () { queue = songs; play(+r.dataset.i); }; });
  }
  function wait() { $("list").innerHTML = '<p class="empty">…</p>'; }
  function fail() { rows([], "Couldn't reach the music bridge. Is it set up? (docs/listen-netease.md)"); }
  var uid = null;
  function tab(t) {
    $("tabs").querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === t); });
    $("find").hidden = t !== "search";
    if (t === "files") return rows((L.tracks || []).map(function (s, i) { return { id: s.id || s.src || i, name: s.name || "Untitled", artist: s.artist || "", cover: s.cover || "", src: s.src, lrc: s.lrc }; }), "Add your tracks to config.js → listen.tracks.");
    if (t === "search") { rows([], "Type something and press enter."); $("q").focus(); return; }
    wait();
    if (t === "daily") music("daily").then(function (d) { rows(((d.data || {}).dailySongs || []).map(ne)); }).catch(fail);
    if (t === "recent") music("recent", { limit: 60 }).then(function (d) { rows(((d.data || {}).list || []).map(function (x) { return ne(x.data); }), "Nothing played lately."); }).catch(fail);
    if (t === "lists") (uid ? Promise.resolve(uid) : music("me").then(function (d) { return uid = ((d.data || d).profile || {}).userId; }))
      .then(function (u) { return music("playlists", { uid: u, limit: 60 }); })
      .then(function (d) { var pl = d.playlist || [], el = $("list");
        el.innerHTML = pl.map(function (p, i) { return '<button type="button" class="row" data-i="' + i + '"><span class="cv" style="background-image:url(\'' + esc(p.coverImgUrl + "?param=120y120") + '\')"></span><span class="tx"><b>' + esc(p.name) + "</b><small>" + p.trackCount + " songs</small></span></button>"; }).join("");
        el.querySelectorAll(".row").forEach(function (r) { r.onclick = function () { wait(); music("tracks", { id: pl[+r.dataset.i].id, limit: 300 }).then(function (d) { rows((d.songs || []).map(ne)); }).catch(fail); }; }); })
      .catch(fail);
  }
  $("find").onsubmit = function (e) { e.preventDefault(); var q = $("q").value.trim(); if (!q) return; $("q").blur(); wait();
    music("search", { keywords: q, limit: 40 }).then(function (d) { rows(((d.result || {}).songs || []).map(ne), "No match."); }).catch(fail); };
  tab(TABS[0][1]);

  /* ---------- playing ---------- */
  // play order: in order (looping the list), shuffle, or one song on repeat — remembered on this phone
  var MODES = ["order", "shuffle", "one"], MODE_NAME = { order: "In order", shuffle: "Shuffle", one: "Repeat one" };
  var MODE_ICON = { order: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
    shuffle: '<path d="M4 7h3.5c2 0 3 1 4.2 3l1.6 3c1.2 2 2.2 3 4.2 3H20M17 13.5l3 2.5-3 2.5"/><path d="M4 16h3.5c1.2 0 2-.4 2.7-1.1M13.8 8.1c.7-.7 1.5-1.1 2.7-1.1H20M17 4.5L20 7l-3 2.5"/>',
    one: '<path d="M4 9h13l-3-3M20 15H7l3 3"/><path d="M11.4 10.6l1.1-.8v4.4"/>' };
  var mode = "order"; try { if (MODES.indexOf(localStorage.getItem("nyx_play_mode")) >= 0) mode = localStorage.getItem("nyx_play_mode"); } catch (e) {}
  function paintOrder() { $("npMode").innerHTML = '<svg viewBox="0 0 24 24">' + MODE_ICON[mode] + "</svg>"; $("npMode").setAttribute("aria-label", MODE_NAME[mode]); }
  paintOrder();
  $("npMode").onclick = function () { mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; try { localStorage.setItem("nyx_play_mode", mode); } catch (e) {} paintOrder(); toast(MODE_NAME[mode]); };
  function nextIdx() {
    if (mode === "shuffle" && queue.length > 1) { var j; do { j = Math.floor(Math.random() * queue.length); } while (j === idx); return j; }
    return idx + 1;
  }
  function play(i) {
    if (!queue.length) return; idx = (i + queue.length) % queue.length; var s = cur = queue[idx];
    paintNow(s); lrc = []; lrcAt = -1; $("lrcIn").innerHTML = '<p class="on">' + (s.lrc || SRC === "netease" ? "…" : "") + "</p>";
    var src = s.src ? Promise.resolve(s.src) : music("url", { id: s.id, level: "exhigh" }).then(function (d) { return ((d.data || [])[0] || {}).url; });
    src.then(function (u) {
      if (!u) { toast("This one won't play here (VIP or region)."); return; }
      audio.src = u; return audio.play();
    }).catch(function () { toast("Couldn't start it. Tap play to try again."); });
    var ly = s.lrc ? fetch(s.lrc).then(function (r) { return r.text(); }) : SRC === "netease" ? music("lyric", { id: s.id }).then(function (d) { return (d.lrc || {}).lyric || ""; }) : Promise.resolve("");
    ly.then(function (t) { if (cur === s) setLrc(t); }).catch(function () { if (cur === s) setLrc(""); });
    report(false);
  }
  function report(force) { if (!cur) return; api("/app/music/now", { id: cur.id, name: cur.name, artist: cur.artist, state: audio.paused ? "pause" : "play", together: together, force: !!force }).catch(function () {}); }
  function paintNow(s) {
    $("cardName").textContent = s.name; $("cardArtist").textContent = s.artist || " ";
    $("cardCover").style.backgroundImage = s.cover ? "url('" + s.cover + "')" : "";
    $("npName").textContent = s.name; $("npArtist").textContent = s.artist || "";
    $("npBg").style.backgroundImage = s.cover ? "url('" + s.cover + "')" : "";
    document.querySelectorAll(".lab").forEach(function (im) { im.setAttribute("href", s.cover || ""); });
    if ("mediaSession" in navigator && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: s.name, artist: s.artist, artwork: s.cover ? [{ src: s.cover, sizes: "360x360" }] : [] });
  }
  function toggle() { if (!cur) { if (queue.length || $("list").querySelector(".row")) $("list").querySelector(".row").click(); return; } if (audio.paused) audio.play().catch(function () {}); else audio.pause(); }
  $("play").onclick = function (e) { e.stopPropagation(); toggle(); }; $("npPlay").onclick = toggle;
  $("prev").onclick = function (e) { e.stopPropagation(); play(idx - 1); }; $("npPrev").onclick = function () { play(idx - 1); };
  $("next").onclick = function (e) { e.stopPropagation(); play(nextIdx()); }; $("npNext").onclick = function () { play(nextIdx()); };
  if ("mediaSession" in navigator) try { navigator.mediaSession.setActionHandler("previoustrack", function () { play(idx - 1); }); navigator.mediaSession.setActionHandler("nexttrack", function () { play(nextIdx()); }); } catch (e) {}
  audio.addEventListener("play", function () { document.body.classList.add("playing"); });
  audio.addEventListener("pause", function () { document.body.classList.remove("playing"); });
  audio.addEventListener("ended", function () { if (mode === "one") { audio.currentTime = 0; audio.play().catch(function () {}); } else play(nextIdx()); });
  audio.addEventListener("timeupdate", tick); audio.addEventListener("loadedmetadata", tick);
  function tick() {
    var d = audio.duration || 0, t = audio.currentTime || 0, p = d ? t / d : 0;
    $("cardBar").style.width = (p * 100).toFixed(2) + "%"; $("cardTime").textContent = mmss(t) + " / " + mmss(d);
    $("npCur").textContent = mmss(t); $("npDur").textContent = mmss(d);
    if (!dragging) seekTo(p);
    var k = -1; for (var i = 0; i < lrc.length && lrc[i].t <= t + .25; i++) k = i;
    if (k !== lrcAt) { lrcAt = k; paintLrc(); }
  }
  function seekTo(p) {
    $("seek").querySelector(".done").setAttribute("stroke-dasharray", p.toFixed(4) + " 1");
    $("drop").style.left = (p * 100).toFixed(2) + "%"; $("drop").style.top = (12 + Math.sin(p * Math.PI * 3) * 3.2) / 24 * 100 + "%";
  }
  var dragging = false;
  (function () { var s = $("seek");
    function at(e) { var r = s.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); }
    s.addEventListener("pointerdown", function (e) { if (!audio.duration) return; dragging = true; s.setPointerCapture(e.pointerId); seekTo(at(e)); });
    s.addEventListener("pointermove", function (e) { if (dragging) seekTo(at(e)); });
    s.addEventListener("pointerup", function (e) { if (!dragging) return; dragging = false; audio.currentTime = at(e) * audio.duration; });
    s.addEventListener("pointercancel", function () { dragging = false; }); })();

  /* ---------- lyrics ---------- */
  function setLrc(text) {
    lrc = []; (text || "").split(/\r?\n/).forEach(function (ln) { var tags = ln.match(/\[\d+:\d+(?:[.:]\d+)?\]/g); if (!tags) return; var tx = ln.replace(/\[[^\]]*\]/g, "").trim(); if (!tx) return;
      tags.forEach(function (tg) { var m = tg.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/); lrc.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +("0." + m[3]) : 0), x: tx }); }); });
    lrc.sort(function (a, b) { return a.t - b.t; }); lrcAt = -2;
    $("lrcIn").innerHTML = lrc.length ? lrc.map(function (l) { return "<p>" + esc(l.x) + "</p>"; }).join("") : '<p class="on none">No lyrics for this one.</p>';
    tick();
  }
  function paintLrc() {
    var ps = $("lrcIn").children; if (!lrc.length) return;
    for (var i = 0; i < ps.length; i++) { ps[i].className = i === lrcAt ? "on" : Math.abs(i - lrcAt) === 1 ? "near" : ""; }
    var c = ps[Math.max(0, lrcAt)]; if (c) $("lrcIn").style.transform = "translateY(" + (-(c.offsetTop + c.offsetHeight / 2) + $("lrc").clientHeight / 2) + "px)";
  }

  /* ---------- now playing sheet ---------- */
  function openNp() { if (!cur) return; $("np").hidden = false; requestAnimationFrame(function () { $("np").classList.add("on"); lrcAt = -2; tick(); }); }
  $("card").onclick = openNp; $("card").onkeydown = function (e) { if (e.key === "Enter") openNp(); };
  $("npDown").onclick = function () { $("np").classList.remove("on"); setTimeout(function () { $("np").hidden = true; }, 350); };
  $("back").onclick = function () { location.href = "./"; };
})();
