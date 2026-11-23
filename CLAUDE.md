# CLAUDE.md

Notes & Reminders: a small browser app for notes with alarms. Vanilla HTML/CSS/JS client (no framework, no build step) plus a zero-dependency Node `http` server. Data is stored in `data/data.json`. See README.md for end-user usage.

## Commands
- Run: `npm start` (or `node server.js`), then open http://localhost:3000. `PORT` env var overrides the port.
- No install step, tests or linter. Syntax check: `node --check app.js` and `node --check server.js`.
- Opening `index.html` directly does not work; the page needs the server's `/api/data`.

## Files
- `server.js`: serves a static whitelist (`/`, `/index.html`, `/app.js`, `/style.css`) and `GET/PUT /api/data`. 1 MB body limit, atomic write (tmp file + rename), binds to 127.0.0.1. **New static files must be added to the `STATIC` map.**
- `app.js`: state (`reminders`, `contacts`), storage layer (`loadAll`, `writeNow`, debounced and serialized `persist`, `loaded` guard), scheduling (`initialNext`, `advance`, `nextWeekday`), alarms (`tick` every 1 s, `fire`, `beep`), rendering (`render`, `describe`, `fmt`), contacts, reminder dialog (`openDialog`, `readSchedule`).
- `index.html`, `style.css`: markup and styles (`bg-green`, `bg-yellow`, `bg-red`).
- `data/data.json`: runtime data, git-ignored.

## Data model
- Reminder: `{id, text, color, contactId, schedule, nextAt, fired}`; `nextAt` is a ms epoch computed on save, `fired` marks completed one-offs.
- Schedule: `{type:"date", at}`, `{type:"relative", amount, unit}`, `{type:"repeat", mode:"interval", amount, unit}` or `{type:"repeat", mode:"weekdays", days, time}`.
- Contact: `{id, name, info}`. Deleting a contact sets `contactId = null` on its reminders.
- Times are 24h `HH:MM` text inputs validated by `T24`; display uses `fmt` (en-GB, 24h).

## Conventions
- Never write before a successful load (`loaded` flag), so an unreachable server cannot wipe saved data.
- After changing state call `save()` / `saveContacts()`, then `render()`.
- Alarms fire only while the page is open. Old localStorage keys (`reminders`, `contacts`) are migrated into the file once.
- Every function has a one-line comment describing its action; keep this when adding code.

## Git
- `data/` is git-ignored (personal data); never commit it.
- Remote `origin` is `https://github.com/egikepam/cert_project.git` (private). Repo-local git identity is set.
- Without a global credential helper, push with: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`.
- Commit or push only when asked.

## Known issues (from code review, not yet fixed)
- `PUT /api/data` has no Content-Type/Origin check.
- A corrupt `data.json` is read as empty, and the next save overwrites it.
- Editing a reminder recalculates its alarm time and re-arms `fired`.
- Saves made within 200 ms of closing the tab are lost.
- Two open tabs overwrite each other's changes.
- `beep()` creates a new AudioContext on every alarm.
