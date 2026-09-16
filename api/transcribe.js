import { authenticate } from "../lib/auth.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!(await authenticate(request))) return response.status(401).json({ error: "Please sign in to transcribe a recording." });
  if (!process.env.GROQ_API_KEY) return response.status(503).json({ error: "GROQ_API_KEY is not configured." });

  try {
    const form = await readForm(request);
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return response.status(400).json({ error: "An audio file is required." });
    if (audio.size > 25 * 1024 * 1024) return response.status(413).json({ error: "Audio must be 25 MB or smaller." });

    const transcriptionForm = new FormData();
    transcriptionForm.set("file", audio, audio.name || "recording.mp3");
    transcriptionForm.set("model", "whisper-large-v3-turbo");
    transcriptionForm.set("response_format", "json");
    const upstream = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: transcriptionForm
    });
    if (!upstream.ok) throw new Error(await providerError(upstream));
    const payload = await upstream.json();
    const transcript = payload.text?.trim() || "";
    if (!transcript) throw new Error("No speech was detected in the recording.");
    return response.status(200).json({ transcript });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Transcription failed." });
  }
}

async function providerError(upstream) {
  let detail = "";
  try { detail = (await upstream.json())?.error?.message || ""; } catch {}
  return `Transcription failed (${upstream.status})${detail ? `: ${detail}` : "."}`;
}

async function readForm(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers["content-type"] } }).formData();
}
