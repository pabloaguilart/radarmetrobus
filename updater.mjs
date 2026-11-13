import { DurableObject } from 'cloudflare:workers';
import realtime from './gtfs-realtime.cjs';
import lookup from './.generated/lookup.json';

const validationUrl = 'https://metrobus-gtfs.sinopticoplus.com/gtfs-api/partnerValidation';
const refreshMs = 10_000;
const urlLifetimeMs = 480_000;

export class RadarUpdater extends DurableObject {
    async ensureRunning() {
        if (this.env.API_USER && this.env.API_PASS && await this.ctx.storage.getAlarm() === null) {
            await this.ctx.storage.setAlarm(Date.now());
        }
    }

    async getFeedUrl() {
        const saved = await this.ctx.storage.get('feedUrl');
        if (saved?.expiresAt > Date.now()) return saved.url;

        const response = await fetch(validationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: this.env.API_USER, senha: this.env.API_PASS }),
            signal: AbortSignal.timeout(5_000),
            redirect: 'error',
        });
        if (!response.ok) throw new Error('La validación del proveedor falló.');
        const { urlRealTime } = await response.json();
        const url = new URL(urlRealTime);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new Error('URL de posiciones inválida.');
        }
        await this.ctx.storage.put('feedUrl', { url: url.href, expiresAt: Date.now() + urlLifetimeMs });
        return url.href;
    }

    async alarm() {
        if (!this.env.API_USER || !this.env.API_PASS) return;
        const startedAt = Date.now();
        let retryMs = refreshMs;
        try {
            const url = await this.getFeedUrl();
            const response = await fetch(url, { signal: AbortSignal.timeout(7_000) });
            if (response.status === 401 || response.status === 403) {
                await this.ctx.storage.delete('feedUrl');
            }
            if (!response.ok) throw new Error('El proveedor de posiciones no respondió correctamente.');

            const snapshot = realtime.decodeVehicles(await response.arrayBuffer(), lookup);
            if (snapshot.count === 0) throw new Error('El proveedor devolvió un feed vacío.');
            await this.env.SNAPSHOTS.put('vehicles.json', JSON.stringify(snapshot), {
                httpMetadata: {
                    contentType: 'application/json; charset=utf-8',
                    cacheControl: 'public, max-age=2, s-maxage=8',
                },
            });
        } catch {
            retryMs = 30_000;
            console.warn('No se pudo actualizar el Radar. Se conserva la última lectura.');
        } finally {
            await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, startedAt + retryMs));
        }
    }
}

export default {
    async scheduled(_controller, env) {
        await env.RADAR.getByName('metrobuses').ensureRunning();
    },
};
