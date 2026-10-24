import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

export const playgroundDir = fileURLToPath(new URL('../playground', import.meta.url));

type AnyValue = { stringValue?: string; intValue?: number | string; boolValue?: boolean };

export type Span = {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: number;
    attributes: Record<string, string | number | boolean | undefined>;
    status: { code?: number };
    events: { name: string }[];
    scope: string;
    service: string;
};

/** OTLP/HTTP JSON receiver that keeps every span it's sent */
export const startCollector = async () => {
    const spans: Span[] = [];
    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            if (req.url === '/v1/traces') {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                for (const resourceSpans of body.resourceSpans ?? []) {
                    const resource = toAttributes(resourceSpans.resource?.attributes);
                    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
                        for (const span of scopeSpans.spans ?? []) {
                            spans.push({
                                ...span,
                                attributes: toAttributes(span.attributes),
                                status: span.status ?? {},
                                events: span.events ?? [],
                                scope: scopeSpans.scope?.name,
                                service: String(resource['service.name'])
                            });
                        }
                    }
                }
            }
            res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        });
    });
    server.listen(0);
    await once(server, 'listening');
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
    return { url, spans, close: () => new Promise((resolve) => server.close(resolve)) };
};

const toAttributes = (list: { key: string; value: AnyValue }[] = []) =>
    Object.fromEntries(list.map(({ key, value }) => [key, value.stringValue ?? value.intValue ?? value.boolValue]));

/** Starts the built playground and resolves once it's listening */
export const startServer = async (port: number, env: Record<string, string>) => {
    const child: ChildProcess = spawn(process.execPath, ['.output/server/index.mjs'], {
        cwd: playgroundDir,
        env: { ...process.env, PORT: String(port), ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const listening = new Promise<void>((resolve, reject) => {
        const onData = (data: Buffer) => {
            output += data;
            if (output.includes('Listening on')) resolve();
        };
        child.stdout!.on('data', onData);
        child.stderr!.on('data', onData);
        child.once('exit', (code) => reject(new Error(`Server exited with ${code}:\n${output}`)));
    });
    await listening;
    return {
        output: () => output,
        /** Sends SIGTERM, as Kubernetes does, and waits for the process to exit */
        stop: async () => {
            if (child.exitCode !== null) return;
            child.kill('SIGTERM');
            await once(child, 'exit');
        }
    };
};
