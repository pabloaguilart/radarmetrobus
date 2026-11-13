require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const app = express();
const PORT = process.env.PORT || 5000;
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, "public");

const API_URL = "https://metrobus-gtfs.sinopticoplus.com/gtfs-api/partnerValidation";
const API_USER = process.env.API_USER;
const API_PASS = process.env.API_PASS;
// Rutas de archivos GTFS locales
const SHAPES_FILE = path.join(PUBLIC_DIR, "shapes.txt");
const STOPS_FILE = path.join(PUBLIC_DIR, "stops.txt");
const ROUTES_FILE = path.join(PUBLIC_DIR, "routes.txt");
const TRIPS_FILE = path.join(PUBLIC_DIR, "trips.txt");

// --- Caché Global y Workers ---
let routesCache = {};
let tripsCache = {};
let shapesJsonCache = { count: 0, shapes: [] };
let stopsJsonCache = { count: 0, stops: [] };
let routesJsonCache = { count: 0, lines: [] };
let vehiclesJsonCache = { count: 0, vehicles: [], source: "Cargando datos estáticos...", debug: "" };

let cachedRealtimeUrl = null;
let cachedUrlTime = 0;
const CACHE_URL_SECONDS = 480;
const REFRESH_DATA_SECONDS = 10;

// --- UTILIDADES ---
function safeColor(color, def = "999999") {
    if (!color) return def;
    let c = String(color).trim().replace(/['"#]/g, "");
    return c.length === 6 ? c : def;
}

function cleanHeader(header) {
    return header.toLowerCase().replace(/['"\uFEFF]/g, '').trim();
}

async function loadCsv(filePath, onRow) {
    if (!fs.existsSync(filePath)) {
        console.error(`⚠️ Archivo no encontrado: ${path.basename(filePath)}`);
        return false;
    }
    return new Promise((resolve) => {
        fs.createReadStream(filePath, { encoding: 'utf8' })
            .pipe(csv({ mapHeaders: ({ header }) => cleanHeader(header) }))
            .on('data', onRow)
            .on('end', resolve)
            .on('error', (err) => console.error(`Error leyendo ${filePath}:`, err));
    });
}

// Carga de datos estáticos (Rutas, Trazos, Estaciones)
async function loadStaticData() {
    console.log("🛠️ Cargando archivos locales (.txt)...");

    // 1. Cargar Rutas
    await loadCsv(ROUTES_FILE, (row) => {
        const route_id = row.route_id?.trim();
        if (route_id) {
            routesCache[route_id] = {
                route_id: route_id,
                short_name: row.route_short_name?.trim() || "",
                long_name: row.route_long_name?.trim() || "",
                color: safeColor(row.route_color, "9B1C31"),
                text_color: safeColor(row.route_text_color, "FFFFFF")
            };
        }
    });

    // 2. Cargar Viajes
    await loadCsv(TRIPS_FILE, (row) => {
        const trip_id = row.trip_id?.trim();
        if (trip_id) {
            tripsCache[trip_id] = {
                trip_id: trip_id,
                route_id: row.route_id?.trim() || "",
                headsign: row.trip_headsign?.trim() || ""
            };
        }
    });

    // 3. Preparar JSON de Rutas
    const linesMap = {};
    for (const r of Object.values(routesCache)) {
        const line = r.short_name || r.route_id;
        if (!linesMap[line]) {
            linesMap[line] = { line: line, color: r.color, text_color: r.text_color, routes: [] };
        }
        linesMap[line].routes.push(r);
    }
    const linesArray = Object.values(linesMap).sort((a, b) => (parseInt(a.line) || 999) - (parseInt(b.line) || 999));
    routesJsonCache = { count: linesArray.length, lines: linesArray };

    // 4. Cargar Shapes
    const groupedShapes = {};
    await loadCsv(SHAPES_FILE, (row) => {
        const shape_id = row.shape_id;
        if (shape_id && row.shape_pt_lat && row.shape_pt_lon) {
            if (!groupedShapes[shape_id]) groupedShapes[shape_id] = [];
            groupedShapes[shape_id].push({
                lat: parseFloat(row.shape_pt_lat),
                lon: parseFloat(row.shape_pt_lon),
                seq: parseInt(row.shape_pt_sequence) || 0
            });
        }
    });

    const shapesResult = [];
    for (const [shape_id, points] of Object.entries(groupedShapes)) {
        points.sort((a, b) => a.seq - b.seq);
        const rInfo = routesCache[shape_id] || { short_name: shape_id, long_name: "", color: "9B1C31", text_color: "FFFFFF" };
        shapesResult.push({
            shape_id: shape_id,
            route_id: shape_id,
            line: rInfo.short_name || shape_id,
            name: rInfo.long_name || "",
            color: rInfo.color,
            text_color: rInfo.text_color,
            points: points.map(p => [p.lat, p.lon])
        });
    }
    shapesJsonCache = { count: shapesResult.length, shapes: shapesResult };

    // 5. Cargar Stops
    const stopsResult = [];
    await loadCsv(STOPS_FILE, (row) => {
        const stop_id = row.stop_id;
        if (stop_id && row.stop_lat && row.stop_lon) {
            stopsResult.push({
                stop_id: stop_id,
                stop_name: row.stop_name || "",
                lat: parseFloat(row.stop_lat),
                lon: parseFloat(row.stop_lon)
            });
        }
    });
    stopsJsonCache = { count: stopsResult.length, stops: stopsResult };

    console.log("✅ Datos locales cargados en memoria.");
}

// --- LÓGICA DE API GTFS-RT ---
async function getRealtimeUrl() {
    const now = Math.floor(Date.now() / 1000);
    if (cachedRealtimeUrl && (now - cachedUrlTime) < CACHE_URL_SECONDS) {
        return cachedRealtimeUrl;
    }

    try {
        console.log("🌐 Solicitando nueva URL realtime...");
        const response = await axios.post(API_URL, { usuario: API_USER, senha: API_PASS });
        if (!response.data.urlRealTime) throw new Error("No urlRealTime en respuesta");

        cachedRealtimeUrl = response.data.urlRealTime;
        cachedUrlTime = now;
        console.log("🌐 URL realtime renovada.");
        return cachedRealtimeUrl;
    } catch (error) {
        console.error("❌ Error obteniendo URL API:", error.message);
        throw error;
    }
}

// --- WORKER EN SEGUNDO PLANO ---
async function fetchVehiclesWorker() {
    try {
        const url = await getRealtimeUrl();
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });

        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
        const items = [];
        const byLine = {};

        feed.entity.forEach(entity => {
            if (!entity.vehicle || !entity.vehicle.position) return;
            const v = entity.vehicle;

            let trip_id = v.trip ? v.trip.tripId : "";
            let route_id = v.trip ? v.trip.routeId : "";
            const trip_info = tripsCache[trip_id] || {};

            if (!route_id) route_id = trip_info.route_id || "";
            const rInfo = routesCache[route_id] || { short_name: route_id || "MB", long_name: "", color: "9B1C31", text_color: "FFFFFF" };

            const short_name = rInfo.short_name || route_id || "MB";
            byLine[short_name] = (byLine[short_name] || 0) + 1;

            items.push({
                id: entity.id,
                vehicle_id: v.vehicle ? v.vehicle.id : "",
                label: v.vehicle ? v.vehicle.label : "",
                trip_id: trip_id,
                route_id: route_id,
                line: short_name,
                headsign: trip_info.headsign || "",
                route_name: rInfo.long_name || "",
                color: rInfo.color,
                text_color: rInfo.text_color,
                lat: v.position.latitude,
                lon: v.position.longitude,
                bearing: v.position.bearing || null,
                speed: v.position.speed || null,
                timestamp: v.timestamp ? v.timestamp.low : null
            });
        });

        // Actualizamos el Caché Global en memoria
        vehiclesJsonCache = {
            updated_local: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
            source: "API CDMX Realtime - Servido desde Caché Node.js",
            count: items.length,
            by_line: byLine,
            vehicles: items
        };

    } catch (error) {
        console.error("❌ Error actualizando vehículos:", error.message);
    }
}

// --- EXPRESS ENDPOINTS ---
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/', (req, res) => {
    res.type('html').send(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replaceAll('__CARTO_TILE_KEY__', encodeURIComponent(process.env.CARTO_TILE_KEY || '')));
});

// Ahora sí están todos los endpoints para que el HTML los consuma
app.get('/vehicles.json', (req, res) => res.json(vehiclesJsonCache));
app.get('/routes.json', (req, res) => res.json(routesJsonCache));
app.get('/shapes.json', (req, res) => res.json(shapesJsonCache));
app.get('/stops.json', (req, res) => res.json(stopsJsonCache));

// --- ARRANQUE DEL MOTOR ---
app.listen(PORT, async () => {
    console.log(`🚀 Servidor Node.js iniciado en http://localhost:${PORT}`);

    // 1. Cargamos archivos TXT pesados UNA vez
    await loadStaticData();

    // 2. Hacemos la primera descarga de vehículos
    await fetchVehiclesWorker();

    // 3. Encendemos el cronómetro
    setInterval(fetchVehiclesWorker, REFRESH_DATA_SECONDS * 1000);
    console.log(`⏱️ Worker de vehículos encendido (cada ${REFRESH_DATA_SECONDS}s).`);
});
