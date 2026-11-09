import tempfile
import unittest
from pathlib import Path

from backend.app.serial_service import websocket_message
from backend.app.storage import EventStore
from tools.serial_protocol import parsear_mensaje


class Phase6AIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.store = EventStore(Path(self.temp_dir.name) / "phase6a.sqlite3")

    def ingest(self, line, received_at):
        message = parsear_mensaje(line + "\n")
        result = self.store.ingest(message, received_at)
        published = None if result.duplicate else websocket_message(message, result)
        return message, result, published

    def test_synthetic_siv_lifecycle_survives_millis_wrap_and_persists_once(self):
        trace = [
            "SIV,1,0,4294966200,BOOT,0",
            "SIV,1,1,4294966295,EMERGENCIA_DETECTADA,17,A,R,G,B_VERDE,180",
            "SIV,1,2,1000,PRIORIDAD_ACTIVADA,17,2001,G,R,PRIORIDAD_A",
            "SIV,1,3,9000,EMERGENCIA_FINALIZADA,17,10001",
            "SIV,1,4,13000,CICLO_RECUPERADO,17,4000",
        ]
        published = []
        results = []
        for index, line in enumerate(trace):
            _, result, websocket_event = self.ingest(
                line, "2026-01-01T00:00:{:02d}.000+00:00".format(index)
            )
            results.append(result)
            if websocket_event is not None:
                published.append(websocket_event)

        duplicate_message, duplicate_result, duplicate_event = self.ingest(
            trace[2], "2026-01-01T00:00:10.000+00:00"
        )
        self.assertEqual(duplicate_message["tipo"], "PRIORIDAD_ACTIVADA")
        self.assertTrue(duplicate_result.duplicate)
        self.assertIsNone(duplicate_event)

        detail = self.store.get_incident(1)
        self.assertEqual(len({result.session_id for result in results}), 1)
        self.assertEqual(detail["status"], "RECUPERADA")
        self.assertEqual(
            [event["type"] for event in detail["events"]],
            [
                "EMERGENCIA_DETECTADA",
                "PRIORIDAD_ACTIVADA",
                "EMERGENCIA_FINALIZADA",
                "CICLO_RECUPERADO",
            ],
        )
        self.assertEqual(detail["detected_uptime_ms"], 4294966295)
        self.assertEqual(detail["priority_uptime_ms"], 1000)
        self.assertEqual(detail["finished_uptime_ms"], 9000)
        self.assertEqual(detail["recovered_uptime_ms"], 13000)
        self.assertEqual(
            (detail["priority_uptime_ms"] - detail["detected_uptime_ms"])
            & 0xFFFFFFFF,
            detail["response_ms"],
        )
        self.assertEqual(detail["response_ms"], 2001)
        self.assertEqual(detail["duration_ms"], 10001)
        self.assertEqual(detail["recovery_ms"], 4000)

        analytics = self.store.analytics()
        self.assertEqual(analytics["total"], 1)
        self.assertEqual(analytics["completed"], 1)
        self.assertEqual(analytics["pending"], 0)
        self.assertEqual(analytics["status_counts"], {"RECUPERADA": 1})
        self.assertEqual(analytics["incidents_by_day"], {"2026-01-01": 1})
        self.assertEqual(len(analytics["response_series"]), 1)
        self.assertEqual(analytics["response_series"][0]["response_ms"], 2001)
        self.assertEqual(
            [event["data"]["event"] for event in published[1:]],
            [
                "EMERGENCIA_DETECTADA",
                "PRIORIDAD_ACTIVADA",
                "EMERGENCIA_FINALIZADA",
                "CICLO_RECUPERADO",
            ],
        )
        self.assertEqual(self.store.list_incidents(20, 0)["total"], 1)

    def test_zero_response_and_recovery_are_valid_measurements(self):
        trace = [
            "SIV,1,0,0,BOOT,0",
            "SIV,1,1,42,EMERGENCIA_DETECTADA,1,A,G,R,A_VERDE,0",
            "SIV,1,2,42,PRIORIDAD_ACTIVADA,1,0,G,R,PRIORIDAD_A",
            "SIV,1,3,100,EMERGENCIA_FINALIZADA,1,58",
            "SIV,1,4,100,CICLO_RECUPERADO,1,0",
        ]
        for index, line in enumerate(trace):
            self.ingest(line, "2026-01-01T00:00:{:02d}.000+00:00".format(index))

        incident = self.store.get_incident(1)
        metrics = self.store.analytics()
        self.assertEqual(incident["response_ms"], 0)
        self.assertEqual(incident["duration_ms"], 58)
        self.assertEqual(incident["recovery_ms"], 0)
        self.assertEqual(metrics["response_count"], 1)
        self.assertEqual(metrics["response_average_ms"], 0)
        self.assertEqual(metrics["response_min_ms"], 0)
        self.assertEqual(metrics["response_max_ms"], 0)
        self.assertEqual(metrics["recovery_average_ms"], 0)


if __name__ == "__main__":
    unittest.main()
