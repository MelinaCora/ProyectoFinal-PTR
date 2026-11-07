import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


_STATUS_RANK = {
    "INCOMPLETO": 0,
    "DETECTADA": 1,
    "PRIORIDAD_ACTIVADA": 2,
    "FINALIZADA": 3,
    "RECUPERADA": 4,
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@dataclass(frozen=True)
class IngestResult:
    session_id: str
    duplicate: bool
    received_at: str


class EventStore:
    def __init__(self, database_path):
        self.database_path = Path(database_path)
        if str(self.database_path) != ":memory:":
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()
        self._current_session_id = self._latest_session_id()

    def _connect(self):
        connection = sqlite3.connect(str(self.database_path), timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self):
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS arduino_sessions (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    boot_received_at TEXT,
                    boot_uptime_ms INTEGER,
                    boot_seen INTEGER NOT NULL DEFAULT 0
                        CHECK (boot_seen IN (0, 1))
                );

                CREATE TABLE IF NOT EXISTS incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL REFERENCES arduino_sessions(id),
                    incident_id INTEGER NOT NULL CHECK (incident_id BETWEEN 1 AND 65535),
                    first_received_at TEXT NOT NULL,
                    detected_received_at TEXT,
                    detected_uptime_ms INTEGER,
                    priority_uptime_ms INTEGER,
                    finished_uptime_ms INTEGER,
                    recovered_uptime_ms INTEGER,
                    status TEXT NOT NULL DEFAULT 'INCOMPLETO',
                    response_ms INTEGER CHECK (response_ms >= 0),
                    duration_ms INTEGER CHECK (duration_ms >= 0),
                    recovery_ms INTEGER CHECK (recovery_ms >= 0),
                    UNIQUE (session_id, incident_id)
                );

                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL REFERENCES arduino_sessions(id),
                    incident_row_id INTEGER REFERENCES incidents(id),
                    sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 65535),
                    protocol_version INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    arduino_uptime_ms INTEGER NOT NULL
                        CHECK (arduino_uptime_ms BETWEEN 0 AND 4294967295),
                    received_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    UNIQUE (
                        session_id, sequence, arduino_uptime_ms, type,
                        incident_row_id, payload_json
                    )
                );

                CREATE INDEX IF NOT EXISTS events_incident_order
                    ON events (incident_row_id, id);
                CREATE INDEX IF NOT EXISTS incidents_received_order
                    ON incidents (first_received_at DESC, id DESC);
                """
            )

    def _latest_session_id(self):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT id FROM arduino_sessions ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
            return row["id"] if row else None

    @staticmethod
    def _payload(message):
        return json.dumps(
            message["datos"], ensure_ascii=True, separators=(",", ":"), sort_keys=True
        )

    def _is_duplicate(self, connection, session_id, message, payload_json):
        row = connection.execute(
            """
            SELECT 1 FROM events
            WHERE session_id = ? AND sequence = ? AND arduino_uptime_ms = ?
              AND type = ? AND payload_json = ?
              AND COALESCE(
                    (SELECT incident_id FROM incidents WHERE id = incident_row_id),
                    0
                  ) = ?
            LIMIT 1
            """,
            (
                session_id,
                message["secuencia"],
                message["uptime_ms"],
                message["tipo"],
                payload_json,
                message["incidente_id"],
            ),
        ).fetchone()
        return row is not None

    def ingest(self, message, received_at=None):
        received_at = received_at or utc_now()
        payload_json = self._payload(message)
        with self._lock, self._connection() as connection:
            session = None
            if self._current_session_id is not None:
                session = connection.execute(
                    "SELECT * FROM arduino_sessions WHERE id = ?",
                    (self._current_session_id,),
                ).fetchone()

            if message["tipo"] == "BOOT":
                if session is not None and self._is_duplicate(
                    connection, session["id"], message, payload_json
                ):
                    return IngestResult(session["id"], True, received_at)
                if session is None or session["boot_seen"]:
                    session_id = str(uuid.uuid4())
                    connection.execute(
                        """
                        INSERT INTO arduino_sessions (id, created_at)
                        VALUES (?, ?)
                        """,
                        (session_id, received_at),
                    )
                else:
                    session_id = session["id"]
                connection.execute(
                    """
                    UPDATE arduino_sessions
                    SET boot_seen = 1, boot_received_at = ?, boot_uptime_ms = ?
                    WHERE id = ?
                    """,
                    (received_at, message["uptime_ms"], session_id),
                )
                self._current_session_id = session_id
            else:
                if session is None:
                    session_id = str(uuid.uuid4())
                    connection.execute(
                        """
                        INSERT INTO arduino_sessions (id, created_at)
                        VALUES (?, ?)
                        """,
                        (session_id, received_at),
                    )
                    self._current_session_id = session_id
                else:
                    session_id = session["id"]
                if self._is_duplicate(connection, session_id, message, payload_json):
                    return IngestResult(session_id, True, received_at)

            incident_row_id = None
            incident_id = message["incidente_id"]
            if incident_id:
                incident = connection.execute(
                    """
                    SELECT id FROM incidents
                    WHERE session_id = ? AND incident_id = ?
                    """,
                    (session_id, incident_id),
                ).fetchone()
                if incident is None:
                    cursor = connection.execute(
                        """
                        INSERT INTO incidents (
                            session_id, incident_id, first_received_at
                        ) VALUES (?, ?, ?)
                        """,
                        (session_id, incident_id, received_at),
                    )
                    incident_row_id = cursor.lastrowid
                else:
                    incident_row_id = incident["id"]

            connection.execute(
                """
                INSERT INTO events (
                    session_id, incident_row_id, sequence, protocol_version,
                    type, arduino_uptime_ms, received_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    incident_row_id,
                    message["secuencia"],
                    message["version"],
                    message["tipo"],
                    message["uptime_ms"],
                    received_at,
                    payload_json,
                ),
            )
            if incident_row_id is not None:
                self._update_incident(
                    connection, incident_row_id, message, received_at
                )
            return IngestResult(session_id, False, received_at)

    @staticmethod
    def _update_incident(connection, row_id, message, received_at):
        event_type = message["tipo"]
        uptime = message["uptime_ms"]
        data = message["datos"]
        stage = {
            "EMERGENCIA_DETECTADA": "DETECTADA",
            "PRIORIDAD_ACTIVADA": "PRIORIDAD_ACTIVADA",
            "EMERGENCIA_FINALIZADA": "FINALIZADA",
            "CICLO_RECUPERADO": "RECUPERADA",
        }.get(event_type)
        if stage is None:
            return

        current = connection.execute(
            "SELECT status FROM incidents WHERE id = ?", (row_id,)
        ).fetchone()
        current_status = current["status"]
        status = (
            stage
            if _STATUS_RANK[stage] > _STATUS_RANK[current_status]
            else current_status
        )
        if event_type == "EMERGENCIA_DETECTADA":
            connection.execute(
                """
                UPDATE incidents
                SET status = ?, detected_received_at = COALESCE(detected_received_at, ?),
                    detected_uptime_ms = COALESCE(detected_uptime_ms, ?)
                WHERE id = ?
                """,
                (status, received_at, uptime, row_id),
            )
        elif event_type == "PRIORIDAD_ACTIVADA":
            connection.execute(
                """
                UPDATE incidents
                SET status = ?, priority_uptime_ms = COALESCE(priority_uptime_ms, ?),
                    response_ms = COALESCE(response_ms, ?)
                WHERE id = ?
                """,
                (status, uptime, data["respuesta_ms"], row_id),
            )
        elif event_type == "EMERGENCIA_FINALIZADA":
            connection.execute(
                """
                UPDATE incidents
                SET status = ?, finished_uptime_ms = COALESCE(finished_uptime_ms, ?),
                    duration_ms = COALESCE(duration_ms, ?)
                WHERE id = ?
                """,
                (status, uptime, data["duracion_ms"], row_id),
            )
        else:
            connection.execute(
                """
                UPDATE incidents
                SET status = ?, recovered_uptime_ms = COALESCE(recovered_uptime_ms, ?),
                    recovery_ms = COALESCE(recovery_ms, ?)
                WHERE id = ?
                """,
                (status, uptime, data["recuperacion_ms"], row_id),
            )

    def list_incidents(self, limit, offset):
        with self._lock, self._connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
            rows = connection.execute(
                """
                SELECT i.*, s.boot_received_at
                FROM incidents i
                JOIN arduino_sessions s ON s.id = i.session_id
                ORDER BY i.first_received_at DESC, i.id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
            return {"items": [dict(row) for row in rows], "total": total}

    def get_incident(self, incident_row_id):
        with self._lock, self._connection() as connection:
            row = connection.execute(
                """
                SELECT i.*, s.boot_received_at, s.boot_uptime_ms, s.boot_seen
                FROM incidents i
                JOIN arduino_sessions s ON s.id = i.session_id
                WHERE i.id = ?
                """,
                (incident_row_id,),
            ).fetchone()
            if row is None:
                return None
            incident = dict(row)
            events = connection.execute(
                """
                SELECT id, sequence, protocol_version, type, arduino_uptime_ms,
                       received_at, payload_json
                FROM events
                WHERE incident_row_id = ?
                ORDER BY id
                """,
                (incident_row_id,),
            ).fetchall()
            incident["events"] = [
                {
                    **{key: event[key] for key in event.keys() if key != "payload_json"},
                    "data": json.loads(event["payload_json"]),
                }
                for event in events
            ]
            return incident

    def metrics(self):
        with self._lock, self._connection() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       COUNT(response_ms) AS response_count,
                       AVG(response_ms) AS response_average_ms,
                       MIN(response_ms) AS response_min_ms,
                       MAX(response_ms) AS response_max_ms
                FROM incidents
                """
            ).fetchone()
            return dict(row)
