"""API tests. Run from the backend folder with:  python -m unittest discover -s tests -v

They use an in-memory SQLite database, so no PostgreSQL is needed.
"""
import io
import os
import unittest
from unittest import mock

from app import create_app, normalize_database_url, parse_origins, validate_production_config
from app.extensions import db
from app.models import User

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200
PASSWORD = "A-long-password-123"
TEST_CONFIG = {
    "TESTING": True,
    "SQLALCHEMY_DATABASE_URI": "sqlite://",
    "SECRET_KEY": "t" * 40,
    "JWT_SECRET_KEY": "j" * 40,
    "MAX_PHOTO_SIZE": 1024,
}
REPORT = {
    "t": "Broken streetlight",
    "c": "Power & lighting",
    "l": "Library Road",
    "d": "The streetlight near the library has been off for three nights.",
}


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app(dict(TEST_CONFIG))
        self.client = self.app.test_client()
        with self.app.app_context():
            admin = User(email="admin@example.edu", display_name="Admin", role="admin")
            admin.set_password(PASSWORD)
            db.session.add(admin)
            db.session.commit()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def register(self, email="ada@example.edu", name="Ada", **extra):
        body = {"email": email, "display_name": name, "password": PASSWORD, **extra}
        return self.client.post("/api/auth/register", json=body)

    def token_for(self, email="ada@example.edu"):
        response = self.client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["access_token"]

    def student(self, email="ada@example.edu"):
        self.assertEqual(self.register(email).status_code, 201)
        return {"Authorization": "Bearer " + self.token_for(email)}

    def admin(self):
        return {"Authorization": "Bearer " + self.token_for("admin@example.edu")}

    def create_report(self, headers, **overrides):
        response = self.client.post("/api/incidents", json={**REPORT, **overrides}, headers=headers)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        return response.get_json()["incident"]

    def upload(self, headers, incident_id, content=JPEG, filename="photo.jpg"):
        return self.client.post(
            f"/api/incidents/{incident_id}/photo",
            data={"photo": (io.BytesIO(content), filename)},
            headers=headers,
            content_type="multipart/form-data",
        )


class AuthTests(ApiTestCase):
    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_register_creates_student_and_ignores_requested_role(self):
        response = self.register(role="admin")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["user"]["role"], "student")

    def test_register_validation_and_duplicates(self):
        self.assertEqual(self.client.post("/api/auth/register", json={"email": "x@y.zz", "display_name": "X", "password": "short"}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/register", json={"email": "nope", "display_name": "X", "password": PASSWORD}).status_code, 400)
        self.assertEqual(self.register().status_code, 201)
        duplicate = self.register()
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.get_json()["error"], "email_exists")

    def test_login_failures_are_generic(self):
        self.register()
        response = self.client.post("/api/auth/login", json={"email": "ada@example.edu", "password": "wrong-password-xx"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "invalid_credentials")

    def test_non_object_json_bodies_do_not_crash(self):
        for path in ("/api/auth/login", "/api/auth/register"):
            response = self.client.post(path, data="[1, 2, 3]", content_type="application/json")
            self.assertIn(response.status_code, (400, 401))

    def test_me_requires_a_valid_token(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer nope"}).status_code, 401)
        headers = self.student()
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).get_json()["user"]["email"], "ada@example.edu")

    def test_api_responses_are_not_cacheable_and_nosniff(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")


class IncidentTests(ApiTestCase):
    def test_student_report_priority_is_forced_to_medium(self):
        headers = self.student()
        incident = self.create_report(headers, p="urg")
        self.assertEqual(incident["p"], "med")
        self.assertEqual(incident["s"], "sub")

    def test_admin_can_choose_priority_when_creating(self):
        incident = self.create_report(self.admin(), p="urg")
        self.assertEqual(incident["p"], "urg")
        bad = self.client.post("/api/incidents", json={**REPORT, "p": "extreme"}, headers=self.admin())
        self.assertEqual(bad.status_code, 400)

    def test_report_validation(self):
        headers = self.student()
        for field, value in (("t", ""), ("c", "Nope"), ("l", "Moon"), ("d", "")):
            response = self.client.post("/api/incidents", json={**REPORT, field: value}, headers=headers)
            self.assertEqual(response.status_code, 400, field)

    def test_students_only_see_their_own_reports(self):
        ada = self.student("ada@example.edu")
        bob = self.student("bob@example.edu")
        incident = self.create_report(ada)
        self.assertEqual(self.client.get("/api/incidents", headers=bob).get_json()["count"], 0)
        self.assertEqual(self.client.get(f"/api/incidents/{incident['id']}", headers=bob).status_code, 404)
        self.assertEqual(self.client.get("/api/incidents", headers=ada).get_json()["count"], 1)
        self.assertEqual(self.client.get("/api/incidents", headers=self.admin()).get_json()["count"], 1)

    def test_only_admins_can_update_and_updates_are_audited(self):
        ada = self.student()
        incident = self.create_report(ada)
        url = f"/api/incidents/{incident['id']}"
        self.assertEqual(self.client.patch(url, json={"s": "asg"}, headers=ada).status_code, 403)
        update = {"s": "asg", "p": "high", "dept": "Electrical Services", "due": "2030-01-15T12:00:00Z"}
        response = self.client.patch(url, json=update, headers=self.admin())
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        updated = response.get_json()["incident"]
        self.assertEqual((updated["s"], updated["p"], updated["dept"]), ("asg", "high", "Electrical Services"))
        audit = self.client.get(url + "/audit", headers=self.admin()).get_json()["items"]
        self.assertEqual([event["action"] for event in audit], ["incident.created", "incident.updated"])
        self.assertEqual(self.client.get(url + "/audit", headers=ada).status_code, 403)

    def test_resolving_sets_and_reopening_clears_resolved_at(self):
        incident = self.create_report(self.student())
        url = f"/api/incidents/{incident['id']}"
        resolved = self.client.patch(url, json={"s": "res"}, headers=self.admin()).get_json()["incident"]
        self.assertIsNotNone(resolved["resolved_at"])
        reopened = self.client.patch(url, json={"s": "prg"}, headers=self.admin()).get_json()["incident"]
        self.assertIsNone(reopened["resolved_at"])

    def test_malformed_update_values_return_400_not_500(self):
        incident = self.create_report(self.student())
        url = f"/api/incidents/{incident['id']}"
        for payload in ({"s": ["res"]}, {"p": {"a": 1}}, {"dept": ["x"]}, {"s": "nope"}, {"due": "yesterday"}, {}):
            response = self.client.patch(url, json=payload, headers=self.admin())
            self.assertEqual(response.status_code, 400, payload)

    def test_duplicate_review_is_recorded_once(self):
        ada = self.student()
        first, second = self.create_report(ada), self.create_report(ada, t="Streetlight out")
        url = f"/api/incidents/{second['id']}/duplicate-reviews"
        body = {"possible_duplicate_id": first["id"], "decision": "duplicate"}
        self.assertEqual(self.client.post(url, json=body, headers=ada).status_code, 403)
        self.assertEqual(self.client.post(url, json=body, headers=self.admin()).status_code, 201)
        again = self.client.post(url, json=body, headers=self.admin())
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.get_json()["error"], "already_reviewed")
        bad = self.client.post(url, json={"possible_duplicate_id": first["id"], "decision": ["x"]}, headers=self.admin())
        self.assertEqual(bad.status_code, 400)

    def test_admin_overview_counts(self):
        ada = self.student()
        self.create_report(ada)
        self.create_report(ada)
        self.assertEqual(self.client.get("/api/admin/overview", headers=ada).status_code, 403)
        overview = self.client.get("/api/admin/overview", headers=self.admin()).get_json()
        self.assertEqual(overview["total_incidents"], 2)
        self.assertEqual(overview["total_students"], 1)
        self.assertEqual(overview["by_status"]["sub"], 2)


class PhotoTests(ApiTestCase):
    def test_photo_round_trip_is_stored_in_the_database(self):
        ada = self.student()
        incident = self.create_report(ada)
        response = self.upload(ada, incident["id"])
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        listed = self.client.get("/api/incidents", headers=ada).get_json()["items"][0]
        self.assertTrue(listed["ph"])
        for headers in (ada, self.admin()):
            fetched = self.client.get(f"/api/incidents/{incident['id']}/photo", headers=headers)
            self.assertEqual(fetched.status_code, 200)
            self.assertEqual(fetched.data, JPEG)
            self.assertEqual(fetched.mimetype, "image/jpeg")
            self.assertEqual(fetched.headers["Cache-Control"], "private, no-store")

    def test_uploading_again_replaces_the_photo(self):
        ada = self.student()
        incident = self.create_report(ada)
        self.upload(ada, incident["id"])
        newer = b"\xff\xd8\xff\xdb" + b"1" * 50
        self.assertEqual(self.upload(ada, incident["id"], newer).status_code, 201)
        self.assertEqual(self.client.get(f"/api/incidents/{incident['id']}/photo", headers=ada).data, newer)

    def test_photo_rejections(self):
        ada = self.student()
        incident = self.create_report(ada)
        self.assertEqual(self.upload(ada, incident["id"], b"GIF89a-not-a-jpeg").status_code, 400)
        self.assertEqual(self.upload(ada, incident["id"], JPEG + b"0" * 2000).status_code, 413)
        missing = self.client.post(f"/api/incidents/{incident['id']}/photo", headers=ada)
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(self.client.get(f"/api/incidents/{incident['id']}/photo", headers=ada).status_code, 404)

    def test_other_students_cannot_read_or_replace_a_photo(self):
        ada = self.student("ada@example.edu")
        bob = self.student("bob@example.edu")
        incident = self.create_report(ada)
        self.upload(ada, incident["id"])
        self.assertEqual(self.client.get(f"/api/incidents/{incident['id']}/photo", headers=bob).status_code, 404)
        self.assertEqual(self.upload(bob, incident["id"]).status_code, 404)
        self.assertEqual(self.client.get(f"/api/incidents/{incident['id']}/photo").status_code, 401)


class ConfigTests(ApiTestCase):
    def test_database_urls_are_normalised_for_psycopg(self):
        self.assertEqual(normalize_database_url("postgres://u:p@h/db"), "postgresql+psycopg://u:p@h/db")
        self.assertEqual(normalize_database_url("postgresql://u:p@h/db"), "postgresql+psycopg://u:p@h/db")
        self.assertEqual(normalize_database_url("postgresql+psycopg://u:p@h/db"), "postgresql+psycopg://u:p@h/db")
        self.assertEqual(normalize_database_url("sqlite:///x.db"), "sqlite:///x.db")

    def test_cors_origins_drop_trailing_slashes(self):
        self.assertEqual(parse_origins("https://a.app/, https://b.app ,"), ["https://a.app", "https://b.app"])

    def test_cors_allows_only_listed_origins(self):
        with mock.patch.dict(os.environ, {"CORS_ORIGINS": "https://good.example/"}):
            client = create_app(dict(TEST_CONFIG)).test_client()
        allowed = client.options("/api/incidents", headers={"Origin": "https://good.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"})
        self.assertEqual(allowed.headers.get("Access-Control-Allow-Origin"), "https://good.example")
        blocked = client.options("/api/incidents", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        self.assertIsNone(blocked.headers.get("Access-Control-Allow-Origin"))

    def test_production_refuses_unsafe_configuration(self):
        with mock.patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
            for key in ("SECRET_KEY", "JWT_SECRET_KEY", "DATABASE_URL", "CORS_ORIGINS", "FLASK_DEBUG"):
                os.environ.pop(key, None)
            with self.assertRaises(RuntimeError) as raised:
                create_app({"TESTING": True})
            message = str(raised.exception)
            for needle in ("SECRET_KEY", "JWT_SECRET_KEY", "DATABASE_URL", "CORS_ORIGINS"):
                self.assertIn(needle, message)

    def test_production_rejects_sqlite_wildcard_cors_and_shared_secrets(self):
        env = {
            "APP_ENV": "production",
            "SECRET_KEY": "s" * 40,
            "JWT_SECRET_KEY": "s" * 40,
            "DATABASE_URL": "sqlite:///x.db",
            "CORS_ORIGINS": "*",
        }
        with mock.patch.dict(os.environ, env):
            with self.assertRaises(RuntimeError) as raised:
                create_app({"TESTING": True})
        message = str(raised.exception)
        self.assertIn("SQLite", message)
        self.assertIn("'*'", message)
        self.assertIn("different", message)

    def test_production_accepts_a_safe_configuration(self):
        config = {
            "SECRET_KEY": "a" * 40,
            "JWT_SECRET_KEY": "b" * 40,
            "SQLALCHEMY_DATABASE_URI": "postgresql+psycopg://user:pw@db.example/signalloop",
            "DEBUG": False,
        }
        env = {"DATABASE_URL": "postgres://user:pw@db.example/signalloop", "CORS_ORIGINS": "https://site.example"}
        with mock.patch.dict(os.environ, env):
            validate_production_config(config, ["https://site.example"])

    def test_render_environment_enables_production_checks(self):
        with mock.patch.dict(os.environ, {"RENDER": "true"}):
            os.environ.pop("SECRET_KEY", None)
            with self.assertRaises(RuntimeError):
                create_app({"TESTING": True})


class BootstrapAdminTests(ApiTestCase):
    def run_command(self, **env):
        base = {"ADMIN_EMAIL": "", "ADMIN_PASSWORD": "", "ADMIN_NAME": ""}
        with mock.patch.dict(os.environ, {**base, **env}):
            return self.app.test_cli_runner().invoke(args=["bootstrap-admin"])

    def test_skips_when_not_configured(self):
        result = self.run_command()
        self.assertEqual(result.exit_code, 0)
        self.assertIn("skipping", result.output)

    def test_creates_admin_who_can_sign_in_and_is_idempotent(self):
        result = self.run_command(ADMIN_EMAIL="Boss@Example.edu", ADMIN_PASSWORD="a-very-long-password", ADMIN_NAME="The Boss")
        self.assertEqual(result.exit_code, 0, result.output)
        login = self.client.post("/api/auth/login", json={"email": "boss@example.edu", "password": "a-very-long-password"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["role"], "admin")
        again = self.run_command(ADMIN_EMAIL="boss@example.edu", ADMIN_PASSWORD="a-different-long-password")
        self.assertEqual(again.exit_code, 0)
        self.assertIn("already exists", again.output)
        still = self.client.post("/api/auth/login", json={"email": "boss@example.edu", "password": "a-very-long-password"})
        self.assertEqual(still.status_code, 200)

    def test_never_promotes_an_existing_student(self):
        self.register("ada@example.edu")
        result = self.run_command(ADMIN_EMAIL="ada@example.edu", ADMIN_PASSWORD="a-very-long-password")
        self.assertEqual(result.exit_code, 0)
        self.assertIn("left unchanged", result.output)
        self.assertEqual(self.client.get("/api/admin/overview", headers={"Authorization": "Bearer " + self.token_for()}).status_code, 403)

    def test_rejects_weak_or_invalid_settings(self):
        self.assertNotEqual(self.run_command(ADMIN_EMAIL="boss@example.edu", ADMIN_PASSWORD="short").exit_code, 0)
        self.assertNotEqual(self.run_command(ADMIN_EMAIL="not-an-email", ADMIN_PASSWORD="a-very-long-password").exit_code, 0)


if __name__ == "__main__":
    unittest.main()
