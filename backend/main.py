from __future__ import annotations

import json
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class Movie(BaseModel):
    id: int
    title: str
    description: str
    poster_url: str
    rating: float
    categories: List[str] = Field(default_factory=list)
    mood: List[str] = Field(default_factory=list)
    content_type: str


DATA_PATH = Path(__file__).with_name("movies.json")
PAGE_SIZE = 10

app = FastAPI(title="FeelFilms Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_movies() -> list[Movie]:
    with DATA_PATH.open("r", encoding="utf-8") as f:
        raw_data = json.load(f)
    return [Movie(**item) for item in raw_data]


def _split_csv(value: str) -> list[str]:
    if not value:
        return []
    return [item.strip().lower() for item in value.split(",") if item.strip()]


@app.get("/api/movies")
def get_movies(
    page: int = Query(1, ge=1),
    content_type: str = Query("", description="FILM, SERIES, CARTOON etc."),
    categories: str = Query("", description="comma-separated categories"),
    mood: str = Query("", description="comma-separated moods"),
):
    movies = _load_movies()

    categories_filter = _split_csv(categories)
    mood_filter = _split_csv(mood)
    normalized_content_type = content_type.strip().lower()

    filtered = movies
    if normalized_content_type:
        filtered = [
            movie for movie in filtered if movie.content_type.strip().lower() == normalized_content_type
        ]

    if categories_filter:
        filtered = [
            movie
            for movie in filtered
            if any(category.lower() in categories_filter for category in movie.categories)
        ]

    if mood_filter:
        filtered = [
            movie for movie in filtered if any(m.lower() in mood_filter for m in movie.mood)
        ]

    total = len(filtered)
    start = (page - 1) * PAGE_SIZE
    end = start + PAGE_SIZE
    items = filtered[start:end]

    return {
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "total_pages": (total + PAGE_SIZE - 1) // PAGE_SIZE,
        "items": [movie.model_dump() for movie in items],
    }


@app.get("/api/movies/{film_id}")
def get_movie_details(film_id: int):
    movies = _load_movies()
    for movie in movies:
        if movie.id == film_id:
            return movie.model_dump()
    raise HTTPException(status_code=404, detail=f"Movie with id={film_id} not found")
