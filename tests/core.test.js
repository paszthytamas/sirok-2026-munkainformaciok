import assert from "node:assert/strict";
import test from "node:test";

import {
  adminCostSummary,
  carDriversPresentAtDeparture,
  driverRoundTripCount,
  movementCompatibility,
  normalizeCarRows,
  payrollSummary,
  shiftDateTimeRange,
  suggestCarGroups,
  summarizeWeatherShift,
  workerArrivalDriverShiftIds,
  workerRideTimeline,
} from "../site/assets/core.js";

test("driverRoundTripCount treats arrival and departure as one assignment", () => {
  const rides = [
    { assigned: true, role: "driver", direction: "arrivals" },
    { assigned: true, role: "driver", direction: "departures" },
    { assigned: true, role: "passenger", direction: "arrivals" },
    { assigned: false, role: null, direction: "departures" },
  ];
  assert.equal(driverRoundTripCount(rides), 1);
  assert.equal(driverRoundTripCount([...rides, { assigned: true, role: "driver" }]), 1.5);
});

test("carDriversPresentAtDeparture marks the next departure after a driver arrives", () => {
  const schedule = {
    boundaries: [
      { id: "arrival-one", arrivals: ["anna", "bela"], departures: [] },
      { id: "departure-one", arrivals: [], departures: ["anna"] },
      { id: "arrival-two", arrivals: ["anna"], departures: [] },
      { id: "departure-two", arrivals: [], departures: ["anna", "bela"] },
      { id: "later", arrivals: [], departures: ["anna"] },
    ],
  };
  const rows = [
    {
      boundary_id: "arrival-one",
      payload: { arrivals: { cars: [{ driver: "anna", passengers: ["bela"] }] } },
    },
    {
      boundary_id: "arrival-two",
      payload: { arrivals: { cars: [{ driver: "anna", passengers: [] }] } },
    },
  ];

  assert.deepEqual([...carDriversPresentAtDeparture(schedule, rows, "departure-one")], ["anna"]);
  assert.deepEqual([...carDriversPresentAtDeparture(schedule, rows, "departure-two")], ["anna"]);
  assert.deepEqual([...carDriversPresentAtDeparture(schedule, rows, "later")], []);
});

test("workerRideTimeline combines arrival, departure, companions and driver role", () => {
  const schedule = {
    boundaries: [
      { id: "one", label: "Sze 10:00", arrivals: ["anna", "bela"], departures: [] },
      { id: "two", label: "Sze 22:00", arrivals: [], departures: ["anna", "bela"] },
    ],
  };
  const rows = [
    {
      boundary_id: "one",
      payload: { arrivals: { cars: [{ driver: "anna", passengers: ["bela"] }] } },
    },
    {
      boundary_id: "two",
      payload: { departures: { cars: [{ driver: "bela", passengers: ["anna"] }] } },
    },
  ];

  assert.deepEqual(workerRideTimeline(schedule, rows, "anna"), [
    {
      boundaryId: "one",
      boundaryLabel: "Sze 10:00",
      direction: "arrivals",
      assigned: true,
      role: "driver",
      driverId: "anna",
      memberIds: ["anna", "bela"],
      companionIds: ["bela"],
    },
    {
      boundaryId: "two",
      boundaryLabel: "Sze 22:00",
      direction: "departures",
      assigned: true,
      role: "passenger",
      driverId: "bela",
      memberIds: ["bela", "anna"],
      companionIds: ["bela"],
    },
  ]);
});

test("workerArrivalDriverShiftIds marks only shifts where the worker arrives as driver", () => {
  const schedule = {
    boundaries: [
      { id: "one", currentShiftId: "s1", previousShiftId: null },
      { id: "two", currentShiftId: "s2", previousShiftId: "s1" },
    ],
  };
  const rows = [
    {
      boundary_id: "one",
      payload: { arrivals: { cars: [{ driver: "anna" }] } },
    },
    {
      boundary_id: "two",
      payload: {
        arrivals: { cars: [{ driver: "bela", shiftId: "s2" }] },
        departures: { cars: [{ driver: "anna", shiftId: "s2" }] },
      },
    },
  ];

  assert.deepEqual([...workerArrivalDriverShiftIds(schedule, rows, "anna")], ["s1"]);
  assert.deepEqual([...workerArrivalDriverShiftIds(schedule, rows, "bela")], ["s2"]);
});

test("adminCostSummary combines wages and per-trip driver fees", () => {
  const schedule = {
    shifts: [
      { id: "s1", durationHours: 4 },
      { id: "s2", durationHours: 6 },
    ],
    workers: [
      { id: "anna", name: "Anna", assignments: { s1: true, s2: true } },
      { id: "bela", name: "Béla", assignments: { s1: true, s2: false } },
    ],
    boundaries: [
      { id: "one", label: "Sze 10:00", currentShiftId: "s1", previousShiftId: null },
      { id: "two", label: "Sze 14:00", currentShiftId: "s2", previousShiftId: "s1" },
    ],
  };
  const cars = [
    {
      boundary_id: "one",
      payload: { arrivals: { cars: [{ id: "a", driver: "anna", fuelFee: 1200 }] } },
    },
    {
      boundary_id: "two",
      payload: {
        arrivals: { cars: [{ id: "b", driver: "anna", fuelFee: 0 }] },
        departures: { cars: [{ id: "c", driver: "bela", fuelFee: 800 }] },
      },
    },
  ];
  const payroll = [
    { worker_id: "anna", shift_id: "s1", adjustment_hours: 1 },
    { worker_id: "bela", shift_id: "s1", adjustment_hours: -0.5 },
  ];

  const result = adminCostSummary(schedule, cars, payroll, 2000);
  assert.equal(result.rows[0].worker.id, "anna");
  assert.equal(result.rows[0].paidHours, 11);
  assert.equal(result.rows[0].travelFees, 1200);
  assert.equal(result.rows[0].total, 23200);
  assert.equal(result.rows[0].missingTravelFees, 1);
  assert.equal(result.rows[1].total, 7800);
  assert.equal(result.wages, 29000);
  assert.equal(result.travelFees, 2000);
  assert.equal(result.total, 31000);
  assert.equal(result.tripCount, 3);
  assert.equal(result.missingTravelFees, 1);
});

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

test("shiftDateTimeRange follows the 08:00 operational day boundary", () => {
  assert.deepEqual(
    shiftDateTimeRange("2026-07-23", { start: "18:00", end: "03:00" }),
    { start: "2026-07-23T18:00", end: "2026-07-24T03:00" },
  );
  assert.deepEqual(
    shiftDateTimeRange("2026-07-23", { start: "03:00", end: "08:00" }),
    { start: "2026-07-24T03:00", end: "2026-07-24T08:00" },
  );
  assert.deepEqual(
    shiftDateTimeRange("2026-07-25", { start: "03:00", end: "10:00" }),
    { start: "2026-07-26T03:00", end: "2026-07-26T10:00" },
  );
});

test("summarizeWeatherShift aggregates only hours inside the shift", () => {
  const hourly = {
    time: ["2026-07-23T17:00", "2026-07-23T18:00", "2026-07-23T19:00", "2026-07-23T20:00"],
    temperature_2m: [30, 26, 24, 22],
    apparent_temperature: [31, 27, 25, 23],
    precipitation_probability: [5, 30, 75, 20],
    precipitation: [0, 0, 1.2, 0.1],
    weather_code: [0, 2, 95, 3],
    wind_speed_10m: [8, 12, 22, 15],
    wind_gusts_10m: [16, 25, 49, 31],
  };
  const summary = summarizeWeatherShift(hourly, "2026-07-23T18:00", "2026-07-23T20:00");

  assert.equal(summary.count, 2);
  assert.equal(summary.minTemperature, 24);
  assert.equal(summary.maxTemperature, 26);
  assert.equal(summary.maxPrecipitationProbability, 75);
  assert.equal(summary.totalPrecipitation, 1.2);
  assert.equal(summary.maxWindGust, 49);
  assert.equal(summary.weatherCode, 95);
  assert.deepEqual(summary.hours.map((hour) => hour.time), ["2026-07-23T18:00", "2026-07-23T19:00"]);
});
