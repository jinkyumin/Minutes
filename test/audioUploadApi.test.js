import test from 'node:test';
import assert from 'node:assert/strict';

import audioUploadHandler from '../api/audio-upload.js';

test('audio upload API creates a Supabase signed upload URL', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url).endsWith('/storage/v1/bucket/meeting-audio')) {
      return jsonResponse({ id: 'meeting-audio' });
    }

    if (String(url).includes('/storage/v1/object/upload/sign/meeting-audio/')) {
      return jsonResponse({
        url: '/object/upload/sign/meeting-audio/recordings/test.webm?token=signed-token',
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const response = createResponse();
  await audioUploadHandler(
    createRequest('POST', {
      fileName: 'meeting.webm',
      mimeType: 'audio/webm',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.bucket, 'meeting-audio');
  assert.match(body.path, /^recordings\/\d{4}-\d{2}-\d{2}\/.+\.webm$/);
  assert.equal(body.token, 'signed-token');
  assert.equal(
    body.uploadUrl,
    'https://project.supabase.co/storage/v1/object/upload/sign/meeting-audio/recordings/test.webm?token=signed-token',
  );
  assert.equal(requests[0].options.headers.Authorization, 'Bearer service-key');

  restoreEnv('SUPABASE_URL', originalUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  globalThis.fetch = originalFetch;
});

test('audio upload API creates the bucket when it does not exist', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url).endsWith('/storage/v1/bucket/meeting-audio')) {
      return jsonResponse({ message: 'Bucket not found' }, { ok: false, status: 404 });
    }

    if (String(url).endsWith('/storage/v1/bucket')) {
      return jsonResponse({ name: 'meeting-audio' });
    }

    if (String(url).includes('/storage/v1/object/upload/sign/meeting-audio/')) {
      return jsonResponse({
        signedURL: '/object/upload/sign/meeting-audio/recordings/test.webm?token=signed-token',
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const response = createResponse();
  await audioUploadHandler(createRequest('POST', { fileName: 'meeting.webm' }), response);

  assert.equal(response.statusCode, 200);
  const bucketCreateRequest = requests.find((request) => String(request.url).endsWith('/storage/v1/bucket'));
  assert.deepEqual(JSON.parse(bucketCreateRequest.options.body), {
    name: 'meeting-audio',
    public: false,
    file_size_limit: 52_428_800,
    allowed_mime_types: [
      'audio/aac',
      'audio/flac',
      'audio/m4a',
      'audio/mp3',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg',
      'audio/opus',
      'audio/wav',
      'audio/webm',
    ],
  });

  restoreEnv('SUPABASE_URL', originalUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  globalThis.fetch = originalFetch;
});

test('audio upload API returns a clear bucket message for storage 404 failures', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/storage/v1/bucket/meeting-audio')) {
      return jsonResponse({ message: 'Bucket not found' }, { ok: false, status: 404 });
    }

    if (String(url).endsWith('/storage/v1/bucket')) {
      return jsonResponse({ message: 'Bucket API disabled' }, { ok: false, status: 404 });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const response = createResponse();
  await audioUploadHandler(createRequest('POST', { fileName: 'meeting.webm' }), response);

  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /meeting-audio/);
  assert.match(JSON.parse(response.body).error, /버킷/);

  restoreEnv('SUPABASE_URL', originalUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  globalThis.fetch = originalFetch;
});

function createRequest(method, body) {
  return { method, body };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
  };
}

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
