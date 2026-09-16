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
  return user?.id ? { user, token } : null;
}

export function supabaseConfig() {
  return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
}
