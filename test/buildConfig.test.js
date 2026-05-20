import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('defines a Vercel-compatible production build', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts?.build, 'vite build');
  assert.match(packageJson.devDependencies?.vite || '', /^\^?\d+\./);
});

test('includes old version page in production build inputs', async () => {
  assert.equal(existsSync('old.html'), true);
  assert.equal(existsSync('src/app-old.js'), true);
  assert.equal(existsSync('src/styles-old.css'), true);

  const viteConfig = await readFile('vite.config.js', 'utf8');
  assert.match(viteConfig, /old\.html/);
});
