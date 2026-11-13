const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

function decodeVehicles(bytes, { routesCache, tripsCache }) {
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(bytes));
    const items = [];
    const byLine = Object.create(null);

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
            bearing: v.position.bearing ?? null,
            speed: v.position.speed ?? null,
            timestamp: v.timestamp ? Number(v.timestamp) : null
        });
    });

    // Actualizamos el Caché Global en memoria
    return {
        updated_at: new Date().toISOString(),
        updated_local: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        source: "API CDMX Realtime",
        count: items.length,
        by_line: byLine,
        vehicles: items
    };

}

module.exports = { decodeVehicles };
