import {
  adminCostSummary,
  byWorkerName,
  carDriversPresentAtDeparture,
  escapeHtml,
  formatHours,
  formatMoney,
  normalizeCarRows,
  suggestCarGroups,
  sortedWorkerIds,
} from "./core.js";

const root = document.querySelector("#admin-root");
const status = document.querySelector("#admin-status");
const config = window.SIROK_CONFIG || {};
const online = Boolean(config.supabaseUrl && config.supabaseAnonKey);

let schedule;
let workersById;
let sessionToken = "";
const adminTabs = new Set(["cars", "leaders", "payroll", "costs"]);
const requestedAdminTab = location.hash.replace(/^#/, "");
let activeTab = adminTabs.has(requestedAdminTab) ? requestedAdminTab : "cars";
let activeBoundaryId = "";
let activeDirection = "arrivals";
let selectedWorkerId = "";
let selectedPayrollWorkerId = "";
let carsByBoundary = new Map();
let payrollEntries = [];
let credentialWorkers = new Set();
let hourlyRate = 0;
let leadersByShift = new Map();
const dirtyTravelFeeBoundaries = new Set();

const localKeys = {
  cars: "sirok-admin-cars-v1",
  payroll: "sirok-admin-payroll-v1",
  rate: "sirok-admin-rate-v1",
  leaders: "sirok-admin-leaders-v1",
};

function setStatus(message = "", type = "") {
  status.textContent = message;
  status.className = `status-card${type ? ` ${type}` : ""}`;
  status.hidden = !message;
}

function blankPayload() {
  return { arrivals: { cars: [] }, departures: { cars: [] } };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function api(action, data = {}) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/admin-api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ action, ...data }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Az adminművelet sikertelen.");
  return payload;
}

async function login(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  setStatus("Bejelentkezés…");
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey },
      body: JSON.stringify({
        email: document.querySelector("#admin-email").value,
        password: document.querySelector("#admin-password").value,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new Error("Hibás admin e-mail vagy jelszó.");
    sessionToken = payload.access_token;
    await bootstrapOnline();
    setStatus("");
    renderAdmin();
  } catch (error) {
    setStatus(error.message, "error");
    button.disabled = false;
  }
}

function renderLogin() {
  setStatus("");
  root.innerHTML = `<article class="card login-card login-panel">
    <p class="eyebrow">Védett felület</p><h1>Admin bejelentkezés</h1>
    <p class="lead">Az autóbeosztást és a fizetési adatokat csak az engedélyezett adminisztrátor módosíthatja.</p>
    <form id="admin-login-form" style="margin-top:1rem">
      <div class="field"><label for="admin-email">E-mail</label><input id="admin-email" type="email" autocomplete="username" required /></div>
      <div class="field"><label for="admin-password">Jelszó</label><input id="admin-password" type="password" autocomplete="current-password" required /></div>
      <button class="button" type="submit">Belépés</button>
    </form>
  </article>`;
  document.querySelector("#admin-login-form").addEventListener("submit", login);
}

async function bootstrapOnline() {
  const data = await api("bootstrap");
  const rows = normalizeCarRows(data.cars || [], schedule.boundaries);
  carsByBoundary = new Map(rows.map((row) => [row.boundary_id, row.payload]));
  payrollEntries = data.payrollEntries || [];
  credentialWorkers = new Set((data.credentials || []).map((item) => item.worker_id));
  hourlyRate = Number(data.hourlyRate || 0);
  leadersByShift = new Map((data.leaders || []).filter((item) => item.worker_id).map((item) => [item.shift_id, item.worker_id]));
}

async function bootstrapLocal() {
  const response = await fetch("../data/cars.json", { cache: "no-store" });
  const defaults = normalizeCarRows(response.ok ? await response.json() : [], schedule.boundaries);
  const savedCars = JSON.parse(localStorage.getItem(localKeys.cars) || "null");
  const rows = normalizeCarRows(savedCars || defaults, schedule.boundaries);
  carsByBoundary = new Map(rows.map((row) => [row.boundary_id, row.payload]));
  payrollEntries = JSON.parse(localStorage.getItem(localKeys.payroll) || "[]");
  hourlyRate = Number(localStorage.getItem(localKeys.rate) || 0);
  const leadersResponse = await fetch("../data/leaders.json", { cache: "no-store" });
  const defaultLeaders = leadersResponse.ok ? await leadersResponse.json() : [];
  const savedLeaders = JSON.parse(localStorage.getItem(localKeys.leaders) || "null") || defaultLeaders;
  leadersByShift = new Map(savedLeaders.filter((item) => item.worker_id).map((item) => [item.shift_id, item.worker_id]));
}

function renderAdmin() {
  const modeNotice = online
    ? ""
    : '<div class="notice">Helyi előkészítő mód: a változások ebben a böngészőben maradnak. Az autóbeosztás JSON-ként exportálható. Éles használathoz kapcsold be a Supabase-hátteret.</div>';
  root.innerHTML = `${modeNotice}
    <div class="admin-tabs" role="tablist">
      <button type="button" data-tab="cars" class="${activeTab === "cars" ? "active" : ""}">Autóbeosztások</button>
      <button type="button" data-tab="leaders" class="${activeTab === "leaders" ? "active" : ""}">Turnusvezetők</button>
      <button type="button" data-tab="payroll" class="${activeTab === "payroll" ? "active" : ""}">Fizetések</button>
      <button type="button" data-tab="costs" class="${activeTab === "costs" ? "active" : ""}">Költségösszesítő</button>
      ${online ? '<button type="button" id="admin-logout">Kijelentkezés</button>' : ""}
    </div>
    <div id="admin-workspace"></div>`;
  root.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      location.hash = activeTab === "cars" ? "" : activeTab;
      renderAdmin();
    }),
  );
  document.querySelector("#admin-logout")?.addEventListener("click", () => {
    sessionToken = "";
    renderLogin();
  });
  if (activeTab === "cars") renderCarsAdmin();
  if (activeTab === "leaders") renderLeadersAdmin();
  if (activeTab === "payroll") renderPayrollAdmin();
  if (activeTab === "costs") renderCostSummaryAdmin();
}

function currentBoundary() {
  return schedule.boundaries.find((boundary) => boundary.id === activeBoundaryId) || schedule.boundaries[0];
}

function currentDirectionIds() {
  const boundary = currentBoundary();
  return activeDirection === "arrivals" ? boundary.arrivals : boundary.departures;
}

function currentCars() {
  const payload = carsByBoundary.get(currentBoundary().id) || blankPayload();
  if (!carsByBoundary.has(currentBoundary().id)) carsByBoundary.set(currentBoundary().id, payload);
  payload[activeDirection] ||= { cars: [] };
  return payload[activeDirection].cars;
}

function renderCarsAdmin() {
  if (!activeBoundaryId) activeBoundaryId = schedule.boundaries[0].id;
  const boundary = currentBoundary();
  const eligibleIds = sortedWorkerIds(currentDirectionIds(), workersById);
  const usedIds = new Set(currentCars().flatMap((car) => [car.driver, ...(car.passengers || [])]).filter(Boolean));
  const unassigned = eligibleIds.filter((id) => !usedIds.has(id));
  const driversOnSite = activeDirection === "departures"
    ? carDriversPresentAtDeparture(schedule, carRows(), boundary.id)
    : new Set();
  const workspace = document.querySelector("#admin-workspace");
  workspace.innerHTML = `<div class="admin-layout">
    <aside class="card admin-sidebar">
      <div class="field"><label for="boundary-select">Váltási időpont</label><select id="boundary-select">${schedule.boundaries.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === boundary.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></div>
      <div class="direction-tabs"><button type="button" data-direction="arrivals" class="${activeDirection === "arrivals" ? "active" : ""}">Érkezés</button><button type="button" data-direction="departures" class="${activeDirection === "departures" ? "active" : ""}">Távozás</button></div>
      <p class="lead">Húzd a neveket a sofőr vagy az utasok mezőbe. Mobilon koppints a névre, majd az „Ide helyezés” gombra.</p>
      <div class="field"><label for="auto-capacity">Automatikus csoportméret</label><select id="auto-capacity">${[3,4,5,6,7,8,9].map((value) => `<option value="${value}" ${value === 4 ? "selected" : ""}>${value} fő/autó</option>`).join("")}</select></div>
      <button id="auto-group" class="button button-secondary" type="button">Automatikus csoportosítás</button>
      <div class="admin-actions"><button id="add-car" class="button" type="button">+ Új autó</button><button id="save-cars" class="button button-secondary" type="button">Mentés</button></div>
      ${online ? "" : '<div class="admin-actions"><button id="export-cars" class="button button-secondary" type="button">JSON export</button></div>'}
    </aside>
    <section class="card admin-content admin-direction-${activeDirection}">
      <p class="eyebrow">${activeDirection === "arrivals" ? "Érkezés" : "Távozás"}</p><h1>${escapeHtml(boundary.label)}</h1>
      ${driversOnSite.size ? '<p class="car-presence-note"><span aria-hidden="true">🚗</span><span>A sárgával jelölt dolgozó korábban sofőrként érkezett, ezért ennél a távozásnál <strong>sofőrként oszd be</strong>.</span></p>' : ""}
      <div class="drag-board">
        ${dropZone("Nincs autóhoz rendelve", "unassigned", "", unassigned, "", driversOnSite)}
        ${currentCars().map((car, index) => carEditor(car, index, driversOnSite)).join("")}
      </div>
    </section>
  </div>`;
  bindCarsAdmin();
}

function workerChip(id, driversOnSite) {
  const hasCarOnSite = driversOnSite.has(id);
  return `<button class="worker-chip${selectedWorkerId === id ? " selected" : ""}${hasCarOnSite ? " car-on-site" : ""}" type="button" draggable="true" data-worker-id="${escapeHtml(id)}"${hasCarOnSite ? ' title="Autóval van jelen – sofőrként távozzon"' : ""}><span>${escapeHtml(workersById.get(id)?.name || id)}</span>${hasCarOnSite ? '<span class="car-presence-badge">🚗 autóval jelen</span>' : ""}</button>`;
}

function dropZone(title, target, carId, ids, extraClass = "", driversOnSite = new Set()) {
  return `<div class="dropzone ${extraClass}" data-drop-target="${target}" data-car-id="${escapeHtml(carId)}"><h3>${escapeHtml(title)}</h3><div class="worker-chips">${ids.map((id) => workerChip(id, driversOnSite)).join("")}</div>${target !== "unassigned" ? '<button class="tap-target" type="button" data-tap-target="' + target + '" data-car-id="' + escapeHtml(carId) + '">Kijelölt ide helyezése</button>' : ""}</div>`;
}

function carEditor(car, index, driversOnSite) {
  const driverIds = car.driver ? [car.driver] : [];
  return `<article class="admin-car">
    <div class="car-head"><h3>Autó ${index + 1}</h3><button class="button button-danger" type="button" data-remove-car="${escapeHtml(car.id)}">Törlés</button></div>
    ${dropZone("Sofőr", "driver", car.id, driverIds, "driver-zone", driversOnSite)}
    ${dropZone("Utasok", "passengers", car.id, car.passengers || [], "", driversOnSite)}
    <div class="field fuel-field"><label>Utazási díj a sofőrnek (Ft)</label><input type="number" min="0" step="100" value="${Number(car.fuelFee || 0)}" data-fuel-car="${escapeHtml(car.id)}" /></div>
  </article>`;
}

function bindCarsAdmin() {
  document.querySelector("#boundary-select").addEventListener("change", (event) => {
    activeBoundaryId = event.target.value;
    selectedWorkerId = "";
    renderCarsAdmin();
  });
  document.querySelectorAll("[data-direction]").forEach((button) =>
    button.addEventListener("click", () => {
      activeDirection = button.dataset.direction;
      selectedWorkerId = "";
      renderCarsAdmin();
    }),
  );
  document.querySelector("#add-car").addEventListener("click", () => {
    const boundary = currentBoundary();
    currentCars().push({
      id: crypto.randomUUID(),
      driver: null,
      passengers: [],
      fuelFee: 0,
      shiftId: activeDirection === "arrivals" ? boundary.currentShiftId : boundary.previousShiftId,
    });
    renderCarsAdmin();
  });
  document.querySelector("#auto-group").addEventListener("click", () => {
    const boundary = currentBoundary();
    const capacity = Number(document.querySelector("#auto-capacity").value || 4);
    const groups = suggestCarGroups(schedule, currentDirectionIds(), capacity);
    const shiftId = activeDirection === "arrivals" ? boundary.currentShiftId : boundary.previousShiftId;
    const payload = carsByBoundary.get(boundary.id) || blankPayload();
    payload[activeDirection] = {
      cars: groups.map((group) => ({
        id: crypto.randomUUID(),
        driver: null,
        passengers: group.members,
        fuelFee: 0,
        shiftId,
        suggestionScore: group.score,
      })),
    };
    carsByBoundary.set(boundary.id, payload);
    renderCarsAdmin();
    setStatus("Az automatikus csoportok elkészültek. Jelöld ki a sofőröket, majd mentsd a beosztást.");
  });
  document.querySelectorAll("[data-remove-car]").forEach((button) =>
    button.addEventListener("click", () => {
      const index = currentCars().findIndex((car) => car.id === button.dataset.removeCar);
      if (index >= 0) currentCars().splice(index, 1);
      renderCarsAdmin();
    }),
  );
  document.querySelectorAll("[data-fuel-car]").forEach((input) =>
    input.addEventListener("change", () => {
      const car = currentCars().find((item) => item.id === input.dataset.fuelCar);
      if (car) {
        car.fuelFee = Math.max(0, Number(input.value || 0));
        dirtyTravelFeeBoundaries.add(currentBoundary().id);
      }
    }),
  );
  document.querySelectorAll("[data-worker-id]").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedWorkerId = selectedWorkerId === chip.dataset.workerId ? "" : chip.dataset.workerId;
      renderCarsAdmin();
    });
    chip.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", chip.dataset.workerId);
      event.dataTransfer.effectAllowed = "move";
    });
  });
  document.querySelectorAll(".dropzone").forEach((zone) => {
    zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("dragover");
      moveWorker(event.dataTransfer.getData("text/plain"), zone.dataset.dropTarget, zone.dataset.carId);
    });
  });
  document.querySelectorAll("[data-tap-target]").forEach((button) =>
    button.addEventListener("click", () => {
      if (selectedWorkerId) moveWorker(selectedWorkerId, button.dataset.tapTarget, button.dataset.carId);
    }),
  );
  document.querySelector("#save-cars").addEventListener("click", saveCars);
  document.querySelector("#export-cars")?.addEventListener("click", () => downloadJson("cars.json", carRows()));
}

function moveWorker(workerId, target, carId) {
  if (!currentDirectionIds().includes(workerId)) return;
  for (const car of currentCars()) {
    if (car.driver === workerId) car.driver = null;
    car.passengers = (car.passengers || []).filter((id) => id !== workerId);
  }
  if (target !== "unassigned") {
    const car = currentCars().find((item) => item.id === carId);
    if (!car) return;
    if (target === "driver") {
      if (car.driver && car.driver !== workerId) car.passengers.push(car.driver);
      car.driver = workerId;
    } else {
      car.passengers.push(workerId);
    }
  }
  selectedWorkerId = "";
  renderCarsAdmin();
}

function carRows() {
  return schedule.boundaries.map((boundary) => ({
    boundary_id: boundary.id,
    payload: carsByBoundary.get(boundary.id) || blankPayload(),
  }));
}

async function saveCars() {
  const payload = clone(carsByBoundary.get(currentBoundary().id) || blankPayload());
  for (const direction of ["arrivals", "departures"]) {
    payload[direction].cars = (payload[direction].cars || []).filter((car) => car.driver || car.passengers?.length);
  }
  carsByBoundary.set(currentBoundary().id, payload);
  try {
    if (online) await api("save-cars", { boundaryId: currentBoundary().id, payload });
    else localStorage.setItem(localKeys.cars, JSON.stringify(carRows()));
    dirtyTravelFeeBoundaries.delete(currentBoundary().id);
    setStatus("Az autóbeosztás mentve.");
    setTimeout(() => setStatus(""), 2200);
    renderCarsAdmin();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderLeadersAdmin() {
  document.querySelector("#admin-workspace").innerHTML = `<section class="card admin-content leader-admin-page">
    <div><p class="eyebrow">Külön adminoldal</p><h1>Turnusvezetők beállítása</h1><p class="lead">Turnusonként csak az adott időszakra beosztott dolgozók közül választhatsz vezetőt.</p></div>
    <form id="leaders-form"><div class="leader-editor-grid">${schedule.shifts.map((shift) => {
      const assigned = byWorkerName(schedule.workers.filter((worker) => worker.assignments[shift.id]));
      const selected = leadersByShift.get(shift.id) || "";
      return `<div class="leader-edit-row"><div><p class="eyebrow">${escapeHtml(shift.day)}</p><h2>${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</h2><small>${assigned.length} fő dolgozik</small></div><div class="field"><label for="leader-${escapeHtml(shift.id)}">Turnusvezető</label><select id="leader-${escapeHtml(shift.id)}" data-leader-shift="${escapeHtml(shift.id)}"><option value="">Nincs kijelölve</option>${assigned.map((worker) => `<option value="${escapeHtml(worker.id)}" ${worker.id === selected ? "selected" : ""}>${escapeHtml(worker.name)}</option>`).join("")}</select></div></div>`;
    }).join("")}</div><div class="admin-actions"><button class="button" type="submit">Turnusvezetők mentése</button></div></form>
  </section>`;
  document.querySelector("#leaders-form").addEventListener("submit", saveLeaders);
}

async function saveLeaders(event) {
  event.preventDefault();
  const leaders = [...document.querySelectorAll("[data-leader-shift]")].map((select) => ({
    shift_id: select.dataset.leaderShift,
    worker_id: select.value || null,
  }));
  try {
    if (online) await api("save-leaders", { leaders });
    else localStorage.setItem(localKeys.leaders, JSON.stringify(leaders));
    leadersByShift = new Map(leaders.filter((item) => item.worker_id).map((item) => [item.shift_id, item.worker_id]));
    setStatus("A turnusvezetői beosztás mentve.");
    renderLeadersAdmin();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderPayrollAdmin() {
  const workers = byWorkerName(schedule.workers);
  if (!selectedPayrollWorkerId) selectedPayrollWorkerId = workers[0]?.id || "";
  const worker = workersById.get(selectedPayrollWorkerId);
  const entries = new Map(
    payrollEntries.filter((entry) => entry.worker_id === worker.id).map((entry) => [entry.shift_id, entry]),
  );
  document.querySelector("#admin-workspace").innerHTML = `<div class="admin-layout">
    <aside class="card admin-sidebar">
      <div class="field"><label for="payroll-worker">Dolgozó</label><select id="payroll-worker">${workers.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === worker.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="hourly-rate">Általános óradíj (Ft)</label><input id="hourly-rate" type="number" min="0" step="100" value="${hourlyRate}" /></div>
      <button id="save-rate" class="button button-secondary" type="button">Óradíj mentése</button>
      <hr />
      <form id="password-form">
        <div class="field"><label for="worker-password-new">Személyes jelszó beállítása</label><input id="worker-password-new" type="password" minlength="12" autocomplete="new-password" ${online ? "required" : "disabled"} /></div>
        <p class="password-help">A mentett jelszó később biztonsági okból nem olvasható vissza. Elfelejtett jelszó esetén itt lehet újat beállítani.</p>
        <div class="admin-actions"><button id="generate-worker-password" class="button button-secondary" type="button" ${online ? "" : "disabled"}>Erős jelszó generálása</button><button id="copy-worker-password" class="button button-secondary" type="button" ${online ? "" : "disabled"}>Másolás</button></div>
        <button class="button" type="submit" ${online ? "" : "disabled"}>Jelszó beállítása</button>
      </form>
      <p class="lead">${credentialWorkers.has(worker.id) ? "✓ Van beállított jelszó" : "Nincs beállított jelszó"}</p>
    </aside>
    <section class="card admin-content payroll-editor">
      <div><p class="eyebrow">Fizetési adatok</p><h1>${escapeHtml(worker.name)}</h1><p class="lead">Tervezett munka: ${formatHours(worker.scheduledHours)} · alapösszeg korrekció nélkül: ${formatMoney(worker.scheduledHours * hourlyRate)}</p></div>
      <form id="payroll-form">
        <div class="shift-edit-grid">${schedule.shifts.filter((shift) => worker.assignments[shift.id]).map((shift) => {
          const entry = entries.get(shift.id) || {};
          return `<div class="shift-edit"><strong>${escapeHtml(shift.day)} ${escapeHtml(shift.start)}–${escapeHtml(shift.end)}<br /><small>${formatHours(shift.durationHours)}</small></strong><div class="field"><label>Eltérés (óra)</label><input type="number" step="0.25" value="${Number(entry.adjustment_hours || 0)}" data-adjustment="${escapeHtml(shift.id)}" /></div><div class="field"><label>Megjegyzés</label><input type="text" value="${escapeHtml(entry.note || "")}" data-note="${escapeHtml(shift.id)}" placeholder="pl. +1 óra csúsztatás" /></div></div>`;
        }).join("")}</div>
        <div class="admin-actions"><button class="button" type="submit">Turnusadatok mentése</button></div>
      </form>
    </section>
  </div>`;
  bindPayrollAdmin(worker);
}

function bindPayrollAdmin(worker) {
  document.querySelector("#payroll-worker").addEventListener("change", (event) => {
    selectedPayrollWorkerId = event.target.value;
    renderPayrollAdmin();
  });
  document.querySelector("#save-rate").addEventListener("click", saveRate);
  document.querySelector("#generate-worker-password").addEventListener("click", () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const password = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
    const input = document.querySelector("#worker-password-new");
    input.value = password;
    input.type = "text";
    input.focus();
    input.select();
    setStatus("Erős jelszó elkészült. Másold ki és add át a dolgozónak a mentés előtt.");
  });
  document.querySelector("#copy-worker-password").addEventListener("click", async () => {
    const input = document.querySelector("#worker-password-new");
    if (!input.value) return setStatus("Előbb írj be vagy generálj egy jelszót.", "error");
    try {
      await navigator.clipboard.writeText(input.value);
      setStatus("A jelszó a vágólapra másolva.");
    } catch {
      input.type = "text";
      input.select();
      setStatus("A jelszó kijelölve; másold ki a böngésző másolás parancsával.");
    }
  });
  document.querySelector("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("set-password", {
        workerId: worker.id,
        name: worker.name,
        password: document.querySelector("#worker-password-new").value,
      });
      credentialWorkers.add(worker.id);
      setStatus("A személyes jelszó beállítva. Később nem olvasható vissza, csak lecserélhető.");
      renderPayrollAdmin();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  document.querySelector("#payroll-form").addEventListener("submit", (event) => savePayroll(event, worker));
}

async function saveRate() {
  const value = Math.max(0, Number(document.querySelector("#hourly-rate").value || 0));
  try {
    if (online) await api("set-hourly-rate", { hourlyRate: value });
    else localStorage.setItem(localKeys.rate, String(value));
    hourlyRate = value;
    setStatus("Az óradíj mentve.");
    renderPayrollAdmin();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function savePayroll(event, worker) {
  event.preventDefault();
  const entries = schedule.shifts.filter((shift) => worker.assignments[shift.id]).map((shift) => ({
    shift_id: shift.id,
    adjustment_hours: Number(document.querySelector(`[data-adjustment="${CSS.escape(shift.id)}"]`).value || 0),
    note: document.querySelector(`[data-note="${CSS.escape(shift.id)}"]`).value.trim(),
  }));
  try {
    if (online) await api("save-payroll", { workerId: worker.id, entries });
    payrollEntries = payrollEntries.filter((entry) => entry.worker_id !== worker.id);
    payrollEntries.push(...entries.map((entry) => ({ ...entry, worker_id: worker.id })));
    if (!online) localStorage.setItem(localKeys.payroll, JSON.stringify(payrollEntries));
    setStatus("A fizetési turnusadatok mentve.");
    renderPayrollAdmin();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderCostSummaryAdmin() {
  const summary = adminCostSummary(schedule, carRows(), payrollEntries, hourlyRate);
  const drivers = summary.rows.filter((row) => row.trips.length);
  const signedHours = (value) => `${value > 0 ? "+" : ""}${formatHours(value)}`;
  const workspace = document.querySelector("#admin-workspace");
  workspace.innerHTML = `<section class="card admin-content cost-admin-page">
    <div class="cost-heading"><div><p class="eyebrow">Admin pénzügyi áttekintés</p><h1>Költségösszesítő</h1><p class="lead">Személyenkénti munkadíj és utazási díj. Az utazási díj minden útnál kizárólag a kijelölt sofőrhöz adódik hozzá.</p></div><button id="save-travel-fees" class="button" type="button">Utazási díjak mentése</button></div>
    <div class="stats cost-summary-stats">
      <div class="stat"><b>${formatMoney(summary.wages)}</b><span>összes munkadíj</span></div>
      <div class="stat"><b>${formatMoney(summary.travelFees)}</b><span>összes utazási díj</span></div>
      <div class="stat"><b>${formatMoney(summary.total)}</b><span>teljes fizetendő költség</span></div>
      <div class="stat"><b>${formatHours(summary.paidHours)}</b><span>összes elszámolt munka</span></div>
      <div class="stat ${summary.missingTravelFees ? "stat-warning" : ""}"><b>${summary.missingTravelFees}</b><span>díj nélküli sofőrös út</span></div>
    </div>
    ${summary.missingTravelFees ? `<p class="notice">${summary.missingTravelFees} sofőrös útnál még 0 Ft az utazási díj. Ezeket lent sárga jelölés mutatja.</p>` : ""}
    <div class="table-card cost-table-wrap"><table class="payroll-table cost-table">
      <thead><tr><th>Dolgozó</th><th>Tervezett</th><th>Eltérés</th><th>Elszámolt</th><th>Munkadíj</th><th>Utazási díj</th><th>Fizetendő</th><th></th></tr></thead>
      <tbody>${summary.rows.map((row) => `<tr><td><b>${escapeHtml(row.worker.name)}</b></td><td>${formatHours(row.scheduledHours)}</td><td>${signedHours(row.adjustmentHours)}</td><td>${formatHours(row.paidHours)}</td><td>${formatMoney(row.wages)}</td><td>${formatMoney(row.travelFees)}${row.trips.length ? `<br /><small>${row.trips.length} sofőrös út${row.missingTravelFees ? ` · ${row.missingTravelFees} díj nélkül` : ""}</small>` : ""}</td><td><b>${formatMoney(row.total)}</b></td><td><button class="button button-secondary cost-edit-button" type="button" data-cost-worker="${escapeHtml(row.worker.id)}">Fizetés szerkesztése</button></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Összesen</td><td>${formatHours(summary.scheduledHours)}</td><td>${signedHours(summary.adjustmentHours)}</td><td>${formatHours(summary.paidHours)}</td><td>${formatMoney(summary.wages)}</td><td>${formatMoney(summary.travelFees)}</td><td>${formatMoney(summary.total)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="cost-trip-section">
      <div><h2>Utazási díjak utanként</h2><p class="lead">A díj itt és az Autóbeosztások fülön is ugyanazt az adatot módosítja.</p></div>
      ${drivers.length ? `<div class="cost-driver-list">${drivers.map((row) => `<details class="cost-driver-card" ${row.missingTravelFees ? "open" : ""}><summary><span><b>${escapeHtml(row.worker.name)}</b><small>${row.trips.length} sofőrös út</small></span><strong>${formatMoney(row.travelFees)}</strong></summary><div class="cost-trip-list">${row.trips.map((trip) => `<div class="cost-trip-row ${trip.amount <= 0 ? "missing-fee" : ""}"><div><b>${escapeHtml(trip.boundaryLabel)} · ${trip.direction === "arrivals" ? "Érkezés" : "Távozás"}</b><small>Autó ${trip.carIndex + 1}${trip.amount <= 0 ? " · díj megadása szükséges" : ""}</small></div><label class="field"><span>Utazási díj (Ft)</span><input type="number" min="0" step="100" value="${trip.amount}" data-travel-fee-boundary="${escapeHtml(trip.boundaryId)}" data-travel-fee-direction="${trip.direction}" data-travel-fee-index="${trip.carIndex}" aria-label="${escapeHtml(row.worker.name)} utazási díja, ${escapeHtml(trip.boundaryLabel)}" /></label><button class="button button-secondary" type="button" data-cost-car-boundary="${escapeHtml(trip.boundaryId)}" data-cost-car-direction="${trip.direction}">Autó megnyitása</button></div>`).join("")}</div></details>`).join("")}</div>` : '<p class="notice">Még nincs sofőr kijelölve egyetlen úthoz sem.</p>'}
    </div>
  </section>`;
  bindCostSummaryAdmin();
}

function bindCostSummaryAdmin() {
  document.querySelectorAll("[data-cost-worker]").forEach((button) =>
    button.addEventListener("click", () => {
      selectedPayrollWorkerId = button.dataset.costWorker;
      activeTab = "payroll";
      location.hash = "payroll";
      renderAdmin();
    }),
  );
  document.querySelectorAll("[data-cost-car-boundary]").forEach((button) =>
    button.addEventListener("click", () => {
      activeBoundaryId = button.dataset.costCarBoundary;
      activeDirection = button.dataset.costCarDirection;
      activeTab = "cars";
      location.hash = "";
      renderAdmin();
    }),
  );
  document.querySelectorAll("[data-travel-fee-boundary]").forEach((input) =>
    input.addEventListener("input", () => {
      const payload = carsByBoundary.get(input.dataset.travelFeeBoundary);
      const car = payload?.[input.dataset.travelFeeDirection]?.cars?.[Number(input.dataset.travelFeeIndex)];
      if (!car) return;
      const amount = Number(input.value || 0);
      car.fuelFee = Number.isFinite(amount) ? Math.max(0, amount) : 0;
      dirtyTravelFeeBoundaries.add(input.dataset.travelFeeBoundary);
    }),
  );
  document.querySelector("#save-travel-fees").addEventListener("click", saveTravelFees);
}

async function saveTravelFees() {
  if (!dirtyTravelFeeBoundaries.size) {
    setStatus("Nincs mentetlen utazási díj.");
    return;
  }
  try {
    if (online) {
      for (const boundaryId of dirtyTravelFeeBoundaries) {
        await api("save-cars", { boundaryId, payload: clone(carsByBoundary.get(boundaryId) || blankPayload()) });
      }
    } else {
      localStorage.setItem(localKeys.cars, JSON.stringify(carRows()));
    }
    dirtyTravelFeeBoundaries.clear();
    setStatus("Az utazási díjak mentve.");
    renderCostSummaryAdmin();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function boot() {
  try {
    const response = await fetch("../data/schedule.json", { cache: "no-store" });
    if (!response.ok) throw new Error("A beosztás nem tölthető be.");
    schedule = await response.json();
    workersById = new Map(schedule.workers.map((worker) => [worker.id, worker]));
    activeBoundaryId = schedule.boundaries[0]?.id || "";
    if (online) renderLogin();
    else {
      await bootstrapLocal();
      setStatus("");
      renderAdmin();
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}

boot();
