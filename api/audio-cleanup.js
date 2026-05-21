import { deleteAudioObject } from './supabaseStorage.js';

export default async function handler(request, response) {
  setJson(response);

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST is supported.' });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
    if (!body.storagePath) {
      return response.status(400).json({ error: 'storagePath is required.' });
    }

    await deleteAudioObject(body.storagePath);
    return response.status(200).json({ ok: true });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Audio cleanup failed.' });
  }
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
