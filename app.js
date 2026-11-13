require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const { loadStaticData } = require('./gtfs-static.cjs');
const { decodeVehicles } = require('./gtfs-realtime.cjs');

const app = express();
const PORT = process.env.PORT || 5000;
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, "public");

const API_URL = "https://metrobus-gtfs.sinopticoplus.com/gtfs-api/partnerValidation";
const API_USER = process.env.API_USER;
const API_PASS = process.env.API_PASS;

let staticData;
let vehiclesJsonCache = { count: 0, vehicles: [], source: "Cargando datos estáticos...", debug: "" };

let cachedRealtimeUrl = null;
let cachedUrlTime = 0;
const CACHE_URL_SECONDS = 480;
const REFRESH_DATA_SECONDS = 10;

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

        vehiclesJsonCache = decodeVehicles(response.data, staticData);
    } catch (error) {
        console.error("❌ Error actualizando vehículos:", error.message);
    }
}

// --- EXPRESS ENDPOINTS ---
app.use(express.static(PUBLIC_DIR));

app.get('/map-config.json', (_req, res) => {
    res.json({ cartoTileKey: process.env.CARTO_TILE_KEY || null });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Ahora sí están todos los endpoints para que el HTML los consuma
app.get('/vehicles.json', (req, res) => res.json(vehiclesJsonCache));
app.get('/routes.json', (req, res) => res.json(staticData?.routesJsonCache ?? { count: 0, lines: [] }));
app.get('/shapes.json', (req, res) => res.json(staticData?.shapesJsonCache ?? { count: 0, shapes: [] }));
app.get('/stops.json', (req, res) => res.json(staticData?.stopsJsonCache ?? { count: 0, stops: [] }));

// --- ARRANQUE DEL MOTOR ---
app.listen(PORT, async () => {
    console.log(`🚀 Servidor Node.js iniciado en http://localhost:${PORT}`);

    // 1. Cargamos archivos TXT pesados UNA vez
    staticData = await loadStaticData();

    // 2. Hacemos la primera descarga de vehículos
    await fetchVehiclesWorker();

    // 3. Encendemos el cronómetro
    setInterval(fetchVehiclesWorker, REFRESH_DATA_SECONDS * 1000);
    console.log(`⏱️ Worker de vehículos encendido (cada ${REFRESH_DATA_SECONDS}s).`);
});
