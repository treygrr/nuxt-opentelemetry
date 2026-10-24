// Bumps the package version, commits, and tags it.
// Pushing the tag runs .github/workflows/release.yml, which publishes to npm.
//
//   pnpm release 0.2.0

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
    console.error('Usage: pnpm release <version>, eg pnpm release 0.2.0');
    process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

if (execSync('git status --porcelain').toString().trim()) {
    console.error('Commit or stash your changes first.');
    process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = version;
writeFileSync('package.json', `${JSON.stringify(pkg, null, 4)}\n`);

run('git add package.json');
run(`git commit -m "chore: release v${version}"`);
// Annotated, so `git push --follow-tags` pushes it (it skips lightweight tags).
run(`git tag -a v${version} -m "v${version}"`);

console.log(`\nTagged v${version}. Push to publish:\n\n  git push --follow-tags\n`);
