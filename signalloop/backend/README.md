# SignalLoop API

Flask + SQLAlchemy + Flask-Migrate (Alembic) + JWT bearer tokens. PostgreSQL in production;
SQLite also works for local development and tests. See the [root README](../README.md) for
running the whole project and deploying it.

## What it does

- Password hashing (Werkzeug), JWT access tokens (30 minutes by default).
- Student-owned incidents; admins see everything. Public registration always creates a `student`.
- Admin triage: status, priority, department and due date, each change written to an audit trail.
- Duplicate-review decisions (recorded once per pair).
- One JPEG photo per incident (up to 4 MB), stored **in the database** so it survives redeploys on
  hosts with ephemeral disks. Photos saved to disk by older versions are still served as a fallback.
- `/api/health` database check, JSON error responses, `Cache-Control: no-store` on API responses.
- Students can't choose a priority: reports they create are always `med`; admins set it while triaging.

## Configuration

Set these as environment variables (locally you can use a `.env` file; see `.env.example`).

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL (`postgres://`, `postgresql://` or `postgresql+psycopg://`) or SQLite (`sqlite:///name.db` creates `instance/name.db`). Required in production |
| `SECRET_KEY`, `JWT_SECRET_KEY` | Two different random values of 32+ characters. Required in production |
| `CORS_ORIGINS` | Comma-separated website origins (trailing slashes are ignored). Required in production; `*` is rejected |
| `APP_ENV=production` | Enables strict startup checks. Also enabled automatically when `RENDER=true` |
| `FLASK_DEBUG` | `1` for local debugging only |
| `JWT_ACCESS_TOKEN_EXPIRES_MINUTES` | Default 30 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Used only by `flask bootstrap-admin` |

In production the app refuses to start, and lists what is wrong, if a secret is missing, short or
a development default, if the two secrets are equal, if `DATABASE_URL` is missing or SQLite, if
`CORS_ORIGINS` is missing or `*`, or if debug is on.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
export DATABASE_URL=sqlite:///signalloop-local.db      # PowerShell: $env:DATABASE_URL = "..."
flask --app run.py create-admin
flask --app run.py run --debug --host 127.0.0.1 --port 5000
curl -i http://127.0.0.1:5000/api/health
```

With SQLite the missing tables are created automatically at startup. With PostgreSQL, create a
database and user, set `DATABASE_URL`, and run `flask --app run.py db upgrade`:

```sql
CREATE USER signalloop_app WITH PASSWORD 'choose-a-password';
CREATE DATABASE signalloop OWNER signalloop_app;
```

## Commands

| Command | Purpose |
| --- | --- |
| `flask --app run.py db upgrade` | Apply migrations (PostgreSQL) |
| `flask --app run.py create-admin` | Interactively create a campus admin |
| `flask --app run.py bootstrap-admin` | Create an admin from `ADMIN_*` variables if that email doesn't exist. Idempotent; never changes an existing account's password or role |
| `python -m unittest discover -s tests -v` | Run the tests (in-memory SQLite) |

Production start command (also in `render.yaml`):
`flask --app run.py db upgrade && flask --app run.py bootstrap-admin && gunicorn run:app --workers 2 --timeout 60`

## Endpoints

Protected requests use `Authorization: Bearer <access_token>`.

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | API and database health (503 if the database is down) |
| POST | `/api/auth/register` | Public | Register a student (password 12 to 128 characters) |
| POST | `/api/auth/login` | Public | Sign in |
| GET | `/api/auth/me` | Authenticated | Current account |
| GET | `/api/incidents` | Authenticated | Students see their own; admins see all |
| POST | `/api/incidents` | Authenticated | Create an incident. `t`, `c`, `l`, `d` required; `p` honoured for admins only |
| GET | `/api/incidents/<id>` | Owner or admin | Detail; admins also get the audit trail |
| PATCH | `/api/incidents/<id>` | Admin | Update `s` status, `p` priority, `dept`, `due` |
| POST | `/api/incidents/<id>/photo` | Owner or admin | Upload a JPEG (`multipart/form-data`, field `photo`); replaces any earlier photo |
| GET | `/api/incidents/<id>/photo` | Owner or admin | Download the photo |
| GET | `/api/incidents/<id>/audit` | Admin | Audit trail |
| POST | `/api/incidents/<id>/duplicate-reviews` | Admin | Record `duplicate` or `different` for a pair (409 if already reviewed) |
| GET | `/api/admin/overview` | Admin | Counts by status and recent audit events |

Allowed values: statuses `sub`, `rev`, `asg`, `prg`, `res`, `rej`; priorities `low`, `med`, `high`,
`urg`; categories, locations and departments are fixed lists in `app/incidents.py`.

## Migrations

After changing the models, generate a migration, review it, and apply it:

```bash
flask --app run.py db migrate -m "describe the change"
flask --app run.py db upgrade
```

Migrations are written for PostgreSQL (`0001` uses `JSONB`), so `db upgrade` is for PostgreSQL;
SQLite databases are created from the models instead. Never edit a migration that has already been
applied to a shared database; add a new one.

## Known gaps

No password reset or email verification, no rate limiting, no refresh tokens or token revocation
(role claims live in the token until it expires), no pagination, and photos are limited to JPEG.
Add rate limiting before exposing sign-in to the public internet.
