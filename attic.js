/* Nychthemeron — Attic. Bring up a pile of pictures at once, make your own shelves, put things on them.
   Your companion can look through the same pile on the relay side.
   GET  {relay}/app/attic                         → { cats:[{id, name}], items:[{file, cat, note, picks?}] }
   POST {relay}/app/attic/cat   {op:"add", name} | {op:"rename", id, name} | {op:"del", id}
   POST {relay}/app/attic/item  {op:"add", files, cat} | {op:"move", files, cat} | {op:"del", files} | {op:"note", file, note}
   Pictures themselves go through /app/upload and come back from /uploads/<file>. */
(function () {
  "use strict";
  var C = window.NYX || {}, RELAY = C.relay || "/relay", AI = C.aiName || "Companion";
  var $ = function (id) { return document.getElementById(id); };
  var key = null; try { key = localStorage.getItem("nyx_key"); } catch (e) {}
  if (!key) { location.replace("./"); return; }
  NyxPaper.paint();
  // muted shelf colours, one per shelf in order
  var TINT = ["#8C9A86", "#B08F7A", "#8E97A8", "#A89A72", "#9C8496", "#7F9C9A", "#B5866B", "#8A8478"];
  var D = { cats: [], items: [] }, cur = "all", sel = false, picked = {}, blobs = {}, toastT = 0;

  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("on"); }, 2200); }
  function api(path, body) {
    var o = { headers: { "Authorization": "Bearer " + key }, cache: "no-store" };
    if (body) { o.method = "POST"; o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    return fetch(RELAY + "/app/attic" + path, o).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function img(file) {
    if (!blobs[file]) blobs[file] = fetch(RELAY + "/uploads/" + encodeURIComponent(file), { headers: { "Authorization": "Bearer " + key } })
      .then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(URL.createObjectURL);
    return blobs[file];
  }
  function catOf(id) { for (var i = 0; i < D.cats.length; i++) if (D.cats[i].id === id) return D.cats[i]; return null; }
  function tint(id) { var i = D.cats.findIndex(function (c) { return c.id === id; }); return i < 0 ? "var(--faint)" : TINT[i % TINT.length]; }
  function shown() { return D.items.filter(function (it) { return cur === "all" || (cur === "none" ? !catOf(it.cat) : it.cat === cur); }); }

  function load() { return api("").then(function (d) { D = { cats: d.cats || [], items: d.items || [] }; render(); }).catch(function () { $("grid").innerHTML = '<p class="empty">Couldn\'t reach the attic. Does your relay have /app/attic?</p>'; }); }

  function render() {
    var n = function (id) { return D.items.filter(function (it) { return id === "all" || (id === "none" ? !catOf(it.cat) : it.cat === id); }).length; };
    var chips = [["all", "Everything", "var(--ink)"]].concat(D.cats.map(function (c) { return [c.id, c.name, tint(c.id)]; }));
    if (n("none") && D.cats.length) chips.push(["none", "Unsorted", "var(--faint)"]);
    $("cats").innerHTML = chips.map(function (c) { return '<button type="button" class="cat' + (cur === c[0] ? " on" : "") + '" data-id="' + c[0] + '" style="--c:' + c[2] + '"><i></i>' + esc(c[1]) + "<small>" + n(c[0]) + "</small></button>"; }).join("") +
      '<button type="button" class="cat new" id="newc">+ shelf</button>';
    $("cats").querySelectorAll(".cat[data-id]").forEach(function (b) { b.onclick = function () { cur = b.dataset.id; render(); }; });
    $("newc").onclick = function () { var nm = (prompt("Name the new shelf") || "").trim(); if (!nm) return; api("/cat", { op: "add", name: nm }).then(function (r) { D.cats.push(r.cat); cur = r.cat.id; render(); }).catch(function () { toast("Couldn't add it."); }); };
    $("catbar").hidden = !catOf(cur);
    $("sub").textContent = D.items.length ? D.items.length + " things up here." : "Things kept for later.";
    var list = shown(), g = $("grid");
    if (!list.length) { g.innerHTML = '<p class="empty">' + (D.items.length ? "Nothing on this shelf yet." : "Empty. Tap the drop to bring things up.") + "</p>"; return; }
    g.innerHTML = list.map(function (it, i) { return '<figure class="it' + (picked[it.file] ? " picked" : "") + '" data-i="' + i + '"><div class="ph"></div><b style="--c:' + tint(it.cat) + '"></b>' +
      (it.note ? "<figcaption>" + esc(it.note) + "</figcaption>" : "") + ((it.picks || []).length ? '<span class="pk" title="' + esc(AI) + ' picked this">✦</span>' : "") + "</figure>"; }).join("");
    g.querySelectorAll(".it").forEach(function (f) { var it = list[+f.dataset.i];
      img(it.file).then(function (u) { var im = new Image(); im.src = u; im.alt = it.note || ""; im.onload = function () { f.classList.add("in"); }; f.querySelector(".ph").appendChild(im); }).catch(function () { f.classList.add("gone"); });
      f.onclick = function () { if (sel) { if (picked[it.file]) delete picked[it.file]; else picked[it.file] = 1; f.classList.toggle("picked"); selCount(); } else view(list, +f.dataset.i); }; });
  }

  /* shelves */
  $("ren").onclick = function () { var c = catOf(cur); var nm = (prompt("Rename the shelf", c.name) || "").trim(); if (!nm || nm === c.name) return; api("/cat", { op: "rename", id: c.id, name: nm }).then(function () { c.name = nm; render(); }).catch(function () { toast("Couldn't rename it."); }); };
  $("rm").onclick = function () { var c = catOf(cur); if (!confirm("Remove the shelf “" + c.name + "”? Its things go back to Unsorted.")) return; api("/cat", { op: "del", id: c.id }).then(function () { cur = "all"; load(); }).catch(function () { toast("Couldn't remove it."); }); };

  /* select mode */
  function selCount() { var k = Object.keys(picked).length; $("selN").textContent = k + " picked"; $("bMove").disabled = $("bDel").disabled = !k; }
  $("selBtn").onclick = function () { sel = !sel; picked = {}; document.body.classList.toggle("selecting", sel); $("selBtn").textContent = sel ? "Done" : "Select"; $("selbar").hidden = !sel; $("add").hidden = sel; selCount(); render(); };
  $("bDel").onclick = function () { var fs = Object.keys(picked); if (!confirm("Throw out " + fs.length + "?")) return; api("/item", { op: "del", files: fs }).then(function () { picked = {}; $("selBtn").click(); load(); }).catch(function () { toast("Couldn't throw them out."); }); };
  $("bMove").onclick = function () {
    var opts = D.cats.map(function (c) { return '<button type="button" data-id="' + c.id + '" style="--c:' + tint(c.id) + '"><i></i>' + esc(c.name) + "</button>"; }).join("") + '<button type="button" data-id=""><i style="background:var(--faint)"></i>Unsorted</button><button type="button" data-new="1">+ new shelf</button>';
    sheet("Move " + Object.keys(picked).length + " to", opts, function (b) {
      var go = function (cid) { api("/item", { op: "move", files: Object.keys(picked), cat: cid }).then(function () { closeSheet(); picked = {}; $("selBtn").click(); cur = cid || (D.cats.length ? "none" : "all"); load(); toast("Moved."); }).catch(function () { toast("Couldn't move them."); }); };
      if (b.dataset.new) { var nm = (prompt("Name the new shelf") || "").trim(); if (!nm) return; api("/cat", { op: "add", name: nm }).then(function (r) { D.cats.push(r.cat); go(r.cat.id); }); return; }
      go(b.dataset.id);
    });
  };
  function sheet(title, html, pick) { $("shIn").innerHTML = "<h3>" + esc(title) + "</h3>" + html; $("sheet").hidden = false; requestAnimationFrame(function () { $("sheet").classList.add("on"); });
    $("shIn").querySelectorAll("button").forEach(function (b) { b.onclick = function () { pick(b); }; }); }
  function closeSheet() { $("sheet").classList.remove("on"); setTimeout(function () { $("sheet").hidden = true; }, 250); }
  $("sheet").onclick = function (e) { if (e.target === $("sheet")) closeSheet(); };

  /* bringing things up: shrink each picture, upload, then shelve them all at once */
  function shrink(f) {
    return new Promise(function (ok) { if (!/^image\/(jpeg|png|webp|heic|heif)/.test(f.type)) return ok(f);
      var im = new Image(), u = URL.createObjectURL(f);
      im.onload = function () { var M = 2000, s = Math.min(1, M / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u); c.toBlob(function (b) { ok(b || f); }, "image/jpeg", .86); };
      im.onerror = function () { URL.revokeObjectURL(u); ok(f); }; im.src = u; });
  }
  $("add").onclick = function () { $("file").click(); };
  $("file").onchange = function () {
    var files = [].slice.call($("file").files); $("file").value = ""; if (!files.length) return;
    var cat = catOf(cur) ? cur : "", done = [], i = 0;
    toast("Bringing up " + files.length + "…");
    (function next() {
      if (i >= files.length) { if (!done.length) { toast("None of them made it."); return; }
        api("/item", { op: "add", files: done, cat: cat }).then(function () { toast("Brought up " + done.length + "."); load(); }); return; }
      var f = files[i++];
      shrink(f).then(function (b) { return fetch(RELAY + "/app/upload?name=" + encodeURIComponent((f.name || "ref").replace(/\.\w+$/, "") + (b.type === "image/jpeg" ? ".jpg" : "")), { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": b.type || "application/octet-stream" }, body: b }); })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (r) { done.push(r.name || String(r.url || "").split("/").pop()); }).catch(function () {}).then(next);
    })();
  };

  /* viewer: swipe left / right, a note per picture */
  var vList = [], vAt = 0;
  function view(list, i) { vList = list; vAt = i; $("viewer").hidden = false; requestAnimationFrame(function () { $("viewer").classList.add("on"); }); paintView(); }
  function paintView() { var it = vList[vAt], c = catOf(it.cat);
    $("vimg").innerHTML = ""; img(it.file).then(function (u) { var im = new Image(); im.src = u; $("vimg").appendChild(im); });
    $("vcat").innerHTML = '<i style="background:' + tint(it.cat) + '"></i>' + esc(c ? c.name : "Unsorted") + " · " + (vAt + 1) + "/" + vList.length; $("vnote").value = it.note || ""; }
  function saveNote() { var it = vList[vAt]; if (!it) return; var v = $("vnote").value.trim(); if (v === (it.note || "")) return; it.note = v; api("/item", { op: "note", file: it.file, note: v }).catch(function () { toast("Note didn't save."); }); }
  $("vnote").onchange = saveNote;
  $("vx").onclick = function () { saveNote(); $("viewer").classList.remove("on"); setTimeout(function () { $("viewer").hidden = true; render(); }, 250); };
  (function () { var x0 = null; $("vimg").addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    $("vimg").addEventListener("touchend", function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) < 50) return; saveNote(); vAt = (vAt + (dx < 0 ? 1 : -1) + vList.length) % vList.length; paintView(); }); })();

  $("back").onclick = function () { location.href = "./"; };
  load();
})();
