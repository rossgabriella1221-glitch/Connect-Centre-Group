import { flatRubric, calculate } from "../lib/rubric.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return response.status(503).json({ error: "OPENAI_API_KEY is not configured." });

  try {
    const form = await readForm(request);
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return response.status(400).json({ error: "An audio file is required." });
    if (audio.size > 25 * 1024 * 1024) return response.status(413).json({ error: "Audio must be 25 MB or smaller." });

    const transcriptionForm = new FormData();
    transcriptionForm.set("file", audio, audio.name || "recording.mp3");
    transcriptionForm.set("model", "gpt-4o-transcribe");
    transcriptionForm.set("response_format", "json");
    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: transcriptionForm
    });
    if (!transcriptionResponse.ok) throw new Error(`Transcription failed (${transcriptionResponse.status}).`);
    const transcriptPayload = await transcriptionResponse.json();
    const transcript = transcriptPayload.text || "";

    const scoringResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [{ role: "system", content: "You are a strict contact-centre QA evaluator. Translate the transcript to English when necessary. Evaluate only observable evidence. Give concise evidence-based comments. For unavailable CRM-only evidence, score 0 and explain that manual verification is required." }, { role: "user", content: JSON.stringify({ transcript, rubric: flatRubric }) }],
        text: { format: { type: "json_schema", name: "qa_evaluation", strict: true, schema: {
          type: "object", additionalProperties: false, required: ["detected_language", "english_transcript", "summary", "results"],
          properties: {
            detected_language: { type: "string" }, english_transcript: { type: "string" }, summary: { type: "string" },
            results: { type: "array", minItems: flatRubric.length, maxItems: flatRubric.length, items: { type: "object", additionalProperties: false, required: ["id", "score", "comment", "evidence"], properties: { id: { type: "string" }, score: { type: ["number", "string"] }, comment: { type: "string" }, evidence: { type: "string" } } }
          }
        } } }
      }
      })
    });
    if (!scoringResponse.ok) throw new Error(`Evaluation failed (${scoringResponse.status}).`);
    const scoringPayload = await scoringResponse.json();
    const parsed = JSON.parse(scoringPayload.output_text);
    const evaluation = calculate(parsed.results);
    return response.status(200).json({ transcript, ...parsed, ...evaluation, created_at: new Date().toISOString() });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Evaluation failed." });
  }
}

async function readForm(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers["content-type"] } }).formData();
}
