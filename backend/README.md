# Backend Fase 4A — API de supervisión

Backend FastAPI de solo lectura para recibir SIV v1, guardar eventos e
incidentes en SQLite y exponer estado y métricas. El backend no envía comandos
al Arduino. Debe ser el único proceso que abra el puerto serial: cerrá
`tools/serial_receiver.py` antes de iniciarlo.

## Requisitos e instalación

Desde Ubuntu/WSL, en la raíz del repositorio:

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
```

La fuente de SIV v1 es `tools/serial_protocol.py`; no se mantiene un parser
duplicado en el backend.

## Configuración serial

Copiá `backend/.env.example` a `backend/.env` y ajustá las variables. Cargalas
en la terminal antes de ejecutar Uvicorn:

```bash
set -a
source backend/.env
set +a
```

Variables disponibles:

| Variable | Predeterminado | Descripción |
|---|---|---|
| `SIV_SERIAL_PORT` | `/tmp/siv-python` | PTY de `socat` o puerto serial equivalente |
| `SIV_BAUDRATE` | `9600` | Baudios de UART |
| `SIV_DATABASE_PATH` | `backend/data/siv_events.sqlite3` | Ruta de SQLite relativa al directorio actual si no es absoluta |
| `SIV_SERIAL_ENABLED` | `true` | Usar `false` para ejecutar API y tests sin serial |
| `SIV_RETRY_SECONDS` | `2` | Pausa entre intentos de reconexión |

El backend crea automáticamente el directorio y las tablas de SQLite. No
ejecutes `serial_receiver.py` simultáneamente: los puertos seriales suelen ser
exclusivos.

## Iniciar la API

Con `socat` y SimulIDE preparados, desde la raíz del repositorio:

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Abrir:

- Salud y conexión serial: <http://127.0.0.1:8000/health>
- Último estado conocido: <http://127.0.0.1:8000/api/estado>
- Historial paginado: <http://127.0.0.1:8000/api/emergencias?limit=20&offset=0>
- Detalle de incidente: <http://127.0.0.1:8000/api/emergencias/1>
- Métricas: <http://127.0.0.1:8000/api/metricas>
- Documentación interactiva: <http://127.0.0.1:8000/docs>

La API puede iniciarse sin SimulIDE; `/health` marcará la conexión como
`degraded` mientras no haya un puerto serial conectado. `/api/estado` usa
`null` para valores aún no recibidos. La disponibilidad del servidor HTTP no
significa que el controlador esté conectado u operativo.

## Pruebas

Desde la raíz del repositorio, con las dependencias instaladas:

```bash
python -m unittest discover -s backend/tests -v
```

Las pruebas usan bases temporales y fixtures del protocolo; no requieren
SimulIDE, `socat` ni hardware.

## Datos y limitaciones

La base predeterminada está en `backend/data/siv_events.sqlite3` y queda fuera
de Git. `.env`, entornos virtuales y archivos SQLite tampoco se publican.

El protocolo SIV v1 no envía un identificador de sesión persistente. El backend
crea una sesión local al recibir `BOOT` (o una sesión provisional si llegan
mensajes antes); incidentes con el mismo ID en distintos arranques quedan
separados. Si Arduino reinicia mientras el backend está desconectado y se
pierde `BOOT`, no existe información en SIV v1 suficiente para identificar con
certeza ese reinicio. Los eventos tardíos se guardan y el estado de ciclo de
vida no retrocede; los timestamps de Arduino y recepción se conservan aparte.
