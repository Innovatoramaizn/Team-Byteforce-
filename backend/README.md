# SignalLoop Flask API (local development)

This is the first backend foundation for the existing plain HTML/CSS/JS frontend. It uses Flask, PostgreSQL, SQLAlchemy, Flask-Migrate/Alembic, and JWT bearer tokens. Public registration always creates a `student`; it never accepts a role from the request. Create admins through the Flask CLI.

## Included

- Password hashes (Werkzeug; plaintext passwords are never stored).
- JWT access tokens (30-minute default expiry).
- Student-owned incident listing/detail; admins can list all incidents.
- Incident create, admin update/assignment/status change, admin audit trail, duplicate review records.
- `/api/health` database connectivity check.
- Initial PostgreSQL Alembic migration.
- CORS allowlist for common local frontend ports (configurable with `CORS_ORIGINS`; unnecessary when the site proxies `/api` through its Worker).
- Production startup guard: outside development the app refuses to boot while `SECRET_KEY` / `JWT_SECRET_KEY` still hold placeholder values.
- `flask create-admin --email ... --name ... --password ...` for non-interactive admin creation during a deploy.

Deployment (gunicorn, migrations, health check, environment variables) is covered in [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Not included yet

Rate limiting, refresh tokens, token revocation/versioning, email verification, password reset, AI categorisation, notifications, pagination, a public campus-wide explore endpoint, and per-user upload storage (photos currently land in `backend/instance/`, which needs a persistent disk when hosted). JWT role claims are checked by routes, and an account's role should not be changed manually without invalidating outstanding tokens. Add token revocation/versioning and rate limiting before treating a public deployment as hardened.

## Ubuntu 24.04 / WSL setup

1. Install PostgreSQL if it is not already installed:

   ```bash
   sudo apt update
   sudo apt install -y postgresql postgresql-contrib python3-venv python3-pip
   sudo service postgresql start
   ```

2. Create a local database and restricted application user. Choose your own password and use the same value in `.env`:

   ```bash
   sudo -u postgres psql
   ```

   At the `postgres=#` prompt, run (replace the password):

   ```sql
   CREATE USER signalloop_app WITH PASSWORD 'replace-with-a-strong-local-password';
   CREATE DATABASE signalloop OWNER signalloop_app;
   \q
   ```

3. From the `backend` directory:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   cp .env.example .env
   python -c 'import secrets; print(secrets.token_hex(32))'
   ```

   Edit `.env`; replace `SECRET_KEY`, `JWT_SECRET_KEY` with two different random values, and set the `DATABASE_URL` password to the one chosen in step 2. Keep `.env` private and never commit it.

4. Apply the initial migration and create a campus admin:

   ```bash
   flask db upgrade
   flask create-admin                       # interactive
   # or, non-interactively:
   flask create-admin --email ops@example.edu --name "Campus Ops" --password 'a-long-password-12+'
   ```

5. Start the API:

   ```bash
   flask --app run.py run --debug --host 127.0.0.1 --port 5000
   ```

   In another terminal, check health:

   ```bash
   curl -i http://127.0.0.1:5000/api/health
   ```

   Expected only if PostgreSQL is running and configured: HTTP 200 with `{"database":"connected","status":"ok"}`. If not, inspect the error; don't assume setup succeeded.

## API endpoints

All protected requests use `Authorization: Bearer <access_token>`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | API + database health |
| POST | `/api/auth/register` | Public | Register student |
| POST | `/api/auth/login` | Public | Sign in |
| GET | `/api/auth/me` | Authenticated | Current account |
| GET | `/api/incidents` | Authenticated | Student sees own; admin sees all |
| POST | `/api/incidents` | Authenticated student/admin | Create incident for current user |
| GET | `/api/incidents/<id>` | Owner or admin | Incident detail; admin gets audit trail |
| PATCH | `/api/incidents/<id>` | Admin only | Set `s` status, `p` priority, `dept`, `due` |
| GET | `/api/incidents/<id>/audit` | Admin only | Audit trail |
| POST | `/api/incidents/<id>/duplicate-reviews` | Admin only | Record duplicate/different decision |
| GET | `/api/admin/overview` | Admin only | Counts and recent audit events |

### Register a student

```bash
curl -sS -X POST http://127.0.0.1:5000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@example.edu","display_name":"Demo Student","password":"Use-a-long-local-password-123!"}'
```

The response includes `access_token`; save it only in your local terminal for API testing. Public registration ignores any supplied `role` and always creates a student.

### Login

```bash
curl -sS -X POST http://127.0.0.1:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@example.edu","password":"Use-a-long-local-password-123!"}'
```

### Create an incident

```bash
curl -sS -X POST http://127.0.0.1:5000/api/incidents \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -d '{"t":"Broken streetlight","c":"Power & lighting","l":"Library Road","p":"high","d":"The light has been off for three nights."}'
```

### Admin update

```bash
curl -i -X PATCH http://127.0.0.1:5000/api/incidents/1 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ADMIN_ACCESS_TOKEN' \
  -d '{"s":"asg","dept":"Electrical Services","due":"2026-10-21T14:00:00Z"}'
```

## Frontend integration plan

The current `src/app.js` reads/writes `localStorage` key `sl-data-v1` and has a client-side role picker. Those are demo-only and must not remain the authority for accounts or access.

1. Add a small `src/api.js` wrapper with `API_BASE = "http://127.0.0.1:5000/api"`, functions for register/login/list/create/get/update, and a token stored for development. Prefer an in-memory token or `sessionStorage` for this demo; never put passwords or secrets in source code.
2. Replace the current simulated sign-in handler with `POST /auth/login`; derive the UI role from the returned `user.role`. Never let a dropdown or URL grant admin UI privileges.
3. On startup, call `/auth/me` with the token and redirect to sign-in if the token is invalid/expired.
4. Replace incident `localStorage` reads with `GET /incidents`; submit the report with `POST /incidents`; admin assignment/status actions use `PATCH /incidents/<id>`. Send the bearer token in each protected request.
5. Use the server's response aliases (`t`, `c`, `l`, `p`, `s`, `m`, `d`, `dept`, `due`, `ph`) so most existing render functions can keep their current field names. `w` is not returned as a relative-time label; format `created_at` client-side.
6. Handle `401` by clearing the local token and returning to sign-in; handle `403` as a permission denial. The backend is authoritative even if the frontend route is manually changed.
7. Remove the `storage` event/localStorage incident sync when API integration is complete. The API doesn't yet expose photo upload or campus-wide student explore/analytics endpoints; keep those screens labelled demo or implement them as follow-on work.

## Migration workflow

After changing SQLAlchemy models, generate and inspect a migration, then apply it:

```bash
flask db migrate -m "describe schema change"
flask db upgrade
```

Do not edit an already-applied migration in a shared database. This initial migration is hand-authored and should be reviewed before applying to any shared environment.
