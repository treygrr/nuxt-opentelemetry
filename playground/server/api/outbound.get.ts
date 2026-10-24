// Calls OUTBOUND_URL, so the undici instrumentation adds a client span under the request span.
export default defineEventHandler(async () => {
    const response = await fetch(process.env.OUTBOUND_URL ?? 'http://localhost:4318/');
    return { status: response.status };
});
