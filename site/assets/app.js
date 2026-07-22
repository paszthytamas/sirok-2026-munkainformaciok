import {
  byWorkerName,
  driverRoundTripCount,
  escapeHtml,
  formatHours,
  formatMoney,
  normalizeCarRows,
  payrollSummary,
  suggestCarGroups,
  sortedWorkerIds,
  workerArrivalDriverShiftIds,
  workerRideTimeline,
} from "./core.js";

const view = document.querySelector("#view");
const status = document.querySelector("#status");
const nav = document.querySelector("#main-nav");
const menuButton = document.querySelector(".menu-button");
const config = window.SIROK_CONFIG || {};

const routes = new Set([
  "heti",
  "turnusletszam",
  "dolgozo",
  "szemelyek",
  "valtasok",
  "utazasi-javaslat",
  "autok",
  "turnusvezetok",
  "kontaktok",
  "informaciok",
  "fizetes",
]);
let schedule;
let workersById;
let carRows = [];
let leadersByShift = new Map();
const attendanceStorageKey = "sirok-attendance-session-v1";
let contactsByWorkerId = new Map();

function attendanceState() {
  try {
    return JSON.parse(sessionStorage.getItem(attendanceStorageKey) || "{}") || {};
  } catch {
    return {};
  }
}

function saveAttendance(state) {
  try {
    sessionStorage.setItem(attendanceStorageKey, JSON.stringify(state));
  } catch {
    // The checklist remains usable even when browser storage is disabled.
  }
}

function hashParams() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

function workerPhoneLink(workerId, extraClass = "") {
  const worker = workersById.get(workerId);
  const contact = contactsByWorkerId.get(workerId);
  const name = escapeHtml(worker?.name || workerId);
  if (!worker) return name;
  if (!contact?.phone_e164) return `<span class="phone-link-missing" title="Nincs megadott telefonszám">${name}</span>`;
  return `<a class="phone-link${extraClass ? ` ${extraClass}` : ""}" href="tel:${escapeHtml(contact.phone_e164)}" title="${escapeHtml(contact.phone_display || contact.phone_e164)} hívása">${name}</a>`;
}

menuButton?.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
});

nav.addEventListener("click", () => {
  nav.classList.remove("open");
  menuButton?.setAttribute("aria-expanded", "false");
});

function pageHeading(eyebrow, title, description, tools = "") {
  return `<div class="page-heading">
    <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(description)}</p></div>
    ${tools ? `<div class="toolbar">${tools}</div>` : ""}
  </div>`;
}

function routeName() {
  const candidate = location.hash.replace(/^#/, "").split("?")[0];
  return routes.has(candidate) ? candidate : "heti";
}

function activateNavigation(route) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderWeekly() {
  const rows = byWorkerName(schedule.workers);
  view.innerHTML = `${pageHeading(
    "1. nézet",
    "Heti beosztás",
    "Az Excel contact táblájából, kizárólag a ténylegesen beosztott dolgozókkal.",
    '<input id="table-search" class="input search-field" type="search" placeholder="Keresés név szerint…" aria-label="Keresés név szerint" />',
  )}
  <div class="stats weekly-stats">
    <div class="stat"><b>${schedule.statistics.workerCount}</b><span>beosztott dolgozó</span></div>
    <div class="stat"><b>${schedule.statistics.shiftCount}</b><span>turnus</span></div>
  </div>
  <div class="card table-card">
    <div class="table-scroll">
      <table class="schedule-table">
        <thead><tr><th class="name-cell" scope="col">Név</th>${schedule.shifts
          .map((shift) => `<th scope="col">${escapeHtml(shift.label)}</th>`)
          .join("")}</tr></thead>
        <tbody id="schedule-body">${weeklyRows(rows)}</tbody>
      </table>
    </div>
  </div>`;
  document.querySelector("#table-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("hu-HU");
    const filtered = rows.filter((worker) => worker.name.toLocaleLowerCase("hu-HU").includes(query));
    document.querySelector("#schedule-body").innerHTML = weeklyRows(filtered);
  });
}

function weeklyRows(workers) {
  if (!workers.length) return '<tr><td class="name-cell">Nincs találat</td></tr>';
  return workers
    .map(
      (worker) => `<tr>
        <th class="name-cell" scope="row">${escapeHtml(worker.name)}</th>
        ${schedule.shifts
          .map((shift) =>
            worker.assignments[shift.id]
              ? '<td class="assigned" aria-label="Dolgozik">x</td>'
              : '<td class="off" aria-label="Nem dolgozik">–</td>',
          )
          .join("")}
      </tr>`,
    )
    .join("");
}

function renderPeople() {
  const workers = byWorkerName(schedule.workers);
  view.innerHTML = `${pageHeading(
    "2. nézet",
    "Személyenkénti beosztás",
    "Minden dolgozó turnusai, összefüggő munkablokkjai és tervezett óraszáma.",
    '<input id="person-search" class="input search-field" type="search" placeholder="Keresés név szerint…" aria-label="Keresés név szerint" />',
  )}<div id="person-grid" class="grid person-grid">${peopleCards(workers)}</div>`;
  document.querySelector("#person-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("hu-HU");
    document.querySelector("#person-grid").innerHTML = peopleCards(
      workers.filter((worker) => worker.name.toLocaleLowerCase("hu-HU").includes(query)),
    );
  });
}

function renderWorkerOverviewWelcome(workers) {
  if (!workers.length) {
    view.innerHTML = '<div class="notice">Nincs megjeleníthető dolgozó.</div>';
    return;
  }
  view.innerHTML = `${pageHeading(
    "Dolgozói összesítő",
    "Dolgozói adatlap",
    "Válassz egy dolgozót a teljes munkaidő-, turnus- és utazási összesítő megnyitásához.",
  )}<section class="card worker-welcome">
    <div class="worker-welcome-icon" aria-hidden="true">👤</div>
    <div><h2>Kinek az adatlapját szeretnéd megnézni?</h2><p class="lead">A kiválasztás után egy helyen látható a heti idővonal, a munkaidő és az autóbeosztás.</p></div>
    <label class="field worker-welcome-picker" for="welcome-worker"><span>Dolgozó kiválasztása</span><select id="welcome-worker"><option value="">Válassz a névsorból…</option>${workers.map((worker) => `<option value="${escapeHtml(worker.id)}">${escapeHtml(worker.name)}</option>`).join("")}</select></label>
  </section>`;
  document.querySelector("#welcome-worker").addEventListener("change", (event) => {
    if (event.target.value) location.hash = `dolgozo?worker=${encodeURIComponent(event.target.value)}`;
  });
}

function renderWorkerOverview() {
  const workers = byWorkerName(schedule.workers);
  const requestedId = hashParams().get("worker");
  const worker = requestedId ? workersById.get(requestedId) : null;
  if (!worker) {
    renderWorkerOverviewWelcome(workers);
    return;
  }
  const contact = contactsByWorkerId.get(worker.id);
  const rides = workerRideTimeline(schedule, carRows, worker.id);
  const driverAssignments = driverRoundTripCount(rides);
  const arrivalDriverShiftIds = workerArrivalDriverShiftIds(schedule, carRows, worker.id);
  const callAction = contact?.phone_e164
    ? `<a class="button call-button" href="tel:${escapeHtml(contact.phone_e164)}">☎ ${escapeHtml(contact.phone_display || contact.phone_e164)}</a>`
    : `<a class="button button-secondary" href="#kontaktok?worker=${encodeURIComponent(worker.id)}">Kontaktlista megnyitása</a>`;

  view.innerHTML = `${pageHeading(
    "Dolgozói összesítő",
    worker.name,
    "Munkaidő, egybefüggő munkablokkok, turnusok és teljes érkezési–távozási autóbeosztás egy helyen.",
    `<label class="field worker-picker"><span>Dolgozó kiválasztása</span><select id="overview-worker">${workers.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === worker.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>`,
  )}
  <div class="worker-profile-head card">
    <div><p class="eyebrow">Kiválasztott dolgozó</p><h2>${escapeHtml(worker.name)}</h2>${contact?.note ? `<p class="lead">${escapeHtml(contact.note)}</p>` : ""}</div>
    ${callAction}
  </div>
  <div class="stats worker-stats">
    <div class="stat"><b>${formatHours(worker.scheduledHours)}</b><span>tervezett munka</span></div>
    <div class="stat"><b>${worker.shiftIds.length}</b><span>turnus</span></div>
    <div class="stat"><b>${worker.blocks.length}</b><span>egybefüggő munkablokk</span></div>
    <div class="stat"><b>${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 }).format(driverAssignments)}</b><span>sofőri megbízás (oda-vissza)</span></div>
  </div>
  ${renderWorkerShiftTimeline(worker, arrivalDriverShiftIds)}
  <div class="worker-overview-grid">
    <section class="card overview-panel">
      <h2>Egybefüggő munkaidők</h2>
      <div class="work-block-list">${worker.blocks.map((block) => `<article class="work-block"><strong>${escapeHtml(block.startLabel)} → ${escapeHtml(block.endLabel)}</strong><span>${formatHours(block.hours)}</span></article>`).join("")}</div>
    </section>
    <section class="card overview-panel">
      <h2>Turnusok</h2>
      <div class="overview-shifts">${schedule.shifts.filter((shift) => worker.assignments[shift.id]).map((shift) => {
        const leaderId = leadersByShift.get(shift.id);
        const leader = workersById.get(leaderId);
        return `<article class="overview-shift"><div><strong>${escapeHtml(shift.day)} ${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</strong><small>${leaderId === worker.id ? "Ő a turnusvezető" : `Turnusvezető: ${escapeHtml(leader?.name || "nincs kijelölve")}`}</small></div><span>${formatHours(shift.durationHours)}</span></article>`;
      }).join("")}</div>
    </section>
    <section class="card overview-panel travel-panel">
      <h2>Érkezések és távozások</h2>
      <div class="worker-ride-timeline">${rides.map(renderWorkerRide).join("") || '<p class="empty">Nincs érkezési vagy távozási esemény.</p>'}</div>
    </section>
  </div>`;

  document.querySelector("#overview-worker").addEventListener("change", (event) => {
    location.hash = `dolgozo?worker=${encodeURIComponent(event.target.value)}`;
  });
}

function renderWorkerShiftTimeline(worker, arrivalDriverShiftIds) {
  const dayNames = { Sze: "Szerda", Cs: "Csütörtök", P: "Péntek", Szo: "Szombat" };
  const dayGroups = [];
  for (const shift of schedule.shifts) {
    const current = dayGroups.at(-1);
    if (!current || current.day !== shift.day) dayGroups.push({ day: shift.day, shifts: [shift] });
    else current.shifts.push(shift);
  }

  return `<section class="card worker-timeline-panel">
    <div class="worker-timeline-heading"><div><p class="eyebrow">Szekvenciális áttekintés</p><h2>Heti jelenléti idővonal</h2><p class="lead">A munkanap reggel 08:00-kor vált; a hajnali 03:00-s turnus még az előző munkanaphoz tartozik. Egybefüggő munka esetén az autó csak az első turnusnál jelenik meg: azt jelzi, hogy a dolgozó arra az érkezésre sofőrként van beosztva.</p></div><div class="timeline-legend" aria-label="Jelmagyarázat"><span><i class="legend-swatch legend-working"></i> ✓ dolgozik</span><span><b aria-hidden="true">✓ 🚗</b> sofőrként érkezik</span><span><i class="legend-swatch legend-off"></i> nincs beosztva</span></div></div>
    <div class="worker-shift-timeline">${dayGroups.map((group) => `<section class="timeline-day"><h3>${escapeHtml(dayNames[group.day] || group.day)}</h3><div class="timeline-day-slots" style="--shift-count:${group.shifts.length}">${group.shifts.map((shift) => {
      const works = Boolean(worker.assignments[shift.id]);
      const drives = works && arrivalDriverShiftIds.has(shift.id);
      const stateClass = drives ? "is-working is-driver" : works ? "is-working" : "is-off";
      const statusLabel = drives ? "dolgozik, és erre a munkablokkra sofőrként érkezik" : works ? "dolgozik" : "nincs beosztva";
      return `<div class="timeline-slot ${stateClass}" title="${escapeHtml(`${dayNames[group.day] || group.day} ${shift.start}–${shift.end}: ${statusLabel}`)}"><time datetime="${escapeHtml(shift.start)}">${escapeHtml(shift.start)}</time><span class="timeline-state" aria-label="${escapeHtml(statusLabel)}"><span class="timeline-check" aria-hidden="true">${works ? "✓" : "–"}</span><span class="timeline-car" aria-hidden="true">${drives ? "🚗" : ""}</span></span></div>`;
    }).join("")}</div></section>`).join("")}</div>
  </section>`;
}

function renderWorkerRide(ride) {
  const arriving = ride.direction === "arrivals";
  const directionLabel = arriving ? "Érkezés" : "Távozás";
  let assignment = '<p class="notice">Még nincs autóhoz rendelve.</p>';
  if (ride.assigned) {
    const statusLabel = ride.role === "driver" ? "sofőr" : "utas";
    const members = ride.memberIds.length
      ? `<ol class="car-member-list">${ride.memberIds.map((id) => `<li class="${id === ride.driverId ? "driver-member" : "passenger-member"}"><span>${workerPhoneLink(id)}</span>${id === ride.driverId ? '<span class="driver-badge" title="Sofőr">🚗 sofőr</span>' : ""}</li>`).join("")}</ol>`
      : '<p class="empty">Nincs rögzített utazó.</p>';
    const driverNotice = ride.driverId ? "" : '<p class="notice">Ehhez az autóhoz még nincs sofőr kijelölve.</p>';
    assignment = `<p class="ride-status">Státusz: <strong class="${ride.role === "driver" ? "driver-role" : ""}">${statusLabel}</strong></p>${driverNotice}<div class="ride-companions"><b>Vele utazik:</b>${members}</div>`;
  }
  return `<article class="worker-ride-event ${arriving ? "ride-arrival" : "ride-departure"}">
    <div class="worker-ride-head"><span class="badge ${arriving ? "badge-in" : "badge-out"}">${directionLabel}</span><strong>${escapeHtml(ride.boundaryLabel)}</strong></div>
    ${assignment}
  </article>`;
}

function renderShiftRosters() {
  const attendance = attendanceState();
  view.innerHTML = `${pageHeading(
    "Létszámellenőrzés",
    "Kiknek kell jelen lenniük?",
    "Turnusonkénti, kipipálható névsor ABC-sorrendben, külön megjelölt turnusvezetővel.",
  )}<div class="grid roster-grid">${schedule.shifts.map((shift) => {
    const workers = byWorkerName(schedule.workers.filter((worker) => worker.assignments[shift.id]));
    const leaderId = leadersByShift.get(shift.id);
    const present = workers.filter((worker) => attendance[`${shift.id}:${worker.id}`]).length;
    return `<article class="card shift-roster-card">
      <div class="shift-roster-head"><div><p class="eyebrow">${escapeHtml(shift.day)}</p><h2>${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</h2></div><span class="headcount" data-attendance-count="${escapeHtml(shift.id)}">${present}/${workers.length} megjelent</span></div>
      ${leaderId ? `<p class="leader-callout">Turnusvezető: ${escapeHtml(workersById.get(leaderId)?.name || "Nincs megadva")}</p>` : '<p class="notice">Nincs turnusvezető kijelölve.</p>'}
      <div class="attendance-actions"><button type="button" data-attendance-all="${escapeHtml(shift.id)}">Mind megjelent</button><button type="button" data-attendance-clear="${escapeHtml(shift.id)}">Jelölések törlése</button></div>
      <ol class="checklist-roster">${workers.map((worker) => {
        const key = `${shift.id}:${worker.id}`;
        const checked = Boolean(attendance[key]);
        return `<li class="${checked ? "present" : ""}"><label><input class="attendance-checkbox" type="checkbox" data-attendance-shift="${escapeHtml(shift.id)}" data-attendance-worker="${escapeHtml(worker.id)}" ${checked ? "checked" : ""} /><span>${escapeHtml(worker.name)}</span></label></li>`;
      }).join("")}</ol>
    </article>`;
  }).join("")}</div><p class="session-note">A jelenléti pipák csak ebben a böngészőfülben, az aktuális munkamenet idejére maradnak meg.</p>`;
  bindAttendanceChecklist();
}

function bindAttendanceChecklist() {
  const updateCount = (shiftId) => {
    const checkboxes = [...document.querySelectorAll(`[data-attendance-shift="${CSS.escape(shiftId)}"]`)];
    const checked = checkboxes.filter((checkbox) => checkbox.checked).length;
    const counter = document.querySelector(`[data-attendance-count="${CSS.escape(shiftId)}"]`);
    if (counter) counter.textContent = `${checked}/${checkboxes.length} megjelent`;
  };
  const persistCheckbox = (checkbox) => {
    const state = attendanceState();
    const key = `${checkbox.dataset.attendanceShift}:${checkbox.dataset.attendanceWorker}`;
    if (checkbox.checked) state[key] = true;
    else delete state[key];
    saveAttendance(state);
    checkbox.closest("li")?.classList.toggle("present", checkbox.checked);
    updateCount(checkbox.dataset.attendanceShift);
  };
  document.querySelectorAll(".attendance-checkbox").forEach((checkbox) =>
    checkbox.addEventListener("change", () => persistCheckbox(checkbox)),
  );
  document.querySelectorAll("[data-attendance-all]").forEach((button) =>
    button.addEventListener("click", () => {
      document.querySelectorAll(`[data-attendance-shift="${CSS.escape(button.dataset.attendanceAll)}"]`).forEach((checkbox) => {
        checkbox.checked = true;
        persistCheckbox(checkbox);
      });
    }),
  );
  document.querySelectorAll("[data-attendance-clear]").forEach((button) =>
    button.addEventListener("click", () => {
      document.querySelectorAll(`[data-attendance-shift="${CSS.escape(button.dataset.attendanceClear)}"]`).forEach((checkbox) => {
        checkbox.checked = false;
        persistCheckbox(checkbox);
      });
    }),
  );
}

function peopleCards(workers) {
  if (!workers.length) return '<div class="notice">Nincs találat.</div>';
  return workers
    .map(
      (worker) => `<article class="card person-card">
        <h2>${escapeHtml(worker.name)}</h2>
        <div class="meta-row"><b>${formatHours(worker.scheduledHours)}</b><span>·</span><span>${worker.shiftIds.length} turnus</span></div>
        <div class="shift-list">${schedule.shifts
          .filter((shift) => worker.assignments[shift.id])
          .map(
            (shift) => `<div class="shift-line"><strong>${escapeHtml(shift.day)} ${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</strong><span>${formatHours(shift.durationHours)}</span></div>`,
          )
          .join("")}</div>
        <div class="block-note"><b>Folyamatos munkablokkok:</b><br />${worker.blocks
          .map((block) => `${escapeHtml(block.startLabel)} → ${escapeHtml(block.endLabel)} (${formatHours(block.hours)})`)
          .join("<br />")}</div>
        <a class="person-details-link" href="#dolgozo?worker=${encodeURIComponent(worker.id)}">Teljes dolgozói adatlap →</a>
      </article>`,
    )
    .join("");
}

function renderTransitions() {
  view.innerHTML = `${pageHeading(
    "3. nézet",
    "Érkezők és távozók",
    "Az érkezés és távozás a közvetlenül megelőző turnushoz viszonyítva készült.",
  )}<div class="boundary-list">${schedule.boundaries
    .map((boundary, index) => {
      const arrivals = sortedWorkerIds(boundary.arrivals, workersById);
      const departures = sortedWorkerIds(boundary.departures, workersById);
      return `<details class="card boundary" ${index === 0 ? "open" : ""}>
        <summary><span>${escapeHtml(boundary.label)}</span><span class="badges"><span class="badge badge-in">+ ${arrivals.length} érkezik</span><span class="badge badge-out">− ${departures.length} távozik</span></span></summary>
        <div class="two-columns">
          ${roster("Érkezik", arrivals, "badge-in")}
          ${roster("Távozik", departures, "badge-out")}
        </div>
      </details>`;
    })
    .join("")}</div>`;
}

function renderTravelSuggestions(capacity = 4) {
  view.innerHTML = `${pageHeading(
    "Automatikus párosítás",
    "Javasolt együtt utazó csoportok",
    "A rendszer azokat teszi egy autóba, akik a hét során a legtöbbször ugyanakkor érkeznek és távoznak.",
    `<label class="field compact-field"><span>Férőhely/autó</span><select id="suggestion-capacity" class="select">${[3,4,5,6,7,8,9].map((value) => `<option value="${value}" ${value === Number(capacity) ? "selected" : ""}>${value} fő</option>`).join("")}</select></label>`,
  )}
  <div class="algorithm-note card"><h2>Hogyan készül a javaslat?</h2><p>Minden dolgozópár pontszámot kap a közös érkezési és távozási eseményeik, valamint a teljes turnusmintájuk hasonlósága alapján. A párosító először a legerősebb párokat választja ki, majd az átlagosan legjobban illeszkedő további személyekkel tölti fel az autót a megadott férőhelyig. Lakcím és jogosítványadat nincs az Excelben, ezért ez logisztikai kiindulópont; a sofőrt az adminfelületen kell kijelölni.</p></div>
  <div class="boundary-list">${travelSuggestionCards(capacity)}</div>`;
  document.querySelector("#suggestion-capacity").addEventListener("change", (event) => renderTravelSuggestions(Number(event.target.value)));
}

function travelSuggestionCards(capacity) {
  return schedule.boundaries.map((boundary, index) => `<details class="card boundary" ${index === 0 ? "open" : ""}>
    <summary><span>${escapeHtml(boundary.label)}</span><span class="badges"><span class="badge badge-in">${boundary.arrivals.length} érkező</span><span class="badge badge-out">${boundary.departures.length} távozó</span></span></summary>
    <div class="two-columns suggestion-columns">
      ${suggestionDirection("Érkezés", boundary.arrivals, capacity, "badge-in")}
      ${suggestionDirection("Távozás", boundary.departures, capacity, "badge-out")}
    </div>
  </details>`).join("");
}

function suggestionDirection(title, ids, capacity, badgeClass) {
  if (!ids.length) return `<section class="roster"><h3><span class="badge ${badgeClass}">${title}</span></h3><p class="empty">Nincs érintett dolgozó.</p></section>`;
  const groups = suggestCarGroups(schedule, ids, capacity);
  return `<section class="roster"><h3><span class="badge ${badgeClass}">${title} · ${groups.length} javasolt autó</span></h3><div class="suggestion-groups">${groups.map((group, index) => `<article class="suggestion-car"><div class="suggestion-car-head"><b>Javasolt autó ${index + 1}</b><span>${group.members.length > 1 ? `${group.score}% egyezés` : "egyedül"}</span></div><ol>${group.members.map((id) => `<li>${escapeHtml(workersById.get(id)?.name || id)}</li>`).join("")}</ol></article>`).join("")}</div></section>`;
}

function roster(title, ids, className) {
  const names = ids.length
    ? `<ol class="name-list">${ids.map((id) => `<li>${escapeHtml(workersById.get(id)?.name || id)}</li>`).join("")}</ol>`
    : '<p class="empty">Nincs érintett dolgozó.</p>';
  return `<section class="roster"><h3><span class="badge ${className}">${escapeHtml(title)} · ${ids.length} fő</span></h3>${names}</section>`;
}

async function loadCars() {
  if (config.supabaseUrl && config.supabaseAnonKey) {
    try {
      const response = await fetch(
        `${config.supabaseUrl}/rest/v1/car_assignments?select=boundary_id,payload`,
        { headers: { apikey: config.supabaseAnonKey } },
      );
      if (!response.ok) throw new Error("Az online autóbeosztás nem érhető el.");
      return normalizeCarRows(await response.json(), schedule.boundaries);
    } catch (error) {
      console.warn(error);
    }
  }
  const localRows = JSON.parse(localStorage.getItem("sirok-admin-cars-v1") || "null");
  if (localRows) return normalizeCarRows(localRows, schedule.boundaries);
  const response = await fetch("./data/cars.json", { cache: "no-store" });
  return normalizeCarRows(response.ok ? await response.json() : [], schedule.boundaries);
}

async function loadLeaders() {
  let rows = [];
  if (config.supabaseUrl && config.supabaseAnonKey) {
    try {
      const response = await fetch(
        `${config.supabaseUrl}/rest/v1/shift_leaders?select=shift_id,worker_id`,
        { headers: { apikey: config.supabaseAnonKey } },
      );
      if (!response.ok) throw new Error("A turnusvezetői adatok nem érhetők el.");
      rows = await response.json();
    } catch (error) {
      console.warn(error);
    }
  }
  if (!rows.length) {
    rows = JSON.parse(localStorage.getItem("sirok-admin-leaders-v1") || "null") || [];
    if (!rows.length) {
      const response = await fetch("./data/leaders.json", { cache: "no-store" });
      rows = response.ok ? await response.json() : [];
    }
  }
  return new Map(rows.filter((row) => row.worker_id).map((row) => [row.shift_id, row.worker_id]));
}

async function loadContacts() {
  if (!(config.supabaseUrl && config.supabaseAnonKey)) return new Map();
  try {
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/worker_contacts?select=worker_id,name,phone_e164,phone_display,note&order=name`,
      { headers: { apikey: config.supabaseAnonKey } },
    );
    if (!response.ok) throw new Error("A kontaktlista nem érhető el.");
    const contacts = await response.json();
    return new Map(contacts.map((contact) => [contact.worker_id, contact]));
  } catch (error) {
    console.warn(error);
    return new Map();
  }
}

function renderCars() {
  const byBoundary = new Map(carRows.map((row) => [row.boundary_id, row.payload]));
  const sections = schedule.boundaries
    .map((boundary) => {
      const payload = byBoundary.get(boundary.id) || {};
      const arrivals = payload.arrivals?.cars || [];
      const departures = payload.departures?.cars || [];
      if (!arrivals.length && !departures.length) return "";
      return `<article class="card car-boundary-card">
        <div class="card-body"><p class="eyebrow">Váltási időpont</p><h2>${escapeHtml(boundary.label)}</h2></div>
        ${publicRideSection("Érkezés", arrivals, "badge-in")}
        ${publicRideSection("Távozás", departures, "badge-out")}
      </article>`;
    })
    .filter(Boolean)
    .join("");
  view.innerHTML = `${pageHeading(
    "4. nézet",
    "Autóbeosztások",
    "A sofőr és a vele utazók turnusváltásonként, külön az érkezéshez és a távozáshoz.",
  )}<div class="cars-public">${sections || '<div class="notice">Az autóbeosztások még nem készültek el.</div>'}</div>`;
}

function renderLeaders() {
  view.innerHTML = `${pageHeading(
    "Vezetői beosztás",
    "Turnusvezetők",
    "Minden dolgozó itt ellenőrizheti, hogy az adott turnust ki vezeti.",
  )}<div class="grid leader-grid">${schedule.shifts.map((shift) => {
    const leaderId = leadersByShift.get(shift.id);
    const leader = workersById.get(leaderId);
    return `<article class="card leader-card"><p class="eyebrow">${escapeHtml(shift.day)}</p><h2>${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</h2>${leader ? `<p class="leader-name">${escapeHtml(leader.name)}</p>` : '<p class="empty">Nincs kijelölve turnusvezető.</p>'}</article>`;
  }).join("")}</div>`;
}

function publicRideSection(title, cars, badgeClass) {
  if (!cars.length) return "";
  const directionClass = badgeClass === "badge-in" ? "ride-arrivals" : "ride-departures";
  return `<section class="ride-section ${directionClass}"><h3><span class="badge ${badgeClass}">${title}</span></h3><div class="car-grid">${cars
    .map((car, index) => {
      const passengers = car.passengers?.length
        ? `<ul>${car.passengers.map((id) => `<li>${workerPhoneLink(id)}</li>`).join("")}</ul>`
        : '<p class="empty">Nincs rögzített utas.</p>';
      const driver = car.driver ? workerPhoneLink(car.driver) : `Autó ${index + 1} · nincs sofőr`;
      return `<div class="car-public"><p class="driver">🚗 ${driver}</p>${passengers}</div>`;
    })
    .join("")}</div></section>`;
}

function renderContacts() {
  const requestedId = hashParams().get("worker");
  const contacts = byWorkerName(
    schedule.workers.map((worker) => ({
      worker_id: worker.id,
      name: worker.name,
      ...(contactsByWorkerId.get(worker.id) || {}),
    })),
  );
  if (requestedId) contacts.sort((left, right) => left.worker_id === requestedId ? -1 : right.worker_id === requestedId ? 1 : 0);
  view.innerHTML = `${pageHeading(
    "Nyilvános névjegyzék",
    "Kontaktlista",
    "A Supabase-ből betöltött telefonszámok mobilon egy érintéssel hívhatók.",
    '<input id="contact-search" class="input search-field" type="search" placeholder="Keresés név szerint…" aria-label="Keresés a kontaktok között" />',
  )}<div id="contact-grid" class="grid contact-grid">${contactCards(contacts, requestedId)}</div>`;
  document.querySelector("#contact-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("hu-HU");
    document.querySelector("#contact-grid").innerHTML = contactCards(
      contacts.filter((contact) => contact.name.toLocaleLowerCase("hu-HU").includes(query)),
      requestedId,
    );
  });
}

function contactCards(contacts, requestedId) {
  if (!contacts.length) return '<div class="notice">Nincs találat.</div>';
  return contacts.map((contact) => `<article class="card contact-card${contact.worker_id === requestedId ? " requested" : ""}">
    <div><p class="eyebrow">Dolgozó</p><h2>${escapeHtml(contact.name)}</h2>${contact.note ? `<p>${escapeHtml(contact.note)}</p>` : ""}</div>
    ${contact.phone_e164 ? `<a class="contact-phone" href="tel:${escapeHtml(contact.phone_e164)}"><span>☎</span><strong>${escapeHtml(contact.phone_display || contact.phone_e164)}</strong></a>` : '<p class="contact-missing">Nincs telefonszám feltöltve.</p>'}
    <a class="person-details-link" href="#dolgozo?worker=${encodeURIComponent(contact.worker_id)}">Teljes dolgozói adatlap →</a>
  </article>`).join("");
}

async function renderInformation() {
  view.innerHTML = `${pageHeading(
    "5. nézet",
    "Általános munkainformációk",
    "A repository data/munkainformaciok.md fájljának közzétett tartalma.",
  )}<article id="markdown-content" class="card markdown-card"><p>Betöltés…</p></article>`;
  const response = await fetch("./data/info.html", { cache: "no-store" });
  document.querySelector("#markdown-content").innerHTML = response.ok
    ? await response.text()
    : '<p class="notice error">A munkainformációs fájl nem tölthető be.</p>';
}

function renderPayrollLogin() {
  const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  view.innerHTML = `${pageHeading(
    "6. nézet",
    "Saját fizetésem",
    "A jelszó csak a hozzá tartozó dolgozó fizetési összesítőjét nyitja meg.",
  )}<article class="card login-card">
    <h2>Belépés jelszóval</h2>
    ${configured ? "" : '<p class="notice">A biztonságos fizetési háttér még nincs összekapcsolva az oldallal.</p>'}
    <form id="payroll-login-form">
      <div class="field"><label for="worker-password">Személyes jelszó</label><input id="worker-password" type="password" minlength="4" autocomplete="current-password" required /></div>
      <button class="button" type="submit" ${configured ? "" : "disabled"}>Fizetési összesítő megnyitása</button>
      <div id="login-message" aria-live="polite"></div>
    </form>
  </article>`;
  if (configured) document.querySelector("#payroll-login-form").addEventListener("submit", submitPayrollLogin);
}

async function submitPayrollLogin(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const message = document.querySelector("#login-message");
  button.disabled = true;
  message.innerHTML = '<p class="notice">Ellenőrzés…</p>';
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/payroll-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabaseAnonKey,
      },
      body: JSON.stringify({ password: document.querySelector("#worker-password").value }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Sikertelen belépés.");
    const worker = workersById.get(payload.workerId);
    if (!worker) throw new Error("Ehhez a jelszóhoz nem található aktív beosztás.");
    renderPayroll(worker, payload);
  } catch (error) {
    message.innerHTML = `<p class="notice error">${escapeHtml(error.message)}</p>`;
    button.disabled = false;
  }
}

function renderPayroll(worker, response) {
  const summary = payrollSummary(schedule, worker, response);
  view.innerHTML = `${pageHeading(
    "Fizetési összesítő",
    worker.name,
    `Aktuális óradíj: ${formatMoney(summary.hourlyRate)} / óra`,
    '<button id="payroll-logout" class="button button-secondary" type="button">Kijelentkezés</button>',
  )}
  <div class="stats payroll-summary">
    <div class="stat"><b>${formatHours(summary.scheduledHours)}</b><span>tervezett munka</span></div>
    <div class="stat"><b>${summary.adjustmentHours >= 0 ? "+" : ""}${formatHours(summary.adjustmentHours)}</b><span>órakorrekció</span></div>
    <div class="stat"><b>${formatMoney(summary.fuelFees)}</b><span>utazási díj</span></div>
    <div class="stat"><b>${formatMoney(summary.total)}</b><span>fizetendő összesen</span></div>
  </div>
  <div class="card table-card payroll-table-wrap"><table class="payroll-table">
    <thead><tr><th>Turnus</th><th>Tervezett</th><th>Eltérés</th><th>Elszámolt</th><th>Munkadíj</th><th>Utazási díj</th><th>Összesen</th></tr></thead>
    <tbody>${summary.rows.map((row) => `<tr><td><b>${escapeHtml(row.shift.day)} ${escapeHtml(row.shift.start)}–${escapeHtml(row.shift.end)}</b>${row.note ? `<br /><small>${escapeHtml(row.note)}</small>` : ""}</td><td>${formatHours(row.scheduledHours)}</td><td>${row.adjustmentHours > 0 ? "+" : ""}${formatHours(row.adjustmentHours)}</td><td>${formatHours(row.paidHours)}</td><td>${formatMoney(row.wage)}</td><td>${formatMoney(row.fuelFee)}</td><td><b>${formatMoney(row.total)}</b></td></tr>`).join("")}</tbody>
    <tfoot><tr><td>Összesen</td><td>${formatHours(summary.scheduledHours)}</td><td>${summary.adjustmentHours > 0 ? "+" : ""}${formatHours(summary.adjustmentHours)}</td><td>${formatHours(summary.paidHours)}</td><td>${formatMoney(summary.wages)}</td><td>${formatMoney(summary.fuelFees)}</td><td>${formatMoney(summary.total)}</td></tr></tfoot>
  </table></div>`;
  document.querySelector("#payroll-logout").addEventListener("click", renderPayrollLogin);
}

async function renderRoute() {
  if (!schedule) return;
  const route = routeName();
  activateNavigation(route);
  if (route === "heti") renderWeekly();
  if (route === "turnusletszam") renderShiftRosters();
  if (route === "dolgozo") renderWorkerOverview();
  if (route === "szemelyek") renderPeople();
  if (route === "valtasok") renderTransitions();
  if (route === "utazasi-javaslat") renderTravelSuggestions();
  if (route === "autok") renderCars();
  if (route === "turnusvezetok") renderLeaders();
  if (route === "kontaktok") renderContacts();
  if (route === "informaciok") await renderInformation();
  if (route === "fizetes") renderPayrollLogin();
  document.querySelector("#main-content").focus({ preventScroll: true });
}

async function boot() {
  try {
    const response = await fetch("./data/schedule.json", { cache: "no-store" });
    if (!response.ok) throw new Error("A beosztás adatfájlja nem érhető el.");
    schedule = await response.json();
    workersById = new Map(schedule.workers.map((worker) => [worker.id, worker]));
    [carRows, leadersByShift, contactsByWorkerId] = await Promise.all([loadCars(), loadLeaders(), loadContacts()]);
    status.hidden = true;
    await renderRoute();
  } catch (error) {
    status.textContent = `Hiba: ${error.message}`;
    status.classList.add("error");
  }
}

window.addEventListener("hashchange", renderRoute);
boot();
