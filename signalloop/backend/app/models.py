from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db


def utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(100), nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="student", index=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    incidents = db.relationship("Incident", back_populates="reporter", foreign_keys="Incident.reporter_id")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "display_name": self.display_name,
            "role": self.role,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Incident(db.Model):
    __tablename__ = "incidents"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(80), nullable=False)
    location = db.Column(db.String(160), nullable=False)
    priority = db.Column(db.String(10), nullable=False, default="med")
    status = db.Column(db.String(10), nullable=False, default="sub", index=True)
    description = db.Column(db.Text, nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    assigned_department = db.Column(db.String(100))
    due_date = db.Column(db.DateTime(timezone=True))
    photo_filename = db.Column(db.String(255))  # Set when a photo is attached; the image itself lives in IncidentPhoto.
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    resolved_at = db.Column(db.DateTime(timezone=True))

    reporter = db.relationship("User", back_populates="incidents", foreign_keys=[reporter_id])
    audit_events = db.relationship("AuditEvent", back_populates="incident", cascade="all, delete-orphan")

    def to_dict(self):
        # Short aliases intentionally match the current prototype's incident fields.
        return {
            "id": self.id,
            "t": self.title,
            "c": self.category,
            "l": self.location,
            "p": self.priority,
            "s": self.status,
            "m": self.reporter_id,
            "reporter": self.reporter.to_dict() if self.reporter else None,
            "d": self.description,
            "dept": self.assigned_department,
            "due": self.due_date.isoformat() if self.due_date else None,
            "ph": bool(self.photo_filename),
            "photo_filename": self.photo_filename,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }


class IncidentPhoto(db.Model):
    """JPEG bytes for an incident, stored in the database so they survive redeploys on hosts with ephemeral disks."""

    __tablename__ = "incident_photos"

    incident_id = db.Column(db.Integer, db.ForeignKey("incidents.id", ondelete="CASCADE"), primary_key=True)
    content = db.Column(db.LargeBinary, nullable=False)
    size = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class AuditEvent(db.Model):
    __tablename__ = "audit_events"

    id = db.Column(db.Integer, primary_key=True)
    actor_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    incident_id = db.Column(db.Integer, db.ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True)
    action = db.Column(db.String(60), nullable=False)
    details = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    actor = db.relationship("User")
    incident = db.relationship("Incident", back_populates="audit_events")

    def to_dict(self):
        return {
            "id": self.id,
            "actor": self.actor.to_dict() if self.actor else None,
            "incident_id": self.incident_id,
            "action": self.action,
            "details": self.details,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class DuplicateReview(db.Model):
    __tablename__ = "duplicate_reviews"
    __table_args__ = (db.UniqueConstraint("incident_id", "possible_duplicate_id", name="uq_duplicate_review_pair"),)

    id = db.Column(db.Integer, primary_key=True)
    incident_id = db.Column(db.Integer, db.ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False)
    possible_duplicate_id = db.Column(db.Integer, db.ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False)
    reviewed_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decision = db.Column(db.String(20), nullable=False)  # duplicate | different
    note = db.Column(db.String(500))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    incident = db.relationship("Incident", foreign_keys=[incident_id])
    possible_duplicate = db.relationship("Incident", foreign_keys=[possible_duplicate_id])
    reviewer = db.relationship("User")
