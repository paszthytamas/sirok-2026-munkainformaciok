import assert from "node:assert/strict";
import test from "node:test";

import {
  movementCompatibility,
  normalizeCarRows,
  payrollSummary,
  suggestCarGroups,
} from "../site/assets/core.js";

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

test("movementCompatibility rewards repeated shared movements", () => {
  const schedule = {
    shifts: [{ id: "s1" }, { id: "s2" }],
    workers: [
      { id: "a", name: "Anna", assignments: { s1: true, s2: false } },
      { id: "b", name: "Béla", assignments: { s1: true, s2: false } },
      { id: "c", name: "Csaba", assignments: { s1: true, s2: true } },
    ],
    boundaries: [
      { id: "one", arrivals: ["a", "b", "c"], departures: [] },
      { id: "two", arrivals: [], departures: ["a", "b"] },
    ],
  };
  assert.ok(movementCompatibility(schedule, "a", "b").score > movementCompatibility(schedule, "a", "c").score);
});

test("suggestCarGroups keeps everyone exactly once and respects capacity", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const schedule = {
    shifts: [{ id: "s1" }],
    workers: ids.map((id) => ({ id, name: id, assignments: { s1: true } })),
    boundaries: [{ id: "one", arrivals: ids, departures: ids }],
  };
  const groups = suggestCarGroups(schedule, ids, 3);
  assert.ok(groups.every((group) => group.members.length <= 3));
  assert.deepEqual(groups.map((group) => group.members.length), [3, 2]);
  assert.deepEqual(groups.flatMap((group) => group.members).sort(), ids);
});
