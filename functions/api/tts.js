const QWEN_SPACE = "https://qwen-qwen3-tts.hf.space";
const MAX_TEXT_LENGTH = 5000;
const TIMEOUT_MS = 120000;

const LANGUAGES = ["Auto","Chinese","English","Japanese","Korean","French","German","Spanish","Portuguese","Russian"];
const SPEAKERS = ["Aiden","Dylan","Eric","Ono_anna","Ryan","Serena","Sohee","Uncle_fu","Vivian"];
const MODELS = ["0.6B","1.7B"];

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestGet({ request }) {
  return json({
    ok: true,
    service: "qwen3-tts",
    provider: "Hugging Face Qwen/Qwen3-TTS"
  }, 200, request);
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();

    const text = String(body?.text ?? "").trim();
    const language = String(body?.language ?? "English");
    const speaker = String(body?.speaker ?? "Ryan");
    const instruct = String(body?.instruct ?? "");
    const modelSize = String(body?.model_size ?? "1.7B");

    if (!text) return json({ error: "text is required" }, 400, request);
    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: `Text is limited to ${MAX_TEXT_LENGTH} characters per request.` }, 400, request);
    }
    if (!LANGUAGES.includes(language)) return json({ error: "Unsupported language." }, 400, request);
    if (!SPEAKERS.includes(speaker)) return json({ error: "Unsupported speaker." }, 400, request);
    if (!MODELS.includes(modelSize)) return json({ error: "Unsupported model size." }, 400, request);

    const infoResponse = await qwenFetch(`${QWEN_SPACE}/gradio_api/info`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (!infoResponse.ok) {
      return json({
        error: "Qwen3-TTS Space API is unavailable.",
        status: infoResponse.status
      }, 502, request);
    }

    const info = await infoResponse.json();
    const endpoint = findCustomVoiceEndpoint(info);

    if (!endpoint) {
      return json({
        error: "Could not find the CustomVoice endpoint in Qwen3-TTS.",
        endpoints: listEndpoints(info)
      }, 502, request);
    }

    const submitResponse = await qwenFetch(
      `${QWEN_SPACE}/gradio_api/call/${encodeURIComponent(endpoint)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          data: [text, language, speaker, instruct, modelSize]
        })
      }
    );

    const submitText = await submitResponse.text();

    if (!submitResponse.ok) {
      return json({
        error: "Qwen generation request was rejected.",
        status: submitResponse.status,
        details: submitText.slice(0, 2000)
      }, 502, request);
    }

    let submitted;
    try {
      submitted = JSON.parse(submitText);
    } catch {
      return json({
        error: "Invalid response from Qwen.",
        details: submitText.slice(0, 2000)
      }, 502, request);
    }

    if (!submitted.event_id) {
      return json({
        error: "Qwen did not return an event_id.",
        response: submitted
      }, 502, request);
    }

    const result = await waitForResult(endpoint, submitted.event_id);

    if (!result.ok) {
      return json({
        error: "Qwen TTS generation failed.",
        details: result.error
      }, 502, request);
    }

    const audio = findAudio(result.data);
    if (!audio) {
      return json({
        error: "Qwen completed but returned no audio file.",
        response: result.data
      }, 502, request);
    }

    const audioUrl = audio.url || makeFileUrl(audio.path);
    if (!audioUrl) {
      return json({
        error: "Qwen returned an unsupported audio-file format.",
        audio
      }, 502, request);
    }

    const audioResponse = await qwenFetch(audioUrl, { method: "GET" });

    if (!audioResponse.ok) {
      return json({
        error: "Could not download generated audio from Qwen.",
        status: audioResponse.status
      }, 502, request);
    }

    const headers = new Headers();
    headers.set("Content-Type", audioResponse.headers.get("Content-Type") || "audio/wav");
    headers.set("Content-Disposition", 'inline; filename="qwen3-tts.wav"');
    headers.set("Cache-Control", "no-store");
    addCors(headers, request);

    return new Response(audioResponse.body, { status: 200, headers });
  } catch (error) {
    return json({
      error: "TTS request failed.",
      details: error?.name === "AbortError" ? "Qwen request timed out." : (error?.message || String(error))
    }, 500, request);
  }
}

function findCustomVoiceEndpoint(info) {
  const collections = [info?.named_endpoints || {}, info?.unnamed_endpoints || {}];

  for (const collection of collections) {
    for (const [name, definition] of Object.entries(collection)) {
      const raw = JSON.stringify(definition).toLowerCase();
      if (
        raw.includes("speaker") &&
        raw.includes("language") &&
        (raw.includes("model_size") || raw.includes("model size"))
      ) {
        return name.replace(/^\/+/, "");
      }
    }
  }

  return null;
}

function listEndpoints(info) {
  return [
    ...Object.keys(info?.named_endpoints || {}),
    ...Object.keys(info?.unnamed_endpoints || {})
  ];
}

async function waitForResult(endpoint, eventId) {
  const response = await qwenFetch(
    `${QWEN_SPACE}/gradio_api/call/${encodeURIComponent(endpoint)}/${encodeURIComponent(eventId)}`,
    {
      method: "GET",
      headers: { Accept: "text/event-stream" }
    }
  );

  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

  const text = await response.text();

  for (const block of text.split(/\n\n+/)) {
    let event = "message";
    let data = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }

    if (event === "error") return { ok: false, error: data };

    if (event === "complete") {
      try {
        return { ok: true, data: JSON.parse(data) };
      } catch {
        return { ok: false, error: "Qwen returned invalid completion data." };
      }
    }
  }

  return { ok: false, error: "No completion event was received from Qwen." };
}

function findAudio(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudio(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  if (value.url || value.path) {
    return {
      url: value.url || null,
      path: value.path || null,
      filename: value.orig_name || value.filename || null
    };
  }

  if (value.file) return findAudio(value.file);
  if (value.value) return findAudio(value.value);

  return null;
}

function makeFileUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${QWEN_SPACE}/gradio_api/file=${encodeURIComponent(path)}`;
}

async function qwenFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function json(data, status, request) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  addCors(headers, request);

  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(request) {
  const headers = new Headers();
  addCors(headers, request);
  return headers;
}

function addCors(headers, request) {
  const origin = request?.headers?.get("Origin");

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
}
