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

export function carDriversPresentAtDeparture(schedule, rows, targetBoundaryId) {
  const rowsByBoundary = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [row.boundary_id, row.payload || {}]),
  );
  const driversOnSite = new Set();

  for (const boundary of schedule.boundaries || []) {
    if (boundary.id === targetBoundaryId) {
      return new Set((boundary.departures || []).filter((workerId) => driversOnSite.has(workerId)));
    }

    for (const workerId of boundary.departures || []) driversOnSite.delete(workerId);

    const arrivingWorkerIds = new Set(boundary.arrivals || []);
    const arrivalCars = rowsByBoundary.get(boundary.id)?.arrivals?.cars || [];
    for (const car of arrivalCars) {
      if (car?.driver && arrivingWorkerIds.has(car.driver)) driversOnSite.add(car.driver);
    }
  }

  return new Set();
}

export function workerRideTimeline(schedule, rows, workerId) {
  const rowsByBoundary = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [row.boundary_id, row.payload || {}]),
  );
  const timeline = [];

  for (const boundary of schedule.boundaries || []) {
    const payload = rowsByBoundary.get(boundary.id) || {};
    for (const direction of ["arrivals", "departures"]) {
      if (!(boundary[direction] || []).includes(workerId)) continue;
      const car = (payload[direction]?.cars || []).find((item) =>
        item?.driver === workerId || (item?.passengers || []).includes(workerId),
      );
      const memberIds = car
        ? [...new Set([car.driver, ...(car.passengers || [])].filter(Boolean))]
        : [];
      timeline.push({
        boundaryId: boundary.id,
        boundaryLabel: boundary.label,
        direction,
        assigned: Boolean(car),
        role: car ? (car.driver === workerId ? "driver" : "passenger") : null,
        driverId: car?.driver || null,
        memberIds,
        companionIds: memberIds.filter((id) => id !== workerId),
      });
    }
  }

  return timeline;
}

export function adminCostSummary(schedule, carRows, payrollEntries, hourlyRate) {
  const rate = Math.max(0, Number(hourlyRate) || 0);
  const adjustments = new Map(
    (Array.isArray(payrollEntries) ? payrollEntries : []).map((entry) => [
      `${entry.worker_id}:${entry.shift_id}`,
      Number(entry.adjustment_hours || 0),
    ]),
  );
  const rowsByBoundary = new Map(
    (Array.isArray(carRows) ? carRows : []).map((row) => [row.boundary_id, row.payload || {}]),
  );
  const tripsByWorker = new Map();

  for (const boundary of schedule.boundaries || []) {
    const payload = rowsByBoundary.get(boundary.id) || {};
    for (const direction of ["arrivals", "departures"]) {
      for (const [carIndex, car] of (payload[direction]?.cars || []).entries()) {
        if (!car?.driver) continue;
        const rawAmount = Number(car.fuelFee || 0);
        const amount = Number.isFinite(rawAmount) ? Math.max(0, rawAmount) : 0;
        const trip = {
          boundaryId: boundary.id,
          boundaryLabel: boundary.label,
          direction,
          carId: car.id || `${boundary.id}-${direction}-${carIndex}`,
          carIndex,
          shiftId: car.shiftId || (direction === "arrivals" ? boundary.currentShiftId : boundary.previousShiftId) || null,
          amount,
        };
        const trips = tripsByWorker.get(car.driver) || [];
        trips.push(trip);
        tripsByWorker.set(car.driver, trips);
      }
    }
  }

  const rows = byWorkerName(schedule.workers || []).map((worker) => {
    const shifts = (schedule.shifts || []).filter((shift) => worker.assignments?.[shift.id]);
    const scheduledHours = shifts.reduce((sum, shift) => sum + Number(shift.durationHours || 0), 0);
    const adjustmentHours = shifts.reduce(
      (sum, shift) => sum + (adjustments.get(`${worker.id}:${shift.id}`) || 0),
      0,
    );
    const paidHours = scheduledHours + adjustmentHours;
    const wages = paidHours * rate;
    const trips = tripsByWorker.get(worker.id) || [];
    const travelFees = trips.reduce((sum, trip) => sum + trip.amount, 0);
    return {
      worker,
      scheduledHours,
      adjustmentHours,
      paidHours,
      wages,
      trips,
      travelFees,
      missingTravelFees: trips.filter((trip) => trip.amount <= 0).length,
      total: wages + travelFees,
    };
  });

  return {
    hourlyRate: rate,
    rows,
    scheduledHours: rows.reduce((sum, row) => sum + row.scheduledHours, 0),
    adjustmentHours: rows.reduce((sum, row) => sum + row.adjustmentHours, 0),
    paidHours: rows.reduce((sum, row) => sum + row.paidHours, 0),
    wages: rows.reduce((sum, row) => sum + row.wages, 0),
    travelFees: rows.reduce((sum, row) => sum + row.travelFees, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    tripCount: rows.reduce((sum, row) => sum + row.trips.length, 0),
    missingTravelFees: rows.reduce((sum, row) => sum + row.missingTravelFees, 0),
  };
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

export function workerMovementEvents(schedule, workerId) {
  const events = new Set();
  for (const boundary of schedule.boundaries || []) {
    if ((boundary.arrivals || []).includes(workerId)) events.add(`arrivals:${boundary.id}`);
    if ((boundary.departures || []).includes(workerId)) events.add(`departures:${boundary.id}`);
  }
  return events;
}

export function movementCompatibility(schedule, leftId, rightId) {
  const leftEvents = workerMovementEvents(schedule, leftId);
  const rightEvents = workerMovementEvents(schedule, rightId);
  const sharedEvents = [...leftEvents].filter((event) => rightEvents.has(event)).length;
  const unionEvents = new Set([...leftEvents, ...rightEvents]).size || 1;
  const eventJaccard = sharedEvents / unionEvents;

  const left = schedule.workers.find((worker) => worker.id === leftId);
  const right = schedule.workers.find((worker) => worker.id === rightId);
  const shifts = schedule.shifts || [];
  const matchingShifts = shifts.filter(
    (shift) => Boolean(left?.assignments?.[shift.id]) === Boolean(right?.assignments?.[shift.id]),
  ).length;
  const shiftSimilarity = shifts.length ? matchingShifts / shifts.length : 0;
  const repeatedMovement = Math.min(sharedEvents / 4, 1);
  const score = Math.round((eventJaccard * 0.65 + shiftSimilarity * 0.25 + repeatedMovement * 0.1) * 100);
  return { score, sharedEvents, eventJaccard, shiftSimilarity };
}

function groupScore(schedule, members) {
  if (members.length < 2) return 100;
  const scores = [];
  for (let left = 0; left < members.length; left += 1) {
    for (let right = left + 1; right < members.length; right += 1) {
      scores.push(movementCompatibility(schedule, members[left], members[right]).score);
    }
  }
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function suggestCarGroups(schedule, workerIds, capacity = 4) {
  const workersById = new Map(schedule.workers.map((worker) => [worker.id, worker]));
  const safeCapacity = Math.max(2, Math.min(9, Number(capacity) || 4));
  const remaining = sortedWorkerIds([...new Set(workerIds)], workersById);
  const groups = [];

  const groupCount = Math.ceil(remaining.length / safeCapacity);
  const baseSize = groupCount ? Math.floor(remaining.length / groupCount) : 0;
  const largerGroups = groupCount ? remaining.length % groupCount : 0;
  const targetSizes = Array.from(
    { length: groupCount },
    (_, index) => baseSize + (index < largerGroups ? 1 : 0),
  );

  for (const targetSize of targetSizes) {
    if (targetSize === 1) {
      groups.push({ members: [remaining.shift()], score: 100 });
      continue;
    }

    let seed = [remaining[0], remaining[1]];
    let seedScore = -1;
    for (let left = 0; left < remaining.length; left += 1) {
      for (let right = left + 1; right < remaining.length; right += 1) {
        const score = movementCompatibility(schedule, remaining[left], remaining[right]).score;
        if (score > seedScore) {
          seed = [remaining[left], remaining[right]];
          seedScore = score;
        }
      }
    }

    const group = [...seed];
    for (const id of seed) remaining.splice(remaining.indexOf(id), 1);
    while (group.length < targetSize && remaining.length) {
      let bestId = remaining[0];
      let bestScore = -1;
      for (const candidate of remaining) {
        const average = group.reduce(
          (sum, member) => sum + movementCompatibility(schedule, candidate, member).score,
          0,
        ) / group.length;
        if (average > bestScore) {
          bestId = candidate;
          bestScore = average;
        }
      }
      group.push(bestId);
      remaining.splice(remaining.indexOf(bestId), 1);
    }
    groups.push({ members: sortedWorkerIds(group, workersById), score: groupScore(schedule, group) });
  }

  return groups;
}
