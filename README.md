# ShipTrack

App para guardar contactos y hacer seguimiento de envíos (FedEx, UPS, DHL, USPS) en un solo lugar:

- Login simple con email y contraseña — **sin verificación de identidad (KYC)**.
- Agenda de contactos (nombre, teléfono, email, empresa, dirección, notas).
- Envíos asociados a un contacto, con courier y número de tracking.
- Actualización automática del estado de cada envío **cada 30 minutos** (configurable).
- Notificaciones cuando cambia el estado de un envío.
- Mapa con la ruta del envío (origen → checkpoints → destino) con [Leaflet](https://leafletjs.com/) + OpenStreetMap.
- Funciona en el navegador y es instalable como **PWA** (ícono en la pantalla de inicio del celular, en Android y iOS).

Por defecto la app corre con **datos de tracking simulados** (`TRACKING_MODE=mock`), para que puedas probar todo el flujo — contactos, envíos, mapa, notificaciones — sin necesitar todavía cuentas con los couriers. Cuando tengas las credenciales de FedEx/UPS/DHL/USPS, seguís los pasos de la sección "Conectar las APIs reales" y pasás a `TRACKING_MODE=live`.

## Cómo correrla en tu computadora

Necesitás [Node.js](https://nodejs.org/) 18 o más nuevo instalado.

```bash
cd shiptrack
npm install
cp .env.example .env
# abrí .env y al menos cambiá JWT_SECRET por un texto largo random
npm start
```

Abrí `http://localhost:3000` en el navegador, creá tu cuenta (Crear cuenta) y ya podés usar la app.

> Nota: en el entorno donde se generó este proyecto no había acceso a internet para bajar los paquetes de npm, así que `npm install` no se corrió acá — se probó la sintaxis de todos los archivos y la lógica interna (base de datos, simulador de tracking) por separado. En tu computadora, con internet normal, `npm install` va a funcionar sin problema.

## Cómo probar el seguimiento sin esperar 30 minutos

- Botón **"Actualizar ahora"** en la pantalla de Envíos: fuerza el mismo ciclo que corre automáticamente cada 30 min, para todos los envíos.
- Al abrir el detalle de un envío también se refresca ese envío puntual.
- Cada vez que agregás un envío nuevo, se consulta el tracking inicial al toque.

Con datos simulados, cada refresh hace "avanzar" el envío un checkpoint más en su ruta (creado → retirado → en tránsito → en reparto → entregado), así podés ver notificaciones y el mapa moverse sin esperar.

## Estructura del proyecto

```
shiptrack/
  server.js                  Servidor Express (API + sirve el frontend)
  routes/
    auth.js                  Registro / login (JWT, sin KYC)
    contacts.js               CRUD de contactos
    shipments.js              CRUD de envíos + refresh de tracking
    notifications.js          Notificaciones
  services/
    store.js                  Base de datos en un archivo JSON local (data/db.json)
    carrierProviders.js       Motor de tracking: modo mock + stubs para FedEx/UPS/DHL/USPS reales
    scheduler.js               Cron que refresca todos los envíos cada 30 min
    notify.js                  Crea notificaciones (+ email opcional)
  middleware/auth.js          Verifica el token JWT en cada request
  public/                     Frontend (HTML/CSS/JS sin frameworks) + PWA (manifest, service worker)
```

## Conectar las APIs reales de los couriers

Cuando tengas cuenta de desarrollador en cada courier:

1. Completá las credenciales correspondientes en `.env` (ver `.env.example`):
   - **FedEx**: `FEDEX_CLIENT_ID` / `FEDEX_CLIENT_SECRET` — [developer.fedex.com](https://developer.fedex.com/api/en-us/catalog/track/v1.html)
   - **UPS**: `UPS_CLIENT_ID` / `UPS_CLIENT_SECRET` — [developer.ups.com](https://developer.ups.com/api/reference?loc=en_US#tag/Track)
   - **DHL**: `DHL_API_KEY` — [developer.dhl.com](https://developer.dhl.com/api-reference/shipment-tracking)
   - **USPS**: `USPS_USER_ID` — [usps.com/business/web-tools-apis](https://www.usps.com/business/web-tools-apis/track-and-confirm-api.htm)
2. Abrí `services/carrierProviders.js` y completá las 4 funciones dentro de `liveProviders` (fedex, ups, dhl, usps). Cada una ya tiene comentado el flujo típico (OAuth2 + endpoint de tracking) y el link a la documentación oficial. Tienen que devolver el mismo formato de objeto que ya arma `mockTrackingUpdate` (status, statusLabel, checkpoints, fullRoute, currentLocation, estimatedDelivery).
3. Cambiá `TRACKING_MODE=live` en `.env`.

Importante: los couriers suelen pedir a **vos**, como negocio, datos de verificación para darte acceso a su API (esto es aparte de esta app — la app en sí no le pide ningún documento de identidad a quien la usa, solo email y contraseña).

## Notificaciones por email (opcional)

Las notificaciones siempre quedan guardadas dentro de la app (campanita 🔔). Si además querés recibirlas por email, completá en `.env`:

```
NOTIFY_EMAIL_ENABLED=true
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
NOTIFY_EMAIL_FROM=...
NOTIFY_EMAIL_TO=...
```

Y agregá la dependencia: `npm install nodemailer`.

## Cambiar cada cuánto se actualiza

En `.env`, `TRACKING_REFRESH_MINUTES=30` (podés bajarlo a 5 o 10 mientras probás, por ejemplo).

## Cerrar el registro (solo vos como usuario)

Como elegiste que la app la uses solo vos, una vez que crees tu cuenta podés "cerrar" el registro para que nadie más pueda crear una cuenta nueva: en `routes/auth.js`, dentro de `/signup`, agregá al principio:

```js
if (db.users.length >= 1) {
  return res.status(403).json({ error: 'El registro está cerrado.' });
}
```

## Desplegarla para que corra 24/7 (y así el refresh de 30 min funcione siempre)

Mientras la app corre solo en tu computadora, el refresh automático de cada 30 min solo pasa cuando la computadora está prendida y `npm start` está corriendo. Para que ande todo el tiempo (y puedas abrirla desde el celular como una app instalada), lo más simple es desplegarla en un servicio gratuito/económico que mantenga un proceso Node corriendo, por ejemplo:

- **Render** (render.com) — plan gratuito para probar, "Web Service" desde este mismo código.
- **Railway** (railway.app)
- **Fly.io**

En cualquiera de los tres: subís este proyecto (por ejemplo a un repositorio de GitHub), lo conectás al servicio, configurás las variables de entorno del `.env` en su panel, y el comando de arranque es `npm start`. Una vez desplegada, entrá a la URL pública desde el celular y usá "Agregar a pantalla de inicio" para instalarla como app.

## Próximos pasos sugeridos

- Conectar las APIs reales de los couriers que más uses (ver sección arriba).
- Activar notificaciones push del navegador (Web Push) si querés avisos aunque la app esté cerrada — requiere desplegar con HTTPS.
- Si más adelante necesitás que varias personas usen la app con sus propias cuentas, la base ya soporta múltiples usuarios (cada quien ve solo sus propios contactos y envíos).
