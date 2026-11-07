import logging
import threading
import time

from tools.serial_protocol import ProtocoloError, parsear_mensaje

from .storage import EventStore, utc_now


LOGGER = logging.getLogger(__name__)


class RuntimeStatus:
    def __init__(self, stale_after_seconds=5.0):
        self._lock = threading.Lock()
        self._stale_after_seconds = stale_after_seconds
        self._serial_connected = False
        self._last_error = None
        self._last_message_received_at = None
        self._last_heartbeat_received_at = None
        self._last_heartbeat_monotonic = None
        self._active_session_id = None
        self._state = {
            "semaforo_a": None,
            "semaforo_b": None,
            "fase": None,
            "modo": None,
            "restante_ms": None,
            "state_received_at": None,
        }

    def connected(self):
        with self._lock:
            changed = not self._serial_connected
            self._serial_connected = True
            self._last_error = None
            return changed

    def disconnected(self, error=None):
        with self._lock:
            changed = self._serial_connected
            self._serial_connected = False
            if error:
                self._last_error = str(error)
            return changed

    def communication_error(self, error):
        with self._lock:
            self._last_error = str(error)

    def observe(self, message, result):
        received_at = result.received_at
        with self._lock:
            self._last_message_received_at = received_at
            self._active_session_id = result.session_id
            self._last_error = None
            if message["tipo"] == "BOOT":
                self._state = {
                    "semaforo_a": None,
                    "semaforo_b": None,
                    "fase": None,
                    "modo": None,
                    "restante_ms": None,
                    "state_received_at": None,
                }
                self._last_heartbeat_received_at = None
                self._last_heartbeat_monotonic = None
            if message["tipo"] in {"STATE", "HEARTBEAT"}:
                data = message["datos"]
                self._state = {
                    "semaforo_a": data["a"],
                    "semaforo_b": data["b"],
                    "fase": data["fase"],
                    "modo": data["modo"],
                    "restante_ms": data["restante_ms"],
                    "state_received_at": received_at,
                }
            if message["tipo"] == "HEARTBEAT":
                self._last_heartbeat_received_at = received_at
                self._last_heartbeat_monotonic = time.monotonic()

    def snapshot(self):
        with self._lock:
            heartbeat_age = self._heartbeat_age()
            controller_observed = (
                self._serial_connected
                and heartbeat_age is not None
                and heartbeat_age <= self._stale_after_seconds
            )
            return {
                **self._state,
                "last_heartbeat_received_at": self._last_heartbeat_received_at,
                "last_message_received_at": self._last_message_received_at,
                "serial_connected": self._serial_connected,
                "controller_observed": controller_observed,
                "state_stale": not controller_observed,
                "active_session_id": self._active_session_id,
            }

    def health(self, serial_port, baudrate):
        with self._lock:
            heartbeat_age = self._heartbeat_age()
            controller_observed = (
                self._serial_connected
                and heartbeat_age is not None
                and heartbeat_age <= self._stale_after_seconds
            )
            return {
                "status": (
                    "ok"
                    if self._serial_connected and controller_observed
                    else "degraded"
                ),
                "backend": "ok",
                "serial": {
                    "connected": self._serial_connected,
                    "controller_observed": controller_observed,
                    "state_stale": not controller_observed,
                    "port": serial_port,
                    "baudrate": baudrate,
                    "last_error": self._last_error,
                    "last_message_received_at": self._last_message_received_at,
                    "last_heartbeat_received_at": self._last_heartbeat_received_at,
                    "active_session_id": self._active_session_id,
                },
            }

    def _heartbeat_age(self):
        if self._last_heartbeat_monotonic is None:
            return None
        return time.monotonic() - self._last_heartbeat_monotonic


def websocket_message(message, result):
    kind = message["tipo"]
    if kind == "BOOT":
        message_type = "state"
        data = {
            "secuencia": message["secuencia"],
            "uptime_ms": message["uptime_ms"],
            "received_at": result.received_at,
            "session_id": result.session_id,
            "semaforo_a": None,
            "semaforo_b": None,
            "fase": None,
            "modo": None,
            "restante_ms": None,
            "state_stale": True,
        }
    elif kind in {"STATE", "HEARTBEAT"}:
        message_type = "state" if kind == "STATE" else "heartbeat"
        data = {
            "secuencia": message["secuencia"],
            "uptime_ms": message["uptime_ms"],
            "received_at": result.received_at,
            "session_id": result.session_id,
            **{
                "semaforo_a": message["datos"]["a"],
                "semaforo_b": message["datos"]["b"],
                "fase": message["datos"]["fase"],
                "modo": message["datos"]["modo"],
                "restante_ms": message["datos"]["restante_ms"],
            },
        }
    elif kind in {
        "EMERGENCIA_DETECTADA",
        "PRIORIDAD_ACTIVADA",
        "EMERGENCIA_FINALIZADA",
        "CICLO_RECUPERADO",
    }:
        message_type = "incident"
        event_data = dict(message["datos"])
        if "a" in event_data:
            event_data["semaforo_a"] = event_data.pop("a")
        if "b" in event_data:
            event_data["semaforo_b"] = event_data.pop("b")
        data = {
            "session_id": result.session_id,
            "incident_id": message["incidente_id"],
            "event": kind,
            "secuencia": message["secuencia"],
            "uptime_ms": message["uptime_ms"],
            "received_at": result.received_at,
            **event_data,
        }
    else:
        return None
    return {"type": message_type, "data": data}


def _default_serial_factory(port, baudrate):
    import serial

    return serial.Serial(port=port, baudrate=baudrate, timeout=1)


class SerialWorker:
    def __init__(
        self,
        store: EventStore,
        status: RuntimeStatus,
        port: str,
        baudrate: int,
        retry_seconds: float,
        serial_factory=None,
        on_message=None,
        on_connection=None,
    ):
        self.store = store
        self.status = status
        self.port = port
        self.baudrate = baudrate
        self.retry_seconds = retry_seconds
        self.serial_factory = serial_factory or _default_serial_factory
        self.on_message = on_message
        self.on_connection = on_connection
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="siv-serial-reader", daemon=True
        )
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
            if self._thread.is_alive():
                LOGGER.warning("El hilo serial no terminó dentro del tiempo esperado")

    def _notify_connection(self):
        if self.on_connection is None:
            return
        try:
            self.on_connection(self.status.snapshot())
        except Exception:
            LOGGER.exception("No se pudo notificar el estado serial")

    def _run(self):
        while not self._stop.is_set():
            port = None
            try:
                port = self.serial_factory(self.port, self.baudrate)
                if self.status.connected():
                    self._notify_connection()
                LOGGER.info("Puerto serial conectado: %s a %s baudios", self.port, self.baudrate)
                while not self._stop.is_set():
                    line = port.readline()
                    if not line:
                        continue
                    try:
                        message = parsear_mensaje(line.decode("ascii"))
                    except (UnicodeDecodeError, ProtocoloError) as exc:
                        self.status.communication_error(exc)
                        LOGGER.warning("Trama SIV inválida: %s", exc)
                        continue
                    received_at = utc_now()
                    result = self.store.ingest(message, received_at)
                    if not result.duplicate:
                        self.status.observe(message, result)
                    if self.on_message is not None and not result.duplicate:
                        try:
                            self.on_message(message, result)
                        except Exception:
                            LOGGER.exception("No se pudo notificar un mensaje SIV")
            except Exception as exc:
                if self._stop.is_set():
                    break
                if self.status.disconnected(exc):
                    self._notify_connection()
                else:
                    self.status.communication_error(exc)
                LOGGER.warning("Error de comunicación serial en %s: %s", self.port, exc)
            finally:
                if port is not None:
                    try:
                        port.close()
                    except Exception:
                        LOGGER.exception("Error al cerrar el puerto serial")
                if self._stop.is_set():
                    if self.status.disconnected():
                        self._notify_connection()
            if not self._stop.is_set():
                self._stop.wait(self.retry_seconds)
