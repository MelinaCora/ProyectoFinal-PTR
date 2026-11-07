import asyncio
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.serial_service import RuntimeStatus, SerialWorker, websocket_message
from backend.app.storage import EventStore
from backend.app.websocket_hub import WebSocketHub
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

    def test_cors_is_limited_to_local_dashboard_origins(self):
        with TestClient(self.app) as client:
            allowed = client.get(
                "/health", headers={"Origin": "http://localhost:8080"}
            )
            allowed_loopback = client.get(
                "/health", headers={"Origin": "http://127.0.0.1:8080"}
            )
            rejected = client.get(
                "/health", headers={"Origin": "http://example.com"}
            )
        self.assertEqual(
            allowed.headers["access-control-allow-origin"], "http://localhost:8080"
        )
        self.assertEqual(
            allowed_loopback.headers["access-control-allow-origin"],
            "http://127.0.0.1:8080",
        )
        self.assertNotIn("access-control-allow-origin", rejected.headers)

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

    def test_worker_publishes_only_persisted_messages(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        store = EventStore(Path(temp_dir.name) / "serial.sqlite3")
        status = RuntimeStatus()
        lines = [
            b"SIV,1,1,121,STATE,0,G,R,A_VERDE,NORMAL,5000\n",
            b"SIV,1,1,121,STATE,0,G,R,A_VERDE,NORMAL,5000\n",
        ]
        published = []

        class FakeSerial:
            def readline(self):
                if lines:
                    return lines.pop(0)
                time.sleep(0.005)
                return b""

            def close(self):
                pass

        worker = SerialWorker(
            store,
            status,
            "/tmp/test-siv",
            9600,
            retry_seconds=0.1,
            serial_factory=lambda _port, _baudrate: FakeSerial(),
            on_message=lambda message, result: published.append(
                websocket_message(message, result)
            ),
        )
        worker.start()
        self.addCleanup(worker.stop)
        deadline = time.time() + 1
        while lines:
            if time.time() >= deadline:
                self.fail("el receptor no consumió las tramas seriales")
            time.sleep(0.01)
        time.sleep(0.05)

        self.assertEqual(len(published), 1)
        self.assertEqual(published[0]["type"], "state")
        self.assertEqual(store.list_incidents(10, 0)["total"], 0)

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

    def test_worker_reports_serial_disconnect_and_reconnection(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        store = EventStore(Path(temp_dir.name) / "serial.sqlite3")
        status = RuntimeStatus()
        disconnect = threading.Event()
        transitions = []
        factory_calls = []

        class FakeSerial:
            def __init__(self, should_disconnect):
                self.should_disconnect = should_disconnect

            def readline(self):
                if self.should_disconnect and disconnect.wait(0.01):
                    raise OSError("conexión perdida")
                time.sleep(0.01)
                return b""

            def close(self):
                pass

        def serial_factory(_port, _baudrate):
            factory_calls.append(True)
            return FakeSerial(len(factory_calls) == 1)

        worker = SerialWorker(
            store,
            status,
            "/tmp/test-siv",
            9600,
            retry_seconds=0.01,
            serial_factory=serial_factory,
            on_connection=lambda snapshot: transitions.append(
                snapshot["serial_connected"]
            ),
        )
        worker.start()
        self.addCleanup(worker.stop)
        deadline = time.time() + 1
        while not transitions:
            if time.time() >= deadline:
                self.fail("no se informó la conexión serial inicial")
            time.sleep(0.01)
        disconnect.set()
        while transitions != [True, False, True]:
            if time.time() >= deadline:
                self.fail("no se informaron pérdida y recuperación serial")
            time.sleep(0.01)


class WebSocketTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        settings = Settings(
            database_path=Path(self.temp_dir.name) / "ws.sqlite3",
            serial_enabled=False,
        )
        self.app = create_app(settings)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_snapshot_state_incident_two_clients_and_disconnect(self):
        store = self.app.state.store
        runtime = self.app.state.runtime
        boot = parse("SIV,1,0,120,BOOT,0")
        state = parse("SIV,1,1,121,STATE,0,G,R,A_VERDE,NORMAL,5000")
        boot_result = store.ingest(boot)
        runtime.observe(boot, boot_result)
        state_result = store.ingest(state)
        runtime.observe(state, state_result)

        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/monitor") as first:
                initial = first.receive_json()
                self.assertEqual(initial["type"], "snapshot")
                self.assertEqual(initial["data"]["semaforo_a"], "G")

                with client.websocket_connect("/ws/monitor") as second:
                    second_initial = second.receive_json()
                    self.assertEqual(second_initial["type"], "snapshot")
                    self.app.state.websocket_hub.publish(
                        {
                            "type": "state",
                            "data": {
                                "semaforo_a": "R",
                                "semaforo_b": "G",
                                "fase": "B_VERDE",
                                "modo": "NORMAL",
                                "uptime_ms": 6121,
                                "received_at": "2026-11-07T10:00:01.000+00:00",
                            },
                        }
                    )
                    self.assertEqual(first.receive_json()["type"], "state")
                    self.assertEqual(second.receive_json()["type"], "state")

                    incident_message = parse(
                        "SIV,1,2,8300,EMERGENCIA_DETECTADA,7,A,R,G,B_VERDE,143"
                    )
                    incident_result = store.ingest(incident_message)
                    self.app.state.websocket_hub.publish(
                        websocket_message(incident_message, incident_result)
                    )
                    first_incident = first.receive_json()
                    second_incident = second.receive_json()
                    self.assertEqual(first_incident, second_incident)
                    self.assertEqual(first_incident["type"], "incident")
                    self.assertEqual(
                        first_incident["data"]["event"], "EMERGENCIA_DETECTADA"
                    )
                    self.assertEqual(first_incident["data"]["incident_id"], 7)

                with client.websocket_connect("/ws/monitor") as third:
                    third.receive_json()
                    third_message = parse(
                        "SIV,1,3,9000,EMERGENCIA_DETECTADA,8,A,R,G,B_VERDE,120"
                    )
                    third_result = store.ingest(third_message)
                    self.app.state.websocket_hub.publish(
                        websocket_message(third_message, third_result)
                    )
                    self.assertEqual(first.receive_json()["data"]["incident_id"], 8)
                    self.assertEqual(third.receive_json()["data"]["incident_id"], 8)

        self.assertEqual(store.list_incidents(10, 0)["total"], 2)

    def test_connection_loss_recovery_and_no_clients(self):
        hub = self.app.state.websocket_hub
        hub.publish({"type": "connection", "data": {"serial_connected": False}})
        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/monitor") as websocket:
                websocket.receive_json()
                hub.publish({"type": "connection", "data": {"serial_connected": False}})
                self.assertFalse(websocket.receive_json()["data"]["serial_connected"])
                hub.publish({"type": "connection", "data": {"serial_connected": True}})
                self.assertTrue(websocket.receive_json()["data"]["serial_connected"])

    def test_client_commands_are_rejected_without_affecting_other_observers(self):
        hub = self.app.state.websocket_hub
        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/monitor") as first:
                first.receive_json()
                with client.websocket_connect("/ws/monitor") as second:
                    second.receive_json()
                    first.send_json({"command": "force_green"})
                    with self.assertRaises(WebSocketDisconnect):
                        first.receive_json()

                    hub.publish({"type": "heartbeat", "data": {"uptime_ms": 1000}})
                    self.assertEqual(second.receive_json()["type"], "heartbeat")

    def test_connection_becomes_stale_after_heartbeat_timeout(self):
        self.app.state.runtime._stale_after_seconds = 0.2
        self.app.state.runtime.connected()
        boot = parse("SIV,1,0,120,BOOT,0")
        heartbeat = parse("SIV,1,1,1120,HEARTBEAT,0,G,R,A_VERDE,NORMAL,4000")
        for message in (boot, heartbeat):
            result = self.app.state.store.ingest(message)
            self.app.state.runtime.observe(message, result)

        with TestClient(self.app) as client:
            with client.websocket_connect("/ws/monitor") as websocket:
                initial = websocket.receive_json()
                self.assertTrue(initial["data"]["controller_observed"])
                update = websocket.receive_json()
                self.assertEqual(update["type"], "connection")
                self.assertTrue(update["data"]["state_stale"])
                self.assertFalse(update["data"]["controller_observed"])

    def test_slow_client_queue_is_bounded_and_keeps_latest(self):
        async def verify():
            hub = WebSocketHub(lambda: {"state": "current"}, queue_capacity=2)
            hub.bind()
            client = object()
            queue = asyncio.Queue(maxsize=2)
            hub._clients.add((client, queue))
            hub._publish_on_loop({"type": "one"})
            hub._publish_on_loop({"type": "two"})
            hub._publish_on_loop({"type": "three"})
            self.assertEqual(queue.maxsize, 2)
            self.assertEqual(queue.qsize(), 2)
            self.assertEqual(await queue.get(), {"type": "two"})
            self.assertEqual(await queue.get(), {"type": "three"})
            hub._clients.clear()
            hub.unbind()

        asyncio.run(verify())
        self.app.state.websocket_hub.publish({"type": "ignored", "data": {}})


if __name__ == "__main__":
    unittest.main()
