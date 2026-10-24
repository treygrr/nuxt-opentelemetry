import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
    addPlugin,
    addServerPlugin,
    addServerTemplate,
    addTypeTemplate,
    createResolver,
    defineNuxtModule,
    useLogger
} from '@nuxt/kit';

import { findHiddenRequires } from './hidden-requires.ts';

export type ModuleOptions = {
    /**
     * Start the OpenTelemetry SDK in the built server. `OTEL_SDK_DISABLED=true` turns it off at runtime.
     * @default true
     */
    enabled: boolean;
    /**
     * Requests that get no span. Strings match path prefixes, regular expressions are tested against the path.
     * Nuxt's build assets and the files in `public/` are always ignored.
     * @default ['/__nuxt', '/_ipx/', '/_fonts/']
     */
    ignore: (string | RegExp)[];
};

/** Presets whose entry the module can run the SDK before. */
const SUPPORTED_PRESETS = ['node-server'];

const OPTIONS_ID = '#nuxt-opentelemetry/options';

const logger = useLogger('opentelemetry');

/** Every file in `dir`, as a URL path */
const listFiles = async (dir: string): Promise<string[]> => {
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => `/${relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')}`);
};

const serializeMatcher = (matcher: string | RegExp) =>
    matcher instanceof RegExp
        ? `new RegExp(${JSON.stringify(matcher.source)}, ${JSON.stringify(matcher.flags)})`
        : JSON.stringify(matcher);

export default defineNuxtModule<ModuleOptions>({
    meta: {
        name: '@treygrr/nuxt-opentelemetry',
        configKey: 'opentelemetry',
        compatibility: { nuxt: '^4.0.0' }
    },
    defaults: {
        enabled: true,
        ignore: ['/__nuxt', '/_ipx/', '/_fonts/']
    },
    setup(options, nuxt) {
        if (!options.enabled) return;

        const { resolve } = createResolver(import.meta.url);

        // Names page-render spans after the Vue route, and request spans after the Nitro route.
        addPlugin({ src: resolve('./runtime/app/plugins/route.server'), mode: 'server' });
        addServerPlugin(resolve('./runtime/server/plugins/opentelemetry'));

        addServerTemplate({
            filename: OPTIONS_ID,
            getContents: async () => {
                const publicFiles = await listFiles(nuxt.options.dir.public);
                const prefixes = [nuxt.options.app.buildAssetsDir];
                return [
                    `export const ignore = [${[...prefixes, ...options.ignore].map(serializeMatcher).join(', ')}];`,
                    `export const publicFiles = new Set(${JSON.stringify(publicFiles)});`
                ].join('\n');
            }
        });
        addTypeTemplate(
            {
                filename: 'types/nuxt-opentelemetry.d.ts',
                getContents: () =>
                    [
                        `declare module '${OPTIONS_ID}' {`,
                        '    export const ignore: (string | RegExp)[];',
                        '    export const publicFiles: Set<string>;',
                        '}',
                        "declare module 'h3' {",
                        '    interface H3EventContext {',
                        '        /** The route template of the page rendered for this request, eg `/play/:slug` */',
                        '        opentelemetryRoute?: string;',
                        '    }',
                        '}',
                        'export {};'
                    ].join('\n')
            },
            { nitro: true, nuxt: true }
        );

        nuxt.hook('nitro:init', async (nitro) => {
            const { preset, entry } = nitro.options;
            // Prerendering, `nuxt dev` and tests run other presets, so they never start the SDK.
            if (!SUPPORTED_PRESETS.includes(preset)) {
                if (!nitro.options.dev && preset !== 'nitro-prerender') {
                    logger.warn(`Tracing only runs on the ${SUPPORTED_PRESETS.join(', ')} preset, not ${preset}.`);
                }
                return;
            }
            // The SDK must patch modules before the app imports them, so the entry loads it first.
            nitro.options.virtual['#nuxt-opentelemetry/entry'] = [
                `await import(${JSON.stringify(resolve('./runtime/instrumentation'))});`,
                `await import(${JSON.stringify(entry)});`
            ].join('\n');
            nitro.options.entry = '#nuxt-opentelemetry/entry';

            nitro.options.externals.traceInclude = [
                ...(nitro.options.externals.traceInclude ?? []),
                ...(await findHiddenRequires(resolve('..')))
            ];
        });
    }
});
