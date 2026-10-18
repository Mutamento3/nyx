/* Nyx — the water under NyxTree: a real sea surface in three.js, seen from high above at a slant.
   Gerstner swells move the mesh; three scrolling normal maps ripple it; it reflects a pale sky (by day) or a dark one
   with a silver moon (by night) by Fresnel, the light breaks into glints, and where the tide meets the paper it
   goes shallow, clears and foams. By day the tide comes in from the bottom and the tree stands in it; by night the
   same sea hangs from the top (the canvas is turned over). The page stays white or black around it.
   three.js is loaded from jsDelivr the first time; the normal map (from the three.js examples, MIT) is in assets/.
   NyxWater(canvas) → { draw(seconds, side, tilt), reset() }. Draws nothing until three.js has loaded. */
(function () {
  var THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var NORMALS = new URL("assets/waternormals.jpg", here).href;

  var VS = [
    "uniform float time; varying vec3 vW; varying vec3 vN;",
    // three Gerstner swells: the surface really moves, crests sharpen, troughs flatten
    "vec3 g(vec2 d, float k, float a, float s, vec3 p, inout vec3 tg, inout vec3 bn){",
    "  d = normalize(d); float f = k * (dot(d, p.xz) - s * time), q = a / k;",
    "  tg += vec3(-d.x * d.x * a * sin(f), d.x * a * cos(f), -d.x * d.y * a * sin(f));",
    "  bn += vec3(-d.x * d.y * a * sin(f), d.y * a * cos(f), -d.y * d.y * a * sin(f));",
    "  return vec3(d.x * q * cos(f), q * sin(f), d.y * q * cos(f)); }",
    "void main(){",
    "  vec3 p = (modelMatrix * vec4(position, 1.)).xyz, tg = vec3(1, 0, 0), bn = vec3(0, 0, 1), o = vec3(0);",
    "  o += g(vec2(.3, 1.), .55, .16, 1.3, p, tg, bn);",
    "  o += g(vec2(-.6, .8), 1.1, .12, 1.1, p, tg, bn);",
    "  o += g(vec2(.9, .45), 2.3, .08, .9, p, tg, bn);",
    "  p += o; vW = p; vN = normalize(cross(bn, tg));",
    "  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }"].join("\n");

  var FS = [
    "uniform sampler2D nm; uniform float time, shore; uniform vec3 cam, sun, deep, shallow, skyLo, skyHi, glint, foamC;",
    "varying vec3 vW; varying vec3 vN;",
    "float h(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }",
    "float n2(vec2 q){ vec2 i = floor(q), f = fract(q); f = f * f * (3. - 2. * f);",
    "  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }",
    "float fbm(vec2 q){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * n2(q); q *= 2.07; a *= .5; } return s; }",
    "vec3 tex(vec2 uv){ return texture2D(nm, uv).rbg * 2. - 1.; }",
    "void main(){",
    "  vec2 xz = vW.xz;",
    "  vec3 r = tex(xz * .09 + vec2(time * .012, time * .02)) + tex(xz * .21 - vec2(time * .018, -time * .009)) * .6",
    "         + tex(xz * .5 + vec2(-time * .03, time * .025)) * .3;",
    "  vec3 N = normalize(vN * .9 + vec3(r.x, 0., r.z) * 1.1);",
    "  vec3 V = normalize(cam - vW);",
    "  float fr = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);",
    "  vec3 R = reflect(-V, N); vec3 sky = mix(skyLo, skyHi, smoothstep(-.05, .6, R.y));",
    "  float sp = pow(max(dot(R, sun), 0.), 500.) * 2.2 + pow(max(dot(R, sun), 0.), 30.) * .12;",
    "  float sss = pow(max(vW.y + .1, 0.), 2.) * .35;",                          // light through the crests
    "  float rel = dot(N, normalize(vec3(-.4, .8, .45)));",   // the relief of the swell, lit from one side
    "  vec3 col = mix(deep * (.55 + .7 * rel) + sss * shallow, sky, fr) + glint * sp;",
    // the tide line: e = how far into the water; a ragged front that washes in and out
    "  float wash = .25 * sin(time * .5) + .12 * sin(time * 1.3 + xz.x * .8);",
    "  float e = (xz.y - shore) + wash + (fbm(xz * vec2(.6, .9) + vec2(time * .05, 0.)) - .5) * 1.6;",
    "  float sh = smoothstep(0., 2.6, e);",                                        // shallow water clears toward the edge
    "  col = mix(shallow, col, .35 + .65 * sh);",
    "  float fm = fbm(xz * 2.4 + vec2(time * .12, -time * .05)) + fbm(xz * 5.5 - time * .08) * .5;",
    "  float lace = 1. - smoothstep(.0, .045, abs(fbm(xz * 3.2 + vec2(time * .1, -time * .04)) - .5));",   // the net foam leaves behind
    "  float foam = (smoothstep(.75, .95, fm + (1. - smoothstep(0., .9, e)) * .5) + lace * .75) * (1. - smoothstep(.2, 2.4, e));",
    "  foam += (1. - smoothstep(0., .22, abs(e - .1))) * .8;",                     // the bright lip of the wave
    "  foam += smoothstep(.9, 1.05, fm) * smoothstep(.7, 1., vW.y / .35) * .35;",   // whitecaps on the crests
    "  col = mix(col, foamC, clamp(foam, 0., 1.));",
    "  float a = smoothstep(-.06, .12, e);",
    "  gl_FragColor = vec4(col * a, a); }"].join("\n");

  window.NyxWater = function (cv) {
    var api = { ready: false, draw: function () {}, reset: function () {} };
    import(THREE_URL).then(function (T) {
      var R; try { R = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, premultipliedAlpha: true }); } catch (e) { return; }
      R.setClearColor(0x000000, 0);
      var scene = new T.Scene(), cam = new T.PerspectiveCamera(38, 1, .1, 200);
      cam.position.set(0, 13, 9); cam.lookAt(0, 0, -1.5);
      var tx = new T.TextureLoader().load(NORMALS); tx.wrapS = tx.wrapT = T.RepeatWrapping;
      var U = { nm: { value: tx }, time: { value: 0 }, shore: { value: 6 }, cam: { value: cam.position },
        sun: { value: new T.Vector3() }, deep: { value: new T.Color() }, shallow: { value: new T.Color() },
        skyLo: { value: new T.Color() }, skyHi: { value: new T.Color() }, glint: { value: new T.Color() }, foamC: { value: new T.Color() } };
      var geo = new T.PlaneGeometry(60, 60, 220, 220); geo.rotateX(-Math.PI / 2);
      scene.add(new T.Mesh(geo, new T.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, premultipliedAlpha: true })));
      var lv = 0, lastSide = null, lastT = 0, w = 0, h = 0, ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
      // the world z where the tide line sits for a given height on screen (0 bottom … 1 top)
      function zAt(f) { ray.setFromCamera(new T.Vector2(0, f * 2 - 1), cam); return ray.ray.intersectPlane(plane, hit) ? hit.z : -40; }
      function palette(moon) {
        if (moon) { U.deep.value.setRGB(.03, .032, .036); U.shallow.value.setRGB(.05, .05, .055); U.skyLo.value.setRGB(.14, .14, .15);
          U.skyHi.value.setRGB(.02, .02, .025); U.glint.value.setRGB(.55, .55, .52); U.foamC.value.setRGB(.3, .3, .29);
          U.sun.value.set(-.15, .5, -1).normalize(); }
        else { U.deep.value.setRGB(.40, .41, .42); U.shallow.value.setRGB(.83, .82, .80); U.skyLo.value.setRGB(.95, .94, .92);
          U.skyHi.value.setRGB(.70, .71, .73); U.glint.value.setRGB(1, 1, .98); U.foamC.value.setRGB(.985, .98, .97);
          U.sun.value.set(.1, .55, -1).normalize(); }
      }
      api.ready = true;
      api.reset = function () { lv = 0; };
      api.draw = function (tt, side, tilt) {
        if (cv.width !== w || cv.height !== h) { w = cv.width; h = cv.height; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
        if (side !== lastSide) { lastSide = side; lv = 0; palette(side === "moon"); cv.style.transform = side === "moon" ? "scaleY(-1)" : ""; }
        var target = (side === "moon" ? .36 : .4) + Math.sin(tt * .25) * .01, dt = Math.min(.3, Math.max(0, tt - lastT)); lastT = tt;
        if (dt === 0) lv = target; else lv += (target - lv) * (1 - Math.exp(-dt * .8));   // the tide comes in over a few seconds
        cam.position.x = tilt[0] * .8; cam.lookAt(tilt[0] * .3, 0, -1.5);
        U.time.value = tt; U.shore.value = zAt(lv);
        R.render(scene, cam);
      };
    }).catch(function () {});
    return api;
  };
})();
