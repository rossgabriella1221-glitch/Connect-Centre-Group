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

    console.log("[api/evaluate] scoring started", { transcriptCharacters: transcript.length, checks: flatRubric.length });
    let scoringResponse = await requestScorecard(transcript, schema, true);
    if (!scoringResponse.ok) {
      const firstFailure = await providerFailure(scoringResponse);
      if (!isJsonGenerationFailure(firstFailure)) throw new Error(formatProviderError("Evaluation", firstFailure));
      console.warn("[api/evaluate] strict JSON generation failed; retrying", { status: firstFailure.status });
      scoringResponse = await requestScorecard(transcript, schema, false);
    }
    if (!scoringResponse.ok) throw new Error(formatProviderError("Evaluation retry", await providerFailure(scoringResponse)));
    const scoringPayload = await scoringResponse.json();
    const parsed = parseScorecard(scoringPayload.choices?.[0]?.message?.content);
    validateScorecard(parsed);
    const evaluation = calculate(parsed.results);
    console.log("[api/evaluate] scoring completed", { score: evaluation.score, max: evaluation.max });
    return response.status(200).json({ transcript, ...parsed, ...evaluation, created_at: new Date().toISOString() });
  } catch (error) {
    console.error("[api/evaluate] scoring failed", { error: error.message || String(error) });
    return response.status(500).json({ error: error.message || "Evaluation failed." });
  }
}

async function requestScorecard(transcript, schema, strict) {
  const system = "You are a strict contact-centre QA evaluator. Translate the transcript to English when necessary. The english_transcript must preserve the complete conversation from the first through the final utterance: never summarize, omit, shorten, merge, reorder, or invent speech. Format every utterance on its own line beginning exactly 'Agent - ' or 'Caller - ', with one blank line between every speaker turn. Infer roles carefully from greetings, requests, questions, and responses; do not mechanically alternate labels. Recheck the final portion of the transcript before answering to ensure the closing dialogue is complete and correctly attributed. Evaluate only observable evidence. Return exactly one result for every rubric item, in the supplied order, using its exact id. Use score strings 0 or 5 for standard checks, 1 or 5 for documentation checks, 1 through 5 for ratings, and na only when an na-type check genuinely did not occur. Keep comments and evidence concise. For unavailable CRM-only evidence, score 1 and explain that manual verification is required. Return one valid JSON object only.";
  return fetch(`${GROQ_API_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EVALUATION_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ transcript, rubric: flatRubric }) }],
      response_format: strict ? { type: "json_schema", json_schema: { name: "qa_evaluation", strict: true, schema } } : { type: "json_object" },
      temperature: 0,
      max_completion_tokens: 8000
    })
  });
}

function parseScorecard(content = "") {
  const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned || "{}"); }
  catch { throw new Error("The evaluation retry returned invalid JSON. Please try the evaluation again."); }
}

function validateScorecard(parsed) {
  const expectedIds = flatRubric.map(item => item.id);
  const resultIds = Array.isArray(parsed.results) ? parsed.results.map(item => item.id) : [];
  if (resultIds.length !== expectedIds.length || expectedIds.some((id, index) => resultIds[index] !== id)) {
    throw new Error("The evaluation returned an incomplete scorecard. Please try again.");
  }
  if (!parsed.detected_language || !parsed.english_transcript || !parsed.summary) throw new Error("The evaluation returned incomplete call details. Please try again.");
}

async function providerFailure(providerResponse) {
  let detail = "";
  try {
    const payload = await providerResponse.json();
    detail = payload?.error?.message || "";
  } catch {}
  return { status: providerResponse.status, detail };
}

function isJsonGenerationFailure(failure) {
  return failure.status === 400 && /failed_generation|generate json|json/i.test(failure.detail);
}

function formatProviderError(stage, failure) {
  return `${stage} failed (${failure.status})${failure.detail ? `: ${failure.detail}` : "."}`;
}
