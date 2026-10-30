from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.chats import router as chats_router
from app.api.files import router as files_router
from app.api.generate import router as generate_router
from app.api.health import router as health_router
from app.api.imagine import router as imagine_router
from app.api.memory import router as memory_router
from app.api.models import router as models_router
from app.api.projects import router as projects_router
from app.api.tasks import router as tasks_router
from app.api.usage import router as usage_router
from app.api.voice import router as voice_router
from app.config import get_settings
from app.store.db import Database
from app.tasks.scheduler import run_scheduler
from app.xai.client import XaiClient
from app.xai.errors import AppError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    db = Database(settings.database_path)
    await db.connect()
    client = XaiClient(settings)
    app.state.db = db
    app.state.xai = client
    app.state.settings = settings
    app.state.active_streams = {}
    stop = asyncio.Event()
    scheduler = asyncio.create_task(run_scheduler(db, client, stop))
    try:
        yield
    finally:
        stop.set()
        scheduler.cancel()
        try:
            await scheduler
        except (asyncio.CancelledError, Exception):
            pass
        await client.aclose()
        await db.close()


app = FastAPI(title="OECE-X Heavy", lifespan=lifespan)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(chats_router, prefix="/api")
app.include_router(generate_router, prefix="/api")
app.include_router(usage_router, prefix="/api")
app.include_router(imagine_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(voice_router, prefix="/api")


@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    headers = {}
    if exc.retry_after is not None:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_body(),
        headers=headers,
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "内部错误",
                "retryable": False,
            }
        },
    )
