const SUPABASE_URL = process.env.SUPABASE_URL || "https://trbgcgwgbfqbfzsbdhmb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PCl6O_LbLG2DKPbMRhkG-Q_WLOWiHzr";

export async function authenticate(request) {
  const token = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const upstream = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!upstream.ok) return null;
  const user = await upstream.json();
  if (!user?.id || !(await isVoiceQaOwner(user.id))) return null;
  return { user, token };
}

export function supabaseConfig() {
  return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
}

async function isVoiceQaOwner(userId) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return false;
  const upstream = await fetch(`${SUPABASE_URL}/rest/v1/voiceqa_owners?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!upstream.ok) return false;
  const owners = await upstream.json();
  return owners.length === 1;
}
