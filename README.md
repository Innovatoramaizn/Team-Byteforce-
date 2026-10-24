# SignalLoop

Campus issue reporting. Students report problems (broken lights, leaks, bins) and
track them; campus admins triage, assign and resolve them.

Plain HTML, CSS and JavaScript on the front end: no framework, no frontend
dependencies and no build step required to run it. The `backend/` folder holds a
Flask + PostgreSQL + JWT API that is the source of truth for accounts and
incidents (see [backend/README.md](backend/README.md)).

**Deploying?** See [DEPLOYMENT.md](DEPLOYMENT.md): the static site goes to
Freebuff Sites (`npm run build` + `site.manifest.json`, Worker `worker.js`
proxying `/api/*`) or to Vercel (`vercel.json`, same `/api` proxy done with
rewrites), and the Flask API goes to any Python + PostgreSQL host
(`gunicorn run:app`, `flask db upgrade`, `flask create-admin`).

## Run it

1. Start the API first (PostgreSQL must be available) — see
   [backend/README.md](backend/README.md) for one-time setup:

   ```bash
   cd backend
   flask --app run.py run --debug --host 127.0.0.1 --port 5000
   curl -i http://127.0.0.1:5000/api/health   # expect {"status":"ok",...}
   ```

2. Serve the front end (port 3000 is on the backend's CORS allowlist):

   ```bash
   npm start          # npx serve . -l 3000
   # or: python3 -m http.server 3000
   ```

   Then open http://localhost:3000.

Google Fonts (Manrope, Inter) load from the internet; offline, the app falls back
to system fonts.

## Accounts

- **Students:** create your own account on the sign-in screen (full name, email,
  password of at least 12 characters). Public registration always creates a
  student account.
- **Campus admins:** created by campus operations through the Flask CLI
  (`flask create-admin` inside `backend/`), never through the website.

Sign-in uses `POST /api/auth/login`; the JWT access token is kept in
`sessionStorage` and expires after 30 minutes, after which the app returns you
to the sign-in screen.

### Which API the front end talks to

`src/config.js` (loaded before `src/api.js`) can pin the API URL. Left empty,
`src/api.js` picks it automatically:

- page served from `localhost` / `127.0.0.1` → `http://127.0.0.1:5000/api`
- anywhere else → `/api`, proxied by `worker.js` to the backend origin in the
  site's `API_ORIGIN` variable (same-origin, so no CORS is involved)

## Layout

| Path              | What it holds                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `index.html`      | Page shell                                                                                     |
| `src/api.js`      | API client: auth, incidents, admin overview; token in `sessionStorage`, 401/403 handling       |
| `src/config.js`   | Optional override for the API base URL                                                          |
| `worker.js`       | Serves the static site and proxies `/api/*` to the backend                                      |
| `site.manifest.json` | Deployment manifest for Freebuff Sites (Worker entrypoint + `dist/` assets)                  |
| `vercel.json`    | Vercel config: builds `dist/`, rewrites `/api/*` to the backend                                |
| `scripts/build.mjs`  | `npm run build` → copies the public files into `dist/`                                      |
| `src/app.js`      | Student and admin screens, hash router (`#/s/home`, `#/a/queue`, ...), event handlers          |
| `src/styles.css`  | Colour tokens (light and dark), components, responsive rules                                   |
| `assets/logo.png` | Logo and favicon                                                                               |
| `backend/`        | Flask API (PostgreSQL, SQLAlchemy, Alembic migrations, JWT) with its own README                |

Screens are functions that return HTML strings (`studentScreens`, `adminScreens`).
Click handlers live in `actions` and are picked by the `data-act` attribute.
Incident keys are the server's short aliases (`t`, `c`, `l`, `p`, `s`, `m`, `d`,
`dept`, `due`, `ph`); timestamps arrive as ISO `created_at` and are formatted
client-side into relative labels.

## Data model

Incidents, accounts and audit trails live in PostgreSQL via the API. Frontend
only keeps a report *draft* (`sessionStorage.sl-draft`) so a half-written report
survives a reload, plus the theme choice in `localStorage`. Clear browsing data
or sessionStorage to reset that.

Responsive: phone (bottom tab bar), tablet, and desktop (sidebar layouts for both
roles).

## Limits

- Photo upload isn't in the API yet: a chosen photo is previewed/silently kept on
  your device only (shrunk to a small canvas image) and never sent to the server.
- Reporter progress updates, notification delivery, profile editing and push/email
  aren't available; the resolution screen's work notes aren't persisted yet.
- "Duplicate review" candidates are computed client-side from shared locations
  and word overlap. A decision is recorded server-side via
  `POST /api/incidents/<id>/duplicate-reviews` and read back from the audit trail,
  so reviewed pairs stay hidden after a reload. It does not merge or close reports.
- The admin screens (overview, queue, triage, departments, maintenance, analytics)
  are built from `GET /api/incidents` and `GET /api/admin/overview`, and refresh
  every 30 seconds. Triage saves status, priority, department and due date with
  `PATCH /api/incidents/<id>`; the history comes from the audit trail.
- Departments, categories, locations and priority levels are fixed lists that the
  server validates, so there are no editors for them. Assignment records a
  department, not an individual assignee.
- AI summaries are simple keyword rules, not a model.
- The backend rejects unsupported categories, locations, priorities and direct
  role escalation; access control is enforced server-side, not just in the UI.

## Next steps

Photo upload, reporter updates, notifications and pagination are natural
follow-on work in `backend/app/` (models + a migration) before the frontend can
switch those screens on.

## Formatting

`npm run format` (uses the settings in `.prettierrc`).
