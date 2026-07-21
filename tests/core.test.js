import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCarRows, payrollSummary } from "../site/assets/core.js";

test("normalizeCarRows keeps every boundary", () => {
  const result = normalizeCarRows(
    [{ boundary_id: "b", payload: { arrivals: { cars: [{ id: "1" }] }, departures: { cars: [] } } }],
    [{ id: "a" }, { id: "b" }],
  );
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].payload.arrivals.cars, []);
  assert.equal(result[1].payload.arrivals.cars.length, 1);
});

test("payrollSummary combines hours, adjustment and driver fuel", () => {
  const schedule = { shifts: [{ id: "s1", day: "Sze", durationHours: 4 }] };
  const worker = { assignments: { s1: true } };
  const result = payrollSummary(schedule, worker, {
    hourlyRate: 2000,
    entries: [{ shift_id: "s1", adjustment_hours: 1, note: "plusz" }],
    fuelEntries: [{ shiftId: "s1", amount: 3000 }],
  });
  assert.equal(result.paidHours, 5);
  assert.equal(result.wages, 10000);
  assert.equal(result.fuelFees, 3000);
  assert.equal(result.total, 13000);
});

