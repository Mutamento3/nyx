/* Nychthemeron — Room. An empty room to furnish: four walls, a window on the far wall, a lamp, a floor.
   You stand in the doorway; drag to look around, pinch (or scroll) to lean in, tap a thing to see its name.
   Day side: low gold sun slanting in through the window. Night side: dark sky, the lamp on.
   Furniture comes from config.js → room.items as .glb files (see docs/room-blender.md). Units are metres. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const C = window.NYX || {}, RM = C.room || {};
const [W, H, D] = RM.size || [3.4, 2.7, 4.4];
const root = document.documentElement, $ = id => document.getElementById(id);
let side = root.dataset.side === "moon" ? "moon" : "sun";
$("title").textContent = RM.name || "Room";
$("back").onclick = () => { location.href = "./"; };

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $("c"), antialias: true }); }
catch (e) { $("msg").textContent = "This browser can't draw the room (no WebGL)."; throw e; }
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, .05, 60);

/* ── canvas textures ── */
const cvs = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
const tex = (c, rx, ry) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rx) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); } return t; };
const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
function planks(base) {
  const [c, x] = cvs(512, 512), r = rng(7), col = new THREE.Color(base);
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) { let y = -r() * 300;
    while (y < 512) { const len = 160 + r() * 240, k = (r() - .5) * .07, cc = col.clone().offsetHSL(0, 0, k);
      x.fillStyle = "#" + cc.getHexString(); x.fillRect(i * 64 + 1, y + 1, 62, len - 2);
      for (let j = 0; j < 5; j++) { x.fillStyle = `rgba(20,12,6,${.08 + r() * .1})`; x.fillRect(i * 64 + 4 + r() * 54, y + r() * len, 1, 20 + r() * 70); }
      y += len; } }
  return tex(c, W / 1.6, D / 1.6);
}
function plaster(base) {
  const [c, x] = cvs(256, 256), r = rng(3); x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) { const px = r() * 256, py = r() * 256, rad = 30 + r() * 70, g = x.createRadialGradient(px, py, 0, px, py, rad), l = r() > .5;
    g.addColorStop(0, l ? "rgba(255,250,240,.022)" : "rgba(80,60,40,.022)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
  return tex(c, 2, 2);
}
function sky(s) {
  const [c, x] = cvs(512, 512), g = x.createLinearGradient(0, 0, 0, 512), r = rng(9);
  if (s === "sun") { g.addColorStop(0, "#9FB6C4"); g.addColorStop(.55, "#E9CFA8"); g.addColorStop(1, "#F2B57E"); }
  else { g.addColorStop(0, "#05070D"); g.addColorStop(.7, "#101A2C"); g.addColorStop(1, "#22273A"); }
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  if (s === "sun") { const sg = x.createRadialGradient(300, 300, 0, 300, 300, 150); sg.addColorStop(0, "rgba(255,236,200,1)"); sg.addColorStop(.12, "rgba(255,220,170,.9)"); sg.addColorStop(1, "rgba(255,200,140,0)"); x.fillStyle = sg; x.fillRect(0, 0, 512, 512); }
  else { for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${.2 + r() * .7})`; const s2 = r() < .1 ? 2 : 1; x.fillRect(r() * 512, r() * 360, s2, s2); }
    x.fillStyle = "#F4E6C8"; x.beginPath(); x.arc(300, 200, 14, 0, 7); x.fill(); x.fillStyle = "#0a0f1c"; x.beginPath(); x.arc(307, 195, 13, 0, 7); x.fill(); }
  // a far line of hills or rooftops
  x.fillStyle = s === "sun" ? "rgba(90,80,70,.35)" : "rgba(0,0,0,.6)"; x.beginPath(); x.moveTo(0, 512);
  for (let i = 0; i <= 16; i++) x.lineTo(i * 32, 400 + Math.sin(i * 1.7) * 18 + r() * 20); x.lineTo(512, 512); x.fill();
  return tex(c);
}
const SKY = { sun: sky("sun"), moon: sky("moon") };

/* ── the shell ── */
const mat = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: .9, metalness: 0 }, o));
const wallM = mat({ map: plaster(RM.wall || "#D9CEBC") }), floorM = mat({ map: planks(RM.floor || "#5B3F2B"), roughness: .75 }), ceilM = mat({ map: plaster(RM.ceiling || "#E6DDCD") });
const trimM = mat({ color: RM.trim || "#EFE8DC", roughness: .6 });
function box(w, h, d, m, x, y, z, cast = true) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = cast; b.receiveShadow = true; scene.add(b); return b; }
const T = .12, WIN = { w: Math.min(1.6, W * .5), h: 1.4, y: 1.5 };
box(W + 2 * T, T, D + 2 * T, floorM, 0, -T / 2, 0, false);
box(W + 2 * T, T, D + 2 * T, ceilM, 0, H + T / 2, 0);
box(T, H, D, wallM, -W / 2 - T / 2, H / 2, 0);
box(T, H, D, wallM, W / 2 + T / 2, H / 2, 0);
box(W + 2 * T, H, T, wallM, 0, H / 2, D / 2 + T / 2);
// the far wall, built around the window opening
const zb = -D / 2 - T / 2, wl = (W - WIN.w) / 2, top = WIN.y + WIN.h / 2, bot = WIN.y - WIN.h / 2;
box(wl + T, H, T, wallM, -W / 2 - T / 2 + (wl + T) / 2, H / 2, zb);
box(wl + T, H, T, wallM, W / 2 + T / 2 - (wl + T) / 2, H / 2, zb);
box(WIN.w, H - top, T, wallM, 0, top + (H - top) / 2, zb);
box(WIN.w, bot, T, wallM, 0, bot / 2, zb);
// window frame, a cross, a sill
const fz = -D / 2 - T / 2;
[[WIN.w + .08, .05, 0, top], [WIN.w + .08, .05, 0, bot], [.05, WIN.h, -WIN.w / 2, WIN.y], [.05, WIN.h, WIN.w / 2, WIN.y], [.03, WIN.h, 0, WIN.y], [WIN.w, .03, 0, WIN.y + .1]]
  .forEach(([w, h, x, y]) => box(w, h, T + .02, trimM, x, y, fz));
box(WIN.w + .2, .04, .22, trimM, 0, bot - .02, -D / 2 + .05);
// baseboards
[[W, -D / 2 + .01, 0], [W, D / 2 - .01, 0]].forEach(([w, z]) => box(w, .09, .02, trimM, 0, .045, z, false));
[[-W / 2 + .01], [W / 2 - .01]].forEach(([x]) => box(.02, .09, D, trimM, x, .045, 0, false));
// the sky behind the window
const skyM = new THREE.MeshBasicMaterial({ map: SKY[side], fog: false });
const skyP = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), skyM); skyP.position.set(0, 1.6, -D / 2 - 3); scene.add(skyP);

/* ── a pendant lamp ── */
const lamp = new THREE.Group(); scene.add(lamp);
const cord = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .5), mat({ color: "#1b1714" })); cord.position.y = H - .25; lamp.add(cord);
const shadeM = mat({ color: RM.shade || "#C9A56A", roughness: .5, side: THREE.DoubleSide, emissive: "#ffb46a", emissiveIntensity: 0 });
const shade = new THREE.Mesh(new THREE.ConeGeometry(.24, .2, 32, 1, true), shadeM); shade.position.y = H - .58; lamp.add(shade);
const bulbM = new THREE.MeshBasicMaterial({ color: "#fff1d6" });
const bulb = new THREE.Mesh(new THREE.SphereGeometry(.045, 16, 12), bulbM); bulb.position.y = H - .66; lamp.add(bulb);
const lampL = new THREE.PointLight("#ffbf7a", 0, 9, 1.6); lampL.position.set(0, H - .72, 0); lampL.castShadow = true; lampL.shadow.mapSize.set(512, 512); lampL.shadow.bias = -.002; scene.add(lampL);
lamp.position.set(0, 0, -.2); lampL.position.z = -.2;

/* ── light ── */
const hemi = new THREE.HemisphereLight("#fff", "#444", 1); scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffc58a", 0);
sun.position.set(1.8, 2.4, -D / 2 - 3.2); sun.target.position.set(-.5, 0, .9); scene.add(sun, sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0008; sun.shadow.normalBias = .02;
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .5, far: 14 });
const fill = new THREE.PointLight("#9fb3c8", 0, 7, 2); fill.position.set(0, 1.6, -D / 2 + .3); scene.add(fill);
const LOOK = {
  sun: { exposure: 1.1, sky: "#f3e6d0", ground: "#b09478", hemi: 1.5, sun: 7, lamp: 0, glow: 0, fill: .6, bg: "#cfc4b2" },
  moon: { exposure: .95, sky: "#2a3550", ground: "#120d0a", hemi: .25, sun: 0, lamp: 6, glow: 1.4, fill: .35, bg: "#05070d" }
};
function paint() {
  const L = LOOK[side];
  renderer.toneMappingExposure = L.exposure; hemi.color.set(L.sky); hemi.groundColor.set(L.ground); hemi.intensity = L.hemi;
  sun.intensity = L.sun; lampL.intensity = L.lamp; shadeM.emissiveIntensity = L.glow; bulbM.color.set(side === "moon" ? "#fff1d6" : "#d9cfc0");
  fill.intensity = L.fill; fill.color.set(side === "moon" ? "#7f95c8" : "#ffd9a8");
  skyM.map = SKY[side]; skyM.needsUpdate = true; scene.background = new THREE.Color(L.bg);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = side === "moon" ? "#0C0A09" : "#ECE8E1";
}
paint();
$("flip").onclick = () => { side = side === "moon" ? "sun" : "moon"; root.dataset.side = side; try { localStorage.setItem("nyx_side", side); } catch (e) {} paint(); };

/* ── furniture ── */
const things = [];
function settle(obj, it) {
  obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  obj.scale.setScalar(it.scale || 1);
  obj.rotation.y = (it.rot || 0) * Math.PI / 180;
  const p = it.pos || [0, null, 0];
  obj.position.set(p[0] || 0, 0, p[2] || 0);
  if (p[1] == null) { const bb = new THREE.Box3().setFromObject(obj); obj.position.y = -bb.min.y; } else obj.position.y = p[1];
  obj.userData.name = it.name || ""; scene.add(obj); things.push(obj);
}
// a stand-in so the room is never empty: a little pixel crab on the floor
function clawd() {
  const g = new THREE.Group(), o = mat({ color: "#d97757", roughness: .7 }), k = mat({ color: "#1c1a19" }), u = .028;
  const add = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w * u, h * u, d * u), m); b.position.set(x * u, y * u, z * u); g.add(b); };
  add(12, 7, 6, 0, 5.5, 0, o); add(1, 2, 2, -6.5, 5, 0, o); add(1, 2, 2, 6.5, 5, 0, o);
  [-4.5, -1.5, 1.5, 4.5].forEach(x => add(1, 2, 1, x, 1, 0, o));
  add(1, 2, .2, -3, 6.5, 3.05, k); add(1, 2, .2, 3, 6.5, 3.05, k);
  return g;
}
const items = RM.items || [];
if (!items.length) settle(clawd(), { name: "Clawd (replace me in config.js → room.items)", pos: [.35, null, -.6], rot: -25 });
const loader = new GLTFLoader(); let pending = items.length;
const done = () => { if (--pending <= 0) $("msg").textContent = ""; };
items.forEach(it => loader.load(it.src, g => { settle(g.scene, it); done(); }, undefined, () => { console.warn("couldn't load", it.src); done(); }));
if (!items.length) $("msg").textContent = "";

/* ── looking around ── */
const eye = new THREE.Vector3(0, RM.eye || 1.5, D / 2 - .35);
let yaw = 0, pitch = -.12, fov = 80, ptrs = new Map(), moved = 0, pinch0 = 0, fov0 = 80;
camera.position.copy(eye);
function aim() { yaw = Math.max(-1.25, Math.min(1.25, yaw)); pitch = Math.max(-.9, Math.min(.7, pitch));
  // fov here is the horizontal one, so a tall phone still sees the whole room across
  camera.rotation.set(pitch, yaw, 0, "YXZ"); camera.fov = Math.min(110, 2 * Math.atan(Math.tan(fov * Math.PI / 360) / camera.aspect) * 180 / Math.PI); camera.updateProjectionMatrix(); }
aim();
const cv = $("c");
cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); fov0 = fov; } });
cv.addEventListener("pointermove", e => { if (!ptrs.has(e.pointerId)) return; const p = ptrs.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1];
  ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved += Math.abs(dx) + Math.abs(dy);
  if (ptrs.size === 1) { yaw += dx * .004 * fov / 80; pitch += dy * .004 * fov / 80; aim(); }
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); fov = Math.max(40, Math.min(92, fov0 * pinch0 / d)); aim(); } });
const up = e => { const tap = ptrs.size === 1 && moved < 8; ptrs.delete(e.pointerId); if (tap) pick(e); };
cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", e => ptrs.delete(e.pointerId));
cv.addEventListener("wheel", e => { e.preventDefault(); fov = Math.max(40, Math.min(92, fov + e.deltaY * .03)); aim(); }, { passive: false });

/* tap a thing: its name floats up */
const ray = new THREE.Raycaster(); let tagT = 0;
function pick(e) {
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(things, true)[0]; if (!hit) return;
  let o = hit.object; while (o && !o.userData.name && o.parent) o = o.parent;
  if (!o || !o.userData.name) return;
  const t = $("tag"); t.textContent = o.userData.name; t.classList.add("on"); clearTimeout(tagT); tagT = setTimeout(() => t.classList.remove("on"), 2000);
}

/* ── draw ── */
function size() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; aim(); }
addEventListener("resize", size); size();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  lamp.rotation.z = Math.sin(t * .6) * .012;   // the lamp sways a hair
  if (things[0] && !items.length) things[0].position.y = Math.abs(Math.sin(t * 2.2)) * .02;   // the crab bobs
  renderer.render(scene, camera);
});
