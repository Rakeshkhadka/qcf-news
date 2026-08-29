"""
Reusable query helpers for filtering, ordering, and pagination.

Usage in repository methods:
    stmt = select(Article)
    stmt = apply_filter_map_stmt(stmt, Article, FILTER_MAP, query_params)
    stmt = ordering.apply_ordering(stmt, Article, query_params)
    stmt = apply_pagination(stmt, page, page_size)
"""
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, or_
from sqlalchemy.sql import sqltypes

MAX_PAGE_SIZE = 100


# ── Filtering ────────────────────────────────────────────────────────────────


def get_applicable_filters(
    query_params: dict[str, Any], filter_map: dict[str, str]
) -> dict[str, Any]:
    """Return {filter_expression: value} for params present in the filter_map."""
    return {
        filter_map[k]: v
        for k, v in query_params.items()
        if k in filter_map and v is not None and v != ""
    }


def build_filter_condition(model, expression: str, value: Any):
    """
    Convert an expression like ``"price__gte"`` and a value into a
    SQLAlchemy filter clause.

    Supported operators:
      exact, gte, lte, gt, lt, icontains/contains, in
    """
    parts = expression.split("__")
    field_name = parts[0]
    operator = parts[1] if len(parts) > 1 else "contains"

    column = getattr(model, field_name, None)
    if column is None:
        raise ValueError(f"Model {model.__name__} has no field '{field_name}'")

    ops = {
        "exact": lambda: column == value,
        "gte": lambda: column >= value,
        "lte": lambda: column <= value,
        "gt": lambda: column > value,
        "lt": lambda: column < value,
        "icontains": lambda: column.ilike(f"%{value}%"),
        "contains": lambda: column.ilike(f"%{value}%"),
        "in": lambda: column.in_(value) if isinstance(value, (list, tuple)) else (_ for _ in ()).throw(
            ValueError("Operator 'in' expects a list or tuple")
        ),
    }
    builder = ops.get(operator)
    if builder is None:
        raise NotImplementedError(f"Operator '{operator}' not implemented")
    return builder()


def apply_filter_map_stmt(
    stmt: Select,
    model,
    filter_map: dict[str, str],
    query_params: dict[str, Any],
) -> Select:
    """Apply all applicable filters from query_params to the statement."""
    applicable = get_applicable_filters(query_params, filter_map)
    conditions = []
    for expr, value in applicable.items():
        try:
            conditions.append(build_filter_condition(model, expr, value))
        except (ValueError, NotImplementedError) as e:
            raise HTTPException(status_code=400, detail=str(e))
    if conditions:
        stmt = stmt.where(*conditions)
    return stmt


# ── Free-text search ─────────────────────────────────────────────────────────


def apply_search(stmt: Select, columns, term: Any) -> Select:
    """
    Narrow `stmt` to rows where any of `columns` contains `term`.

    Case-insensitive and OR-ed across the columns, so a single box in the UI can
    search a title, a summary and a body at once. LIKE wildcards typed by the
    user are escaped: someone searching for "100%" means the literal characters,
    not "match everything".
    """
    if not term or not str(term).strip():
        return stmt

    escaped = (
        str(term)
        .strip()
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )
    pattern = f"%{escaped}%"
    return stmt.where(
        or_(*(column.ilike(pattern, escape="\\") for column in columns))
    )


# ── Ordering ─────────────────────────────────────────────────────────────────


class OrderingFilterMap:
    """Declarative ordering helper tied to a set of allowed fields."""

    def __init__(
        self,
        ordering_param: str = "ordering",
        default_ordering: list[str] | None = None,
        ordering_fields_map: dict[str, str] | None = None,
    ):
        self.ordering_param = ordering_param
        self.default_ordering = default_ordering or []
        self.ordering_fields_map = ordering_fields_map or {}

    def apply_ordering(self, stmt: Select, model, query_params: dict) -> Select:
        raw = query_params.get(self.ordering_param, "")
        keys = [k.strip() for k in raw.split(",") if k.strip()] if raw else []
        if not keys:
            keys = self.default_ordering

        clauses = []
        for key in keys:
            desc = key.startswith("-")
            field_key = key.lstrip("-")

            if field_key not in self.ordering_fields_map:
                raise HTTPException(400, detail=f"Invalid ordering field: {field_key}")

            col = getattr(model, self.ordering_fields_map[field_key], None)
            if col is None:
                raise HTTPException(
                    400,
                    detail=f"Model {model.__name__} has no field "
                    f"'{self.ordering_fields_map[field_key]}'",
                )
            expr = func.lower(col) if isinstance(col.type, sqltypes.String) else col
            clauses.append(expr.desc() if desc else expr.asc())

        return stmt.order_by(*clauses)


# ── Pagination ───────────────────────────────────────────────────────────────


def apply_pagination(stmt: Select, page: int, page_size: int) -> Select:
    """Add LIMIT / OFFSET.  page is 1-based; page_size clamped to MAX_PAGE_SIZE."""
    page_size = min(page_size, MAX_PAGE_SIZE)
    offset = (max(page, 1) - 1) * page_size
    return stmt.limit(page_size).offset(offset)
