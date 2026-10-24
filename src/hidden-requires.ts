import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join } from 'node:path';

// The @opentelemetry packages are built with rolldown, whose ESM output loads some dependencies
// through `const __require = createRequire(import.meta.url)`. Nitro's file tracer doesn't follow
// that alias, so those dependencies (eg forwarded-parse) are missing from .output and the server
// fails to start. This finds them so they can be added to Nitro's `externals.traceInclude`.

const HIDDEN_REQUIRE = /__require\("([^"]+)"\)/g;

/** The real directory of package `name` as Node would find it from `fromDir` */
const findPackageDir = (name: string, fromDir: string) => {
    for (let dir = fromDir; ; dir = dirname(dir)) {
        const candidate = join(dir, 'node_modules', name);
        // pnpm links packages, and their dependencies sit next to the link target.
        if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
        if (dirname(dir) === dir) return undefined;
    }
};

const listModules = async (dir: string) => {
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name));
};

/**
 * Files required through `__require` by the @opentelemetry packages reachable from `rootDir`.
 * @param rootDir - A package directory whose dependencies include the @opentelemetry packages.
 */
export const findHiddenRequires = async (rootDir: string) => {
    const seen = new Set<string>();
    const queue = [rootDir];
    const files = new Set<string>();

    while (queue.length) {
        const pkgDir = queue.shift()!;
        const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
        for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
            if (!name.startsWith('@opentelemetry/')) continue;
            const dir = findPackageDir(name, pkgDir);
            if (!dir || seen.has(dir)) continue;
            seen.add(dir);
            queue.push(dir);
        }
        if (pkgDir === rootDir) continue;

        for (const file of await listModules(join(pkgDir, 'dist'))) {
            const source = await readFile(file, 'utf8');
            for (const [, specifier] of source.matchAll(HIDDEN_REQUIRE)) {
                if (isBuiltin(specifier!)) continue;
                try {
                    files.add(createRequire(file).resolve(specifier!));
                } catch {
                    // An optional dependency that isn't installed; the package handles it missing.
                }
            }
        }
    }

    return [...files];
};
