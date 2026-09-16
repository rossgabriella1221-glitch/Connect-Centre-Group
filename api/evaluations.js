import { authenticate, supabaseConfig } from "../lib/auth.js";

const table = "evaluations";

export default async function handler(request, response) {
  const auth = await authenticate(request);
  if (!auth) return response.status(401).json({ error: "Please sign in to access evaluations." });

  const { url, key } = supabaseConfig();
  const headers = { apikey: key, Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" };

  if (request.method === "GET") {
    const upstream = await fetch(`${url}/rest/v1/${table}?select=id,agent,campaign,transaction_id,score,max_score,percentage,status,created_at&order=created_at.desc&limit=50`, { headers });
    return forward(upstream, response);
  }

  if (request.method === "POST") {
    const input = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const body = { ...input, owner_id: auth.user.id };
    const upstream = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(body)
    });
    return forward(upstream, response);
  }

  return response.status(405).json({ error: "Method not allowed" });
}

async function forward(upstream, response) {
  const text = await upstream.text();
  response.status(upstream.status).setHeader("Content-Type", upstream.headers.get("content-type") || "application/json").send(text);
}
