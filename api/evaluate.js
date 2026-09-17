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

    console.log("[api/evaluate] scoring started", { transcriptCharacters: transcript.length, checks: flatRubric.length });
    let scoringResponse = await requestScorecard(transcript, false);
    if (!scoringResponse.ok) throw new Error(formatProviderError("Evaluation", await providerFailure(scoringResponse)));
    let parsed;
    try {
      parsed = parseAndValidate(await scoringResponse.json());
    } catch (firstError) {
      console.warn("[api/evaluate] response validation failed; retrying compact response", { error: firstError.message });
      scoringResponse = await requestScorecard(transcript, true);
      if (!scoringResponse.ok) throw new Error(formatProviderError("Evaluation retry", await providerFailure(scoringResponse)));
      parsed = parseAndValidate(await scoringResponse.json());
    }
    parsed.results = parsed.results.map(item => ({ ...item, comment: "", evidence: "" }));
    const evaluation = calculate(parsed.results);
    console.log("[api/evaluate] scoring completed", { score: evaluation.score, max: evaluation.max });
    return response.status(200).json({ transcript, ...parsed, ...evaluation, created_at: new Date().toISOString() });
  } catch (error) {
    console.error("[api/evaluate] scoring failed", { error: error.message || String(error) });
    return response.status(500).json({ error: error.message || "Evaluation failed." });
  }
}

async function requestScorecard(transcript, retry) {
  const system = `You are a contact-centre QA evaluator. Return one compact valid JSON object and no other text. Translate when needed. Keep english_transcript complete and format every turn as "Agent - ..." or "Caller - ..." with blank lines between turns. Infer roles from the conversation, not by alternating. Score every rubric item in order. Return results with only id and score. Allowed scores: standard 0/5, documentation 1/5, rating 1-5, and na only for eligible checks. CRM-only evidence that cannot be heard scores 1. Required keys: detected_language, english_transcript, summary, results.${retry ? " This is a retry: be especially strict about valid JSON syntax and include all rubric ids." : ""}`;
  return fetch(`${GROQ_API_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EVALUATION_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ transcript, rubric: flatRubric }) }],
      temperature: 0,
      max_completion_tokens: 6000
    })
  });
}

function parseAndValidate(payload) {
  const parsed = parseScorecard(payload.choices?.[0]?.message?.content);
  validateScorecard(parsed);
  return parsed;
}

function parseScorecard(content = "") {
  const raw = String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const cleaned = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
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

function formatProviderError(stage, failure) {
  return `${stage} failed (${failure.status})${failure.detail ? `: ${failure.detail}` : "."}`;
}
