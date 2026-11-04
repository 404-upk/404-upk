"""Выгрузка заявок в Excel и CSV."""

import csv
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from ..models import Ticket
from . import tickets as ts

EXPORT_COLUMNS = [
    ("Номер", 12),
    ("Создана", 18),
    ("Заголовок", 40),
    ("Описание", 60),
    ("Категория", 24),
    ("Место", 40),
    ("Статус", 20),
    ("Приоритет", 14),
    ("Исполнитель", 24),
    ("Сообщили", 10),
    ("Закрыта", 18),
    ("Оценка", 10),
]


def ticket_row(t: Ticket) -> list:
    return [
        t.public_number,
        t.created_at.strftime("%d.%m.%Y %H:%M"),
        t.title,
        t.description,
        t.category.name,
        t.place,
        ts.STATUS_LABELS[t.status],
        ts.PRIORITY_LABELS.get(t.priority, t.priority),
        t.assignee.name if t.assignee else "",
        t.reports_count,
        t.closed_at.strftime("%d.%m.%Y %H:%M") if t.closed_at else "",
        t.rating or "",
    ]


def to_xlsx(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Заявки"
    ws.append([c[0] for c in EXPORT_COLUMNS])
    for i, (_, width) in enumerate(EXPORT_COLUMNS, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = width
        cell = ws.cell(row=1, column=i)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="2F5BD3")
    for row in rows:
        ws.append(row)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_csv(rows: list[list]) -> bytes:
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM, чтобы Excel правильно открыл кириллицу
    writer = csv.writer(buf, delimiter=";")
    writer.writerow([c[0] for c in EXPORT_COLUMNS])
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")
