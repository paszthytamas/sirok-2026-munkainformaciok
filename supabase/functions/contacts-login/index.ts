import {
  authenticateWorkerPassword,
  corsHeaders,
  jsonResponse,
  serviceJson,
} from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Csak POST kérés engedélyezett." }, 405);
  try {
    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";
    const workerId = await authenticateWorkerPassword(password);
    if (!workerId) return jsonResponse({ error: "Hibás jelszó." }, 401);

    const contacts = await serviceJson(
      "/rest/v1/worker_contacts?select=worker_id,name,phone_e164,phone_display,note&order=name",
    );
    return jsonResponse({ workerId, contacts });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "A kontaktlista jelenleg nem érhető el." }, 500);
  }
});
