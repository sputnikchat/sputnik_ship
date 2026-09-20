# Sputnik Ship — Rediseño total (brief único para Claude Code)

Referencia obligatoria: `sputnik-hero.html` (en esta misma carpeta) y esta especificación.
Todo lo que sigue reemplaza el diseño actual de la app. No es un retoque: es una reconstrucción visual completa manteniendo la lógica y los datos existentes.

---

## 0. Reglas de trabajo (léelas antes de tocar código)

1. No preguntes permiso a cada paso. Ejecuta las fases 1→7 en orden, sin pausas, hasta el final.
2. Al terminar cada fase, verifícala tú mismo con Playwright (protocolo abajo) antes de pasar a la siguiente. Si no coincide visualmente, corrígelo en el momento — no lo dejes para después.
3. No inventes valores de color, tipografía, radio o sombra. Todo sale de la sección 1 (tokens). Si algo no está especificado aquí, elige el valor más cercano a `sputnik-hero.html` y anótalo en el resumen final.
4. No cambies la lógica de negocio, rutas de API, ni el modelo de datos. Esto es solo la capa visual y de interacción.
5. Al final de todo: build limpio (`npm run build` o equivalente sin errores), commit único con mensaje descriptivo, y un resumen en texto de qué se hizo pantalla por pantalla.

---

## 1. Sistema de diseño (tokens.css — crear o reemplazar)

```css
:root{
  --bg:#050507; --bg2:#0b0c12; --surface:#0f1017; --line:#1e2029; --line2:#2a2d3a;
  --text:#f2f3f7; --muted:#9a9fac; --dim:#7a8090;
  --accent:#5e6ad2; --accent2:#8b7cf6; --accent-soft:rgba(94,106,210,.16);
  --ok:#3ecf8e; --warn:#f2b45c; --danger:#eb5757;
  --sans:"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --r-sm:9px; --r-md:14px; --r-lg:18px; --r-xl:32px;
}
```
- Cargar Google Fonts: Instrument Sans (400/500/600/700) e IBM Plex Mono (400/500/600) globalmente.
- **Instrument Sans** para todo el texto de interfaz. **IBM Plex Mono** SOLO para: números de tracking, horas/fechas técnicas, coordenadas, datos de EXIF.
- Fondo global `--bg`. Tarjetas `--surface` con borde `1px solid var(--line)`.
- Sombra/glow estándar para elementos destacados: `box-shadow: 0 40px 80px -30px rgba(94,106,210,.4)`.
- Botón primario: fondo `--accent`, texto blanco, `border-radius:var(--r-sm)`, `box-shadow:0 8px 24px -8px rgba(94,106,210,.6)`.
- Pills de estado con color semántico, nunca gris neutro:
  - En curso / activo → fondo `--accent-soft`, texto `#c3c8f0`
  - Retrasado → fondo `rgba(242,180,92,.14)`, texto `--warn`
  - Entregado → fondo `rgba(62,207,142,.14)`, texto `--ok`

## 2. Mapa (Leaflet)

- Tiles oscuros: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png` (atribución CARTO + OSM visible pero discreta).
- Línea de ruta: color `--accent2` a `--accent` (gradiente si la librería lo permite), grosor 3px, extremos redondeados.
- Punto de la posición actual: círculo animado tipo "pulso" (`@keyframes ping`, halo `--accent` que se expande y desvanece cada ~2s).
- Contenedor del mapa: `border-radius:var(--r-lg)`, overlay sutil con viñeta hacia los bordes (`radial-gradient` transparente→`rgba(7,8,12,.5)`).

## 3. Pantalla: Lista de envíos (Home)

- Header con logo (triángulo actual está bien, ya coincide) + saludo `@usuario` + contador "N in progress" como pill con icono.
- Barra de búsqueda: fondo `--surface`, borde `--line`, icono lupa atenuado.
- Filtros (Active/Delayed/All/Archived/Following): pill activa con fondo `--accent`, resto texto `--muted`.
- Tarjeta de envío: icono de paquete en caja `--surface` redondeada, título en Instrument Sans 600, tracking number en `--mono`, pill de estado semántico (no gris), fecha "Last checked" en `--dim` alineada a la derecha.

## 4. Pantalla: Detalle de envío (la más importante — ver teléfono del hero en el mockup)

Orden de arriba a abajo:
1. Mapa oscuro (sección 2) con ruta real del envío.
2. Tarjeta de cabecera: nombre del envío, pill de estado semántico, courier.
3. Tarjeta de tracking en **claro** sobre fondo oscuro (`background:#f5f6fa; color:#0b0c12`), radio `var(--r-md)`: "Estimated delivery" + fecha grande, separador, "Tracking #" en `--mono`.
4. Timeline vertical de estados (Label created → Picked up → In transit → Out for delivery → Delivered): punto relleno para completados, punto con anillo pulsante para el actual (color `--accent`), punto hueco para pendientes. Etiqueta de cada estado + hora en `--mono` a la derecha.
5. Acciones (Share/QR/Archive/Delete): botones secundarios `--surface` + borde.
6. **Chat anclado al envío**: burbujas propias en `--accent`, ajenas en `--surface`, hora en `--dim` bajo cada mensaje.
7. **Foto en el chat**: botón de cámara junto al input. Al adjuntar, la imagen ocupa una burbuja ancha con badge "Metadata removed" (icono candado, fondo `rgba(7,8,12,.8)`, texto `--ok`) superpuesto arriba a la izquierda. El servidor debe stripear EXIF real antes de guardar (no solo visual).

## 5. Pantalla: Calendario

- Semana con 7 días, punto bajo el número si hay entrega ese día, día actual con fondo `--accent` circular.
- Banner "N packages out for delivery today" en `--accent-soft`.
- Lista de envíos del día por courier, con pill semántico (Out today / Delayed).

## 6. Pantalla: Nuevo envío (captura + formulario)

- Paso 1 "Scan label": vista de cámara con marco esquinado en `--accent`, línea de escaneo animada.
- Paso 2: formulario con los campos leídos (courier, tracking, destinatario, peso, valor) prellenados, cada campo en tarjeta `--surface` con label pequeño en `--dim` arriba y valor en `--mono` cuando sea un dato técnico.

## 7. Motion (aplicar con moderación, respetar `prefers-reduced-motion`)

- Entrada de tarjetas al hacer scroll: fade + translateY(12px)→0, 400ms.
- Pulso en pin del mapa y en pill de estado activo.
- Transición de tab (bottom nav): 150ms ease en color/fondo.

---

## Protocolo de autoverificación (obligatorio, no opcional)

Para cada pantalla, antes de darla por terminada:

1. Abre `sputnik-hero.html` con Playwright, haz captura de la sección equivalente.
2. Abre la pantalla real de la app (localhost) en el mismo viewport, haz captura.
3. Compara ambas capturas tú mismo (colores, tipografía, espaciado, radios). Si algo no coincide con la sección correspondiente de este brief, corrígelo ahí mismo.
4. Solo pasa a la siguiente pantalla cuando la actual pase esta comparación.

Al terminar las 6 pantallas, haz una pasada final comparando TODAS contra el mockup y entrega el resumen.
