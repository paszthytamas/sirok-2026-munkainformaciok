export const huCollator = new Intl.Collator("hu-HU", { sensitivity: "base" });

export function sortedWorkerIds(ids, workersById) {
  return [...ids].sort((left, right) =>
    huCollator.compare(workersById.get(left)?.name || "", workersById.get(right)?.name || ""),
  );
}

export function formatHours(value) {
  return `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(Number(value) || 0)} óra`;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("hu-HU", {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

export function byWorkerName(workers) {
  return [...workers].sort((left, right) => huCollator.compare(left.name, right.name));
}

export function normalizeCarRows(rows, boundaries) {
  const map = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      row.boundary_id,
      row.payload || { arrivals: { cars: [] }, departures: { cars: [] } },
    ]),
  );
  return boundaries.map((boundary) => ({
    boundary_id: boundary.id,
    payload: map.get(boundary.id) || { arrivals: { cars: [] }, departures: { cars: [] } },
  }));
}

export function payrollSummary(schedule, worker, response) {
  const entries = new Map((response.entries || []).map((entry) => [entry.shift_id, entry]));
  const fuelByShift = new Map();
  for (const item of response.fuelEntries || []) {
    const shiftId = item.shiftId || "egyeb";
    fuelByShift.set(shiftId, (fuelByShift.get(shiftId) || 0) + Number(item.amount || 0));
  }
  const hourlyRate = Number(response.hourlyRate || 0);
  const rows = schedule.shifts
    .filter((shift) => worker.assignments[shift.id])
    .map((shift) => {
      const entry = entries.get(shift.id) || {};
      const adjustmentHours = Number(entry.adjustment_hours || 0);
      const paidHours = Number(shift.durationHours) + adjustmentHours;
      const fuelFee = fuelByShift.get(shift.id) || 0;
      return {
        shift,
        scheduledHours: Number(shift.durationHours),
        adjustmentHours,
        paidHours,
        wage: paidHours * hourlyRate,
        fuelFee,
        total: paidHours * hourlyRate + fuelFee,
        note: entry.note || "",
      };
    });
  const unassignedFuel = fuelByShift.get("egyeb") || 0;
  return {
    hourlyRate,
    rows,
    scheduledHours: rows.reduce((sum, row) => sum + row.scheduledHours, 0),
    adjustmentHours: rows.reduce((sum, row) => sum + row.adjustmentHours, 0),
    paidHours: rows.reduce((sum, row) => sum + row.paidHours, 0),
    wages: rows.reduce((sum, row) => sum + row.wage, 0),
    fuelFees: rows.reduce((sum, row) => sum + row.fuelFee, unassignedFuel),
    total: rows.reduce((sum, row) => sum + row.total, unassignedFuel),
  };
}

