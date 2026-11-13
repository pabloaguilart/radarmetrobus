const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const PUBLIC_DIR = path.join(__dirname, "public");
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
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath, { encoding: 'utf8' }).on('error', reject)
            .pipe(csv({ mapHeaders: ({ header }) => cleanHeader(header) }))
            .on('data', onRow)
            .on('end', resolve)
            .on('error', reject);
    });
}

// Carga de datos estáticos (Rutas, Trazos, Estaciones)
async function loadStaticData() {
    const routesCache = Object.create(null);
    const tripsCache = Object.create(null);
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
    const routesJsonCache = { count: linesArray.length, lines: linesArray };

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
    const shapesJsonCache = { count: shapesResult.length, shapes: shapesResult };

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
    const stopsJsonCache = { count: stopsResult.length, stops: stopsResult };

    return { routesCache, tripsCache, routesJsonCache, shapesJsonCache, stopsJsonCache };
}

module.exports = { loadStaticData };
