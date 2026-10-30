"""5 字段 cron（分 时 日 月 周）。不引入第三方依赖。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

_FIELD_BOUNDS = (
    (0, 59),  # minute
    (0, 23),  # hour
    (1, 31),  # day of month
    (1, 12),  # month
    (0, 6),  # day of week, 0=Sunday
)


class CronError(ValueError):
    pass


def parse_field(expr: str, min_v: int, max_v: int) -> set[int]:
    expr = expr.strip()
    if not expr:
        raise CronError("空 cron 字段")
    values: set[int] = set()
    for part in expr.split(","):
        part = part.strip()
        if not part:
            raise CronError("空 cron 子字段")
        step = 1
        if "/" in part:
            base, step_s = part.split("/", 1)
            try:
                step = int(step_s)
            except ValueError as exc:
                raise CronError(f"非法步长 {part}") from exc
            if step <= 0:
                raise CronError(f"非法步长 {part}")
            part = base or "*"
        if part == "*":
            start, end = min_v, max_v
        elif "-" in part:
            a, b = part.split("-", 1)
            try:
                start, end = int(a), int(b)
            except ValueError as exc:
                raise CronError(f"非法范围 {part}") from exc
        else:
            try:
                start = end = int(part)
            except ValueError as exc:
                raise CronError(f"非法值 {part}") from exc
        if start < min_v or end > max_v or start > end:
            raise CronError(f"超出范围 {part}（{min_v}-{max_v}）")
        values.update(range(start, end + 1, step))
    return values


def validate_cron(expr: str) -> str:
    parts = expr.split()
    if len(parts) != 5:
        raise CronError("cron 须为 5 字段：分 时 日 月 周")
    for part, (lo, hi) in zip(parts, _FIELD_BOUNDS, strict=True):
        parse_field(part, lo, hi)
    return " ".join(parts)


def _cron_dow(dt: datetime) -> int:
    # Python Monday=0 → cron Sunday=0
    return (dt.weekday() + 1) % 7


def matches(expr: str, dt: datetime) -> bool:
    parts = validate_cron(expr).split()
    minute, hour, dom, month, dow = (
        parse_field(parts[i], *_FIELD_BOUNDS[i]) for i in range(5)
    )
    if dt.minute not in minute or dt.hour not in hour or dt.month not in month:
        return False
    dom_star = parts[2] == "*"
    dow_star = parts[4] == "*"
    in_dom = dt.day in dom
    in_dow = _cron_dow(dt) in dow
    if not dom_star and not dow_star:
        return in_dom or in_dow
    return in_dom and in_dow


def next_run_after(expr: str, after: datetime) -> datetime:
    validate_cron(expr)
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    cursor = after.astimezone(timezone.utc).replace(second=0, microsecond=0) + timedelta(
        minutes=1
    )
    for _ in range(366 * 24 * 60):
        if matches(expr, cursor):
            return cursor
        cursor += timedelta(minutes=1)
    raise CronError("找不到下一次执行时间")
