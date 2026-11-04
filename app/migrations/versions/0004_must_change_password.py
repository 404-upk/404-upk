"""must change password

Признак временного пароля у сотрудника: такой пароль выдаёт команда create_admin или администратор в панели,
и пока его не сменили, панель закрыта.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-05 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("must_change_password", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("must_change_password")
