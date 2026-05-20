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

test('local development server routes API handlers', async () => {
  const server = await readFile('server.js', 'utf8');

  assert.match(server, /\/api\/transcribe/);
  assert.match(server, /\/api\/summarize/);
});

test('main page exposes temporary audio upload controls', async () => {
  const html = await readFile('index.html', 'utf8');

  assert.match(html, /uploadAudioButton/);
  assert.match(html, /audioFileInput/);
  assert.match(html, /accept="audio\/\*/);
});
