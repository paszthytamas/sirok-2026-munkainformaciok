const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${supabaseUrl}${path}`, { ...init, headers });
}

export async function serviceJson(path: string): Promise<unknown[]> {
  const response = await serviceFetch(path);
  if (!response.ok) throw new Error(`Adatbázis-hiba (${response.status}).`);
  return await response.json();
}

export async function requireAdmin(authorization: string | null): Promise<{ id: string; email?: string }> {
  if (!authorization?.startsWith("Bearer ")) throw new Error("Hiányzó admin munkamenet.");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!response.ok) throw new Error("Lejárt vagy érvénytelen admin munkamenet.");
  const user = await response.json();
  const rows = await serviceJson(`/rest/v1/admin_allowlist?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`);
  if (!rows.length) throw new Error("Ehhez a fiókhoz nincs admin jogosultság.");
  return user;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function passwordLookup(password: string): Promise<string> {
  const pepper = Deno.env.get("PASSWORD_PEPPER");
  if (!pepper || pepper.length < 32) throw new Error("A PASSWORD_PEPPER titok nincs biztonságosan beállítva.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password));
  return bytesToBase64(new Uint8Array(signature));
}

export async function hashPassword(password: string, salt?: Uint8Array, iterations = 160000) {
  const actualSalt = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: actualSalt, iterations },
    key,
    256,
  );
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(actualSalt), iterations };
}

export async function verifyPassword(password: string, salt: string, expected: string, iterations: number) {
  const result = await hashPassword(password, base64ToBytes(salt), iterations);
  const left = new TextEncoder().encode(result.hash);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

