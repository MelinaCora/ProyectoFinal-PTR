# Dashboard web SIV — Fase 5A

Interfaz local de demostración para supervisar el controlador y consultar
incidentes. No se conecta a FastAPI, WebSocket ni al hardware; los registros
están definidos en `js/mock-data.js` y no representan mediciones reales.

## Ejecutar

Desde la raíz del repositorio:

```bash
python -m http.server 8080 --directory frontend
```

Abrir <http://localhost:8080>. También puede usarse cualquier servidor estático
local que sirva módulos ES desde `index.html`.

## Vistas

- **Resumen:** indicadores, estado de los dos semáforos y últimos eventos.
- **Monitoreo:** modo FSM, tiempo restante, heartbeat y sesión de demostración.
- **Emergencias:** búsqueda por identificador, filtros, orden y detalle del ciclo.
- **Estadísticas:** métricas calculadas desde incidentes y gráficos SVG nativos.

La aplicación separa los datos de demostración (`js/mock-data.js`), el estado y
las interacciones (`js/app.js`) y la presentación (`css/styles.css`).
`calculateMetrics` recibe registros con los nombres de campos de incidentes de
la API, de modo que la siguiente fase pueda sustituir la fuente sin acoplar los
componentes a los mocks. No hay acciones para controlar los semáforos.
