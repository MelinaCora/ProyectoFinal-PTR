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

_INCIDENT_SELECT = """
    SELECT i.*, s.boot_received_at, s.boot_uptime_ms, s.boot_seen,
           (SELECT MIN(e.received_at) FROM events e
            WHERE e.incident_row_id = i.id AND e.type = 'PRIORIDAD_ACTIVADA')
               AS priority_received_at,
           (SELECT MIN(e.received_at) FROM events e
            WHERE e.incident_row_id = i.id AND e.type = 'EMERGENCIA_FINALIZADA')
               AS finished_received_at,
           (SELECT MIN(e.received_at) FROM events e
            WHERE e.incident_row_id = i.id AND e.type = 'CICLO_RECUPERADO')
               AS recovered_received_at{sort_column}
    FROM incidents i
    JOIN arduino_sessions s ON s.id = i.session_id
"""


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

    @staticmethod
    def _incident_filters(start_at=None, end_at=None, status=None, search=None):
        conditions = []
        values = []
        if start_at is not None:
            conditions.append("julianday(i.first_received_at) >= julianday(?)")
            values.append(start_at)
        if end_at is not None:
            conditions.append("julianday(i.first_received_at) < julianday(?)")
            values.append(end_at)
        if status:
            conditions.append("i.status = ?")
            values.append(status)
        if search:
            value = search.strip().lstrip("#")
            conditions.append(
                "(instr(CAST(i.id AS TEXT), ?) > 0 "
                "OR instr(CAST(i.incident_id AS TEXT), ?) > 0)"
            )
            values.extend((value, value))
        clause = " WHERE " + " AND ".join(conditions) if conditions else ""
        return clause, values

    def list_incidents(
        self,
        limit,
        offset,
        start_at=None,
        end_at=None,
        status=None,
        search=None,
        order="desc",
    ):
        where, values = self._incident_filters(start_at, end_at, status, search)
        direction = "ASC" if order == "asc" else "DESC"
        with self._lock, self._connection() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM incidents i" + where, values
            ).fetchone()[0]
            rows = connection.execute(
                _INCIDENT_SELECT.format(sort_column="")
                + where
                + " ORDER BY COALESCE(julianday(i.first_received_at), 0) {} , i.id {} LIMIT ? OFFSET ?".format(
                    direction, direction
                ),
                values + [limit, offset],
            ).fetchall()
            return {"items": [dict(row) for row in rows], "total": total}

    def iter_incidents(
        self,
        start_at=None,
        end_at=None,
        status=None,
        search=None,
        order="desc",
        batch_size=500,
    ):
        where, values = self._incident_filters(start_at, end_at, status, search)
        direction = "ASC" if order == "asc" else "DESC"
        comparison = ">" if order == "asc" else "<"
        with self._lock, self._connection() as connection:
            maximum_id = connection.execute(
                "SELECT COALESCE(MAX(id), 0) FROM incidents"
            ).fetchone()[0]
        if maximum_id == 0:
            return

        base_conditions = where[7:] if where else ""
        last_sort_time = None
        last_id = None
        while True:
            conditions = [base_conditions] if base_conditions else []
            conditions.append("i.id <= ?")
            query_values = values + [maximum_id]
            if last_sort_time is not None:
                conditions.append(
                    "(COALESCE(julianday(i.first_received_at), 0) {0} ? OR "
                    "(COALESCE(julianday(i.first_received_at), 0) = ? AND i.id {0} ?))".format(
                        comparison
                    )
                )
                query_values.extend((last_sort_time, last_sort_time, last_id))
            clause = " WHERE " + " AND ".join(conditions)
            with self._lock, self._connection() as connection:
                rows = connection.execute(
                    _INCIDENT_SELECT.format(
                        sort_column=", COALESCE(julianday(i.first_received_at), 0) AS _sort_time"
                    )
                    + clause
                    + " ORDER BY COALESCE(julianday(i.first_received_at), 0) {} , i.id {} LIMIT ?".format(
                        direction, direction
                    ),
                    query_values + [batch_size],
                ).fetchall()
            if not rows:
                break
            last_sort_time = rows[-1]["_sort_time"]
            last_id = rows[-1]["id"]
            for row in rows:
                yield {key: row[key] for key in row.keys() if key != "_sort_time"}

    def get_incident(self, incident_row_id):
        with self._lock, self._connection() as connection:
            row = connection.execute(
                _INCIDENT_SELECT.format(sort_column="") + " WHERE i.id = ?",
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

    def analytics(self, start_at=None, end_at=None):
        where, values = self._incident_filters(start_at, end_at)
        response_where = where + " AND" if where else " WHERE"
        with self._lock, self._connection() as connection:
            summary = dict(
                connection.execute(
                    """
                    SELECT COUNT(*) AS total,
                           COUNT(response_ms) AS response_count,
                           AVG(response_ms) AS response_average_ms,
                           MIN(response_ms) AS response_min_ms,
                           MAX(response_ms) AS response_max_ms,
                           AVG(duration_ms) AS duration_average_ms,
                           AVG(recovery_ms) AS recovery_average_ms,
                           SUM(CASE WHEN status IN ('FINALIZADA', 'RECUPERADA')
                                    THEN 1 ELSE 0 END) AS completed,
                           SUM(CASE WHEN status IN (
                               'INCOMPLETO', 'DETECTADA', 'PRIORIDAD_ACTIVADA'
                           ) THEN 1 ELSE 0 END) AS pending
                    FROM incidents i
                    """
                    + where,
                    values,
                ).fetchone()
            )
            summary["completed"] = summary["completed"] or 0
            summary["pending"] = summary["pending"] or 0
            summary["status_counts"] = {
                row["status"]: row["count"]
                for row in connection.execute(
                    "SELECT i.status, COUNT(*) AS count FROM incidents i"
                    + where
                    + " GROUP BY i.status ORDER BY i.status",
                    values,
                ).fetchall()
            }
            summary["incidents_by_day"] = {
                row["day"]: row["count"]
                for row in connection.execute(
                    "SELECT date(i.first_received_at) AS day, COUNT(*) AS count "
                    "FROM incidents i"
                    + where
                    + " GROUP BY date(i.first_received_at) ORDER BY day",
                    values,
                ).fetchall()
                if row["day"] is not None
            }
            summary["response_series"] = [
                dict(row)
                for row in connection.execute(
                    """
                    WITH measurements AS (
                        SELECT i.id, i.incident_id, i.first_received_at,
                               i.response_ms,
                               ROW_NUMBER() OVER (ORDER BY COALESCE(
                                   julianday(i.first_received_at), 0
                               ), i.id) AS row_number,
                               COUNT(*) OVER () AS measurement_count
                        FROM incidents i
                        """
                    + response_where
                    + """
                          i.response_ms IS NOT NULL
                    ), buckets AS (
                        SELECT *, (row_number - 1) * 1000 / measurement_count AS bucket
                        FROM measurements
                    ), sampled AS (
                        SELECT *, LAG(bucket) OVER (ORDER BY row_number) AS previous_bucket
                        FROM buckets
                    )
                    SELECT id, incident_id, first_received_at, response_ms,
                           measurement_count
                    FROM sampled
                    WHERE previous_bucket IS NULL OR bucket != previous_bucket
                    ORDER BY COALESCE(julianday(first_received_at), 0), id
                    """,
                    values,
                ).fetchall()
            ]
            return summary
