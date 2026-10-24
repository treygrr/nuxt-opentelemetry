import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        // The end-to-end test builds the playground and starts the server.
        testTimeout: 240_000,
        hookTimeout: 240_000
    }
});
