# SignalLoop

Campus issue reporting. Students report problems (broken lights, leaks, bins),
attach a photo and track them; campus admins triage, assign and resolve them.

- **Front end:** plain HTML, CSS and JavaScript. No framework and no runtime
  dependencies. Deployed as a static site (Netlify).
- **Back end:** `backend/`, a Flask + PostgreSQL + JWT API. It is the source of truth
  for accounts, incidents, photos and the audit trail. Deployed on Render.

There is no demo data: every account, report and photo comes from the API.

## Project layout

| Path | What it holds |
| --- | --- |
| `index.html`, `src/`, `assets/` | The website. `src/api.js` is the API client, `src/app.js` the screens, `src/config.js` the API address |
| `scripts/build.js` | `npm run build`: copies the site into `dist/` and writes the API address into it |
| `netlify.toml` | Netlify build settings and security headers |
| `render.yaml` | Render Blueprint: API service + PostgreSQL database |
| `backend/` | Flask API, migrations, tests ([backend/README.md](backend/README.md)) |

## Run it locally

You need Python 3.12+ and Node 18+. PostgreSQL is optional for local work: SQLite is
used if you point `DATABASE_URL` at it (Windows PowerShell shown; use `export` on macOS/Linux).

```powershell
# 1. API (window 1)
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
$env:DATABASE_URL = "sqlite:///signalloop-local.db"     # creates backend/instance/signalloop-local.db
flask --app run.py create-admin                          # asks for email, name, password (12+ chars)
flask --app run.py run --host 127.0.0.1 --port 5000

# 2. Website (window 2, from the project root)
npm start                                                # http://localhost:3000
```

Open http://localhost:3000. The API must be running first; check
http://127.0.0.1:5000/api/health. The local API accepts requests from ports 3000 and
5500 only; if `npm start` picks another port, free port 3000 or add the origin to `CORS_ORIGINS`.
Set `DATABASE_URL` again in every new terminal, or use a `backend/.env` file
(see `backend/.env.example`).

Run the API tests (no database server needed):

```powershell
cd backend
python -m unittest discover -s tests -v
```

## Deploy

The site and the API are deployed separately: **Render** for the API and database,
**Netlify** for the website. Push this repository to GitHub first (the repository
root is the folder that contains `render.yaml`).

### 1. API on Render

1. Render dashboard, **New**, **Blueprint**, pick your repository. Render reads `render.yaml`
   and shows the API service and the database it will create.
2. It asks for three values:
   - `CORS_ORIGINS`: your website address. You don't have it yet, so enter
     `https://placeholder.netlify.app` for now and change it in step 3.
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: the first campus admin (password 12+ characters).
3. Wait for the deploy. On every start the service applies database migrations,
   creates the admin if it doesn't exist yet, then serves the API with gunicorn.
4. Open `https://YOUR-API.onrender.com/api/health`. It should show
   `{"database":"connected","status":"ok"}`. Copy this address.

### 2. Website on Netlify

1. **Add new site**, **Import an existing project**, pick the same repository. Netlify reads
   `netlify.toml` (build command `npm run build`, publish folder `dist`).
2. Under **Site configuration, Environment variables**, add
   `API_BASE_URL` = `https://YOUR-API.onrender.com` (with or without `/api`).
3. Deploy. The build stops with a clear message if `API_BASE_URL` is missing, is not
   `https://`, or is malformed, so a site that points at the wrong place can't go live.

### 3. Connect them

1. In Render, open the API service, **Environment**, and set `CORS_ORIGINS` to your exact
   Netlify address, for example `https://your-site.netlify.app`. Add a custom domain too
   if you have one, separated by a comma. Render redeploys automatically.
2. Open your Netlify site and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Once you can sign in, **delete the `ADMIN_PASSWORD` variable** in Render. It is only
   used to create the account the first time; the account keeps working without it.

If you change the API address later, change `API_BASE_URL` in Netlify and trigger a new deploy.

### Free-tier behaviour to know about

Based on Render's documentation for free instances:

- A free API service sleeps after 15 minutes without traffic. The first request after that
  takes about a minute, and the app shows its "can't reach the server" message until the API wakes.
- A free service's disk is wiped on every restart and deploy. SignalLoop therefore stores
  photos inside PostgreSQL, so they survive.
- A free PostgreSQL database expires 30 days after creation (with a short grace period)
  and holds 1 GB. Move the database to a paid plan before then, or you will lose your data.
  For a real campus deployment, use paid plans.

## Configuration reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `API_BASE_URL` | Netlify (build) | Address of the deployed API |
| `APP_ENV=production` | Render (set by `render.yaml`) | Strict startup checks; the API refuses to start with weak secrets, SQLite, `*` in CORS, or debug on |
| `DATABASE_URL` | Render (from the database) | `postgres://` and `postgresql://` URLs are accepted as-is |
| `SECRET_KEY`, `JWT_SECRET_KEY` | Render (generated) | Two different random values, 32+ characters |
| `CORS_ORIGINS` | Render | Exact website origin(s), comma separated |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Render | Optional first-admin bootstrap |
| `JWT_ACCESS_TOKEN_EXPIRES_MINUTES` | Render (optional) | Session length, default 30 |

## Accounts

- **Students** create their own account on the sign-in screen. Registration always creates a
  student; the role is never taken from the request.
- **Campus admins** are created by `flask --app run.py create-admin` (interactive), or by the
  `ADMIN_*` variables on hosts without a shell. They can't be created through the website.

Sessions use a JWT kept in `sessionStorage` that expires after 30 minutes, after which the app
returns to sign-in. Access control is enforced by the API, not only by the screens.

## Limits

- **Photos:** one JPEG per report, up to 4 MB (the browser shrinks photos before uploading).
  Students attach it when submitting; there is no way to add one later.
- **No password reset or email verification**, no email/push notifications, and no refresh
  tokens or token revocation. Changing an account's role takes effect after the user's next sign-in.
- **No rate limiting** on sign-in. Put the API behind a service that provides it before
  opening the site to the public.
- **Lists are not paginated**: the API returns every incident the user may see.
- **Priority** is set by admins when they triage; students can't choose it.
- **Duplicate review** pairs are computed in the browser from shared location and word overlap.
  A decision is recorded in the audit trail; it does not merge or close reports.
- **Departments, categories, locations and priority levels** are fixed lists validated by the
  server, so there are no editors for them. Assignment records a department, not a person.
- The resolution screen records only the status change; work notes aren't stored.
- Admin screens refresh every 30 seconds; there is no live push.
- No Content-Security-Policy header is set yet. Security headers in `netlify.toml` cover
  MIME sniffing, framing and referrers.

## Troubleshooting

- **"Can't reach the SignalLoop server"** is shown for any failed request. Open
  `YOUR-API/api/health` in a browser tab. If it doesn't load, the API is asleep or down
  (check the Render logs). If it loads, press F12 and look at the Console: a message about
  CORS means `CORS_ORIGINS` doesn't match the website address exactly; "mixed content" means
  `API_BASE_URL` starts with `http://`.
- **Render deploy fails at start** with "Refusing to start with an unsafe production
  configuration": the log lists exactly which setting to fix.
- **Photo upload fails**: only JPEG files up to 4 MB are accepted.

## Formatting

`npm run format` (settings in `.prettierrc`).
