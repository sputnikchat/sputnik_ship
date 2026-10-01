# Sputnik Ship — guía del logo «Proa»

**La idea:** la proa de una nave que avanza, con un ojo de buey en forma de rombo. El envío está en camino.
Es la evolución del logo anterior: conserva la forma y el color, pero ahora todo usa un único dibujo construido con geometría exacta.

## Archivos

| Uso | Archivo |
|---|---|
| Símbolo a color (degradado) | `proa-symbol-color.svg` |
| Símbolo negro / blanco | `export/sputnik-ship-black.svg` · `proa-symbol-white.svg` |
| Símbolo a una tinta índigo | `export/sputnik-ship-mono-5e6ad2.svg` |
| Versión para tamaños pequeños (rombo más grande) | `proa-symbol-small.svg` |
| Logo horizontal, fondo claro / oscuro | `sputnik-ship-horizontal.svg` · `sputnik-ship-horizontal-on-dark.svg` |
| Logo apilado, fondo claro / oscuro | `sputnik-ship-stacked.svg` · `sputnik-ship-stacked-on-dark.svg` |
| Icono de app (iOS/Android/PWA) | `export/apple-touch-icon.png` (180) · `icon-192.png` · `icon-512.png` · `maskable-512.png` |
| Favicon | `export/favicon.ico` · `favicon.svg` |
| Presentación | `presentation.html` · `slides/` |

Los SVG se regeneran con `build_proa.py` (símbolo) y `build_lockups.py` (logos con nombre).
Las letras están convertidas a trazos, así que no dependen de que la fuente esté instalada.

## Color

| | HEX | RGB |
|---|---|---|
| Violeta (inicio del degradado) | `#8B7CF6` | 139 124 246 |
| Índigo (final, color plano principal) | `#5E6AD2` | 94 106 210 |
| Texto sobre claro | `#0B0C12` | 11 12 18 |
| Texto sobre oscuro | `#F2F3F7` | 242 243 247 |

- El degradado va siempre de arriba-izquierda (violeta) a abajo-derecha (índigo).
- Cuando no se pueda usar degradado (impresión, bordado, sellos), usa índigo plano `#5E6AD2`, negro o blanco.

## Tipografía

**Instrument Sans 600**, con espaciado entre letras de −0,02 em. Es la misma fuente de la app.
La licencia es OFL, así que se puede usar en un logo.

## Espacio libre y tamaños mínimos

- **Espacio libre:** alrededor del logo deja, como mínimo, el ancho del rombo. No pongas nada dentro de ese margen.
- **Símbolo:** 16 px como mínimo. Por debajo de 32 px usa `proa-symbol-small.svg`.
- **Logo horizontal:** 96 px de ancho como mínimo. Si el espacio es menor, usa solo el símbolo.

## Icono de app

- **Fondo:** el degradado de marca a sangre, sin esquinas ni transparencias. iOS y Android recortan la forma ellos mismos.
- **Símbolo:** blanco.
- **Versión maskable (Android):** el símbolo es más pequeño para que quepa en la zona segura circular.

## Qué no hacer

- No deformar, girar ni inclinar el símbolo.
- No cambiar los colores del degradado ni invertir su dirección.
- No rellenar el rombo: es un hueco y debe dejar ver el fondo.
- No añadir sombras, contornos ni efectos.
- No poner el símbolo de color sobre fondos índigo o violeta. Ahí va blanco.
- No volver a dibujarlo a mano (la landing y el vídeo promo tenían versiones distintas, y eso es justo lo que se corrigió).

## Pendiente

- Las escenas del vídeo promo (`public/promo/00_intro.html`, `i_end.html`) todavía usan el dibujo antiguo.
- No se ha hecho una búsqueda de registro de marca. Conviene hacer una profesional antes de registrarla.
