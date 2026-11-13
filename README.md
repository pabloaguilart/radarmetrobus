# Radar Metrobús

## Desarrollo local

Con Node 22 o superior, instala con `npm ci`. Copia `.env.example` a `.env`, configura el acceso al proveedor y ejecuta `npm start`. Si usas CARTO con clave, usa una clave pública limitada a los dominios del mapa.

## Cloudflare

Selecciona la cuenta MetrobusRadar. El proyecto Git existente se llama `radarmetrobus`. Conserva el directorio raíz y el comando `npx wrangler deploy`. Wrangler ejecuta el generador de archivos y sirve el mapa, los trazos, las rutas y las paradas desde `dist/`.

Para habilitar posiciones en vivo:

1. Crea el bucket R2 Standard `radarmetrobus-positions`. Conecta un dominio propio para servir `vehicles.json` con caché. Habilita caché para ese objeto, respetando el encabezado de duración de la respuesta. Autoriza `GET` en CORS desde el origen del mapa.
2. Desde este repositorio, autentica Wrangler con `npx wrangler login` y verifica la cuenta con `npx wrangler whoami`. Despliega el actualizador con `npx wrangler deploy --config wrangler.updater.jsonc`. Si la sesión tiene varias cuentas, establece `CLOUDFLARE_ACCOUNT_ID` al ID de MetrobusRadar antes de ejecutar los comandos.
3. Configura los secretos con `npx wrangler secret put API_USER --config wrangler.updater.jsonc` y `npx wrangler secret put API_PASS --config wrangler.updater.jsonc`. El cron inicia o recupera la alarma del actualizador, que intenta publicar una lectura cada 10 segundos. En caso de error, conserva el archivo anterior y reintenta a los 30 segundos.
4. Define `VEHICLE_FEED_URL` en las variables de compilación del proyecto del mapa con la URL HTTPS del objeto. Si corresponde, define también `CARTO_TILE_KEY`. Vuelve a desplegar el mapa.
5. Comprueba que `vehicles.json` cambia de fecha, que responde con el origen CORS correcto y que la CDN devuelve `CF-Cache-Status: HIT` en lecturas sucesivas. Confirma la cadencia, los errores del actualizador y las lecturas reales de R2 antes de enviar tráfico al proyecto nuevo.

`API_USER` y `API_PASS` son exclusivos del actualizador. El mapa solo recibe la URL pública de las posiciones y, si está configurada, la clave pública de teselas.
