from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt, jwt_required
from sqlalchemy import func, select

from .extensions import db
from .models import AuditEvent, Incident, User

admin_bp = Blueprint("admin", __name__)


def admin_only():
    if get_jwt().get("role") != "admin":
        return jsonify({"error": "forbidden", "message": "Campus admin permissions are required."}), 403
    return None


@admin_bp.get("/overview")
@jwt_required()
def overview():
    denied = admin_only()
    if denied:
        return denied
    counts = dict(db.session.execute(select(Incident.status, func.count(Incident.id)).group_by(Incident.status)).all())
    return jsonify({
        "total_incidents": db.session.scalar(select(func.count(Incident.id))) or 0,
        "total_students": db.session.scalar(select(func.count(User.id)).where(User.role == "student")) or 0,
        "by_status": {status: counts.get(status, 0) for status in ("sub", "rev", "asg", "prg", "res", "rej")},
        "recent_audit_events": [event.to_dict() for event in db.session.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(10)).all()],
    }), 200
