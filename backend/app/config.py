import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = PROJECT_ROOT / "backend" / "data" / "siv_events.sqlite3"


@dataclass(frozen=True)
class Settings:
    serial_port: str = "/tmp/siv-python"
    baudrate: int = 9600
    database_path: Path = DEFAULT_DATABASE
    serial_enabled: bool = True
    retry_seconds: float = 2.0

    @classmethod
    def from_env(cls):
        serial_enabled = os.getenv("SIV_SERIAL_ENABLED", "true").strip().lower()
        if serial_enabled not in {"true", "false", "1", "0", "yes", "no"}:
            raise ValueError("SIV_SERIAL_ENABLED debe ser true o false")

        try:
            baudrate = int(os.getenv("SIV_BAUDRATE", "9600"))
            retry_seconds = float(os.getenv("SIV_RETRY_SECONDS", "2"))
        except ValueError as exc:
            raise ValueError("SIV_BAUDRATE y SIV_RETRY_SECONDS deben ser numericos") from exc

        if baudrate <= 0:
            raise ValueError("SIV_BAUDRATE debe ser mayor que cero")
        if retry_seconds <= 0:
            raise ValueError("SIV_RETRY_SECONDS debe ser mayor que cero")

        return cls(
            serial_port=os.getenv("SIV_SERIAL_PORT", "/tmp/siv-python"),
            baudrate=baudrate,
            database_path=Path(os.getenv("SIV_DATABASE_PATH", str(DEFAULT_DATABASE))),
            serial_enabled=serial_enabled in {"true", "1", "yes"},
            retry_seconds=retry_seconds,
        )
