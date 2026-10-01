# Qwen Audiobook Studio

A responsive, English-language frontend for turning documents into audiobooks with a separately hosted Qwen TTS service.

## Current status

- [x] Website interface: file selection/drag-and-drop, narrator selection, MP3/WAV choice, upload progress, audio playback and download.
- [ ] Audio-generation backend: **not included or connected yet**.
- [ ] End-to-end conversion test.

The website does not generate audio on its own. The original Qwen3 Audiobook Converter is a Python/FFmpeg application; Cloudflare Pages is suitable for hosting this static interface, not for running the full Python/FFmpeg/Qwen model.

## Publish the website with Cloudflare Pages (phone-friendly)

1. Open the Cloudflare dashboard and go to **Workers & Pages**.
2. Choose **Create** → **Pages** → **Connect to Git**.
3. Select the GitHub repository `mahdi12e/qwen-audiobook-site` and authorize access if asked.
4. Use these settings:
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** leave blank
   - **Build output directory:** `/` (the repository root)
5. Start deployment. Cloudflare will provide a `*.pages.dev` address.

If Cloudflare's form does not accept `/` as the output directory, use `.` (dot) for the repository root.

## Connect an audio backend

The UI expects a backend at the URL entered in **Audio server URL**. It sends:

- `POST /api/convert`
- `multipart/form-data` fields:
  - `file`: uploaded book file
  - `voice`: `Ryan`, `Aiden`, or `Serena`
  - `format`: `mp3` or `wav`
  - `chunk_size`: selected chunk size

The backend may respond with either:
- The generated audio file directly, with an appropriate audio `Content-Type`; or
- JSON containing `audio_url` (an absolute URL or a URL relative to the backend), or `audio_base64` and optional `mime_type`.

The backend must also:
- Run the actual Qwen TTS conversion pipeline and FFmpeg where required.
- Allow browser requests from your Cloudflare Pages domain via CORS.
- Validate file type and size, limit request duration and resource use, and delete uploaded files/audio when no longer needed.
- Avoid exposing API keys or other secrets in frontend code.

## Free hosting caveat

Cloudflare Pages can host this interface on its free tier, subject to current plan limits. The audio backend is a separate service and may have sleep, runtime, file-size, CPU/GPU, or monthly usage limits. Free GPU inference is not guaranteed. Do not advertise conversion as working until a backend is deployed and tested.

## Local development

Open `index.html` in a browser to inspect the interface. Conversion requires a compatible backend as described above.
