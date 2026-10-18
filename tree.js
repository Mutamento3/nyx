/* Nyx — NyxTree, the other home. One tree in ink, rooted off the bottom-left of the screen and leaning out to the
   upper right, the right side left open for light. Every branch carries a depth (z, far -1 … near 1): near ones are
   thicker and darker, far ones thin and pale. Tilt the phone and branches slide against each other by depth; a slow
   wind sways each tip by its own depth. By day the tree grows one more tier and a few leaves; at night it keeps only
   the bones. Each entry in NYX.apps hangs at an outer tip as a small frosted disc with one dot of clay orange.
   Tap one: a dozen glass squares break off that tip and drift up while the room opens.
   Shape after Yan's sketch; roots after Crys. Same signature as NyxHome: NyxTree(host, apps, open, opt) → { refresh, stop }.
   opt.photo: an image laid under the tree on the night side only, pressed dark. */
(function () {
  function seeded(s) { return function () { s = s * 16807 % 2147483647; return s / 2147483647; }; }

  // the tree in a 390 × 844 frame (scaled to the screen), after Yan's tree.mjs
  function grow(night) {
    var W = 390, H = 844, rnd = seeded(7), UPR = -Math.PI / 2 + .3, P = [];   // v1's bones: 唯 said the first one looked most like a tree
    function branch(x, y, ang, len, w, z, tier, maxTier, parent) {
      var pts = [[x, y]], a = ang, cx = x, cy = y, n = 14;
      for (var i = 1; i <= n; i++) {
        // a little wander; the wind carries only the trunk and the big limbs up and right — from the second tier on,
        // twigs go their own way so the hand opens (Yan)
        a += (rnd() - .5) * .16 + (UPR - a) * .06;
        if (tier === 0 && a < -Math.PI / 2 - .12) a += (-Math.PI / 2 - .12 - a) * .5;   // the trunk doesn't curl back left
        if (cx < 60) a += (UPR - a) * .25; if (cx > W - 70) a -= .12;
        cx += Math.cos(a) * len / n; cy += Math.sin(a) * len / n; pts.push([cx, cy]);
      }
      var me = { pts: pts, w0: w, w1: w * (tier === 0 ? .22 : .5), z: z, tier: tier, parent: parent, kids: [] };
      // after Dora Lazarevic's Europe (唯): the trunk is solid ink, limbs taper fast, twigs are pen hairlines
      if (tier === 1) me.w1 = 2; else if (tier >= 2) { me.w0 = 1.15; me.w1 = .7; }
      P.push(me); if (parent) parent.kids.push(me);
      if (tier >= maxTier) return [{ x: cx, y: cy, a: a, b: me }];
      var kids = tier === 0 ? 3 : 2, ends = [];
      for (var k = 0; k < kids; k++) {
        var t = tier === 0 ? [.38, .62, .97][k] : [.5, .95][k], j = Math.min(n, Math.round(t * n)), bx = pts[j][0], by = pts[j][1];
        var wl = w + (w * (tier === 0 ? .22 : .5) - w) * j / n, side = (tier + k) % 2 ? 1 : -1;
        var na = a + side * (.5 + rnd() * .3) * (side < 0 ? .75 : 1);
        me.at = me.at || []; me.at.push(j);
        ends.push.apply(ends, branch(bx, by, na, len * (tier === 0 ? .6 : .62), wl * (tier === 0 ? .62 : .66),
          Math.max(-1, Math.min(1, z + (rnd() - .5) * .9)), tier + 1, maxTier, me));
      }
      if (tier < 2 && me.at) {   // the parent stops at its last fork; the last child carries on from there (no stub, Yan)
        var last = Math.max.apply(null, me.at); me.pts = pts.slice(0, last + 1); me.w1 = w + (me.w1 - w) * last / n;
      }
      return [{ x: cx, y: cy, a: a, b: me }].concat(ends);
    }
    // the same seed grows the same bones by day and night; the day just goes one tier further
    // always grow all three tiers so the bones are identical; the night side just doesn't draw the last one
    var tips = branch(74, H + 30, -Math.PI / 2 + .04, 470, 18, 0, 0, 3, null);
    var top = Infinity; P.forEach(function (b) { b.pts.forEach(function (p) { if (p[1] < top) top = p[1]; }); });   // same frame day and night
    // (the night side drops the last tier when drawing; twigs that carry an entry stay)
    var leaves = [];
    if (!night) P.forEach(function (b) {   // (P is already trimmed at night)
      if (b.tier >= 2 && rnd() < .5) { var e = b.pts[b.pts.length - 1], q = b.pts[b.pts.length - 2], a = Math.atan2(e[1] - q[1], e[0] - q[0]);
        leaves.push({ b: b, a: a }); }
    });
    // roots (Crys, weighed by Yan): a few, half the trunk, heading down and down-left out of the frame
    var R = seeded(31), roots = [], spec = [[Math.PI * .72, 1.0], [Math.PI * .58, .8], [Math.PI * .46, .9], [Math.PI * .86, 1.2]];
    spec.forEach(function (sp, r) {
      var x = 72 + (R() - .5) * 8, y = H - 40 + R() * 6, a = sp[0], pts = [[x, y]], len = 200 * sp[1];
      for (var s2 = 0; s2 < 14; s2++) { a += (R() - .5) * .2; a = Math.max(Math.PI * .35, Math.min(Math.PI * .95, a)); x += Math.cos(a) * len / 14; y += Math.sin(a) * len / 14; pts.push([x, y]); }
      roots.push({ pts: pts, w0: 7 - r * .9, w1: .8, z: (R() - .5) * .4, root: true });
    });
    return { P: P, tips: tips, leaves: leaves, roots: roots, W: W, H: H, top: top };
  }

  window.NyxTree = function (host, apps, open, opt) {
    opt = opt || {};
    host.innerHTML = '<div class="tree"><canvas></canvas><div class="tags"></div></div>';
    var box = host.querySelector(".tree"), cv = box.querySelector("canvas"), ctx = cv.getContext("2d"), tags = box.querySelector(".tags");
    if (opt.photo) { box.style.setProperty("--photo", 'url("' + opt.photo + '")'); box.classList.add("photo"); }
    var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var G = {}, side = null, W = 0, H = 0, S = 1, OX = 0, OY = 0, dpr = 1, raf = 0, t0 = performance.now();
    var tilt = [0, 0], tiltT = [0, 0], burst = [], leaving = null, picked = [], labels = [];

    function build() {
      side = document.documentElement.dataset.side === "moon" ? "moon" : "sun";
      G = grow(side === "moon");
      // entries hang at outer tips that sit apart from each other (Yan: 80 apart)
      // only second-tier tips: they exist by day and by night, so an entry stays on the same twig when the page turns over
      var far = G.tips.filter(function (t) { return t.b.tier >= 2 && t.y < G.H * .7 && t.y > 150 && t.x > 44 && t.x < G.W - 56; }).sort(function (a, b) { return a.y - b.y; });
      picked = [];
      for (var i = 0; i < far.length && picked.length < apps.length; i++) {
        var t = far[i]; if (picked.every(function (p) { return Math.hypot(p.x - t.x, p.y - t.y) > 80; })) picked.push(t);
      }
      if (picked.length < apps.length) {   // not enough room: loosen the spacing, then take first-tier tips too
        var more = G.tips.filter(function (t) { return t.b.tier >= 2 && t.y > 120 && t.y < G.H * .74 && t.x > 40 && t.x < G.W - 50; });
        [60, 44, 0].forEach(function (gap) { more.forEach(function (t) {
          if (picked.length < apps.length && picked.indexOf(t) < 0 && picked.every(function (p) { return Math.hypot(p.x - t.x, p.y - t.y) > gap; })) picked.push(t); }); });
      }
      // the most-used ones (first in NYX.apps) go to the tips nearest the trunk; the far-reaching tips to the rarely used
      picked.sort(function (a, b) { return Math.hypot(a.x - 74, a.y - 500) - Math.hypot(b.x - 74, b.y - 500); });
      // a twig that carries an entry ends there: nothing grows on past the disc (Yan)
      var cut = new Set(); picked.forEach(function (t) { (function drop(b) { b.kids.forEach(function (k) { cut.add(k); drop(k); }); })(t.b); });
      var carry = new Set(picked.map(function (t) { return t.b; }));
      G.draw = G.P.filter(function (b) { return !cut.has(b) && (side === "sun" || b.tier < 3 || carry.has(b)); });
      G.leafs = G.leaves.filter(function (l) { return !cut.has(l.b) && picked.every(function (t) { return t.b !== l.b; }); });
      tags.innerHTML = ""; labels = picked.map(function (t, i) {
        var a = apps[i], b = document.createElement("button"); b.type = "button"; b.className = "tag";
        b.innerHTML = "<i></i><span>" + a.en + (a.zh ? "<small>" + a.zh + "</small>" : "") + "</span>";
        b.onclick = function () { go(i); }; tags.appendChild(b); return b;
      });
    }
    function size() {
      var r = (host.closest(".scroller") || host.parentElement).getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(280, r.width); H = Math.max(480, r.height);
      host.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      // fit: the highest tip stops a finger below the header; the tree's edge is drawn, not cut by the screen (Yan)
      var head = 92, room = H - head - 8, span = G.H - G.top;
      S = Math.min(W / G.W * 1.04, room / span); OX = 6; OY = H - G.H * S;
    }
    // a point on branch b, moved by tilt and wind according to its depth
    function at(b, p, k, n, tt) {
      var z = b.z, sway = still ? 0 : Math.sin(tt * (.5 + (z + 1) * .25) + b.pts[0][0] * .02) * (1.5 + (z + 1) * 2.2) * Math.pow(k / n, 1.6) * (b.root ? 0 : 1);
      return [OX + (p[0] + tilt[0] * z * 12 + sway) * S, OY + (p[1] + tilt[1] * z * 8) * S];
    }
    // ink mixed into the paper colour, fully opaque: where branches overlap at a joint there is no darker seam
    function ink(op) {
      var a = side === "moon" ? [217, 207, 194] : [31, 26, 22], p = side === "moon" ? [12, 10, 9] : [236, 232, 225];
      return "rgb(" + a.map(function (v, i) { return Math.round(p[i] + (v - p[i]) * Math.min(1, op)); }).join(",") + ")";
    }
    function ribbon(b, tt) {
      var n = b.pts.length - 1, L = [], Rr = [];
      if (b.parent || b.root) {   // tuck the start into the parent and round it off (Yan)
        var s0 = at(b, b.pts[0], 0, n, tt), s1 = at(b, b.pts[1], 1, n, tt), dd = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1, rr = b.w0 / 2 * S;
        ctx.beginPath(); ctx.arc(s0[0], s0[1], rr, 0, Math.PI * 2);
        ctx.fillStyle = ink(b.root ? .5 : .35 + .65 * (b.z + 1) / 2); ctx.fill();
      }
      for (var i = 0; i <= n; i++) {
        var p = at(b, b.pts[i], i, n, tt), pp = at(b, b.pts[Math.max(0, i - 1)], Math.max(0, i - 1), n, tt), np = at(b, b.pts[Math.min(n, i + 1)], Math.min(n, i + 1), n, tt);
        var dx = np[0] - pp[0], dy = np[1] - pp[1], d = Math.hypot(dx, dy) || 1, w = (b.w0 + (b.w1 - b.w0) * i / n) / 2 * S * (b.jit ? b.jit[i] : 1);
        L.push([p[0] - dy / d * w, p[1] + dx / d * w]); Rr.push([p[0] + dy / d * w, p[1] - dx / d * w]);
      }
      ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
      for (var k = 1; k < L.length; k++) ctx.lineTo(L[k][0], L[k][1]);
      for (k = Rr.length - 1; k >= 0; k--) ctx.lineTo(Rr[k][0], Rr[k][1]);
      ctx.closePath();
      var near = (b.z + 1) / 2;

      ctx.filter = b.z < -.3 ? "blur(.6px)" : "none";
      ctx.fillStyle = ink(b.root ? .8 : b.tier === 0 ? 1 : b.tier === 1 ? .78 + .2 * near : .55 + .35 * near); ctx.fill();
      var e = at(b, b.pts[n], n, n, tt);   // round the far end too, as its own shape so the winding can't punch a hole
      ctx.beginPath(); ctx.arc(e[0], e[1], b.w1 / 2 * S, 0, Math.PI * 2); ctx.fill();
    }
    function frame(now) {
      var tt = (now - t0) / 1000;
      if ((document.documentElement.dataset.side === "moon" ? "moon" : "sun") !== side) { build(); size(); }
      tilt[0] += (tiltT[0] - tilt[0]) * .05; tilt[1] += (tiltT[1] - tilt[1]) * .05;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      G.roots.forEach(function (b) { ribbon(b, tt); });
      G.draw.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (b) { ribbon(b, tt); });
      ctx.filter = "none";
      if (side === "sun") G.leafs.forEach(function (l) {   // line-drawn leaves at the day tips
        var b = l.b, n = b.pts.length - 1, e = at(b, b.pts[n], n, n, tt), op = (.35 + .65 * (b.z + 1) / 2) * .7;
        ctx.strokeStyle = ink(op); ctx.lineWidth = .8;
        [-.9, .9].forEach(function (o) { var a = l.a + o, cx = e[0] + Math.cos(a) * 9 * S, cy = e[1] + Math.sin(a) * 9 * S;
          ctx.beginPath(); ctx.ellipse(cx, cy, 8 * S, 3.2 * S, a, 0, Math.PI * 2); ctx.stroke(); });
      });
      // entries ride their tips
      picked.forEach(function (t) {
        var b = t.b, n = b.pts.length - 1, e = at(b, b.pts[n], n, n, tt);
        t.sx = e[0] + Math.cos(t.a) * 14 * S; t.sy = e[1] + Math.sin(t.a) * 14 * S;
      });
      picked.forEach(function (t, i) {
        // label to the outer side, unless another entry sits where the words would go
        var left = t.sx > W * .55, blocked = function (l) { return picked.some(function (o) { return o !== t &&
          Math.abs(o.sy - t.sy) < 44 && (l ? o.sx < t.sx && o.sx > t.sx - 140 : o.sx > t.sx && o.sx < t.sx + 140); }); };
        if (blocked(left) && !blocked(!left)) left = !left;
        if (t.left == null || t.left !== left && blocked(t.left)) t.left = left;   // don't flicker as the wind moves things
        labels[i].classList.toggle("l", t.left);
        labels[i].style.transform = "translate(" + t.sx.toFixed(1) + "px," + t.sy.toFixed(1) + "px)";
      });
      // glass squares breaking off the tip you tapped
      burst = burst.filter(function (q) { return q.life < q.max; });
      burst.forEach(function (q) {
        q.life++; q.x += q.vx; q.y += q.vy; q.vy -= .015; q.vx *= .985;
        var f = 1 - q.life / q.max, s = q.s * (1 + q.life / q.max * .4);
        ctx.globalAlpha = f * .9;
        ctx.fillStyle = side === "moon" ? "rgba(255,250,246,.22)" : "rgba(255,255,255,.62)"; ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
        ctx.strokeStyle = side === "moon" ? "rgba(255,250,246,.55)" : "rgba(31,26,22,.22)"; ctx.lineWidth = .7; ctx.strokeRect(q.x - s / 2, q.y - s / 2, s, s);
      });
      ctx.globalAlpha = 1;
      if (leaving && now - leaving.t > 520) { var a = apps[leaving.i]; leaving = null; open(a); }
      raf = (!still || burst.length || leaving) ? requestAnimationFrame(frame) : 0;
    }
    function go(i) {
      if (leaving) return; var t = picked[i];
      labels[i].classList.add("hit");
      for (var k = 0; k < 13; k++) burst.push({ x: t.sx, y: t.sy, vx: (Math.random() - .5) * 2.4, vy: -Math.random() * 1.6 - .4,
        s: 3 + Math.random() * Math.random() * 11, life: 0, max: 50 + Math.random() * 40 });
      leaving = { i: i, t: performance.now() };
      setTimeout(function () { labels[i] && labels[i].classList.remove("hit"); }, 900);
      if (!raf) raf = requestAnimationFrame(frame);
    }
    window.addEventListener("deviceorientation", function (e) {
      if (e.gamma == null) return;
      tiltT = [Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, ((e.beta || 50) - 50) / 30))];
    });
    function start() { if (!raf && !document.hidden && host.offsetParent) raf = requestAnimationFrame(frame); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
    window.addEventListener("resize", function () { if (host.offsetParent) { size(); stop(); start(); } });
    function refresh() { build(); size(); stop(); raf = requestAnimationFrame(frame); }
    return { refresh: refresh, stop: stop };
  };
})();
