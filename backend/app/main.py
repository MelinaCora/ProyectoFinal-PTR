from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query

from .config import Settings
from .serial_service import RuntimeStatus, SerialWorker
from .storage import EventStore


def create_app(settings=None, serial_factory=None):
    settings = settings or Settings.from_env()
    store = EventStore(settings.database_path)
    runtime = RuntimeStatus()
    worker = None
    if settings.serial_enabled:
        worker = SerialWorker(
            store=store,
            status=runtime,
            port=settings.serial_port,
            baudrate=settings.baudrate,
            retry_seconds=settings.retry_seconds,
            serial_factory=serial_factory,
        )

    @asynccontextmanager
    async def lifespan(_app):
        if worker is not None:
            worker.start()
        try:
            yield
        finally:
            if worker is not None:
                worker.stop()

    app = FastAPI(
        title="PTR Semáforos — API de supervisión",
        version="1.0.0",
        description="API de solo lectura para eventos SIV v1.",
        lifespan=lifespan,
    )
    app.state.store = store
    app.state.runtime = runtime
    app.state.worker = worker
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

    return app


app = create_app()
