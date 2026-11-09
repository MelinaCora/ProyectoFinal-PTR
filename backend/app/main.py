import asyncio
import csv
import io
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

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

    def period_bounds(start, end):
        bounds = []
        for value in (start, end):
            if value is not None and value.utcoffset() is None:
                raise HTTPException(
                    status_code=422, detail="Las fechas deben incluir zona horaria"
                )
            bounds.append(
                value.astimezone(timezone.utc).isoformat(timespec="milliseconds")
                if value is not None
                else None
            )
        if bounds[0] is not None and bounds[1] is not None and bounds[0] >= bounds[1]:
            raise HTTPException(
                status_code=422, detail="desde debe ser anterior a hasta"
            )
        return bounds

    def csv_stream(start_at, end_at, status, search, order):
        def as_utc(value):
            if not value:
                return ""
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.utcoffset() is None:
                return value
            return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds")

        output = io.StringIO(newline="")
        writer = csv.writer(output, delimiter=";", lineterminator="\r\n")
        writer.writerow(
            [
                "ID incidente",
                "ID registro",
                "Fecha y hora de detección (UTC)",
                "Estado",
                "Tiempo de respuesta (ms)",
                "Duración (ms)",
                "Tiempo de recuperación (ms)",
                "Fecha y hora de activación de prioridad (UTC)",
                "Fecha y hora de finalización (UTC)",
                "Fecha y hora de recuperación (UTC)",
            ]
        )
        yield "\ufeff" + output.getvalue()
        for incident in store.iter_incidents(
            start_at=start_at,
            end_at=end_at,
            status=status,
            search=search,
            order=order,
        ):
            output.seek(0)
            output.truncate(0)
            writer.writerow(
                [
                    incident["incident_id"],
                    incident["id"],
                    as_utc(
                        incident["detected_received_at"]
                        or incident["first_received_at"]
                    ),
                    incident["status"],
                    incident["response_ms"],
                    incident["duration_ms"],
                    incident["recovery_ms"],
                    as_utc(incident["priority_received_at"]),
                    as_utc(incident["finished_received_at"]),
                    as_utc(incident["recovered_received_at"]),
                ]
            )
            yield output.getvalue()

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
        desde: datetime | None = None,
        hasta: datetime | None = None,
        estado: str | None = None,
        buscar: str | None = None,
        orden: str = Query(default="desc", pattern="^(asc|desc)$"),
    ):
        start_at, end_at = period_bounds(desde, hasta)
        result = store.list_incidents(
            limit,
            offset,
            start_at=start_at,
            end_at=end_at,
            status=estado,
            search=buscar,
            order=orden,
        )
        return {**result, "limit": limit, "offset": offset}

    @app.get("/api/emergencias/export.csv")
    def export_incidents(
        desde: datetime | None = None,
        hasta: datetime | None = None,
        estado: str | None = None,
        buscar: str | None = None,
        orden: str = Query(default="desc", pattern="^(asc|desc)$"),
    ):
        start_at, end_at = period_bounds(desde, hasta)
        return StreamingResponse(
            csv_stream(start_at, end_at, estado, buscar, orden),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="emergencias-siv.csv"'
            },
        )

    @app.get("/api/emergencias/{incident_row_id}")
    def incident_detail(incident_row_id: int):
        if incident_row_id < 1:
            raise HTTPException(status_code=422, detail="id debe ser mayor que cero")
        incident = store.get_incident(incident_row_id)
        if incident is None:
            raise HTTPException(status_code=404, detail="Incidente no encontrado")
        return incident

    @app.get("/api/metricas")
    def metrics(
        detalle: bool = False,
        desde: datetime | None = None,
        hasta: datetime | None = None,
    ):
        start_at, end_at = period_bounds(desde, hasta)
        if detalle:
            return store.analytics(start_at=start_at, end_at=end_at)
        return store.metrics()

    @app.websocket("/ws/monitor")
    async def monitor(websocket: WebSocket):
        await hub.serve(websocket)

    cors_app.state = app.state
    cors_app.router = app.router
    cors_app.openapi = app.openapi
    return cors_app


app = create_app()
