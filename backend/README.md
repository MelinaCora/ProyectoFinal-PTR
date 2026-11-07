# Backend Fases 4A y 4B — API de supervisión en tiempo real

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
significa que el controlador esté conectado u operativo. Si no se recibe un
heartbeat durante 5 segundos, el estado se informa como desactualizado y
`controller_observed` pasa a `false`.

## WebSocket de monitoreo

Conectá uno o varios clientes observadores a:

```text
ws://127.0.0.1:8000/ws/monitor
```

Al conectar se envía primero una instantánea:

```json
{
  "type": "snapshot",
  "data": {
    "semaforo_a": "G",
    "semaforo_b": "R",
    "fase": "A_VERDE",
    "modo": "NORMAL",
    "restante_ms": 4000,
    "last_heartbeat_received_at": "2026-11-07T10:00:01.000+00:00",
    "serial_connected": true,
    "controller_observed": true,
    "state_stale": false
  }
}
```

Después se reciben mensajes `state`, `heartbeat`, `incident` y `connection`.
Los mensajes de telemetría incluyen `uptime_ms` (reloj Arduino) y
`received_at` (hora UTC de recepción backend) por separado. Ejemplos:

```json
{"type":"state","data":{"secuencia":12,"uptime_ms":4000,"received_at":"2026-11-07T10:00:04.000+00:00","session_id":"...","semaforo_a":"R","semaforo_b":"G","fase":"B_VERDE","modo":"NORMAL","restante_ms":5000}}
{"type":"incident","data":{"session_id":"...","incident_id":3,"event":"PRIORIDAD_ACTIVADA","secuencia":13,"uptime_ms":5000,"received_at":"2026-11-07T10:00:05.000+00:00","respuesta_ms":0,"semaforo_a":"G","semaforo_b":"R","fase":"PRIORIDAD_A"}}
{"type":"connection","data":{"serial_connected":false,"controller_observed":false,"state_stale":true,"received_at":"2026-11-07T10:00:06.000+00:00"}}
```

La cola por cliente tiene capacidad fija de 32 mensajes. Si un cliente lento la
llena, se descarta el mensaje más antiguo para conservar las actualizaciones
más recientes; el historial completo sigue disponible en REST/SQLite. Al
desconectarse, el cliente se elimina y no afecta al receptor serial ni a otros
clientes. La API solo distribuye observaciones; el WebSocket no acepta comandos.
Al recibirse un nuevo `BOOT`, se envía un estado desconocido hasta que llegue
el siguiente `STATE` o `HEARTBEAT`.

Para probar desde la consola del navegador, con Uvicorn local activo:

```javascript
const monitor = new WebSocket("ws://127.0.0.1:8000/ws/monitor");
monitor.onmessage = ({ data }) => console.log(JSON.parse(data));
```

## Pruebas

Desde la raíz del repositorio, con las dependencias instaladas:

```bash
python -m unittest discover -s backend/tests -v
```

Las pruebas usan bases temporales y fixtures del protocolo; cubren la API REST,
persistencia, distribución WebSocket, varios clientes, colas llenas y
desconexión serial. No requieren SimulIDE, `socat` ni hardware.

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
