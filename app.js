"use strict";
// Notes & Reminders — browser client.
// Shows reminder cards, lets the user create/edit/delete them and manage contacts,
// fires alarms while the page is open, and saves everything to the server (data/data.json).

// Milliseconds per time unit; used to turn "N <unit>" into a timestamp offset.
const UNIT_MS = { minutes: 60e3, hours: 3600e3, days: 86400e3, weeks: 7 * 86400e3 };
// Shorthand for document.getElementById.
const $ = (id) => document.getElementById(id);

// In-memory state (mirrors data/data.json).
let reminders = [];
let contacts = [];
let editingId = null;       // id of the reminder open in the dialog (null = creating a new one)
let editingContact = null;  // id of the contact being edited in the contacts form (null = adding)

/* ---------- storage: server file data/data.json via /api/data ---------- */
let loaded = false;      // never write before a successful load (would wipe the file)
let saveTimer = null;    // debounce timer for persist()
let saving = Promise.resolve(); // chain that serializes writes so they never overlap

// Show (or hide, when msg is empty) the red banner at the top of the page.
function showStorageError(msg) {
  let b = $("storageErr");
  if (!b) {
    b = document.createElement("div");
    b.id = "storageErr";
    b.className = "storage-err";
    document.body.prepend(b);
  }
  b.textContent = msg;
  b.hidden = !msg;
}
// Load reminders and contacts from the server; on first run, import old localStorage data.
async function loadAll() {
  const res = await fetch("/api/data", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const d = await res.json();
  reminders = d.reminders;
  contacts = d.contacts;
  // One-time migration from the old localStorage storage
  if (!reminders.length && !contacts.length) {
    try {
      const r = JSON.parse(localStorage.getItem("reminders")) || [];
      const c = JSON.parse(localStorage.getItem("contacts")) || [];
      if (r.length || c.length) {
        reminders = r; contacts = c;
        await writeNow();
        localStorage.removeItem("reminders");
        localStorage.removeItem("contacts");
      }
    } catch (e) { console.warn("Migration skipped", e); }
  }
  loaded = true;
}
// Send the full current state to the server (PUT /api/data). Throws if the server rejects it.
async function writeNow() {
  const res = await fetch("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reminders, contacts }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}
// Schedule a save ~200 ms from now (restarts on every call); shows/clears the error banner on failure/success.
function persist() {
  if (!loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(writeNow).then(
      () => showStorageError(""),
      (e) => { console.error(e); showStorageError("Server not reachable — changes are NOT saved. Start it with: node server.js"); }
    );
  }, 200);
}
// Call after changing reminders / contacts; both just trigger a save.
function save() { persist(); }
function saveContacts() { persist(); }
// Find the contact linked to a reminder (undefined if none).
const contactOf = (r) => contacts.find((c) => c.id === r.contactId);
// Generate a unique id for a new reminder or contact.
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/* ---------- scheduling ---------- */
// Next occurrence of a weekday/time schedule strictly after `after`.
function nextWeekday(days, time, after) {
  const [h, m] = time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(after);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (days.includes(d.getDay()) && d.getTime() > after) return d.getTime();
  }
  return null;
}
// Compute first nextAt for a schedule on save.
function initialNext(s, now) {
  if (s.type === "date") return new Date(s.at).getTime();
  if (s.type === "relative") return now + s.amount * UNIT_MS[s.unit];
  if (s.mode === "weekdays") return nextWeekday(s.days, s.time, now);
  return now + s.amount * UNIT_MS[s.unit];
}
// Next nextAt after a repeat fires.
function advance(r, now) {
  const s = r.schedule;
  if (s.mode === "weekdays") return nextWeekday(s.days, s.time, now);
  const step = s.amount * UNIT_MS[s.unit];
  let n = r.nextAt + step;
  if (n <= now) n += Math.ceil((now - n) / step + 0.0001) * step; // skip missed slots
  return n;
}

/* ---------- alarms ---------- */
// Runs every second: fires every reminder that is due, then reschedules repeats or marks one-offs as done.
function tick() {
  const now = Date.now();
  let changed = false;
  for (const r of reminders) {
    if (r.fired || r.nextAt == null || r.nextAt > now) continue;
    fire(r);
    if (r.schedule.type === "repeat") r.nextAt = advance(r, now);
    else r.fired = true;
    changed = true;
  }
  if (changed) { save(); render(); }
}
// Show the alarm banner (with Dismiss button), beep, and send a browser notification if permitted.
function fire(r) {
  const box = document.createElement("div");
  box.className = "alert bg-" + r.color;
  const t = document.createElement("span");
  const p = contactOf(r);
  t.textContent = "⏰ " + (p ? p.name + ": " : "") + r.text;
  const x = document.createElement("button");
  x.textContent = "Dismiss";
  x.onclick = () => box.remove();
  box.append(t, x);
  $("alerts").append(box);
  beep();
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(p ? "Reminder · " + p.name : "Reminder", { body: r.text });
  }
}
// Play a short 880 Hz tone (0.3 s).
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.connect(ctx.destination);
    o.frequency.value = 880;
    o.start();
    o.stop(ctx.currentTime + 0.3);
  } catch { /* audio may be blocked until user interaction */ }
}

/* ---------- rendering ---------- */
// Build the one-line timing text shown on a card (done / repeat rule / next time).
function describe(r) {
  const s = r.schedule;
  if (r.fired) return "Done (" + fmt(r.nextAt) + ")";
  if (s.type === "repeat") {
    const rep = s.mode === "weekdays"
      ? "weekly on " + s.days.map((d) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ") + " " + s.time
      : "every " + s.amount + " " + s.unit;
    return "🔁 " + rep + " · next " + fmt(r.nextAt);
  }
  return "🕒 " + fmt(r.nextAt);
}
// Format a timestamp as a short 24-hour date/time ("—" when empty).
function fmt(ms) {
  return ms == null ? "—" : new Date(ms).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" });
}
// Valid 24-hour time: HH:MM, 00:00–23:59.
const T24 = /^([01]\d|2[0-3]):[0-5]\d$/;

// Redraw all reminder cards: pending first (soonest first), done last, honouring the person filter.
function render() {
  const grid = $("grid");
  grid.replaceChildren();
  const sorted = [...reminders].sort((a, b) => (a.fired - b.fired) || ((a.nextAt ?? 0) - (b.nextAt ?? 0)));
  const filter = $("filterSel").value;
  for (const r of sorted) {
    if (filter && r.contactId !== filter) continue;
    const c = document.createElement("div");
    c.className = "card bg-" + r.color + (r.fired ? " done" : "");
    const t = document.createElement("div");
    t.className = "txt";
    t.textContent = r.text;
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = describe(r);
    c.append(t);
    const p = contactOf(r);
    if (p) {
      const w = document.createElement("div");
      w.className = "who";
      w.textContent = "👤 " + p.name;
      if (p.info) {
        const s = document.createElement("small");
        s.textContent = " — " + p.info;
        w.append(s);
      }
      c.append(w);
    }
    c.append(m);
    c.onclick = () => openDialog(r.id); // clicking a card opens it for editing
    grid.append(c);
  }
  $("empty").hidden = reminders.length > 0;
}

/* ---------- contacts ---------- */
// Fill a <select> with a first placeholder option plus all contacts; keep selectedId if it still exists.
function fillSelect(sel, first, selectedId) {
  sel.replaceChildren(new Option(first, ""));
  for (const c of contacts) sel.append(new Option(c.name, c.id));
  sel.value = contacts.some((c) => c.id === selectedId) ? selectedId : "";
}
// Refresh the person dropdown in the reminder dialog and the filter bar (hidden when there are no contacts).
function refreshContactSelects(pickId) {
  fillSelect($("contactSel"), "— no person —", pickId ?? $("contactSel").value);
  fillSelect($("filterSel"), "All people", $("filterSel").value);
  $("filterBar").hidden = contacts.length === 0;
}
// Put the contacts form back into "Add person" mode.
function resetContactForm() {
  editingContact = null;
  $("contactForm").reset();
  $("cfTitle").textContent = "Add person";
  $("cSaveBtn").textContent = "Add";
  $("cResetBtn").hidden = true;
}
// Redraw the contacts list with Edit / Delete buttons for each person.
function renderContacts() {
  const ul = $("contactList");
  ul.replaceChildren();
  for (const c of contacts) {
    const li = document.createElement("li");
    const ci = document.createElement("span");
    ci.className = "ci";
    ci.textContent = c.name;
    if (c.info) {
      const s = document.createElement("small");
      s.textContent = c.info;
      ci.append(s);
    }
    const eb = document.createElement("button");
    eb.textContent = "Edit";
    // Edit: load this person into the form below the list.
    eb.onclick = () => {
      editingContact = c.id;
      $("cName").value = c.name;
      $("cInfo").value = c.info || "";
      $("cfTitle").textContent = "Edit person";
      $("cSaveBtn").textContent = "Save";
      $("cResetBtn").hidden = false;
    };
    const db = document.createElement("button");
    db.className = "danger";
    db.textContent = "Delete";
    // Delete: confirm, remove the contact and unlink it from any reminders that used it.
    db.onclick = () => {
      const used = reminders.filter((r) => r.contactId === c.id).length;
      const msg = used ? `Delete ${c.name}? ${used} reminder(s) will lose this person.` : `Delete ${c.name}?`;
      if (!confirm(msg)) return;
      contacts = contacts.filter((x) => x.id !== c.id);
      reminders.forEach((r) => { if (r.contactId === c.id) r.contactId = null; });
      saveContacts(); save();
      if (editingContact === c.id) resetContactForm();
      renderContacts(); refreshContactSelects(); render();
    };
    li.append(ci, eb, db);
    ul.append(li);
  }
  $("noContacts").hidden = contacts.length > 0;
}
// Open the contacts dialog with a clean form and a fresh list.
function openContacts() {
  resetContactForm();
  renderContacts();
  $("contactsDlg").showModal();
}
// Add or update a person; if opened via "+ New person", select them in the reminder dialog afterwards.
$("contactForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("cName").value.trim();
  const info = $("cInfo").value.trim();
  if (!name) return;
  let id = editingContact;
  if (id) Object.assign(contacts.find((c) => c.id === id), { name, info });
  else { id = newId(); contacts.push({ id, name, info }); }
  saveContacts();
  resetContactForm();
  renderContacts();
  refreshContactSelects($("contactsDlg").dataset.pick ? id : undefined);
  render();
});
// Header "Contacts" button: open the dialog in plain management mode.
$("contactsBtn").onclick = () => { delete $("contactsDlg").dataset.pick; openContacts(); };
// "+ New person" inside the reminder dialog: open contacts and remember to pick the new person.
$("addPersonBtn").onclick = () => { $("contactsDlg").dataset.pick = "1"; openContacts(); };
$("cCloseBtn").onclick = () => $("contactsDlg").close();
$("cResetBtn").onclick = resetContactForm;
// Changing the person filter just redraws the cards.
$("filterSel").addEventListener("change", render);

/* ---------- dialog ---------- */
// Convert a timestamp to local "YYYY-MM-DDTHH:MM" text (for the date + time inputs).
function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
// Split "YYYY-MM-DDTHH:MM" into the date and time inputs.
function setDateAt(v) {
  [$("dateDay").value, $("dateTime").value] = v.split("T");
}
// Show only the option block that matches the selected timing type.
function showOpt() {
  const type = document.querySelector('input[name=type]:checked').value;
  document.querySelectorAll(".opt").forEach((o) => (o.hidden = o.dataset.for !== type));
}
// Open the reminder dialog: empty form with defaults for a new reminder, or filled in for an existing id.
function openDialog(id) {
  editingId = id || null;
  const r = reminders.find((x) => x.id === id);
  $("dlgTitle").textContent = r ? "Edit reminder" : "New reminder";
  $("delBtn").hidden = !r;
  $("err").hidden = true;
  $("form").reset();
  setDateAt(toLocalInput(Date.now() + 3600e3)); // default: one hour from now
  document.querySelectorAll("#wdays input").forEach((c) => (c.checked = false));
  if (r) {
    const s = r.schedule;
    $("text").value = r.text;
    document.querySelector(`input[name=color][value=${r.color}]`).checked = true;
    document.querySelector(`input[name=type][value=${s.type}]`).checked = true;
    if (s.type === "date") setDateAt(s.at);
    if (s.type === "relative") { $("relAmount").value = s.amount; $("relUnit").value = s.unit; }
    if (s.type === "repeat") {
      document.querySelector(`input[name=rmode][value=${s.mode}]`).checked = true;
      if (s.mode === "interval") { $("repAmount").value = s.amount; $("repUnit").value = s.unit; }
      else {
        $("repTime").value = s.time;
        document.querySelectorAll("#wdays input").forEach((c) => (c.checked = s.days.includes(+c.value)));
      }
    }
  }
  fillSelect($("contactSel"), "— no person —", r ? r.contactId : "");
  showOpt();
  $("dlg").showModal();
}
// Read and validate the timing fields; returns a schedule object, or an error message string.
function readSchedule() {
  const type = document.querySelector("input[name=type]:checked").value;
  if (type === "date") {
    if (!$("dateDay").value) return "Pick a date.";
    if (!T24.test($("dateTime").value)) return "Time must be 24h HH:MM (e.g. 14:30).";
    return { type, at: $("dateDay").value + "T" + $("dateTime").value };
  }
  if (type === "relative") {
    const amount = +$("relAmount").value;
    if (!(amount > 0)) return "Enter a positive amount.";
    return { type, amount, unit: $("relUnit").value };
  }
  const mode = document.querySelector("input[name=rmode]:checked").value;
  if (mode === "interval") {
    const amount = +$("repAmount").value;
    if (!(amount > 0)) return "Enter a positive interval.";
    return { type, mode, amount, unit: $("repUnit").value };
  }
  const days = [...document.querySelectorAll("#wdays input:checked")].map((c) => +c.value);
  if (!days.length) return "Select at least one weekday.";
  if (!T24.test($("repTime").value)) return "Time must be 24h HH:MM (e.g. 14:30).";
  return { type, mode, days, time: $("repTime").value };
}

// Save button: validate, then create a new reminder or update the one being edited.
// The alarm time is recalculated from the schedule and the reminder is re-armed (fired = false).
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  const schedule = readSchedule();
  const err = !text ? "Text is required." : typeof schedule === "string" ? schedule : null;
  if (err) { $("err").textContent = err; $("err").hidden = false; return; }

  const now = Date.now();
  const color = document.querySelector("input[name=color]:checked").value;
  const nextAt = initialNext(schedule, now);
  const contactId = $("contactSel").value || null;
  if (editingId) {
    Object.assign(reminders.find((x) => x.id === editingId), { text, color, contactId, schedule, nextAt, fired: false });
  } else {
    reminders.push({ id: newId(), text, color, contactId, schedule, nextAt, fired: false });
  }
  save();
  render();
  $("dlg").close();
  // Ask for notification permission the first time a reminder is saved.
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
});

// Button handlers: new reminder, cancel the dialog, delete the reminder being edited.
$("newBtn").onclick = () => openDialog(null);
$("cancelBtn").onclick = () => $("dlg").close();
$("delBtn").onclick = () => {
  reminders = reminders.filter((x) => x.id !== editingId);
  save(); render(); $("dlg").close();
};
// Switching the timing type (date / relative / repeating) swaps the visible options.
document.querySelectorAll("input[name=type]").forEach((i) => i.addEventListener("change", showOpt));

// Startup: load saved data, draw the UI and start the 1-second alarm check.
// If the server can't be reached, show an error and disable editing so saved data isn't overwritten.
async function init() {
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    showStorageError("Cannot load data — start the server with: node server.js (then open http://localhost:3000). Editing is disabled to protect saved data.");
    $("newBtn").disabled = true;
    $("contactsBtn").disabled = true;
    return;
  }
  refreshContactSelects();
  render();
  tick();
  setInterval(tick, 1000);
}
init();
