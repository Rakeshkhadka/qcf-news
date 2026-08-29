"""
Filter / ordering maps for the users module.

Used by the generic filter_and_sort utility in repository queries.
"""

ROLE_FILTER_MAP = {
    "name": "name__icontains",
}

ROLE_ORDERING_MAP = {
    "name": "name",
    "id": "id",
    "created_at": "created_at",
}

USER_FILTER_MAP = {
    "first_name": "first_name__icontains",
    "last_name": "last_name__icontains",
    "email": "email__icontains",
}

USER_ORDERING_MAP = {
    "first_name": "first_name",
    "email": "email",
    "id": "id",
}

PERMISSION_FILTER_MAP = {
    "name": "name__icontains",
    "module": "module__exact",
    "code": "code__icontains",
}

PERMISSION_ORDERING_MAP = {
    "name": "name",
    "code": "code",
    "module": "module",
    "id": "id",
}
