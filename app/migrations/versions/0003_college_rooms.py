"""college rooms

Список помещений приводится к схеме колледжа на странице заявителя: добавляются недостающие кабинеты,
столовая, спортзал и актовый зал становятся кабинетами 101, 102 и 110, помещения второго корпуса выключаются.
Заявки и QR-коды существующих помещений не меняются. В пустой базе ничего не делает: её заполнит seed.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-04 20:30:00
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

locations = sa.table(
    "locations",
    sa.column("id", sa.Integer),
    sa.column("building", sa.String),
    sa.column("floor", sa.Integer),
    sa.column("room", sa.String),
    sa.column("zone_name", sa.String),
    sa.column("kind", sa.String),
    sa.column("qr_key", sa.String),
    sa.column("is_active", sa.Boolean),
)


def upgrade() -> None:
    from app.seed_data import LOCATIONS, RETIRED_LOCATIONS

    conn = op.get_bind()
    rows = conn.execute(sa.select(locations)).mappings().all()
    if not rows:
        return
    by_key = {r["qr_key"]: r for r in rows}
    by_room = {(r["building"], r["room"]): r for r in rows if r["room"]}

    for building, floor, room, zone, kind, key in LOCATIONS:
        values = {"floor": floor, "room": room, "zone_name": zone, "kind": kind, "is_active": True}
        current = by_key.get(key) or (by_room.get((building, room)) if room else None)
        if current:
            conn.execute(sa.update(locations).where(locations.c.id == current["id"]).values(building=building, **values))
        else:
            conn.execute(sa.insert(locations).values(building=building, qr_key=key, **values))

    conn.execute(sa.update(locations).where(locations.c.qr_key.in_(RETIRED_LOCATIONS)).values(is_active=False))


def downgrade() -> None:
    # данные не откатываются: выключенные помещения можно включить в панели
    pass
