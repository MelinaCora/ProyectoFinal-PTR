import logging
import threading

from tools.serial_protocol import ProtocoloError, parsear_mensaje

from .storage import EventStore, utc_now


LOGGER = logging.getLogger(__name__)


class RuntimeStatus:
    def __init__(self):
        self._lock = threading.Lock()
        self._serial_connected = False
        self._last_error = None
        self._last_message_received_at = None
        self._last_heartbeat_received_at = None
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
            self._serial_connected = True
            self._last_error = None

    def disconnected(self, error=None):
        with self._lock:
            self._serial_connected = False
            if error:
                self._last_error = str(error)

    def communication_error(self, error):
        with self._lock:
            self._last_error = str(error)

    def observe(self, message, result):
        received_at = result.received_at
        with self._lock:
            self._last_message_received_at = received_at
            self._active_session_id = result.session_id
            self._last_error = None
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

    def snapshot(self):
        with self._lock:
            return {
                **self._state,
                "last_heartbeat_received_at": self._last_heartbeat_received_at,
                "last_message_received_at": self._last_message_received_at,
                "serial_connected": self._serial_connected,
                "active_session_id": self._active_session_id,
            }

    def health(self, serial_port, baudrate):
        with self._lock:
            heartbeat_seen = self._last_heartbeat_received_at is not None
            return {
                "status": (
                    "ok"
                    if self._serial_connected and heartbeat_seen
                    else "degraded"
                ),
                "backend": "ok",
                "serial": {
                    "connected": self._serial_connected,
                    "controller_observed": heartbeat_seen,
                    "port": serial_port,
                    "baudrate": baudrate,
                    "last_error": self._last_error,
                    "last_message_received_at": self._last_message_received_at,
                    "last_heartbeat_received_at": self._last_heartbeat_received_at,
                    "active_session_id": self._active_session_id,
                },
            }


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
    ):
        self.store = store
        self.status = status
        self.port = port
        self.baudrate = baudrate
        self.retry_seconds = retry_seconds
        self.serial_factory = serial_factory or _default_serial_factory
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

    def _run(self):
        while not self._stop.is_set():
            port = None
            try:
                port = self.serial_factory(self.port, self.baudrate)
                self.status.connected()
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
                    self.status.observe(message, result)
            except Exception as exc:
                if self._stop.is_set():
                    break
                self.status.disconnected(exc)
                LOGGER.warning("Error de comunicación serial en %s: %s", self.port, exc)
            finally:
                if port is not None:
                    try:
                        port.close()
                    except Exception:
                        LOGGER.exception("Error al cerrar el puerto serial")
                if self._stop.is_set():
                    self.status.disconnected()
            if not self._stop.is_set():
                self._stop.wait(self.retry_seconds)
