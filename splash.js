/* Nychthemeron — opening card. A word list per side; the first letters drop in vertically and each one pulls its
   word out to the right. When the side flips, every word turns over on its row into the other side's word.
   Tap to skip. NyxSplash(fromSide, toSide) */
(function () {
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, busy = false;
  var COL = { sun: { bg: "#FAF7F2", fg: "#D97757", sub: "#9A8F86" }, moon: { bg: "#0B0908", fg: "#D97757", sub: "#B9705A" } };
  function row(w, side, cls) { return '<span class="w ' + (cls || "") + '" style="color:' + COL[side].sub + '"><b>' + w[0] + "</b>" + (w[1] ? "<i>" + w[1] + "</i>" : "") + "</span>"; }
  window.NyxSplash = function (from, to, words) {
    if (busy || !words || !words[from]) return; busy = true;
    var A = words[from], Z = words[to] || A, el = document.createElement("div"); el.id = "splash"; el.style.background = COL[from].bg;
    el.innerHTML = A.map(function (w, k) { return '<div class="row"><span class="L" style="color:' + COL[from].fg + '">' + w[0][0] + '</span><span class="wd">' + row(w, from) + (to !== from ? row(Z[k], to, "wait") : "") + "</span></div>"; }).join("");
    document.body.appendChild(el);
    var T = [], ended = false, at = function (ms, f) { T.push(setTimeout(f, reduce ? 0 : ms)); };
    var end = function () { if (ended) return; ended = true; T.forEach(clearTimeout); el.classList.add("out"); setTimeout(function () { el.remove(); busy = false; }, 500); };
    el.onclick = end;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var Ls = el.querySelectorAll(".L"), rows = el.querySelectorAll(".row"), n = rows.length;
      Ls.forEach(function (x, k) { at(90 * k, function () { x.classList.add("in"); }); });
      rows.forEach(function (r, k) { at(600 + 110 * k, function () { r.querySelector(".w").classList.add("in"); }); });
      var t = 600 + 110 * n + 700;
      if (to !== from) {
        t += 1500;   // let the first side be read before it turns
        at(t, function () { el.style.background = COL[to].bg; Ls.forEach(function (x) { x.style.color = COL[to].fg; }); });
        rows.forEach(function (r, k) { at(t + 120 * k, function () { var ws = r.querySelectorAll(".w"); ws[0].classList.add("gone"); ws[1].classList.remove("wait"); ws[1].classList.add("in"); }); });
        t += 120 * n + 1300;
      } else t += 600;
      at(t, end);
    }); });
  };
})();
