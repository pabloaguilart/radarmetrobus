import { DurableObject } from 'cloudflare:workers';
import realtime from './gtfs-realtime.cjs';
import lookup from './.generated/lookup.json';

const validationUrl = 'https://metrobus-gtfs.sinopticoplus.com/gtfs-api/partnerValidation';
const refreshMs = 10_000;
const urlLifetimeMs = 480_000;

export class RadarUpdater extends DurableObject {
    async snapshot() {
        return this.ctx.storage.get('snapshot');
    }

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
            signal: AbortSignal.timeout(12_000),
            redirect: 'manual',
        });
        if (!response.ok) throw new Error(`GTFS HTTP ${response.status}`);
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
        let stage = 'validación';
        try {
            const url = await this.getFeedUrl();
            stage = 'descarga';
            const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
            if (response.status === 401 || response.status === 403) {
                await this.ctx.storage.delete('feedUrl');
            }
            if (!response.ok) throw new Error('El proveedor de posiciones no respondió correctamente.');

            stage = 'decodificación';
            const snapshot = realtime.decodeVehicles(await response.arrayBuffer(), lookup);
            if (snapshot.count === 0) throw new Error('El proveedor devolvió un feed vacío.');
            stage = 'almacenamiento';
            await this.ctx.storage.put('snapshot', JSON.stringify(snapshot));
        } catch (error) {
            retryMs = 30_000;
            const code = error instanceof Error && error.name === 'TypeError'
                ? error.message
                    .replaceAll(this.env.API_USER, '[usuario]')
                    .replaceAll(this.env.API_PASS, '[secreto]')
                    .replace(/https?:[^\s]+/gi, '[URL]')
                    .slice(0, 160)
                : undefined;
            console.warn('No se pudo actualizar el Radar.', stage, error instanceof Error ? error.name : 'UnknownError', code ?? '');
        } finally {
            await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, startedAt + retryMs));
        }
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname !== '/vehicles.json') return env.ASSETS.fetch(request);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        }
        url.search = '';
        const key = new Request(url);
        const cached = await caches.default.match(key);
        if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached;

        const radar = env.RADAR.getByName('metrobuses');
        const snapshot = await radar.snapshot();
        if (!snapshot) {
            ctx.waitUntil(radar.ensureRunning());
            return Response.json({ error: 'Posiciones en vivo no disponibles' }, {
                status: 503,
                headers: { 'Cache-Control': 'no-store' },
            });
        }
        const response = new Response(snapshot, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=8',
            },
        });
        ctx.waitUntil(caches.default.put(key, response.clone()));
        return request.method === 'HEAD' ? new Response(null, response) : response;
    },
    async scheduled(_controller, env) {
        await env.RADAR.getByName('metrobuses').ensureRunning();
    },
};
