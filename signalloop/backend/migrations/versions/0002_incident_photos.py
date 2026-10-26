"""Store incident photos in the database.

Render's free web services have an ephemeral filesystem, so uploads written to disk are lost on every
restart. Keeping the bytes in PostgreSQL makes them survive redeploys and be covered by database backups.

Revision ID: 0002_incident_photos
Revises: 0001_initial
Create Date: 2026-10-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_incident_photos"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "incident_photos",
        sa.Column("incident_id", sa.Integer(), sa.ForeignKey("incidents.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("incident_photos")
