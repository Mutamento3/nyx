# Room · furnishing it from Blender

`room.html` is an empty room: four walls, a window on the far wall, a pendant lamp, a wooden floor.
You stand in the doorway. On the day side a low gold sun slants in through the window; on the night side the lamp is on.
Everything you put in it is a `.glb` file listed in `config.js`.

## The room's own measurements

```js
room: {
  name: "Our room",
  size: [3.4, 2.7, 4.4],      // width (x), height (y), depth (z), in metres
  wall: "#D9CEBC", floor: "#5B3F2B", ceiling: "#E6DDCD", trim: "#EFE8DC", shade: "#C9A56A",
  eye: 1.5,                   // how tall you are, roughly
  items: [
    { name: "Bed",  src: "models/bed.glb",  pos: [-0.9, null, -1.3], rot: 90 },
    { name: "Lamp", src: "models/lamp.glb", pos: [1.2, 0.72, -1.9], scale: 0.9 }
  ]
}
```

- The floor is `y = 0`. `x` runs from `-width/2` (left) to `width/2` (right). `z` runs from `-depth/2` (the window wall) to `depth/2` (the door, where you stand).
- `pos: [x, null, z]` — leave `y` as `null` and the thing is set down on the floor for you. Give a number to put it on a table or hang it.
- `rot` is degrees around the vertical axis. `scale` multiplies the model.
- `name` is what floats up when you tap it. Leave it out and tapping does nothing.
- With no items, a small pixel crab stands in for the furniture.

## Exporting from Blender

1. **Units**: Scene Properties → Units → Metric, Unit Scale 1.0. Model in real sizes (a bed is about 2 m long).
2. **Origin at the bottom**: put each object's origin at the centre of its base (Object → Set Origin, or snap the 3D cursor to the base first). Then `pos` means where it stands.
3. **Apply transforms**: select it, `Ctrl+A` → All Transforms. Otherwise rotation and scale come out doubled or sideways.
4. **Facing**: Blender's −Y becomes the room's +Z (toward you). Model it facing −Y in Blender and it'll face the door.
5. **Materials**: use Principled BSDF. Base Color, Roughness, Metallic, Normal and Emission textures all survive the trip.
   Procedural node textures don't — bake them to images first (Cycles → Bake → Diffuse, colour only).
6. **Export**: File → Export → glTF 2.0. Format **glTF Binary (.glb)**, Include → Selected Objects, Transform → +Y Up (on), Mesh → Apply Modifiers (on).
   Leave **Draco compression off** — this page doesn't load the Draco decoder.
7. **Size**: keep each file under ~3 MB. Textures at 1024 px are plenty on a phone; bigger ones just make the room slow to open.

Put the files next to `room.html` (e.g. `models/bed.glb`) and list them in `items`.

## Exporting a whole scene at once

If you build the room's furniture in one `.blend`, this script (Scripting tab → New → paste → Run) writes every top-level object to its own `.glb`
in a `models/` folder beside the `.blend`, with its origin moved to the base:

```python
import bpy, os
out = os.path.join(os.path.dirname(bpy.data.filepath), "models"); os.makedirs(out, exist_ok=True)
for ob in [o for o in bpy.context.scene.objects if o.parent is None and o.type in {"MESH", "EMPTY"}]:
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    for c in ob.children_recursive: c.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, ob.name + ".glb"), export_format="GLB",
                              use_selection=True, export_apply=True, export_yup=True)
    print("wrote", ob.name)
```

## Light

The room lights itself: a hemisphere light for the room's general glow, a sun through the window by day, and the pendant lamp
(a point light with shadows) by night. If your models look too dark, check the Base Color isn't near black and Metallic is 0
for wood, fabric and paint.
