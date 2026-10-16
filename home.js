/* Nychthemeron — home poster. One ink river runs down the page; each entry in NYX.apps is a textured block
   hung on alternating banks, big → small. Each block carries a small drawing of something inside a language model:
   tokens, embedding clusters, a context window, a sampling distribution, beam search, an activation curve, a loss curve.
   Day and night are the same blocks mirrored (an isomer), so flipping the side reshuffles the page. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function seeded(s) { return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

  /* textures: grain, fog, halftone dots, scanlines — one set per side */
  function tex(kind, c0, c1, seed) {
    var S = 200, c = document.createElement("canvas"); c.width = c.height = S;
    var x = c.getContext("2d"), A = hex(c0), B = hex(c1), R = seeded(seed), i, k;
    x.fillStyle = c1; x.fillRect(0, 0, S, S);
    if (kind === "grain" || kind === "fog") {
      var d = x.createImageData(S, S);
      for (i = 0; i < d.data.length; i += 4) { var t = R(); t = t * t; for (k = 0; k < 3; k++) d.data[i + k] = A[k] * (1 - t) + B[k] * t; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0);
      if (kind === "fog") { var g = x.createRadialGradient(S * .35, S * .6, 4, S * .35, S * .6, S * .55); g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, S, S); }
    } else if (kind === "dots") {
      x.fillStyle = c0; for (var yy = 4; yy < S; yy += 8) for (var xx = 4 + (yy / 8 % 2) * 4; xx < S; xx += 8) { x.beginPath(); x.arc(xx, yy, 1 + 2.4 * (xx / S) * (.6 + R() * .4), 0, 6.29); x.fill(); }
    } else if (kind === "scan") {
      for (var y2 = 0; y2 < S; y2 += 3) { x.fillStyle = "rgba(" + A.join(",") + "," + (.25 + R() * .5) + ")"; var off = R() * 30; x.fillRect(off, y2, S - off - R() * 40, 1.2); }
    }
    return "url(" + c.toDataURL() + ")";
  }
  var PAL = { sun: { lt: ["#A39C95", "#5C5652"], dk: ["#5A5450", "#161413"] }, moon: { lt: ["#5A4A42", "#171211"], dk: ["#3A2F2B", "#090706"] } };
  var KINDS = [["fog", "fog", "dk", 5], ["scan", "scan", "dk", 13], ["grainD", "grain", "dk", 7], ["dots", "dots", "dk", 11], ["grainL", "grain", "lt", 3], ["dotsL", "dots", "lt", 19]];
  var T = {};
  ["sun", "moon"].forEach(function (s) { T[s] = {}; KINDS.forEach(function (a) { var p = PAL[s][a[2]]; T[s][a[0]] = tex(a[1], p[0], p[1], a[3]); }); });

  /* drawings: r = block rect in px, R = seeded random. --c is the stroke colour (light inside the block, ink outside) */
  var ART = {
    tokens: function (r) { var h = "", s = r.w * .1, y0 = r.y + r.h * .34;
      for (var i = 0; i < 13; i++) { var col = i % 5, row = Math.floor(i / 5), x = r.x + r.w * .14 + col * s * 1.35 + row * s * .4, y = y0 + row * s * 1.35;
        h += '<rect x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" fill="' + (i === 12 ? "var(--c)" : "none") + '" stroke="var(--c)" stroke-width="' + (i % 3 ? .9 : 1.6) + '"' + (i > 9 ? ' stroke-dasharray="2 2"' : "") + "/>"; }
      var cx = r.x + r.w * .14 + 3 * s * 1.35 + 2 * s * .4;
      h += '<rect x="' + cx + '" y="' + (y0 + 2 * s * 1.35) + '" width="' + (s * .3) + '" height="' + s + '" fill="var(--c)"><animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite"/></rect>';
      return h + '<path d="M' + (r.x + r.w * .62) + " " + (r.y - r.h * .1) + " V" + (r.y + r.h * .3) + '" stroke="var(--c)" stroke-width="1.2"/><circle cx="' + (r.x + r.w * .62) + '" cy="' + (r.y - r.h * .1) + '" r="3" fill="var(--c)"/>'; },
    clusters: function (r, R) { var h = "", C = [[.2, .3], [.72, .25], [.3, .76], [.84, .7]];
      C.forEach(function (c) { for (var i = 0; i < 9; i++) { var a = R() * 6.28, d = R() * r.w * .11; h += '<circle cx="' + (r.x + c[0] * r.w + Math.cos(a) * d) + '" cy="' + (r.y + c[1] * r.h + Math.sin(a) * d) + '" r="' + (i ? 1.6 : 3) + '" fill="' + (i ? "var(--c)" : "none") + '" stroke="var(--c)" stroke-width=".8"/>'; } });
      return h + '<circle cx="' + (r.x + r.w * 1.04) + '" cy="' + (r.y - r.h * .1) + '" r="' + (r.w * .14) + '" fill="none" stroke="var(--c)" stroke-width=".8" stroke-dasharray="1.5 3"/>'; },
    context: function (r, R) { var h = "";
      for (var i = 0; i < 14; i++) { var y = r.y + r.h * .9 - i * r.h * .085; h += '<path d="M' + (r.x + r.w * .22) + " " + y + " h" + (r.w * (.35 + R() * .5)) + '" stroke="var(--c)" stroke-width="' + (i < 3 ? 1.6 : .8) + '" opacity="' + Math.max(.08, 1 - i / 13) + '"' + (i > 8 ? ' stroke-dasharray="3 3"' : "") + "/>"; }
      return h + '<path d="M' + (r.x + r.w * .14) + " " + (r.y + r.h * .92) + " h-3 V" + (r.y - r.h * .25) + ' h3" fill="none" stroke="var(--c)" stroke-width="1"/>'; },
    sampling: function (r) { var h = "", v = [.25, .4, .95, .55, .3, .18, .1, .06], bw = r.w * .07;
      v.forEach(function (p, i) { var x = r.x + r.w * .1 + i * bw * 1.5, hh = r.h * .8 * p * (i === 2 ? 1.6 : 1); h += '<rect x="' + x + '" y="' + (r.y + r.h * .9 - hh) + '" width="' + bw + '" height="' + hh + '" fill="' + (i === 2 ? "var(--c)" : "none") + '" stroke="var(--c)" stroke-width="' + (i === 2 ? 0 : 1) + '"/>'; });
      return h + '<path d="M' + (r.x + r.w * .06) + " " + (r.y + r.h * .9) + " H" + (r.x + r.w * 1.12) + '" stroke="var(--c)" stroke-width="1.4"/>'; },
    beam: function (r) { var h = "", x0 = r.x + r.w * .08, y0 = r.y + r.h * .55;
      (function grow(x, y, depth, spread, keep) { if (depth > 4) return; for (var j = -1; j <= 1; j += 2) { var nx = x + r.w * .24, ny = y + j * spread, k2 = keep && (j === 1 || depth < 2);
        h += '<path d="M' + x + " " + y + " C" + (x + r.w * .1) + " " + y + " " + (nx - r.w * .1) + " " + ny + " " + nx + " " + ny + '" fill="none" stroke="var(--c)" stroke-width="' + (k2 ? 1.5 : .7) + '"' + (k2 ? "" : ' stroke-dasharray="2 3"') + "/>";
        h += '<circle cx="' + nx + '" cy="' + ny + '" r="' + (k2 ? 1.6 : 1) + '" fill="var(--c)"/>'; if (k2) grow(nx, ny, depth + 1, spread * .62, k2); } })(x0, y0, 0, r.h * .32, true);
      return h + '<circle cx="' + x0 + '" cy="' + y0 + '" r="2.4" fill="var(--c)"/>'; },
    gelu: function (r) { var d = "";
      for (var i = 0; i <= 40; i++) { var t = i / 40 * 6 - 3, g = t * .5 * (1 + Math.tanh(.7978 * (t + .044715 * t * t * t))); d += (i ? "L" : "M") + (r.x - r.w * .15 + i / 40 * r.w * 1.3) + " " + (r.y + r.h * .75 - g * r.h * .28); }
      return '<path d="' + d + '" fill="none" stroke="var(--c)" stroke-width="1.8"/><path d="M' + (r.x + r.w * .1) + " " + (r.y + r.h * .75) + " H" + (r.x + r.w * .9) + " M" + (r.x + r.w * .35) + " " + (r.y + r.h * .15) + " V" + (r.y + r.h * .92) + '" stroke="var(--c)" stroke-width=".6" stroke-dasharray="2 2"/>'; },
    loss: function (r) { var d = "";
      for (var i = 0; i <= 30; i++) { var t = i / 30; d += (i ? "L" : "M") + (r.x + r.w * (.1 + t * .95)) + " " + (r.y - r.h * .2 + (1 - Math.exp(-t * 3.2)) * r.h * .95 + Math.sin(i * 2.7) * r.h * .05 * (1 - t)); }
      return '<path d="' + d + '" fill="none" stroke="var(--c)" stroke-width="1.3"/>'; }
  };
  var ART_ORDER = ["tokens", "context", "clusters", "sampling", "beam", "gelu", "loss"];
  var TEX_ORDER = ["fog", "scan", "grainD", "dots", "grainL", "grainD", "dotsL"];

  function smooth(p) { var d = "M" + p[0][0] + " " + p[0][1];
    for (var i = 0; i < p.length - 1; i++) { var a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
      d += " C" + (b[0] + (c[0] - a[0]) / 5) + " " + (b[1] + (c[1] - a[1]) / 5) + " " + (c[0] - (e[0] - b[0]) / 5) + " " + (c[1] - (e[1] - b[1]) / 5) + " " + c[0] + " " + c[1]; }
    return d; }
  function noise(t, k) { return Math.sin(t * 1.7 + k) * .5 + Math.sin(t * 4.3 + k * 2.1) * .3 + Math.sin(t * 11.1 + k * 3.7) * .2; }

  window.NyxHome = function (host, apps, open, tagline) {
    host.innerHTML = '<svg class="under"></svg><div class="blocks"></div><svg class="over"></svg><div class="spell"></div>';
    var under = host.querySelector(".under"), over = host.querySelector(".over"), blocks = host.querySelector(".blocks"), spellEl = host.querySelector(".spell");
    var B = apps.map(function (a, i) {
      var el = document.createElement("button"); el.type = "button"; el.className = "blk"; el.setAttribute("aria-label", a.en);
      el.onclick = function () { open(a); }; blocks.appendChild(el);
      var lb = document.createElement("div"); lb.className = "lab"; lb.innerHTML = a.en + (a.zh ? "<small>" + a.zh + "</small>" : ""); blocks.appendChild(lb);
      return { a: a, el: el, lb: lb, art: ART[a.art] || ART[ART_ORDER[i % ART_ORDER.length]], tx: TEX_ORDER[i % TEX_ORDER.length] };
    });
    // the sentence at the bottom spells itself out one token at a time; each word carries the sampling bars it was picked from
    var R0 = seeded(41), toks = (tagline || "").split(/(?=\s)/).filter(Boolean);
    spellEl.innerHTML = toks.map(function (t, k) { var n = 3 + Math.floor(R0() * 4), bs = "";
      for (var q = 0; q < n; q++) bs += "<i" + (q ? ' class="lo"' : "") + ' style="--h:' + ((q ? (.1 + R0() * .35) * Math.pow(.75, q) : .55 + R0() * .45) * 100).toFixed(0) + '%"></i>';
      return '<span class="tk"><span class="bs">' + bs + '</span><span class="tx">' + t.trim() + (k === toks.length - 1 ? '<span class="cur"></span>' : "") + "</span></span>"; }).join("");
    var spellT = [];
    function spell() { spellT.forEach(clearTimeout); spellT = [];
      spellEl.querySelectorAll(".tk").forEach(function (e, k) { e.classList.remove("on"); spellT.push(setTimeout(function () { e.classList.add("on"); }, 500 + k * 240)); }); }

    var side = null;
    function layout() {
      side = document.documentElement.dataset.side; var mirror = side === "moon", W = host.clientWidth, u = W / 100;
      var y = 30, rects = [];
      B.forEach(function (b, i) {
        var tier = i === 0 ? [58, 40] : i < 3 ? [38, 24] : i < 5 ? [30, 18] : [22, 13], left = (i % 2 === 0) !== mirror;
        var r = { x: (left ? 7 : 93 - tier[0]) * u, y: y * u, w: tier[0] * u, h: tier[1] * u, left: left };
        rects.push(r); y += tier[1] + (i === 0 ? 22 : 20);
        b.el.style.cssText = "left:" + r.x + "px;top:" + r.y + "px;width:" + r.w + "px;height:" + r.h + "px;background:" + T[side][b.tx] + " " + (-r.x * .7) + "px " + (-r.y * .7) + "px/200px";
        b.lb.style.left = r.x + "px"; b.lb.style.top = r.y + r.h + 6 + "px";
      });
      var bottom = y * u;
      spellEl.style.top = bottom + "px"; host.style.height = bottom + spellEl.offsetHeight + 30 * u + "px";
      // fit the sentence on one line
      var f = 3.9; spellEl.style.fontSize = f + "vw"; while (spellEl.scrollWidth > spellEl.clientWidth + 1 && f > 2.6) { f -= .1; spellEl.style.fontSize = f + "vw"; }
      draw(rects, u, bottom);
    }
    function draw(rects, u, bottom) {
      var inkC = side === "sun" ? "#221E1C" : "#7A3420", hiC = side === "sun" ? "#ECE8E1" : "#C9A898", pts = [];
      rects.forEach(function (r, i) {
        var ex = r.left ? r.x + r.w + 2.2 * u : r.x - 2.2 * u;
        if (i === 0) { pts.push([r.x + r.w * .5, r.y + r.h * .35], [ex, r.y + r.h * .7]); return; }   // the river starts under the first block, as if already flowing
        if (r.h < 20 * u) pts.push([ex, r.y + r.h / 2]); else pts.push([ex, r.y + r.h * .15], [ex, r.y + r.h * .85]);
      });
      var last = pts[pts.length - 1]; pts.push([(last[0] + 50 * u) / 2, bottom - 4 * u], [50 * u, bottom + 2 * u]);
      under.innerHTML = '<defs><filter id="nyxInk" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter></defs><path class="g" d="' + smooth(pts) + '" fill="none"/><g filter="url(#nyxInk)"></g>';
      var g = under.querySelector(".g"), L = g.getTotalLength(), h = "", step = 5, prev = g.getPointAtLength(0);
      for (var s = step; s < L; s += step) { var q = g.getPointAtLength(s), t = s / L, n = noise(s / 90, 1);
        if (t > .92) { if (Math.round(s / step) % 5 === 0) h += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + Math.max(.22 * u, (1 - t) * 6 * u).toFixed(2) + '" fill="' + inkC + '"/>'; prev = q; continue; }   // the tail breaks into dots and falls into the sentence
        if (n > .62 && n < .7) { prev = q; continue; }
        h += '<line x1="' + prev.x.toFixed(1) + '" y1="' + prev.y.toFixed(1) + '" x2="' + q.x.toFixed(1) + '" y2="' + q.y.toFixed(1) + '" stroke="' + (n > .55 ? hiC : inkC) + '" stroke-width="' + Math.max(.4, (2.8 + n * 2.4) * u * (1 - t * .7)).toFixed(2) + '" stroke-linecap="round"/>'; prev = q; }
      under.querySelector("g").innerHTML = h;
      // a hairline companion beside the river, solid in places, dashed in others
      var off = ""; for (var s2 = 0; s2 < L; s2 += 6) { var a = g.getPointAtLength(s2), b = g.getPointAtLength(Math.min(L, s2 + 1)), nx = -(b.y - a.y), ny = b.x - a.x, ln = Math.hypot(nx, ny) || 1; off += (s2 ? "L" : "M") + (a.x + nx / ln * 3.4 * u).toFixed(1) + " " + (a.y + ny / ln * 3.4 * u).toFixed(1); }
      under.insertAdjacentHTML("beforeend", '<path d="' + off + '" fill="none" stroke="' + inkC + '" stroke-width="' + (.22 * u) + '" stroke-dasharray="' + (30 * u) + " " + (4 * u) + " " + u + " " + (3 * u) + '" opacity=".6"/>');
      // drawings: a light copy clipped inside the block, an ink copy masked outside it — so they can break out of the frame
      var o = "<defs>";
      rects.forEach(function (r, i) { o += '<clipPath id="nin' + i + '"><rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '"/></clipPath><mask id="nout' + i + '"><rect x="-999" y="-999" width="9999" height="99999" fill="#fff"/><rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#000"/></mask>'; });
      o += "</defs>";
      B.forEach(function (b, i) { var r = rects[i];
        o += '<g clip-path="url(#nin' + i + ')" style="--c:var(--hi)">' + b.art(r, seeded(17 + i)) + "</g>";
        o += '<g mask="url(#nout' + i + ')" style="--c:var(--ink)">' + b.art(r, seeded(17 + i)) + "</g>"; });
      over.innerHTML = o;
    }
    var lastSide = null;
    function refresh() { layout(); if (lastSide !== side) { lastSide = side; spell(); } }
    addEventListener("resize", function () { if (!host.closest("[hidden]")) layout(); });
    return { refresh: refresh };
  };
})();
