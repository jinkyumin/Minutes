const DEFAULT_AUDIO_BUCKET = 'meeting-audio';

export async function createSignedAudioUpload({ fileName = 'meeting.webm', mimeType = 'audio/webm' } = {}) {
  assertSupabaseConfigured();
  await ensureAudioBucket();

  const path = createAudioPath(fileName, mimeType);
  const response = await fetch(`${storageBaseUrl()}/object/upload/sign/${audioBucket()}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: storageHeaders(),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  const signedUrl = new URL(`${storageBaseUrl()}${data.url}`);
  const token = signedUrl.searchParams.get('token');

  if (!token) {
    throw new Error('Supabase signed upload token was not returned.');
  }

  return {
    bucket: audioBucket(),
    path,
    token,
    uploadUrl: signedUrl.toString(),
  };
}

export async function downloadAudioObject(path) {
  assertSupabaseConfigured();

  const response = await fetch(`${storageBaseUrl()}/object/${audioBucket()}/${encodeStoragePath(path)}`, {
    method: 'GET',
    headers: storageHeaders(),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteAudioObject(path) {
  if (!path || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  await fetch(`${storageBaseUrl()}/object/${audioBucket()}`, {
    method: 'DELETE',
    headers: storageHeaders(),
    body: JSON.stringify({ prefixes: [path] }),
  });
}

function assertSupabaseConfigured() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
}

async function ensureAudioBucket() {
  const getResponse = await fetch(`${storageBaseUrl()}/bucket/${audioBucket()}`, {
    method: 'GET',
    headers: storageHeaders(),
  });

  if (getResponse.ok) return;
  if (getResponse.status !== 404) {
    throw new Error(await getResponse.text());
  }

  const createResponse = await fetch(`${storageBaseUrl()}/bucket`, {
    method: 'POST',
    headers: storageHeaders(),
    body: JSON.stringify({
      id: audioBucket(),
      name: audioBucket(),
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
    }),
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    throw new Error(await createResponse.text());
  }
}

function createAudioPath(fileName, mimeType) {
  const extension = extensionForAudio(fileName, mimeType);
  return `recordings/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

function extensionForAudio(fileName, mimeType) {
  const fromName = String(fileName || '').split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;

  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function audioBucket() {
  return process.env.SUPABASE_AUDIO_BUCKET || DEFAULT_AUDIO_BUCKET;
}

function storageBaseUrl() {
  return `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
}

function storageHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}
