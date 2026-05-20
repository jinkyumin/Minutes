import { createSignedAudioUpload } from './supabaseStorage.js';

export default async function handler(request, response) {
  setJson(response);

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST is supported.' });
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
    const upload = await createSignedAudioUpload({
      fileName: body.fileName,
      mimeType: body.mimeType || 'audio/webm',
    });

    return response.status(200).json(upload);
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Audio upload URL failed.' });
  }
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
