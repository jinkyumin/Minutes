import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('defines a Vercel-compatible production build', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts?.build, 'vite build');
  assert.match(packageJson.devDependencies?.vite || '', /^\^?\d+\./);
});
