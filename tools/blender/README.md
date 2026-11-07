# Receta del pelo del modelo (Blender)

`assets/models/pelo_anime5.vrm` sale del modelo original `197037196013835212.vrm` (VRM 0.x, pelo largo): se corta el pelo
a la altura del hombro, se le crean puntas pequeñas estilo anime (pelo de atrás y mechones de delante) y se añaden
colisionadores para que no atraviese el cuerpo ni la ropa.

Requisitos: Blender 5.x y el add-on «VRM Add-on for Blender» (v4.10.4).

```
blender -b --factory-startup --python tools/blender/anime_tips5.py -- <original.vrm> <salida.vrm>
node tools/blender/patchq.mjs <original.vrm> <salida.vrm> <final.vrm>
```

`patchq.mjs` restaura el `renderQueue` de los materiales (el exportador de Blender lo deja en -1 y la prenda blanca
se dibujaría bajo la piel). Parámetros del pelo (altura de corte, puntas, colisionadores) al principio de `anime_tips5.py`.
