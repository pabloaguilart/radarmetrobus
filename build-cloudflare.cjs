const fs = require('node:fs/promises');
const { loadStaticData } = require('./gtfs-static.cjs');

async function build() {
    const data = await loadStaticData();
    const vehicleFeed = process.env.VEHICLE_FEED_URL;
    let vehicleFeedUrl = null;
    if (vehicleFeed) {
        const url = new URL(vehicleFeed);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
            throw new Error('VEHICLE_FEED_URL debe ser una URL HTTPS pública sin credenciales.');
        }
        vehicleFeedUrl = url.href;
    }

    await fs.mkdir('dist', { recursive: true });
    await fs.mkdir('.generated', { recursive: true });
    await Promise.all([
        fs.copyFile('public/index.html', 'dist/index.html'),
        fs.writeFile('dist/routes.json', JSON.stringify(data.routesJsonCache)),
        fs.writeFile('dist/shapes.json', JSON.stringify(data.shapesJsonCache)),
        fs.writeFile('dist/stops.json', JSON.stringify(data.stopsJsonCache)),
        fs.writeFile('dist/map-config.json', JSON.stringify({
            cartoTileKey: process.env.CARTO_TILE_KEY || null,
            vehicleFeedUrl,
        })),
        fs.writeFile('.generated/lookup.json', JSON.stringify({
            routesCache: data.routesCache,
            tripsCache: data.tripsCache,
        })),
    ]);
}

build().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
