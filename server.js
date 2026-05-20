import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 4173);
const root = process.cwd();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const apiHandlers = {
  '/api/summarize': () => import('./api/summarize.js'),
  '/api/transcribe': () => import('./api/transcribe.js'),
  '/api/notion': () => import('./api/notion.js'),
  '/api/meetings': () => import('./api/meetings.js'),
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://localhost:${port}`);

  if (apiHandlers[url.pathname]) {
    await handleApiRequest(request, response, url.pathname);
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
});

async function handleApiRequest(request, response, pathname) {
  try {
    const { default: handler } = await apiHandlers[pathname]();
    const body = await readJsonBody(request);

    response.status = (code) => {
      response.statusCode = code;
      return response;
    };
    response.json = (payload) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(payload));
      return response;
    };

    await handler({ method: request.method, body }, response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error.message || 'Local API failed.' }));
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      rawBody += chunk;
    });
    request.on('error', reject);
    request.on('end', () => {
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });
  });
}

server.listen(port, () => {
  console.log(`Meeting app running at http://localhost:${port}`);
});
