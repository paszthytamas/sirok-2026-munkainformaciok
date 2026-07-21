import {
  byWorkerName,
  escapeHtml,
  formatHours,
  formatMoney,
  normalizeCarRows,
  payrollSummary,
  suggestCarGroups,
  sortedWorkerIds,
} from "./core.js";

const view = document.querySelector("#view");
const status = document.querySelector("#status");
const nav = document.querySelector("#main-nav");
const menuButton = document.querySelector(".menu-button");
const config = window.SIROK_CONFIG || {};

const routes = new Set([
  "heti",
  "turnusletszam",
  "szemelyek",
  "valtasok",
  "utazasi-javaslat",
  "autok",
  "turnusvezetok",
  "informaciok",
  "fizetes",
]);
let schedule;
let workersById;
let carRows = [];
let leadersByShift = new Map();

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
  <div class="stats">
    <div class="stat"><b>${schedule.statistics.workerCount}</b><span>beosztott dolgozó</span></div>
    <div class="stat"><b>${schedule.statistics.shiftCount}</b><span>turnus</span></div>
    <div class="stat"><b>${formatHours(schedule.statistics.scheduledHours)}</b><span>összes beosztott munka</span></div>
    <div class="stat"><b>Excel</b><span>egyetlen adatforrás</span></div>
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

function shiftWorkers(shift) {
  const workers = byWorkerName(schedule.workers.filter((worker) => worker.assignments[shift.id]));
  const leaderId = leadersByShift.get(shift.id);
  if (!leaderId) return workers;
  return workers.sort((left, right) => {
    if (left.id === leaderId) return -1;
    if (right.id === leaderId) return 1;
    return 0;
  });
}

function renderShiftRosters() {
  view.innerHTML = `${pageHeading(
    "Létszámellenőrzés",
    "Kiknek kell jelen lenniük?",
    "Turnusonkénti névsor az aktuális turnusvezetővel az első helyen.",
  )}<div class="grid roster-grid">${schedule.shifts.map((shift) => {
    const workers = shiftWorkers(shift);
    const leaderId = leadersByShift.get(shift.id);
    return `<article class="card shift-roster-card">
      <div class="shift-roster-head"><div><p class="eyebrow">${escapeHtml(shift.day)}</p><h2>${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</h2></div><span class="headcount">${workers.length} fő</span></div>
      ${leaderId ? `<p class="leader-callout">Turnusvezető: ${escapeHtml(workersById.get(leaderId)?.name || "Nincs megadva")}</p>` : '<p class="notice">Nincs turnusvezető kijelölve.</p>'}
      <ol class="checklist-roster">${workers.map((worker) => `<li class="${worker.id === leaderId ? "shift-leader" : ""}"><span class="check-box" aria-hidden="true"></span><span>${escapeHtml(worker.name)}${worker.id === leaderId ? " · turnusvezető" : ""}</span></li>`).join("")}</ol>
    </article>`;
  }).join("")}</div>`;
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

function renderCars() {
  const byBoundary = new Map(carRows.map((row) => [row.boundary_id, row.payload]));
  const sections = schedule.boundaries
    .map((boundary) => {
      const payload = byBoundary.get(boundary.id) || {};
      const arrivals = payload.arrivals?.cars || [];
      const departures = payload.departures?.cars || [];
      if (!arrivals.length && !departures.length) return "";
      return `<article class="card">
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
  return `<section class="ride-section"><h3><span class="badge ${badgeClass}">${title}</span></h3><div class="car-grid">${cars
    .map((car, index) => {
      const passengers = car.passengers?.length
        ? `<ul>${car.passengers.map((id) => `<li>${escapeHtml(workersById.get(id)?.name || id)}</li>`).join("")}</ul>`
        : '<p class="empty">Nincs rögzített utas.</p>';
      return `<div class="car-public"><p class="driver">🚗 ${escapeHtml(workersById.get(car.driver)?.name || `Autó ${index + 1}`)}</p>${passengers}</div>`;
    })
    .join("")}</div></section>`;
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
      <div class="field"><label for="worker-password">Személyes jelszó</label><input id="worker-password" type="password" minlength="12" autocomplete="current-password" required /></div>
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
    <div class="stat"><b>${formatMoney(summary.fuelFees)}</b><span>üzemanyagdíj</span></div>
    <div class="stat"><b>${formatMoney(summary.total)}</b><span>fizetendő összesen</span></div>
  </div>
  <div class="card table-card payroll-table-wrap"><table class="payroll-table">
    <thead><tr><th>Turnus</th><th>Tervezett</th><th>Eltérés</th><th>Elszámolt</th><th>Munkadíj</th><th>Üzemanyag</th><th>Összesen</th></tr></thead>
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
  if (route === "szemelyek") renderPeople();
  if (route === "valtasok") renderTransitions();
  if (route === "utazasi-javaslat") renderTravelSuggestions();
  if (route === "autok") renderCars();
  if (route === "turnusvezetok") renderLeaders();
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
    [carRows, leadersByShift] = await Promise.all([loadCars(), loadLeaders()]);
    status.hidden = true;
    await renderRoute();
  } catch (error) {
    status.textContent = `Hiba: ${error.message}`;
    status.classList.add("error");
  }
}

window.addEventListener("hashchange", renderRoute);
boot();
