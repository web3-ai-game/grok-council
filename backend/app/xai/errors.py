from typing import Any


class AppError(Exception):
    """归一化错误，由全局 handler 转成 {"error": {code, message, retryable}}。"""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        status_code: int = 400,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status_code = status_code
        self.retry_after = retry_after

    def to_body(self) -> dict[str, Any]:
        error: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.retry_after is not None:
            error["retry_after"] = self.retry_after
        return {"error": error}


def mask_key(key: str) -> str:
    if len(key) <= 8:
        return "***"
    return f"{key[:8]}***"
