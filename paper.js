/* Nyx — the paper every page sits on: grain, the marks along the thread, a scatter of ink drops.
   Needs <div id="paper">, <svg id="drops"> in the page. NyxPaper.paint() after the side changes. */
(function () {
  "use strict";
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
  // ink drops scattered over the paper, like the send button: slim teardrops, some frosted, some striped, very faint
  function drops() {
    var W = 390, H = 844, R = Math.random, n = 10 + Math.floor(R() * 6), s = "";
    // slim teardrop pointing up, unit size; some frosted solid, some striped
    var D = "M0 -2.8 C.28 -1.6 .9 -.7 .9 .15 A.9 .9 0 0 1 -.9 .15 C-.9 -.7 -.28 -1.6 0 -2.8 Z";
    for (var i = 0; i < n; i++){ var r = 2.2 + Math.pow(R(), 2.3) * 7, k = R(), x = R() * W, y = R() * H, rot = 0;   // straight down, no tilt (10/16)
      var at = function (dx, dy, sc, rr){ return 'transform="translate(' + (x + dx).toFixed(1) + ' ' + (y + dy).toFixed(1) + ') rotate(' + rr.toFixed(1) + ') scale(' + sc.toFixed(2) + ')" d="' + D + '" '; };
      if (k < .4) s += '<path ' + at(0, 0, r, rot) + 'fill="currentColor" fill-opacity="' + (.1 + R() * .14).toFixed(3) + '" filter="url(#nyx_f)"/>';
      else if (k < .7) s += '<path ' + at(0, 0, r, rot) + 'fill="url(#nyx_s)" stroke="currentColor" stroke-width="' + (.6 / r).toFixed(3) + '" stroke-opacity=".35" opacity="' + (.35 + R() * .3).toFixed(2) + '"/>';
      else { var m = 2 + Math.floor(R() * 2), op = (.25 + R() * .25).toFixed(2);   // bare outlines, slightly different sizes, overlapping out of step
        for (var j = 0; j < m; j++){ var sc = r * (1 - j * (.14 + R() * .1)); s += '<path ' + at((R() - .5) * r * .9, (R() - .3) * r * 1.1, sc, rot) + 'fill="none" stroke="currentColor" stroke-width="' + (.7 / sc).toFixed(3) + '" opacity="' + op + '"/>'; } } }
    var defs = '<defs><filter id="nyx_f" x="-40%" y="-20%" width="180%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.9" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>' +
      '<pattern id="nyx_s" patternUnits="userSpaceOnUse" width="4" height=".34"><rect x="-2" width="8" height=".11" fill="currentColor"/></pattern></defs>';
    var el = document.getElementById("drops"); if (!el) return; el.setAttribute("viewBox", "0 0 " + W + " " + H); el.innerHTML = defs + s;
  }
  drops();
  function paintSide() {
    var root = document.documentElement, s = root.dataset.side, p = PAPER[s];
    root.style.setProperty("--grain", p[0]); root.style.setProperty("--marks", p[1]);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = s === "moon" ? "#0C0A09" : "#ECE8E1";
  }
  paintSide();
  window.NyxPaper = { paint: paintSide };
})();
