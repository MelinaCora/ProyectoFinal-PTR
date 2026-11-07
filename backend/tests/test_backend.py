import asyncio
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

from httpx import ASGITransport, AsyncClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.serial_service import RuntimeStatus, SerialWorker
from backend.app.storage import EventStore
from tools.serial_protocol import parsear_mensaje


def parse(line):
    return parsear_mensaje(line + "\n")


class EventStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "events.sqlite3"
        self.store = EventStore(self.database_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_creates_schema_and_ingests_protocol_event(self):
        with closing(sqlite3.connect(self.database_path)) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
        self.assertTrue({"arduino_sessions", "incidents", "events"} <= tables)

        result = self.store.ingest(
            parse("SIV,1,1,121,EMERGENCIA_DETECTADA,7,A,R,G,B_VERDE,25"),
            "2026-11-07T10:00:00.000+00:00",
        )
        self.assertFalse(result.duplicate)
        detail = self.store.get_incident(1)
        self.assertEqual(detail["incident_id"], 7)
        self.assertEqual(detail["status"], "DETECTADA")
        self.assertEqual(detail["detected_uptime_ms"], 121)
        self.assertEqual(detail["events"][0]["data"]["carril"], "A")

    def test_deduplicates_exact_message(self):
        message = parse("SIV,1,3,8300,EMERGENCIA_DETECTADA,7,A,R,G,B_VERDE,143")
        first = self.store.ingest(message, "2026-11-07T10:00:00.000+00:00")
        duplicate = self.store.ingest(message, "2026-11-07T10:00:02.000+00:00")
        self.assertEqual(first.session_id, duplicate.session_id)
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(self.store.list_incidents(20, 0)["total"], 1)
        self.assertEqual(len(self.store.get_incident(1)["events"]), 1)

    def test_lifecycle_and_events_share_incident(self):
        messages = [
            "SIV,1,0,120,BOOT,0",
            "SIV,1,1,8300,EMERGENCIA_DETECTADA,1,A,R,G,B_VERDE,143",
            "SIV,1,2,10301,PRIORIDAD_ACTIVADA,1,2001,G,R,PRIORIDAD_A",
            "SIV,1,3,18600,EMERGENCIA_FINALIZADA,1,8299",
            "SIV,1,4,22600,CICLO_RECUPERADO,1,4000",
        ]
        for line in messages:
            self.store.ingest(parse(line))

        detail = self.store.get_incident(1)
        self.assertEqual(detail["status"], "RECUPERADA")
        self.assertEqual(detail["response_ms"], 2001)
        self.assertEqual(detail["duration_ms"], 8299)
        self.assertEqual(detail["recovery_ms"], 4000)
        self.assertEqual(
            [event["type"] for event in detail["events"]],
            [
                "EMERGENCIA_DETECTADA",
                "PRIORIDAD_ACTIVADA",
                "EMERGENCIA_FINALIZADA",
                "CICLO_RECUPERADO",
            ],
        )
        self.assertTrue(all(event["sequence"] > 0 for event in detail["events"]))

    def test_out_of_order_events_do_not_regress_incident(self):
        later = self.store.ingest(
            parse("SIV,1,3,18600,EMERGENCIA_FINALIZADA,11,8299")
        )
        self.store.ingest(
            parse("SIV,1,1,8300,EMERGENCIA_DETECTADA,11,A,R,G,B_VERDE,143")
        )
        boot = self.store.ingest(parse("SIV,1,0,120,BOOT,0"))
        detail = self.store.get_incident(1)
        self.assertEqual(detail["status"], "FINALIZADA")
        self.assertEqual(detail["detected_uptime_ms"], 8300)
        self.assertEqual(detail["finished_uptime_ms"], 18600)
        self.assertEqual(len(detail["events"]), 2)
        self.assertEqual(boot.session_id, later.session_id)

    def test_incident_id_is_scoped_to_arduino_session(self):
        events = [
            "SIV,1,0,100,BOOT,0",
            "SIV,1,1,200,EMERGENCIA_DETECTADA,5,A,R,G,A_VERDE,10",
            "SIV,1,0,50,BOOT,0",
            "SIV,1,1,150,EMERGENCIA_DETECTADA,5,A,R,G,A_VERDE,10",
        ]
        for line in events:
            self.store.ingest(parse(line))
        incidents = self.store.list_incidents(20, 0)["items"]
        self.assertEqual(len(incidents), 2)
        self.assertEqual({row["incident_id"] for row in incidents}, {5})
        self.assertEqual(len({row["session_id"] for row in incidents}), 2)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        settings = Settings(
            database_path=Path(self.temp_dir.name) / "api.sqlite3",
            serial_enabled=False,
        )
        self.app = create_app(settings)

    def tearDown(self):
        self.temp_dir.cleanup()

    def request(self, method, path):
        async def send():
            async with AsyncClient(
                transport=ASGITransport(app=self.app),
                base_url="http://testserver",
            ) as client:
                return await client.request(method, path)

        return asyncio.run(send())

    def test_empty_api_and_serial_health(self):
        health = self.request("GET", "/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "degraded")
        self.assertFalse(health.json()["serial"]["connected"])

        state = self.request("GET", "/api/estado").json()
        self.assertIsNone(state["semaforo_a"])
        self.assertFalse(state["serial_connected"])

        self.assertEqual(
            self.request("GET", "/api/emergencias").json(),
            {"items": [], "total": 0, "limit": 20, "offset": 0},
        )
        self.assertEqual(
            self.request("GET", "/api/metricas").json(),
            {
                "total": 0,
                "response_count": 0,
                "response_average_ms": None,
                "response_min_ms": None,
                "response_max_ms": None,
            },
        )
        self.assertEqual(self.request("GET", "/api/emergencias/1").status_code, 404)
        self.assertEqual(
            self.request("GET", "/api/emergencias?limit=0").status_code, 422
        )

    def test_history_detail_pagination_and_metrics(self):
        store = self.app.state.store
        for sequence, incident_id, response in ((1, 21, 100), (2, 22, 300)):
            store.ingest(
                parse(
                    "SIV,1,{},{},PRIORIDAD_ACTIVADA,{},{},G,R,PRIORIDAD_A".format(
                        sequence, sequence * 100, incident_id, response
                    )
                )
            )

        history = self.request("GET", "/api/emergencias?limit=1&offset=0").json()
        self.assertEqual(history["total"], 2)
        self.assertEqual(history["limit"], 1)
        newest_id = history["items"][0]["id"]
        detail = self.request("GET", "/api/emergencias/{}".format(newest_id))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["events"][0]["type"], "PRIORIDAD_ACTIVADA")

        metrics = self.request("GET", "/api/metricas").json()
        self.assertEqual(metrics["total"], 2)
        self.assertEqual(metrics["response_count"], 2)
        self.assertEqual(metrics["response_average_ms"], 200.0)
        self.assertEqual(metrics["response_min_ms"], 100)
        self.assertEqual(metrics["response_max_ms"], 300)


class SerialWorkerTests(unittest.TestCase):
    def test_open_port_without_heartbeat_is_not_healthy(self):
        status = RuntimeStatus()
        status.connected()
        health = status.health("/tmp/test-siv", 9600)
        self.assertEqual(health["backend"], "ok")
        self.assertEqual(health["status"], "degraded")
        self.assertTrue(health["serial"]["connected"])
        self.assertFalse(health["serial"]["controller_observed"])

    def test_worker_ingests_state_and_incident_messages(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        store = EventStore(Path(temp_dir.name) / "serial.sqlite3")
        status = RuntimeStatus()
        lines = [
            b"SIV,1,0,120,BOOT,0\n",
            b"SIV,1,1,121,STATE,0,G,R,A_VERDE,NORMAL,5000\n",
            b"SIV,1,2,1121,HEARTBEAT,0,G,R,A_VERDE,NORMAL,4000\n",
            b"SIV,1,3,8300,EMERGENCIA_DETECTADA,7,A,R,G,B_VERDE,143\n",
        ]

        class FakeSerial:
            def __init__(self):
                self.closed = False

            def readline(self):
                if lines:
                    return lines.pop(0)
                time.sleep(0.005)
                return b""

            def close(self):
                self.closed = True

        fake_port = FakeSerial()
        worker = SerialWorker(
            store,
            status,
            "/tmp/test-siv",
            9600,
            retry_seconds=0.1,
            serial_factory=lambda _port, _baudrate: fake_port,
        )
        worker.start()
        self.addCleanup(worker.stop)
        deadline = time.time() + 1
        while store.list_incidents(10, 0)["total"] == 0:
            if time.time() >= deadline:
                self.fail("el receptor no persistió el evento de emergencia")
            time.sleep(0.01)

        snapshot = status.snapshot()
        self.assertTrue(snapshot["serial_connected"])
        self.assertEqual(snapshot["semaforo_a"], "G")
        self.assertEqual(snapshot["semaforo_b"], "R")
        self.assertIsNotNone(snapshot["last_heartbeat_received_at"])
        self.assertEqual(status.health("/tmp/test-siv", 9600)["status"], "ok")
        self.assertEqual(store.get_incident(1)["incident_id"], 7)
        self.assertEqual(store.get_incident(1)["status"], "DETECTADA")

    def test_serial_disconnect_is_reported_and_does_not_stop_backend(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        status = RuntimeStatus()
        store = EventStore(Path(temp_dir.name) / "serial.sqlite3")

        def disconnected_port(_port, _baudrate):
            raise OSError("puerto no disponible")

        worker = SerialWorker(
            store,
            status,
            "/tmp/ausente",
            9600,
            retry_seconds=0.1,
            serial_factory=disconnected_port,
        )
        worker.start()
        self.addCleanup(worker.stop)
        deadline = time.time() + 1
        while status.health("/tmp/ausente", 9600)["serial"]["last_error"] is None:
            if time.time() >= deadline:
                self.fail("no se informó la desconexión serial")
            time.sleep(0.01)

        health = status.health("/tmp/ausente", 9600)
        self.assertEqual(health["backend"], "ok")
        self.assertFalse(health["serial"]["connected"])
        self.assertIn("puerto no disponible", health["serial"]["last_error"])


if __name__ == "__main__":
    unittest.main()
