"use strict";
const UNIT_MS = { minutes: 60e3, hours: 3600e3, days: 86400e3, weeks: 7 * 86400e3 };
const $ = (id) => document.getElementById(id);

let reminders = [];
let contacts = [];
let editingId = null;
let editingContact = null;

/* ---------- storage: server file data/data.json via /api/data ---------- */
let loaded = false;      // never write before a successful load (would wipe the file)
let saveTimer = null;
let saving = Promise.resolve();

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
async function writeNow() {
  const res = await fetch("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reminders, contacts }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}
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
function save() { persist(); }
function saveContacts() { persist(); }
const contactOf = (r) => contacts.find((c) => c.id === r.contactId);
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
function fmt(ms) {
  return ms == null ? "—" : new Date(ms).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" });
}
const T24 = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    c.onclick = () => openDialog(r.id);
    grid.append(c);
  }
  $("empty").hidden = reminders.length > 0;
}

/* ---------- contacts ---------- */
function fillSelect(sel, first, selectedId) {
  sel.replaceChildren(new Option(first, ""));
  for (const c of contacts) sel.append(new Option(c.name, c.id));
  sel.value = contacts.some((c) => c.id === selectedId) ? selectedId : "";
}
function refreshContactSelects(pickId) {
  fillSelect($("contactSel"), "— no person —", pickId ?? $("contactSel").value);
  fillSelect($("filterSel"), "All people", $("filterSel").value);
  $("filterBar").hidden = contacts.length === 0;
}
function resetContactForm() {
  editingContact = null;
  $("contactForm").reset();
  $("cfTitle").textContent = "Add person";
  $("cSaveBtn").textContent = "Add";
  $("cResetBtn").hidden = true;
}
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
function openContacts() {
  resetContactForm();
  renderContacts();
  $("contactsDlg").showModal();
}
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
$("contactsBtn").onclick = () => { delete $("contactsDlg").dataset.pick; openContacts(); };
$("addPersonBtn").onclick = () => { $("contactsDlg").dataset.pick = "1"; openContacts(); };
$("cCloseBtn").onclick = () => $("contactsDlg").close();
$("cResetBtn").onclick = resetContactForm;
$("filterSel").addEventListener("change", render);

/* ---------- dialog ---------- */
function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function setDateAt(v) {
  [$("dateDay").value, $("dateTime").value] = v.split("T");
}
function showOpt() {
  const type = document.querySelector('input[name=type]:checked').value;
  document.querySelectorAll(".opt").forEach((o) => (o.hidden = o.dataset.for !== type));
}
function openDialog(id) {
  editingId = id || null;
  const r = reminders.find((x) => x.id === id);
  $("dlgTitle").textContent = r ? "Edit reminder" : "New reminder";
  $("delBtn").hidden = !r;
  $("err").hidden = true;
  $("form").reset();
  setDateAt(toLocalInput(Date.now() + 3600e3));
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
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
});

$("newBtn").onclick = () => openDialog(null);
$("cancelBtn").onclick = () => $("dlg").close();
$("delBtn").onclick = () => {
  reminders = reminders.filter((x) => x.id !== editingId);
  save(); render(); $("dlg").close();
};
document.querySelectorAll("input[name=type]").forEach((i) => i.addEventListener("change", showOpt));

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
