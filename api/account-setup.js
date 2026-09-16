import { timingSafeEqual } from "node:crypto";
import { supabaseConfig } from "../lib/auth.js";

export default async function handler(request, response) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(503).json({ error: "Account setup is not configured." });

  const existing = await firstOwner();
  if (request.method === "GET") return response.status(200).json({ setupAvailable: !existing });
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  if (existing) return response.status(409).json({ error: "The VoiceQA owner account already exists." });

  const { userId, password, setupKey } = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  const normalizedUserId = normalizeUserId(userId);
  const email = `${normalizedUserId}@voiceqa.local`;
  if (!matchesSetupKey(setupKey)) return response.status(401).json({ error: "The existing dashboard access key is incorrect." });
  if (normalizedUserId.length < 3) return response.status(400).json({ error: "Use a User ID with at least 3 letters or numbers." });
  if ((password || "").length < 12) return response.status(400).json({ error: "Use a password with at least 12 characters." });

  const { url, key } = supabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const loginResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
  });
  const loginPayload = await loginResponse.json();
  let authUserId = loginPayload?.user?.id;

  if (!loginResponse.ok) {
    const createResponse = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { voiceqa_user_id: normalizedUserId } })
    });
    const createPayload = await createResponse.json();
    if (!createResponse.ok) return response.status(createResponse.status).json({ error: createPayload?.message || "That email may already exist. Check the password and try again." });
    authUserId = createPayload.id;
  }

  const ownerResponse = await fetch(`${url}/rest/v1/voiceqa_owners`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: authUserId })
  });
  if (!ownerResponse.ok) return response.status(500).json({ error: "Could not secure the owner account." });

  await fetch(`${url}/rest/v1/evaluations?owner_id=is.null`, {
    method: "PATCH",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: authUserId })
  });

  return response.status(201).json({ created: true });
}

async function firstOwner() {
  const { url } = supabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const upstream = await fetch(`${url}/rest/v1/voiceqa_owners?select=user_id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!upstream.ok) throw new Error("Could not check account status.");
  const payload = await upstream.json();
  return payload?.[0] || null;
}

function matchesSetupKey(provided = "") {
  const expected = process.env.QA_ACCESS_KEY || "";
  if (!expected || !provided || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function normalizeUserId(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
}
