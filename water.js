/* Nyx — the water under NyxTree, seen from above: a tide of fingerprint-fine pen lines that follow the swell,
   its front breaking into white foam (after an engraved wave 唯 liked). By day it comes in from the bottom and the
   tree stands in it; by night it comes down from the top. Drawn by a small WebGL shader over the plain paper.
   NyxWater(canvas) → { draw(seconds, side, tilt, base), reset() } — or null without WebGL (the tree just stands on paper). */
(function () {
  var VS = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }";
  var FS = [
    "#extension GL_OES_standard_derivatives : enable",
    "precision highp float;",
    "uniform vec2 res; uniform float t, moon, level; uniform vec2 tilt; uniform vec3 ink; uniform vec2 base;",
    "float h(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }",
    "float n(vec2 q){ vec2 i = floor(q), f = fract(q); f = f * f * (3. - 2. * f);",
    "  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }",
    "float fbm(vec2 q){ float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * n(q); q = q * 2.03 + 17.1; a *= .5; } return s; }",
    "float line(float v, float hw){ float dd = abs(fract(v + .5) - .5) / max(fwidth(v), 1e-4); return 1. - smoothstep(hw - .5, hw + .6, dd); }",   // hw: half width in pixels
    "void main(){",
    "  vec2 uv = gl_FragCoord.xy / res; float y = 1. - uv.y;",          // y: 0 top … 1 bottom
    "  if (moon > .5) y = 1. - y;",                                     // by night the water hangs from the top
    "  vec2 q = vec2(uv.x * res.x / res.y, y);",
    "  float wash = .012 * sin(t * .45) + .006 * sin(t * 1.1 + q.x * 4.);",          // the tide breathing in and out
    "  float e = y - (1. - level) + wash + tilt.x * (uv.x - .5) * .02",
    "            + (fbm(q * vec2(5., 3.) + vec2(t * .04, 0.)) - .5) * .11;",        // a ragged front
    "  if (e < -.02) { gl_FragColor = vec4(0.); return; }",
    "  float warp = fbm(q * 2.2 + vec2(0., -t * .03)) * 1.8 + fbm(q * 5. + t * .05) * .5;",
    "  float f = e * 170. + warp * 16.;",                                  // fingerprint lines that follow the swell
    "  float L = line(f, .5) * smoothstep(-.005, .01, e);",
    "  float foam = smoothstep(.42, .6, fbm(q * vec2(7., 11.) + vec2(t * .06, -t * .02))) * (1. - smoothstep(.0, .16, e))",
    "             + smoothstep(.6, .72, fbm(q * 9. + 5. + t * .04)) * (1. - smoothstep(.12, .36, e));",
    "  L *= 1. - clamp(foam * 1.6, 0., 1.);",                           // white foam breaks the lines
    "  float w = L * (.16 + .42 * smoothstep(.0, .3, e));",            // deeper water, darker ink
    "  gl_FragColor = vec4(ink * w, w);",
    "}"].join("\n");

  window.NyxWater = function (cv) {
    var gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl || !gl.getExtension("OES_standard_derivatives")) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var pr = gl.createProgram();
    try { gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); } catch (e) { return null; }
    gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var lp = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ["res", "t", "moon", "level", "tilt", "ink", "base"].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });
    var lv = 0, lastSide = null, lastT = 0;
    return {
      reset: function () { lv = 0; },
      // base: [x as a fraction of the width, depth below the waterline] where the rings start
      draw: function (tt, side, tilt, base) {
        if (side !== lastSide) { lastSide = side; lv = 0; }
        if (tt === lastT) lv = (side === "moon" ? .36 : .4);   // reduced motion: the tide is simply in
        var target = (side === "moon" ? .36 : .4) + Math.sin(tt * .25) * .008, dt = Math.min(.3, Math.max(0, tt - lastT)); lastT = tt;
        lv += (target - lv) * (1 - Math.exp(-dt * .9));   // the tide comes in over a few seconds
        gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U.res, cv.width, cv.height); gl.uniform1f(U.t, tt); gl.uniform1f(U.moon, side === "moon" ? 1 : 0);
        gl.uniform1f(U.level, lv); gl.uniform2f(U.tilt, tilt[0], tilt[1]);
        gl.uniform3fv(U.ink, side === "moon" ? [.85, .81, .76] : [.12, .1, .086]);
        gl.uniform2f(U.base, base[0], base[1]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  };
})();
