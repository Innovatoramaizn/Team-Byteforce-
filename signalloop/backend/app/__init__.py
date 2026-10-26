import os
from datetime import timedelta

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy.exc import SQLAlchemyError

from .extensions import db, jwt, migrate
from .models import User

# Local-development fallbacks only. They are at least 32 characters so JWT signing does not warn,
# and create_app() refuses to start with them (or anything weak) when running in production.
DEV_SECRET_KEY = "development-only-secret-key-do-not-use-in-production"
DEV_JWT_SECRET_KEY = "development-only-jwt-key-do-not-use-in-production"
DEV_DATABASE_URL = "postgresql+psycopg://signalloop_app:change-this-password@localhost:5432/signalloop"
DEV_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500"


def normalize_database_url(url):
    """Hosts such as Render hand out postgres:// or postgresql:// URLs; SQLAlchemy needs the psycopg 3 driver name."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def parse_origins(raw):
    """Split a comma-separated origin list and drop trailing slashes, which browsers never send."""
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


def is_production():
    return os.getenv("APP_ENV", "").lower() == "production" or os.getenv("RENDER", "").lower() == "true"


def validate_production_config(config, origins):
    problems = []
    for key in ("SECRET_KEY", "JWT_SECRET_KEY"):
        value = config.get(key) or ""
        if len(value) < 32 or value.startswith("development-only"):
            problems.append(f"{key} must be a random value of at least 32 characters.")
    if config.get("SECRET_KEY") == config.get("JWT_SECRET_KEY"):
        problems.append("SECRET_KEY and JWT_SECRET_KEY must be different values.")
    if not os.getenv("DATABASE_URL"):
        problems.append("DATABASE_URL must be set.")
    elif config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        problems.append("DATABASE_URL must point at PostgreSQL in production, not SQLite.")
    if not os.getenv("CORS_ORIGINS"):
        problems.append("CORS_ORIGINS must list the exact frontend origin(s), for example https://your-site.netlify.app.")
    elif "*" in origins:
        problems.append("CORS_ORIGINS must not contain '*'.")
    if config.get("DEBUG"):
        problems.append("FLASK_DEBUG must be 0 in production.")
    if problems:
        raise RuntimeError("Refusing to start with an unsafe production configuration:\n- " + "\n- ".join(problems))


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY", DEV_SECRET_KEY),
        JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", DEV_JWT_SECRET_KEY),
        SQLALCHEMY_DATABASE_URI=normalize_database_url(os.getenv("DATABASE_URL", DEV_DATABASE_URL)),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True},
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(
            minutes=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "30"))
        ),
        DEBUG=os.getenv("FLASK_DEBUG", "0") == "1",
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        UPLOAD_FOLDER=os.path.join(app.instance_path, "incident_uploads"),
        MAX_PHOTO_SIZE=4 * 1024 * 1024,
    )

    if test_config:
        app.config.update(test_config)

    origins = parse_origins(os.getenv("CORS_ORIGINS", DEV_CORS_ORIGINS))
    if is_production():
        validate_production_config(app.config, origins)

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": origins}}, allow_headers=["Content-Type", "Authorization"])

    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
        # Local convenience: create any missing tables (never alters existing ones). PostgreSQL uses `flask db upgrade`.
        with app.app_context():
            db.create_all()

    from .auth import EMAIL_RE, auth_bp
    from .incidents import incidents_bp
    from .admin import admin_bp
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(incidents_bp, url_prefix="/api/incidents")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.get("/api/health")
    def health():
        try:
            db.session.execute(db.text("SELECT 1"))
            return jsonify({"status": "ok", "database": "connected"}), 200
        except SQLAlchemyError:
            db.session.rollback()
            return jsonify({"status": "error", "database": "unavailable"}), 503

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": "not_found", "message": "The requested resource was not found."}), 404

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return jsonify({"error": "method_not_allowed", "message": "That method is not allowed here."}), 405

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": "payload_too_large", "message": "Request body exceeds 5 MB."}), 413

    @app.errorhandler(500)
    def server_error(_error):
        db.session.rollback()
        return jsonify({"error": "internal_server_error", "message": "An unexpected server error occurred."}), 500

    @app.cli.command("create-admin")
    def create_admin():
        """Interactively create a campus admin; public registration cannot grant admin role."""
        import getpass
        from sqlalchemy import select
        email = input("Admin email: ").strip().lower()
        display_name = input("Display name: ").strip()
        password = getpass.getpass("Password (12+ characters): ")
        if "@" not in email or not display_name or len(password) < 12:
            raise SystemExit("Valid email, display name and a password of at least 12 characters are required.")
        if db.session.scalar(select(User).where(User.email == email)):
            raise SystemExit("That email already exists. Use a separate admin email or update the account through a controlled process.")
        user = User(email=email, display_name=display_name, role="admin")
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        print(f"Created admin account for {email} (user id {user.id}).")

    @app.cli.command("bootstrap-admin")
    def bootstrap_admin():
        """Create the first admin from ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME, if that account does not exist yet.

        Meant for hosts without a shell (run from the start command). It is idempotent and never changes an existing
        account's password or role.
        """
        from sqlalchemy import select
        email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        password = os.getenv("ADMIN_PASSWORD", "")
        display_name = os.getenv("ADMIN_NAME", "").strip() or "Campus Admin"
        if not email and not password:
            print("bootstrap-admin: ADMIN_EMAIL and ADMIN_PASSWORD are not set; skipping.")
            return
        if not EMAIL_RE.match(email) or len(email) > 254:
            raise SystemExit("bootstrap-admin: ADMIN_EMAIL is not a valid email address.")
        if len(password) < 12 or len(password) > 128:
            raise SystemExit("bootstrap-admin: ADMIN_PASSWORD must be between 12 and 128 characters.")
        if len(display_name) > 100:
            raise SystemExit("bootstrap-admin: ADMIN_NAME must be at most 100 characters.")
        existing = db.session.scalar(select(User).where(User.email == email))
        if existing:
            note = "" if existing.role == "admin" else f" (it is a {existing.role} account and was left unchanged)"
            print(f"bootstrap-admin: {email} already exists{note}; nothing to do.")
            return
        user = User(email=email, display_name=display_name, role="admin")
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        print(f"bootstrap-admin: created admin account for {email} (user id {user.id}).")

    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify({"error": "authentication_required", "message": "A valid Bearer access token is required."}), 401

    @jwt.invalid_token_loader
    def invalid_token(reason):
        return jsonify({"error": "invalid_token", "message": "The access token is invalid."}), 401

    @jwt.expired_token_loader
    def expired_token(jwt_header, jwt_payload):
        return jsonify({"error": "token_expired", "message": "The access token has expired. Sign in again."}), 401

    return app
