"""
Category service — business logic for news categories.
"""
from typing import Optional

from fastapi import status

from src.apps.v1.news.models.news import Category
from src.apps.v1.news.schemas.news import CategoryCreate, CategoryOutput, CategoryUpdate
from src.apps.v1.news.unit_of_work.interfaces import INewsUnitOfWork
from src.utils.exceptions import AlreadyExistsException, NotFoundException
from src.utils.response import ResponseSuccess


class CategoryService:
    def __init__(self, uow: INewsUnitOfWork):
        self.uow = uow

    async def list_categories(
        self, *, search: Optional[str] = None, limit: int = 10, offset: int = 0
    ):
        async with self.uow as uow:
            categories, total = await uow.category_repository.get_all(
                search=search, limit=limit, offset=offset,
            )
            data = [CategoryOutput.model_validate(c).model_dump(mode="json") for c in categories]
        return ResponseSuccess(
            message="Categories", data=data, total_count=total
        ).to_response()

    async def get_category(self, category_id: int):
        async with self.uow as uow:
            cat = await uow.category_repository.get_by_id(category_id)
            if not cat:
                raise NotFoundException(detail="Category not found")
            data = CategoryOutput.model_validate(cat).model_dump(mode="json")
        return ResponseSuccess(message="Category detail", data=data).to_response()

    async def create_category(self, payload: CategoryCreate, *, user_id: int):
        async with self.uow as uow:
            existing = await uow.category_repository.get_by_slug(payload.slug)
            if existing:
                raise AlreadyExistsException(detail="Category slug already exists")

            cat = Category(
                name=payload.name,
                slug=payload.slug,
                description=payload.description,
                created_by=user_id,
                updated_by=user_id,
            )
            cat_id = await uow.category_repository.create(cat)

        return ResponseSuccess(
            message="Category created",
            data={"id": cat_id},
            status_code=status.HTTP_201_CREATED,
        ).to_response()

    async def update_category(self, category_id: int, payload: CategoryUpdate, *, user_id: int):
        async with self.uow as uow:
            cat = await uow.category_repository.get_by_id(category_id)
            if not cat:
                raise NotFoundException(detail="Category not found")
            data = payload.model_dump(exclude_unset=True)
            data["updated_by"] = user_id
            await uow.category_repository.update(category_id, data)
        return ResponseSuccess(
            message="Category updated", data={"id": category_id}
        ).to_response()

    async def delete_category(self, category_id: int, *, user_id: int):
        async with self.uow as uow:
            cat = await uow.category_repository.get_by_id(category_id)
            if not cat:
                raise NotFoundException(detail="Category not found")
            await uow.category_repository.delete(category_id, user_id=user_id)
        return ResponseSuccess(
            message="Category deleted", data={"id": category_id}
        ).to_response()
