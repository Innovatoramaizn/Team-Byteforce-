import re

from flask import Blueprint, jsonify
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from sqlalchemy import select

from .extensions import db
from .http import json_body
from .models import User

auth_bp = Blueprint("auth", __name__)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def error(message, status=400, code="invalid_request"):
    return jsonify({"error": code, "message": message}), status


@auth_bp.post("/register")
def register():
    data = json_body()
    email = str(data.get("email", "")).strip().lower()
    display_name = str(data.get("display_name", "")).strip()
    password = data.get("password", "")
    if not EMAIL_RE.match(email) or len(email) > 254:
        return error("Provide a valid email address.")
    if not display_name or len(display_name) > 100:
        return error("display_name is required and must be at most 100 characters.")
    if not isinstance(password, str) or len(password) < 12 or len(password) > 128:
        return error("Password must be between 12 and 128 characters.")
    if db.session.scalar(select(User).where(User.email == email)):
        return error("An account with this email already exists.", 409, "email_exists")
    user = User(email=email, display_name=display_name, role="student")  # Never accept role from public input.
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify({"user": user.to_dict(), "access_token": token, "token_type": "Bearer"}), 201


@auth_bp.post("/login")
def login():
    data = json_body()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")
    user = db.session.scalar(select(User).where(User.email == email))
    if not user or not user.is_active or not isinstance(password, str) or not user.check_password(password):
        return error("Email or password is incorrect.", 401, "invalid_credentials")
    token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify({"user": user.to_dict(), "access_token": token, "token_type": "Bearer"}), 200


@auth_bp.get("/me")
@jwt_required()
def me():
    user = db.session.get(User, int(get_jwt_identity()))
    if not user or not user.is_active:
        return error("Account is unavailable.", 401, "account_unavailable")
    return jsonify({"user": user.to_dict()}), 200
