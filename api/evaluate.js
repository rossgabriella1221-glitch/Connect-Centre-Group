import { flatRubric, calculate } from "../lib/rubric.js";
import { authenticate } from "../lib/auth.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1";
const EVALUATION_MODEL = "openai/gpt-oss-20b";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!(await authenticate(request))) return response.status(401).json({ error: "Please sign in to evaluate a recording." });
  if (!process.env.GROQ_API_KEY) return response.status(503).json({ error: "GROQ_API_KEY is not configured." });

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const transcript = body?.transcript?.trim() || "";
    if (!transcript) return response.status(400).json({ error: "A transcript is required." });

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
            content: "You are a strict contact-centre QA evaluator. Translate the transcript to English when necessary. Format english_transcript as dialogue with every utterance on a separate line beginning exactly 'Agent - ' or 'Caller - '. Infer the roles carefully from conversational context and never add words that are not present in the transcript. Evaluate only observable evidence. Return exactly one result for every rubric item, in the supplied order, using its exact id. Use score strings 0 or 5 for standard checks, 1 or 5 for documentation checks, 1 through 5 for ratings, and na only when an na-type check genuinely did not occur. Give concise evidence-based comments. For unavailable CRM-only evidence, score 1 and explain that manual verification is required."
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

async function providerError(stage, providerResponse) {
  let detail = "";
  try {
    const payload = await providerResponse.json();
    detail = payload?.error?.message || "";
  } catch {}
  return `${stage} failed (${providerResponse.status})${detail ? `: ${detail}` : "."}`;
}
