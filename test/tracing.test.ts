import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { playgroundDir, startCollector, startServer, type Span } from './helpers.ts';

const SERVER_KIND = 2;
const CLIENT_KIND = 3;
const STATUS_ERROR = 2;

beforeAll(() => {
    execSync('pnpm exec nuxt build', { cwd: playgroundDir, stdio: 'pipe' });
});

describe('the built server', () => {
    let collector: Awaited<ReturnType<typeof startCollector>>;
    let spans: Span[];
    let output: string;
    const port = 3931;
    const base = `http://localhost:${port}`;
    let asset: string | undefined;

    beforeAll(async () => {
        asset = readdirSync(join(playgroundDir, '.output/public/_nuxt')).find((file) => file.endsWith('.js'));
        collector = await startCollector();
        const server = await startServer(port, {
            OTEL_SERVICE_NAME: 'playground',
            OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
            OTEL_METRICS_EXPORTER: 'none',
            OTEL_NODE_DISABLED_INSTRUMENTATIONS: 'fs,dns,net',
            OUTBOUND_URL: `${collector.url}/ping`
        });
        // The first request matters: http must be instrumented before Nitro creates its server.
        for (const path of [
            '/api/items/1',
            '/items/42?tab=info',
            '/api/outbound',
            '/api/fail',
            '/nope',
            '/robots.txt',
            `/_nuxt/${asset}`
        ]) {
            await fetch(`${base}${path}`);
        }
        // Stopping flushes spans still queued in the batch processor.
        await server.stop();
        output = server.output();
        spans = collector.spans;
    });

    afterAll(() => collector?.close());

    const serverSpan = (path: string) =>
        spans.find((span) => span.kind === SERVER_KIND && span.attributes['url.path'] === path);

    it('traces the first request', () => {
        expect(serverSpan('/api/items/1')).toBeDefined();
    });

    it('names API spans after the Nitro route', () => {
        const span = serverSpan('/api/items/1')!;
        expect(span.name).toBe('GET /api/items/:id');
        expect(span.attributes['http.route']).toBe('/api/items/:id');
        expect(span.service).toBe('playground');
    });

    it('names page spans after the Vue route', () => {
        const span = serverSpan('/items/42')!;
        expect(span.name).toBe('GET /items/:id');
        expect(span.attributes['http.route']).toBe('/items/:id');
    });

    it('adds outgoing fetches as child spans', () => {
        const parent = serverSpan('/api/outbound')!;
        const child = spans.find((span) => span.kind === CLIENT_KIND && span.traceId === parent.traceId);
        expect(child?.parentSpanId).toBe(parent.spanId);
        expect(child?.scope).toBe('@opentelemetry/instrumentation-undici');
    });

    it('records server errors on the span', () => {
        const span = serverSpan('/api/fail')!;
        expect(span.name).toBe('GET /api/fail');
        expect(span.status.code).toBe(STATUS_ERROR);
        expect(span.events.map((event) => event.name)).toContain('exception');
    });

    it("leaves the route off requests that don't match one", () => {
        const span = serverSpan('/nope')!;
        expect(span.name).toBe('GET');
        expect(span.attributes['http.route']).toBeUndefined();
    });

    it('ignores build assets and public files', () => {
        expect(serverSpan('/robots.txt')).toBeUndefined();
        expect(serverSpan(`/_nuxt/${asset}`)).toBeUndefined();
    });

    it('starts without warnings from the SDK', () => {
        expect(output).not.toMatch(/\[nuxt-opentelemetry\]|OTLPExporter|ECONNREFUSED/);
    });
});

describe('OTEL_SDK_DISABLED', () => {
    it('serves requests without sending spans', async () => {
        const collector = await startCollector();
        const port = 3932;
        const server = await startServer(port, {
            OTEL_SDK_DISABLED: 'true',
            OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json'
        });
        const response = await fetch(`http://localhost:${port}/api/items/1`);
        await server.stop();
        await collector.close();
        expect(response.status).toBe(200);
        expect(collector.spans).toEqual([]);
    });
});
