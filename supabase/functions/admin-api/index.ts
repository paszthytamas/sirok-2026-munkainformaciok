import {
  corsHeaders,
  hashPassword,
  jsonResponse,
  passwordLookup,
  requireAdmin,
  serviceFetch,
  serviceJson,
} from "../_shared/security.ts";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,100}$/.test(value);
}

async function upsert(path: string, rows: unknown) {
  const response = await serviceFetch(path, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 409) throw new Error("Ez a jelszó már másik dolgozóhoz tartozik. Minden személyes jelszónak egyedinek kell lennie.");
    console.error(detail);
    throw new Error(`A mentés sikertelen (${response.status}).`);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Csak POST kérés engedélyezett." }, 405);
  try {
    await requireAdmin(request.headers.get("Authorization"));
    const body = await request.json();
    const action = body.action;

    if (action === "bootstrap") {
      const [settings, cars, payrollEntries, credentials, leaders] = await Promise.all([
        serviceJson("/rest/v1/app_settings?key=eq.hourly_rate&select=value&limit=1"),
        serviceJson("/rest/v1/car_assignments?select=boundary_id,payload&order=boundary_id"),
        serviceJson("/rest/v1/payroll_entries?select=worker_id,shift_id,adjustment_hours,note&order=worker_id,shift_id"),
        serviceJson("/rest/v1/worker_credentials?select=worker_id,name,updated_at&order=name"),
        serviceJson("/rest/v1/shift_leaders?select=shift_id,worker_id&order=shift_id"),
      ]);
      const setting = settings[0] as { value?: unknown } | undefined;
      return jsonResponse({ hourlyRate: Number(setting?.value || 0), cars, payrollEntries, credentials, leaders });
    }

    if (action === "save-cars") {
      if (!validId(body.boundaryId) || typeof body.payload !== "object" || !body.payload) {
        return jsonResponse({ error: "Érvénytelen autóbeosztás." }, 400);
      }
      await upsert("/rest/v1/car_assignments?on_conflict=boundary_id", {
        boundary_id: body.boundaryId,
        payload: body.payload,
        updated_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true });
    }

    if (action === "set-hourly-rate") {
      const hourlyRate = Number(body.hourlyRate);
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > 1000000) {
        return jsonResponse({ error: "Érvénytelen óradíj." }, 400);
      }
      await upsert("/rest/v1/app_settings?on_conflict=key", {
        key: "hourly_rate",
        value: hourlyRate,
        updated_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true });
    }

    if (action === "save-leaders") {
      if (!Array.isArray(body.leaders) || body.leaders.length > 40) {
        return jsonResponse({ error: "Érvénytelen turnusvezetői beosztás." }, 400);
      }
      const selected = body.leaders.filter((item: Record<string, unknown>) => item.worker_id);
      const cleared = body.leaders.filter((item: Record<string, unknown>) => !item.worker_id);
      const rows = selected.map((item: Record<string, unknown>) => {
        if (!validId(item.shift_id) || !validId(item.worker_id)) throw new Error("Érvénytelen turnus- vagy dolgozóazonosító.");
        return {
          shift_id: item.shift_id,
          worker_id: item.worker_id,
          updated_at: new Date().toISOString(),
        };
      });
      if (rows.length) await upsert("/rest/v1/shift_leaders?on_conflict=shift_id", rows);
      for (const item of cleared) {
        if (!validId(item.shift_id)) throw new Error("Érvénytelen turnusazonosító.");
        const response = await serviceFetch(`/rest/v1/shift_leaders?shift_id=eq.${encodeURIComponent(item.shift_id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("A turnusvezető törlése sikertelen.");
      }
      return jsonResponse({ ok: true });
    }

    if (action === "set-password") {
      const password = typeof body.password === "string" ? body.password : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!validId(body.workerId) || !name || password.length < 4 || password.length > 128) {
        return jsonResponse({ error: "A jelszó legalább 4 karakter legyen, a dolgozó adatai pedig legyenek érvényesek." }, 400);
      }
      const [lookup, derived] = await Promise.all([passwordLookup(password), hashPassword(password)]);
      await upsert("/rest/v1/worker_credentials?on_conflict=worker_id", {
        worker_id: body.workerId,
        name,
        password_lookup: lookup,
        password_salt: derived.salt,
        password_hash: derived.hash,
        password_iterations: derived.iterations,
        updated_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true });
    }

    if (action === "save-payroll") {
      if (!validId(body.workerId) || !Array.isArray(body.entries) || body.entries.length > 40) {
        return jsonResponse({ error: "Érvénytelen fizetési adatok." }, 400);
      }
      const rows = body.entries.map((entry: Record<string, unknown>) => {
        if (!validId(entry.shift_id)) throw new Error("Érvénytelen turnusazonosító.");
        const adjustment = Number(entry.adjustment_hours || 0);
        if (!Number.isFinite(adjustment) || adjustment < -24 || adjustment > 24) throw new Error("Az órakorrekció -24 és +24 óra között lehet.");
        return {
          worker_id: body.workerId,
          shift_id: entry.shift_id,
          adjustment_hours: adjustment,
          note: String(entry.note || "").slice(0, 500),
          updated_at: new Date().toISOString(),
        };
      });
      if (rows.length) await upsert("/rest/v1/payroll_entries?on_conflict=worker_id,shift_id", rows);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Ismeretlen adminművelet." }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Váratlan hiba.";
    const status = /admin|munkamenet|jogosultság/i.test(message) ? 403 : 500;
    return jsonResponse({ error: message }, status);
  }
});
