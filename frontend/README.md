# Dashboard web SIV — Fase 5C

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

## Estadísticas e historial

Estadísticas usa agregados calculados por SQLite para el período elegido:
totales, estados, promedios/min/max en milisegundos, emergencias por día y
tiempos de respuesta por incidente. Los valores nulos se excluyen de sus
promedios. El filtro personalizado interpreta las fechas como días calendario
locales inclusivos; las convierte a instantes UTC y el backend aplica el final
como límite exclusivo. La agrupación de días del gráfico usa UTC.

El historial pagina los resultados y comparte el filtro de período; búsqueda,
estado y orden también se aplican al CSV. **Exportar CSV** genera el archivo
completo filtrado desde SQLite, en UTF-8 con BOM y separador `;` para Excel.
La línea de tiempos de respuesta muestra hasta 1.000 incidentes reales
uniformemente muestreados; los agregados abarcan todo el período seleccionado.
El modelo no registra carril en todos los incidentes y no se atribuye uno.
La vista requiere la respuesta extendida de `/api/metricas?detalle=true`;
reiniciá FastAPI al actualizar el backend. Una instancia anterior que ignore
ese parámetro se identifica como contrato incompleto, no como período vacío.

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
