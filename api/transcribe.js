import { authenticate } from "../lib/auth.js";

export const config = { api: { bodyParser: false } };

const LANGUAGE_CODES = {
  english: "en",
  mandarin: "zh",
  malay: "ms",
  tamil: "ta",
  spanish: "es",
  french: "fr"
};

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!(await authenticate(request))) return response.status(401).json({ error: "Please sign in to transcribe a recording." });
  if (!process.env.GROQ_API_KEY) return response.status(503).json({ error: "GROQ_API_KEY is not configured." });

  try {
    const form = await readForm(request);
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return response.status(400).json({ error: "An audio file is required." });
    if (audio.size > 25 * 1024 * 1024) return response.status(413).json({ error: "Audio must be 25 MB or smaller." });

    const selectedLanguage = String(form.get("language") || "auto").toLowerCase();
    const language = LANGUAGE_CODES[selectedLanguage];
    const part = Math.max(1, Number(form.get("part")) || 1);
    const parts = Math.max(1, Number(form.get("parts")) || 1);
    const filename = audio.name || "recording.mp3";
    let result = await transcribe(audio, filename, language, false, part, parts);
    let retriedOpening = false;

    if (part === 1 && needsOpeningRetry(result)) {
      retriedOpening = true;
      const retry = await transcribe(audio, filename, language, true, part, parts);
      result = chooseBetterOpening(result, retry);
    }

    const transcript = result.text?.trim() || "";
    if (!transcript) throw new Error("No speech was detected in the recording.");
    console.log("[api/transcribe] completed", {
      characters: transcript.length,
      firstSegmentStart: getFirstSegmentStart(result),
      lastSegmentEnd: getLastSegmentEnd(result),
      duration: Number(result.duration) || null,
      language: language || "auto",
      part,
      parts,
      retriedOpening
    });
    return response.status(200).json({ transcript });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Transcription failed." });
  }
}

async function transcribe(audio, filename, language, openingRetry, part, parts) {
  const transcriptionForm = new FormData();
  transcriptionForm.set("file", audio, filename);
  transcriptionForm.set("model", "whisper-large-v3");
  transcriptionForm.set("response_format", "verbose_json");
  transcriptionForm.set("timestamp_granularities[]", "segment");
  transcriptionForm.set("temperature", "0");
  if (language) transcriptionForm.set("language", language);
  const sectionContext = parts > 1 ? ` This is section ${part} of ${parts}. Transcribe every spoken word in this section from its beginning through its end.` : " Include the very first spoken words after any ringing or silence, especially the agent's greeting and introduction. Continue through the final spoken word.";
  transcriptionForm.set("prompt", openingRetry
    ? "Start at the first spoken syllable after any ringing or silence. Do not omit the opening greeting, company name, agent introduction, or offer of assistance. Transcribe the entire contact-centre call through the final spoken word exactly as heard."
    : `This is a contact-centre telephone call between an agent and a caller.${sectionContext} Preserve all dialogue, names, numbers, questions, answers, and closing statements exactly as heard.`);

  const upstream = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: transcriptionForm
  });
  if (!upstream.ok) throw new Error(await providerError(upstream));
  return upstream.json();
}

function needsOpeningRetry(result) {
  if (!result.text?.trim()) return false;
  const firstStart = getFirstSegmentStart(result);
  return !hasOpeningGreeting(result.text) || (Number.isFinite(firstStart) && firstStart > 12);
}

function chooseBetterOpening(first, retry) {
  return openingScore(retry) > openingScore(first) ? retry : first;
}

function openingScore(result) {
  const firstStart = getFirstSegmentStart(result);
  const greetingBonus = hasOpeningGreeting(result.text || "") ? 100 : 0;
  const completenessBonus = Math.min((result.text?.length || 0) / 1000, 10);
  return greetingBonus + completenessBonus - (Number.isFinite(firstStart) ? firstStart : 0);
}

function hasOpeningGreeting(text) {
  return /\b(hello|hi|good\s+(morning|afternoon|evening)|thanks?\s+you\s+for\s+calling|thanks?\s+for\s+calling|how\s+(may|can)\s+i\s+(help|assist)|my\s+name\s+is|this\s+is)\b/i.test(text.slice(0, 400));
}

function getFirstSegmentStart(result) {
  const firstStart = Number(result.segments?.[0]?.start);
  return Number.isFinite(firstStart) ? firstStart : null;
}

function getLastSegmentEnd(result) {
  const lastEnd = Number(result.segments?.at(-1)?.end);
  return Number.isFinite(lastEnd) ? lastEnd : null;
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
