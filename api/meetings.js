export default async function handler(request, response) {
  setJson(response);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(500).json({
      error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    });
  }

  try {
    if (request.method === 'GET') {
      return listRecords(response);
    }

    if (request.method === 'POST') {
      const body = readBody(request);
      return saveRecord(response, body);
    }

    if (request.method === 'DELETE') {
      const body = readBody(request);
      return deleteRecord(response, body.id);
    }

    return response.status(405).json({ error: 'Unsupported method.' });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Meetings API failed.' });
  }
}

async function listRecords(response) {
  const supabaseResponse = await fetch(
    `${baseUrl()}/rest/v1/meeting_records?select=*&order=saved_at.desc`,
    {
      method: 'GET',
      headers: supabaseHeaders(),
    },
  );

  if (!supabaseResponse.ok) {
    return response.status(supabaseResponse.status).json({ error: await supabaseResponse.text() });
  }

  const rows = await supabaseResponse.json();
  return response.status(200).json(rows.map(fromSupabaseRow));
}

async function saveRecord(response, record) {
  const supabaseResponse = await fetch(`${baseUrl()}/rest/v1/meeting_records`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation',
    },
    body: JSON.stringify(toSupabaseRow(record)),
  });

  if (!supabaseResponse.ok) {
    return response.status(supabaseResponse.status).json({ error: await supabaseResponse.text() });
  }

  const rows = await supabaseResponse.json();
  return response.status(200).json(fromSupabaseRow(rows[0]));
}

async function deleteRecord(response, id) {
  if (!id) {
    return response.status(400).json({ error: 'Meeting record ID is required.' });
  }

  const supabaseResponse = await fetch(
    `${baseUrl()}/rest/v1/meeting_records?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: supabaseHeaders(),
    },
  );

  if (!supabaseResponse.ok) {
    return response.status(supabaseResponse.status).json({ error: await supabaseResponse.text() });
  }

  return response.status(200).json({ ok: true });
}

function readBody(request) {
  return typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
}

function baseUrl() {
  return process.env.SUPABASE_URL.replace(/\/$/, '');
}

function supabaseHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function toSupabaseRow(record) {
  return {
    title: record?.title || '',
    meeting_date_time: record?.meetingDateTime || '',
    attendees: record?.attendees || '',
    note: record?.note || record?.notes || '',
    transcript_entries: Array.isArray(record?.transcriptEntries) ? record.transcriptEntries : [],
    summary: normalizeSummary(record?.summary),
  };
}

function fromSupabaseRow(row) {
  const note = row?.note || '';

  return {
    id: row?.id || '',
    title: row?.title || '',
    meetingDateTime: row?.meeting_date_time || '',
    attendees: row?.attendees || '',
    note,
    notes: note,
    transcriptEntries: Array.isArray(row?.transcript_entries) ? row.transcript_entries : [],
    summary: normalizeSummary(row?.summary),
    savedAt: row?.saved_at || row?.created_at || '',
  };
}

function normalizeSummary(summary = {}) {
  return {
    overview: summary.overview || '',
    keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints : [],
    actionItems: Array.isArray(summary.actionItems) ? summary.actionItems : [],
  };
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
