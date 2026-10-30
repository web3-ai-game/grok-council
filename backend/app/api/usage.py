from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request

from app.security import current_user

router = APIRouter()


@router.get("/usage")
async def get_usage(
    request: Request,
    range: str = "today",
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    if range == "7d":
        since = now - timedelta(days=7)
    elif range == "30d":
        since = now - timedelta(days=30)
    else:
        since = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since_iso = since.replace(microsecond=0).isoformat()
    summary = await request.app.state.db.usage_summary(str(user["id"]), since_iso)
    return {"range": range, "since": since_iso, **summary}
