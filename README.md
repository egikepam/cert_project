# Notes & Reminders

Simple browser app for notes with reminders. Data is saved in `data/data.json` inside the project, so it survives closing the browser.

## Run
Requires Node.js (no packages to install):

```
npm start        # or: node server.js
```
Then open http://localhost:3000. Set `PORT` to use another port. Opening `index.html` directly no longer works (it cannot write files).

**Backup:** copy `data/data.json`. Data from the older browser-storage version is imported automatically on first run.

## Use
- **+ New reminder** creates a card; click a card to edit or delete it.
- Per reminder: text, background colour (green / yellow / red), and alarm timing:
  - **Specific date** – exact date and time
  - **Relative** – in N minutes / hours / days
  - **Repeating** – every N minutes/hours/days/weeks, or on chosen weekdays at a set time
- **👤 Contacts** manages a reusable list of people (name + company/role/notes). Pick a person per reminder (or use "+ New person" in the form); the card, alarm banner and notification show them. Use the "Person" filter above the cards to see one person's reminders. Deleting a contact unlinks it from its reminders.
- Alarms show an in-page banner, a beep, and a browser notification (if permitted).

## Limitations
Alarms fire only while the page is open in a browser tab. Reminders missed while it was closed fire when it is next opened.
