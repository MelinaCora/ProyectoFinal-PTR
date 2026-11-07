# Dashboard web SIV — Fase 5B

Dashboard local de supervisión para FastAPI. No controla Arduino. Los datos se
obtienen de la API REST y del WebSocket; no se usan fixtures de demostración.

## Iniciar los servicios

1. En la raíz del repositorio, activar el entorno Python del backend e iniciar
   FastAPI:

   ```bash
   python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
   ```

2. En otra terminal, servir el frontend:

   ```bash
   python -m http.server 8080 --directory frontend
   ```

3. Abrir <http://localhost:8080>. El frontend deriva el host del navegador y
   usa el puerto `8000` para REST y WebSocket. Para verificar FastAPI, abrir
   <http://localhost:8000/health>.

La API permite solicitudes GET desde `http://localhost:8080` y
`http://127.0.0.1:8080`. El WebSocket de observación usa
`ws://<host-del-navegador>:8000/ws/monitor` (o `wss` si la página usa HTTPS).

## Conexión y datos

El indicador superior distingue backend no disponible, serial desconectado,
telemetría desactualizada y controlador observado. El estado inicial se carga
por REST; los cambios se reciben por WebSocket y se reintenta la conexión con
espera progresiva. Si SimulIDE o el puerto serial no están conectados, FastAPI
puede seguir disponible, pero el panel informa que no hay telemetría reciente
y oculta el tiempo restante obsoleto. El historial y métricas se leen desde
SQLite mediante los endpoints existentes.

Un fallo aislado en una consulta se informa como temporal y no desconecta el
backend si `/health` sigue respondiendo. La alerta de backend no disponible
requiere fallos consecutivos de salud y ausencia de respuestas REST recientes.
Después de actualizar FastAPI, reiniciarlo para que aplique el middleware CORS.
Para comprobar el origen permitido desde PowerShell:

```powershell
curl.exe -i -H "Origin: http://localhost:8080" "http://localhost:8000/api/emergencias?limit=100&offset=0"
```

La respuesta debe incluir `Access-Control-Allow-Origin: http://localhost:8080`.
En caso de fallo interno, los tests comprueban que la respuesta 500 también
conserve esa cabecera.

## Pruebas

Pruebas frontend, sin instalar dependencias:

```bash
npm test --prefix frontend
```

Pruebas backend (incluyen los orígenes CORS permitidos):

```bash
python -m unittest discover -s backend/tests -v
```

Las pruebas automatizadas no requieren SimulIDE. La comprobación de extremo a
extremo con telemetría UART requiere iniciar el circuito, `socat` y el backend
con el puerto serial configurado.
