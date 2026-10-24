// import-in-the-middle ships register-hooks.d.ts next to register-hooks.mjs, but TypeScript only
// pairs .mjs files with .d.mts, so the import below is untyped without this.
declare module 'import-in-the-middle/register-hooks.mjs' {
    export type RegisterHooksOptions = {
        include?: Array<string | RegExp>;
        exclude?: Array<string | RegExp>;
        disableCjsSourceStripping?: boolean;
    };
    export function register(options?: RegisterHooksOptions): void;
    export function supportsSyncHooks(): boolean;
}
