import { flatRubric, calculate } from "../lib/rubric.js";
import { timingSafeEqual } from "node:crypto";

export const config = { api: { bodyParser: false } };

const GROQ_API_URL = "https://api.groq.com/openai/v1";
const TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const EVALUATION_MODEL = "openai/gpt-oss-20b";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!authorized(request)) return response.status(401).json({ error: "A valid dashboard access key is required." });
  if (!process.env.GROQ_API_KEY) return response.status(503).json({ error: "GROQ_API_KEY is not configured." });

  try {
    const form = await readForm(request);
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return response.status(400).json({ error: "An audio file is required." });
    if (audio.size > 25 * 1024 * 1024) return response.status(413).json({ error: "Audio must be 25 MB or smaller." });

    const transcriptionForm = new FormData();
    transcriptionForm.set("file", audio, audio.name || "recording.mp3");
    transcriptionForm.set("model", TRANSCRIPTION_MODEL);
    transcriptionForm.set("response_format", "json");
    const transcriptionResponse = await fetch(`${GROQ_API_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: transcriptionForm
    });
    if (!transcriptionResponse.ok) throw new Error(await providerError("Transcription", transcriptionResponse));
    const transcriptPayload = await transcriptionResponse.json();
    const transcript = transcriptPayload.text?.trim() || "";
    if (!transcript) throw new Error("No speech was detected in the recording.");

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["detected_language", "english_transcript", "summary", "results"],
      properties: {
        detected_language: { type: "string" },
        english_transcript: { type: "string" },
        summary: { type: "string" },
        results: {
          type: "array",
          minItems: flatRubric.length,
          maxItems: flatRubric.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "score", "comment", "evidence"],
            properties: {
              id: { type: "string" },
              score: { type: "string", enum: ["0", "1", "2", "3", "4", "5", "na"] },
              comment: { type: "string" },
              evidence: { type: "string" }
            }
          }
        }
      }
    };

    const scoringResponse = await fetch(`${GROQ_API_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EVALUATION_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a strict contact-centre QA evaluator. Translate the transcript to English when necessary. Evaluate only observable evidence. Return exactly one result for every rubric item, in the supplied order, using its exact id. Use score strings 0 or 5 for standard checks, 1 or 5 for documentation checks, 1 through 5 for ratings, and na only when an na-type check genuinely did not occur. Give concise evidence-based comments. For unavailable CRM-only evidence, score 1 and explain that manual verification is required."
          },
          { role: "user", content: JSON.stringify({ transcript, rubric: flatRubric }) }
        ],
        response_format: { type: "json_schema", json_schema: { name: "qa_evaluation", strict: true, schema } },
        max_completion_tokens: 12000
      })
    });
    if (!scoringResponse.ok) throw new Error(await providerError("Evaluation", scoringResponse));
    const scoringPayload = await scoringResponse.json();
    const parsed = JSON.parse(scoringPayload.choices?.[0]?.message?.content || "{}");
    if (!Array.isArray(parsed.results) || parsed.results.length !== flatRubric.length) {
      throw new Error("The evaluation returned an incomplete scorecard. Please try again.");
    }
    const evaluation = calculate(parsed.results);
    return response.status(200).json({ transcript, ...parsed, ...evaluation, created_at: new Date().toISOString() });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Evaluation failed." });
  }
}

function authorized(request) {
  const expected = process.env.QA_ACCESS_KEY || "";
  const provided = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !provided || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

async function providerError(stage, providerResponse) {
  let detail = "";
  try {
    const payload = await providerResponse.json();
    detail = payload?.error?.message || "";
  } catch {}
  return `${stage} failed (${providerResponse.status})${detail ? `: ${detail}` : "."}`;
}

async function readForm(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers["content-type"] } }).formData();
}
