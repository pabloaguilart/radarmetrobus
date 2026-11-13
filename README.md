# Radar Metrobús

## Desarrollo local

Con Node 22 o superior, instala con `npm ci`. Copia `.env.example` a `.env`, configura el acceso al proveedor y ejecuta `npm start`. Si usas CARTO con clave, usa una clave pública limitada a los dominios del mapa.

## Cloudflare

Selecciona la cuenta MetrobusRadar. El proyecto Git existente se llama `radarmetrobus`. Conserva el directorio raíz y el comando `npx wrangler deploy`. Wrangler ejecuta el generador de archivos y sirve el mapa, los trazos, las rutas y las paradas desde `dist/`.

Para habilitar posiciones en vivo:

1. Configura `API_USER` y `API_PASS` como secretos de ejecución en el Worker `radarmetrobus`. Desde Wrangler puedes usar `npx wrangler secret put API_USER` y `npx wrangler secret put API_PASS`. Si la sesión tiene varias cuentas, establece `CLOUDFLARE_ACCOUNT_ID` al ID de MetrobusRadar.
2. El cron inicia la alarma del Durable Object SQLite, que intenta guardar una lectura cada 10 segundos. En caso de error conserva la última lectura y reintenta a los 30 segundos.
3. Comprueba que `/vehicles.json` responde y cambia de fecha. Verifica la cadencia y las métricas de solicitudes antes de enviar tráfico al proyecto. La caché local de Cloudflare reduce las lecturas al Durable Object. Las solicitudes que entran al Worker cuentan contra la cuota del plan.

`API_USER` y `API_PASS` son exclusivos del actualizador. El mapa solo recibe la URL pública de las posiciones y, si está configurada, la clave pública de teselas.
