import { authenticate } from "../lib/auth.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (!(await authenticate(request))) return response.status(401).json({ error: "Please sign in to label the transcript." });
  if (!process.env.GROQ_API_KEY) return response.status(503).json({ error: "GROQ_API_KEY is not configured." });

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const transcript = body?.transcript?.trim() || "";
    if (!transcript) return response.status(400).json({ error: "A transcript is required." });

    const upstream = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          { role: "system", content: "Identify the speakers in this contact-centre call. Return only the complete transcript. Start every speaker turn with exactly 'Agent - ' or 'Caller - ' and put one blank line between turns. Infer roles from meaning and the opening greeting, not by simply alternating. Preserve every spoken detail, name, number, question and answer. Do not summarize, explain, correct or omit content." },
          { role: "user", content: transcript }
        ],
        temperature: 0,
        max_completion_tokens: 5000
      })
    });

    if (!upstream.ok) {
      const failure = await providerFailure(upstream);
      if (failure.status === 429) return response.status(429).json({ error: `Groq is temporarily busy. VoiceQA will retry in ${failure.retryAfter} seconds.`, retryAfter: failure.retryAfter });
      throw new Error(`Speaker identification failed (${failure.status})${failure.detail ? `: ${failure.detail}` : "."}`);
    }
    const payload = await upstream.json();
    const speakerTranscript = payload.choices?.[0]?.message?.content?.trim() || "";
    if (!speakerTranscript) throw new Error("Speaker identification returned an empty transcript.");
    console.log("[api/speakers] completed", { inputCharacters: transcript.length, outputCharacters: speakerTranscript.length });
    return response.status(200).json({ transcript: speakerTranscript });
  } catch (error) {
    console.error("[api/speakers] failed", { error: error.message || String(error) });
    return response.status(500).json({ error: error.message || "Speaker identification failed." });
  }
}

async function providerFailure(providerResponse) {
  let detail = "";
  try { detail = (await providerResponse.json())?.error?.message || ""; } catch {}
  const headerDelay = Number(providerResponse.headers.get("retry-after"));
  const detailDelay = Number(detail.match(/try again in\s+([\d.]+)s/i)?.[1]);
  const retryAfter = Number.isFinite(headerDelay) && headerDelay > 0 ? Math.ceil(headerDelay) : Number.isFinite(detailDelay) ? Math.ceil(detailDelay) : 30;
  return { status: providerResponse.status, detail, retryAfter };
}
