import { deleteAudioObject, downloadAudioObject } from './supabaseStorage.js';

const MAX_INLINE_AUDIO_BASE64_LENGTH = 4_000_000;

export default async function handler(request, response) {
  setJson(response);

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST is supported.' });
  }

  const body = readBody(request);
  const audioInput = parseAudioInput(body.audio);
  const storagePath = body.storagePath || '';
  const audioData = storagePath ? '' : audioInput.data;
  const mimeType = normalizeAudioMimeType(body.mimeType || audioInput.mimeType || 'audio/webm');

  if (!audioData && !storagePath) {
    return response.status(400).json({ error: 'Audio is required.' });
  }

  if (audioData.length > MAX_INLINE_AUDIO_BASE64_LENGTH) {
    return response.status(413).json({
      error: 'Audio file is too large for inline transcription. Please upload a shorter recording.',
    });
  }

  try {
    const resolvedAudioData = storagePath
      ? bytesToBase64(await downloadAudioObject(storagePath))
      : audioData;

    const transcript =
      resolveProvider() === 'openai'
        ? await transcribeWithOpenAI(resolvedAudioData, mimeType)
        : await transcribeWithGemini(resolvedAudioData, mimeType);

    return response.status(200).json({ transcript });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Transcription failed.' });
  } finally {
    if (storagePath) {
      try {
        await deleteAudioObject(storagePath);
      } catch (error) {
        console.warn('Temporary audio cleanup failed:', error.message);
      }
    }
  }
}

async function transcribeWithGemini(audioData, mimeType) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const model = process.env.GEMINI_TRANSCRIBE_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0,
          topP: 0.8,
          maxOutputTokens: 8192,
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audioData,
                },
              },
              {
                text: [
                  '이 한국어 회의 녹음을 가능한 한 정확하게 전사하세요.',
                  '발언자 라벨은 들리는 경우에만 Speaker 1, Speaker 2 형식으로 표시하세요.',
                  '추측으로 내용을 만들지 말고, 들리지 않는 부분은 [불명확]으로 표시하세요.',
                  '요약하지 말고 전사문만 반환하세요.',
                ].join('\n'),
              },
            ],
          },
        ],
      }),
    },
  );

  if (!geminiResponse.ok) {
    throw new Error(await geminiResponse.text());
  }

  const data = await geminiResponse.json();
  return parseGeminiText(data);
}

async function transcribeWithOpenAI(audioData, mimeType) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const formData = new FormData();
  formData.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
  formData.append('language', 'ko');
  formData.append(
    'file',
    new Blob([base64ToBytes(audioData)], { type: mimeType }),
    `meeting.${extensionForMimeType(mimeType)}`,
  );

  const openAiResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!openAiResponse.ok) {
    throw new Error(await openAiResponse.text());
  }

  const data = await openAiResponse.json();
  return String(data.text || '').trim();
}

function readBody(request) {
  return typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
}

function resolveProvider() {
  return (process.env.TRANSCRIPTION_PROVIDER || process.env.LLM_PROVIDER || 'gemini').toLowerCase();
}

function parseAudioInput(audio = '') {
  const text = String(audio || '');
  const dataUrlMatch = text.match(/^data:([^,]+),(.*)$/s);

  if (!dataUrlMatch) {
    return { data: text.trim(), mimeType: '' };
  }

  const metadata = dataUrlMatch[1] || '';
  const mimeType = metadata.split(';')[0] || '';
  return {
    data: dataUrlMatch[2].trim(),
    mimeType,
  };
}

function normalizeAudioMimeType(mimeType = '') {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();

  if (normalized === 'audio/x-m4a') return 'audio/m4a';
  if (normalized === 'audio/mp3') return 'audio/mp3';
  if (normalized.startsWith('audio/')) return normalized;
  return 'audio/webm';
}

function parseGeminiText(data) {
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || '';
}

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
