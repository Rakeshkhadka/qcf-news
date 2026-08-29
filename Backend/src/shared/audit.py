"""
SQLAlchemy ORM event listeners for:
  1. Auto-populating audit fields (created_by / updated_by).
  2. Global soft-delete filtering on SELECT statements.
"""
from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from src.db.base import SoftDeleteMixin


def _get_user_id():
    """Lazy import to avoid circular dependency with the DI container."""
    from src.container import Container

    ctx = Container.user_context()
    try:
        return ctx.get()
    except LookupError:
        return None


@event.listens_for(Session, "before_flush")
def set_audit_fields(session, flush_context, instances):
    """Auto-set created_by / updated_by on new and dirty objects."""
    user_id = _get_user_id()

    for obj in session.new:
        if hasattr(obj, "created_by") and getattr(obj, "created_by") is None:
            obj.created_by = user_id
        if hasattr(obj, "updated_by"):
            obj.updated_by = user_id

    for obj in session.dirty:
        if session.is_modified(obj, include_collections=False):
            if hasattr(obj, "updated_by"):
                obj.updated_by = user_id


@event.listens_for(Session, "do_orm_execute", retval=True)
def _add_soft_delete_filter(execute_state):
    """
    Globally filter out soft-deleted rows from ORM SELECT statements.

    To include deleted rows in a specific query, set the execution option:
        stmt = select(MyModel).execution_options(include_deleted=True)
    """
    if execute_state.is_select and not execute_state.execution_options.get(
        "include_deleted", False
    ):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                SoftDeleteMixin,
                lambda cls: cls.is_deleted.is_(False),
                include_aliases=True,
            )
        )
    return execute_state.invoke_statement()
