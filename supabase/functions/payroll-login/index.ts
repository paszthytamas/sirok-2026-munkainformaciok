import {
  authenticateWorkerPassword,
  corsHeaders,
  jsonResponse,
  serviceJson,
} from "../_shared/security.ts";

type CarRow = { boundary_id: string; payload?: Record<string, { cars?: Array<Record<string, unknown>> }> };

function fuelEntries(rows: CarRow[], workerId: string) {
  const result: Array<{ boundaryId: string; direction: string; shiftId: string | null; amount: number }> = [];
  for (const row of rows) {
    for (const direction of ["arrivals", "departures"]) {
      for (const car of row.payload?.[direction]?.cars || []) {
        if (car.driver !== workerId) continue;
        const amount = Number(car.fuelFee || 0);
        if (amount > 0) result.push({
          boundaryId: row.boundary_id,
          direction,
          shiftId: typeof car.shiftId === "string" ? car.shiftId : null,
          amount,
        });
      }
    }
  }
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Csak POST kérés engedélyezett." }, 405);
  try {
    const body = await request.json();
    const password = typeof body.password === "string" ? body.password : "";
    const workerId = await authenticateWorkerPassword(password);
    if (!workerId) return jsonResponse({ error: "Hibás jelszó." }, 401);
    const [settings, entries, cars] = await Promise.all([
      serviceJson("/rest/v1/app_settings?key=eq.hourly_rate&select=value&limit=1"),
      serviceJson(`/rest/v1/payroll_entries?worker_id=eq.${encodeURIComponent(workerId)}&select=shift_id,adjustment_hours,note&order=shift_id`),
      serviceJson("/rest/v1/car_assignments?select=boundary_id,payload"),
    ]);
    const setting = settings[0] as { value?: unknown } | undefined;
    return jsonResponse({
      workerId,
      hourlyRate: Number(setting?.value || 0),
      entries,
      fuelEntries: fuelEntries(cars as CarRow[], workerId),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "A belépés jelenleg nem érhető el." }, 500);
  }
});
