import io
import os
from datetime import datetime, timezone
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .http import json_body
from .models import AuditEvent, DuplicateReview, Incident, IncidentPhoto, User

incidents_bp = Blueprint("incidents", __name__)
CATEGORIES = {"Power & lighting", "Water & plumbing", "Road / walkway", "Waste / sanitation", "Facilities", "Safety & security"}
LOCATIONS = {"Library Road", "Hostel Block C", "Science Complex", "Student Centre", "North Gate", "Main Hall"}
PRIORITIES = {"low", "med", "high", "urg"}
STATUSES = {"sub", "rev", "asg", "prg", "res", "rej"}
DEPARTMENTS = {"Facilities & Maintenance", "Electrical Services", "Water & Plumbing", "Sanitation", "Campus Security"}


def current_user():
    return db.session.get(User, int(get_jwt_identity()))


def admin_required():
    claims = get_jwt()
    return claims.get("role") == "admin"


def denied():
    return jsonify({"error": "forbidden", "message": "Campus admin permissions are required."}), 403


def write_audit(incident, action, details=None):
    actor_id = int(get_jwt_identity())
    db.session.add(AuditEvent(actor_id=actor_id, incident_id=incident.id, action=action, details=details or {}))


@incidents_bp.get("")
@jwt_required()
def list_incidents():
    user = current_user()
    if not user or not user.is_active:
        return jsonify({"error": "account_unavailable"}), 401
    stmt = select(Incident).order_by(Incident.created_at.desc())
    if user.role != "admin":
        stmt = stmt.where(Incident.reporter_id == user.id)
    items = db.session.scalars(stmt).all()
    return jsonify({"items": [i.to_dict() for i in items], "count": len(items)}), 200


@incidents_bp.post("")
@jwt_required()
def create_incident():
    user = current_user()
    if not user or not user.is_active:
        return jsonify({"error": "account_unavailable"}), 401
    data = json_body()
    title = str(data.get("t", data.get("title", ""))).strip()
    category = str(data.get("c", data.get("category", ""))).strip()
    location = str(data.get("l", data.get("location", ""))).strip()
    description = str(data.get("d", data.get("description", ""))).strip()
    priority = "med"
    if user.role == "admin":
        priority = str(data.get("p", data.get("priority", "med"))).strip()
    if not title or len(title) > 160:
        return jsonify({"error": "validation_error", "message": "Title is required and must be at most 160 characters."}), 400
    if category not in CATEGORIES:
        return jsonify({"error": "validation_error", "message": "Choose a supported incident category."}), 400
    if location not in LOCATIONS:
        return jsonify({"error": "validation_error", "message": "Choose a supported campus location."}), 400
    if not description or len(description) > 5000:
        return jsonify({"error": "validation_error", "message": "Description is required and must be at most 5000 characters."}), 400
    if priority not in PRIORITIES:
        return jsonify({"error": "validation_error", "message": "Priority must be low, med, high or urg."}), 400
    incident = Incident(title=title, category=category, location=location, description=description,
                        priority=priority, status="sub", reporter_id=user.id)
    db.session.add(incident)
    db.session.flush()
    write_audit(incident, "incident.created", {"status": "sub"})
    db.session.commit()
    return jsonify({"incident": incident.to_dict()}), 201


@incidents_bp.post("/<int:incident_id>/photo")
@jwt_required()
def upload_incident_photo(incident_id):
    user = current_user()

    if not user or not user.is_active:
        return jsonify({
            "error": "account_unavailable",
            "message": "Your account is unavailable."
        }), 401

    incident = db.session.get(Incident, incident_id)

    # Return 404 for inaccessible incidents to avoid exposing their existence.
    if not incident or (
        user.role != "admin" and incident.reporter_id != user.id
    ):
        return jsonify({
            "error": "not_found",
            "message": "Incident not found."
        }), 404

    photo = request.files.get("photo")

    if not photo or not photo.filename:
        return jsonify({
            "error": "photo_required",
            "message": "Choose a photo to upload."
        }), 400

    # Read only enough bytes to verify that the content is actually a JPEG.
    header = photo.stream.read(3)
    photo.stream.seek(0)

    if not header.startswith(b"\xff\xd8\xff"):
        return jsonify({
            "error": "invalid_photo",
            "message": "Upload a valid JPEG image."
        }), 400

    max_size = current_app.config["MAX_PHOTO_SIZE"]
    contents = photo.stream.read(max_size + 1)

    if len(contents) > max_size:
        return jsonify({
            "error": "photo_too_large",
            "message": "The photo must be no larger than 4 MB."
        }), 413

    try:
        record = db.session.get(IncidentPhoto, incident.id)
        if record:
            record.content = contents
            record.size = len(contents)
            record.created_at = datetime.now(timezone.utc)
        else:
            db.session.add(IncidentPhoto(incident_id=incident.id, content=contents, size=len(contents)))

        # Server-generated name (never client-supplied); it only flags that a photo is attached.
        incident.photo_filename = f"{uuid4().hex}.jpg"

        write_audit(
            incident,
            "incident.photo_uploaded",
            {"photo_attached": True}
        )
        db.session.commit()

    except Exception:
        db.session.rollback()
        current_app.logger.exception(
            "Failed to save photo for incident %s", incident_id
        )
        return jsonify({
            "error": "photo_upload_failed",
            "message": "The photo could not be saved. Please try again."
        }), 500

    return jsonify({
        "message": "Photo uploaded successfully.",
        "incident_id": incident.id,
        "photo_filename": incident.photo_filename,
        "ph": True
    }), 201


@incidents_bp.get("/<int:incident_id>/photo")
@jwt_required()
def get_incident_photo(incident_id):
    user = current_user()

    if not user or not user.is_active:
        return jsonify({
            "error": "account_unavailable",
            "message": "Your account is unavailable."
        }), 401

    incident = db.session.get(Incident, incident_id)

    # Only the incident reporter or an admin may view its photo.
    if not incident or (
        user.role != "admin" and incident.reporter_id != user.id
    ):
        return jsonify({
            "error": "not_found",
            "message": "Incident not found."
        }), 404

    record = db.session.get(IncidentPhoto, incident.id)
    if record:
        response = send_file(
            io.BytesIO(bytes(record.content)),
            mimetype="image/jpeg",
            as_attachment=False,
            download_name="incident-photo.jpg"
        )
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    if not incident.photo_filename:
        return jsonify({
            "error": "photo_not_found",
            "message": "This incident has no attached photo."
        }), 404

    upload_dir = os.path.realpath(current_app.config["UPLOAD_FOLDER"])
    filepath = os.path.realpath(
        os.path.join(upload_dir, incident.photo_filename)
    )

    # Ensure the resolved file remains inside the upload directory.
    if os.path.commonpath([upload_dir, filepath]) != upload_dir:
        return jsonify({
            "error": "photo_not_found",
            "message": "Photo not found."
        }), 404

    if not os.path.isfile(filepath):
        return jsonify({
            "error": "photo_not_found",
            "message": "Photo not found."
        }), 404

    response = send_file(
        filepath,
        mimetype="image/jpeg",
        as_attachment=False,
        download_name="incident-photo.jpg",
        conditional=True
    )
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@incidents_bp.get("/<int:incident_id>")
@jwt_required()
def get_incident(incident_id):
    user = current_user()
    incident = db.session.get(Incident, incident_id)
    if not incident:
        return jsonify({"error": "not_found", "message": "Incident not found."}), 404
    if not user or (user.role != "admin" and incident.reporter_id != user.id):
        return jsonify({"error": "not_found", "message": "Incident not found."}), 404
    response = {"incident": incident.to_dict()}
    if user.role == "admin":
        response["audit"] = [a.to_dict() for a in db.session.scalars(select(AuditEvent).where(AuditEvent.incident_id == incident.id).order_by(AuditEvent.created_at.asc())).all()]
    return jsonify(response), 200


@incidents_bp.patch("/<int:incident_id>")
@jwt_required()
def update_incident(incident_id):
    if not admin_required():
        return denied()
    incident = db.session.get(Incident, incident_id)
    if not incident:
        return jsonify({"error": "not_found", "message": "Incident not found."}), 404
    data = json_body()
    changes = {}
    status = data.get("s", data.get("status"))
    priority = data.get("p", data.get("priority"))
    department = data.get("dept", data.get("assigned_department"))
    due = data.get("due", data.get("due_date"))
    if status is not None:
        if not isinstance(status, str) or status not in STATUSES:
            return jsonify({"error": "validation_error", "message": "Unsupported status."}), 400
        changes["status"] = status
    if priority is not None:
        if not isinstance(priority, str) or priority not in PRIORITIES:
            return jsonify({"error": "validation_error", "message": "Unsupported priority."}), 400
        changes["priority"] = priority
    if department is not None:
        if not isinstance(department, str) or department not in DEPARTMENTS:
            return jsonify({"error": "validation_error", "message": "Unsupported department."}), 400
        changes["assigned_department"] = department
    if due is not None:
        if due == "":
            changes["due_date"] = None
        else:
            try:
                parsed = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                changes["due_date"] = parsed
            except ValueError:
                return jsonify({"error": "validation_error", "message": "due_date must be an ISO-8601 datetime or empty."}), 400
    if not changes:
        return jsonify({"error": "validation_error", "message": "Provide at least one supported field to update."}), 400
    before = {key: getattr(incident, key) for key in changes}
    for key, value in changes.items():
        setattr(incident, key, value)
    if changes.get("status") == "res":
        incident.resolved_at = datetime.now(timezone.utc)
    elif changes.get("status") and changes["status"] != "res":
        incident.resolved_at = None
    write_audit(incident, "incident.updated", {"before": {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in before.items()}, "after": {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in changes.items()}})
    db.session.commit()
    return jsonify({"incident": incident.to_dict()}), 200


@incidents_bp.get("/<int:incident_id>/audit")
@jwt_required()
def incident_audit(incident_id):
    if not admin_required():
        return denied()
    incident = db.session.get(Incident, incident_id)
    if not incident:
        return jsonify({"error": "not_found"}), 404
    rows = db.session.scalars(select(AuditEvent).where(AuditEvent.incident_id == incident_id).order_by(AuditEvent.created_at.asc())).all()
    return jsonify({"items": [row.to_dict() for row in rows]}), 200


@incidents_bp.post("/<int:incident_id>/duplicate-reviews")
@jwt_required()
def review_duplicate(incident_id):
    if not admin_required():
        return denied()
    data = json_body()
    other_id = data.get("possible_duplicate_id")
    decision = data.get("decision")
    note = str(data.get("note", "")).strip()
    if (
        not isinstance(other_id, int)
        or isinstance(other_id, bool)
        or other_id == incident_id
        or not isinstance(decision, str)
        or decision not in {"duplicate", "different"}
    ):
        return jsonify({"error": "validation_error", "message": "Provide a different possible_duplicate_id and decision duplicate or different."}), 400
    incident = db.session.get(Incident, incident_id)
    if not incident or not db.session.get(Incident, other_id):
        return jsonify({"error": "not_found", "message": "Both incidents must exist."}), 404
    review = DuplicateReview(incident_id=incident_id, possible_duplicate_id=other_id,
                             reviewed_by_id=int(get_jwt_identity()), decision=decision, note=note[:500] or None)
    try:
        db.session.add(review)
        write_audit(incident, "incident.duplicate_reviewed", {"possible_duplicate_id": other_id, "decision": decision})
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "already_reviewed", "message": "This pair has already been reviewed."}), 409
    return jsonify({"id": review.id, "incident_id": incident_id, "possible_duplicate_id": other_id,
                    "decision": decision, "note": review.note, "created_at": review.created_at.isoformat()}), 201
