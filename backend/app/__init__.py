import os
from datetime import timedelta

from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import get_jwt, verify_jwt_in_request
from flask_jwt_extended.exceptions import JWTExtendedException
from jwt.exceptions import PyJWTError
from sqlalchemy.exc import SQLAlchemyError

from .extensions import db, jwt, migrate
from .models import User


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY", "development-only-change-me"),
        JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", "development-only-change-me-too"),
        SQLALCHEMY_DATABASE_URI=os.getenv(
            "DATABASE_URL",
            "postgresql+psycopg://signalloop_app:change-this-password@localhost:5432/signalloop",
        ),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
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

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500").split(",") if x.strip()]
    CORS(app, resources={r"/api/*": {"origins": origins}}, allow_headers=["Content-Type", "Authorization"])

    from .auth import auth_bp
    from .incidents import incidents_bp
    from .admin import admin_bp
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(incidents_bp, url_prefix="/api/incidents")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

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
