from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse

from app.security import current_user
from app.store.media import MediaRepo
from app.xai.errors import AppError

router = APIRouter(prefix="/files")

_MAX_BYTES = 12 * 1024 * 1024
_ALLOWED = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/x-python",
    "application/json",
}


def _media(request: Request) -> MediaRepo:
    return MediaRepo(request.app.state.db, request.app.state.settings.media_root)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "filename": row["filename"],
        "mime": row["mime"],
        "size": row["size"],
        "project_id": row.get("project_id"),
        "created_at": row["created_at"],
        "url": f"/api/files/{row['id']}/content",
    }


@router.get("")
async def list_files(
    request: Request,
    project_id: str | None = None,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    rows = await _media(request).list_files(str(user["id"]), project_id)
    return {"files": [_public(r) for r in rows]}


@router.post("")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    project_id: str | None = Form(default=None),
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise AppError("invalid_argument", "文件超过 12MB", status_code=400)
    mime = file.content_type or "application/octet-stream"
    name = file.filename or "upload.bin"
    if mime not in _ALLOWED and not (
        mime.startswith("text/") or mime.startswith("image/")
    ):
        raise AppError("invalid_argument", f"不支持的类型 {mime}", status_code=400)
    uid = str(user["id"])
    media = _media(request)
    if project_id:
        proj = await media.get_project(uid, project_id)
        if proj is None:
            raise AppError("not_found", "项目不存在", status_code=404)
    rel_dir = f"uploads/{uid}"
    (media.root / rel_dir).mkdir(parents=True, exist_ok=True)
    row = await media.insert_file(
        uid,
        name,
        mime,
        len(data),
        "tmp",
        project_id=project_id,
    )
    ext = name.rsplit(".", 1)[-1] if "." in name else "bin"
    rel = f"{rel_dir}/{row['id']}.{ext}"
    (media.root / rel).write_bytes(data)
    await media.set_file_path(uid, row["id"], rel)
    saved = await media.get_file(uid, row["id"])
    assert saved is not None
    return {"file": _public(saved)}


@router.get("/{file_id}/content")
async def file_content(
    file_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> FileResponse:
    media = _media(request)
    row = await media.get_file(str(user["id"]), file_id)
    if row is None:
        raise AppError("not_found", "文件不存在", status_code=404)
    path = media.root / str(row["path"])
    if not path.is_file():
        raise AppError("not_found", "文件缺失", status_code=404)
    return FileResponse(path, media_type=str(row["mime"]), filename=str(row["filename"]))


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, bool]:
    ok = await _media(request).soft_delete_file(str(user["id"]), file_id)
    if not ok:
        raise AppError("not_found", "文件不存在", status_code=404)
    return {"ok": True}
