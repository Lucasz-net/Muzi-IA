# Animaciones

Cada estado del compañero se anima a partir de una **pose objetivo** (`PoseSource`, en `src/character/types.ts`). Hoy se generan por código; más adelante pueden venir de clips.

## Estados

| Estado | Cuándo | Animación procedural actual |
|---|---|---|
| `idle` | Sin actividad | Respiración y balanceo suaves |
| `thinking` | El modelo razona | Cabeza ladeada, mano en la barbilla, puntos sobre la cabeza |
| `working` | Usando herramientas | Inclinado, "tecleando" |
| `waiting_permission` | Pide aprobación | Saluda con un brazo, "!" ámbar |
| `responding` | Escribiendo la respuesta | Asiente y gesticula |
| `celebrating` | Tarea terminada (~2.8 s) | Salto con brazos arriba y destellos |
| `error` | Fallo (~3.5 s) | Cabizbajo, niega con la cabeza, tinte rojo |

## Procedural (actual)

`src/character/procedural.ts` → `proceduralPoses.poseFor(state, t, stateTime)`. Para ajustar un movimiento, edita el `case` del estado. El `Animator` suaviza las transiciones entre poses.

Probar un estado en desarrollo: abre las herramientas de desarrollo de la ventana y ejecuta `mizu.force("celebrating")`.

## Clips (Mixamo / VRMA) — fase 4

Cuando haya modelo VRM, los clips se colocarán aquí, un archivo por estado:

```
assets/animations/
  idle.vrma        thinking.vrma     working.vrma
  waiting_permission.vrma            responding.vrma
  celebrating.vrma error.vrma
```

Si descargas animaciones de Mixamo (FBX), conviértelas/retargetéalas a VRM (por ejemplo a `.vrma`) antes de ponerlas aquí. Un estado sin clip usa la pose procedural.
