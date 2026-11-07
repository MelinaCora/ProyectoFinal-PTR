import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .serial_service import RuntimeStatus, SerialWorker, websocket_message
from .storage import EventStore, utc_now
from .websocket_hub import WebSocketHub


def create_app(settings=None, serial_factory=None):
    settings = settings or Settings.from_env()
    store = EventStore(settings.database_path)
    runtime = RuntimeStatus()
    hub = WebSocketHub(snapshot_provider=runtime.snapshot)
    worker = None
    if settings.serial_enabled:
        def publish_connection(_snapshot):
            hub.publish(
                {
                    "type": "connection",
                    "data": {
                        **runtime.snapshot(),
                        "received_at": utc_now(),
                    },
                }
            )

        def publish_message(message, result):
            websocket_event = websocket_message(message, result)
            if websocket_event is not None:
                hub.publish(websocket_event)

        worker = SerialWorker(
            store=store,
            status=runtime,
            port=settings.serial_port,
            baudrate=settings.baudrate,
            retry_seconds=settings.retry_seconds,
            serial_factory=serial_factory,
            on_message=publish_message,
            on_connection=publish_connection,
        )

    @asynccontextmanager
    async def lifespan(_app):
        hub.bind()
        if worker is not None:
            worker.start()
        previous_connection = None

        async def monitor_staleness():
            nonlocal previous_connection
            while True:
                snapshot = runtime.snapshot()
                signature = (
                    snapshot["serial_connected"],
                    snapshot["controller_observed"],
                    snapshot["state_stale"],
                )
                if previous_connection is not None and signature != previous_connection:
                    hub.publish(
                        {
                            "type": "connection",
                            "data": {**snapshot, "received_at": utc_now()},
                        }
                    )
                previous_connection = signature
                await asyncio.sleep(0.5)

        staleness_task = asyncio.create_task(monitor_staleness())
        try:
            yield
        finally:
            staleness_task.cancel()
            try:
                await staleness_task
            except asyncio.CancelledError:
                pass
            if worker is not None:
                worker.stop()
            hub.unbind()

    app = FastAPI(
        title="PTR Semáforos — API de supervisión",
        version="1.0.0",
        description="API de solo lectura para eventos SIV v1.",
        lifespan=lifespan,
    )
    cors_app = CORSMiddleware(
        app=app,
        allow_origins=[
            "http://localhost:8080",
            "http://127.0.0.1:8080",
        ],
        allow_methods=["GET"],
        allow_headers=["Accept"],
    )
    app.state.store = store
    app.state.runtime = runtime
    app.state.worker = worker
    app.state.websocket_hub = hub
    app.state.settings = settings

    @app.get("/health")
    def health():
        return runtime.health(settings.serial_port, settings.baudrate)

    @app.get("/api/estado")
    def state():
        return runtime.snapshot()

    @app.get("/api/emergencias")
    def incidents(
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ):
        result = store.list_incidents(limit, offset)
        return {**result, "limit": limit, "offset": offset}

    @app.get("/api/emergencias/{incident_row_id}")
    def incident_detail(incident_row_id: int):
        if incident_row_id < 1:
            raise HTTPException(status_code=422, detail="id debe ser mayor que cero")
        incident = store.get_incident(incident_row_id)
        if incident is None:
            raise HTTPException(status_code=404, detail="Incidente no encontrado")
        return incident

    @app.get("/api/metricas")
    def metrics():
        return store.metrics()

    @app.websocket("/ws/monitor")
    async def monitor(websocket: WebSocket):
        await hub.serve(websocket)

    cors_app.state = app.state
    cors_app.router = app.router
    cors_app.openapi = app.openapi
    return cors_app


app = create_app()
