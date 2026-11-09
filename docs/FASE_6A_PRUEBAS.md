# Fase 6A — Pruebas de integración y línea base temporal

Alcance: verificar la FSM y el flujo de supervisión existente sin cambiar
firmware, FSM, Goertzel, SIV v1, esquema SQLite ni contratos API/WebSocket.
Las trazas de `test_phase6a_integration.py` son sintéticas y usan una SQLite
temporal; no son mediciones de Arduino ni de SimulIDE.

## Matriz de pruebas

| ID | Escenario / objetivo | Procedimiento | Resultado esperado | Resultado obtenido | Estado |
|---|---|---|---|---|---|
| FSM-01 | Ciclo normal A→B→A | `node test\test_ciclo.mjs` | Un solo carril verde; todo-rojo conservado | Todos los checks de transición y exclusividad pasaron | Aprobada |
| FSM-02 | Emergencia en A/B verde, A/B amarillo y todo-rojo | Suite FSM existente | Prioridad espera el despeje requerido | Todos los escenarios existentes pasaron | Aprobada |
| FSM-03 | Fin de prioridad y recuperación | Suite FSM existente | Se restaura fase/tiempo pertinente | Checks de recuperación pasaron | Aprobada |
| FSM-04 | Detecciones repetidas, reentrada y solicitudes consecutivas | Suite FSM existente | No reinicia despejes ni duplica solicitudes activas | Checks de repetición y reentrada pasaron | Aprobada |
| FSM-05 | Fases inválidas, sobretiempo y exclusividad de verdes | Suite FSM existente | Fallo enclavado con ambos carriles rojos | Checks de fallo seguro pasaron | Aprobada |
| DET-01 | Tonos fijos, silencio y sirena WAV | `test\test_goertzel.ps1` | Falsos patrones rechazados; pico confirmado | Los nueve checks del detector pasaron | Aprobada |
| SIV-01 | Mensajes válidos/malformados, secuencia, wrap y arranque | Pruebas del parser | Parser rechaza entradas inválidas y detecta huecos | Cuatro pruebas pasaron | Aprobada |
| INT-01 | Parser→SQLite→analíticas→mensaje WebSocket | Traza sintética de integración | Cronología persistida y métricas coherentes | Dos pruebas de integración pasaron | Aprobada |
| INT-02 | Mensaje duplicado y orden de eventos | Repetir una trama idéntica | Solo una persistencia/publicación | Duplicado ignorado; orden conservado | Aprobada |
| INT-03 | Cero como respuesta o recuperación válida | Traza sintética con mediciones cero | Cero cuenta como medición, no como dato ausente | Promedio, mínimo, máximo y recuperación conservan cero | Aprobada |
| DB-01 | Aislamiento de SQLite de pruebas | Suites backend e integración | Cada fixture usa `TemporaryDirectory` | Configuración aislada en los tests inspeccionados | Aprobada |
| API-01 | REST, WebSocket, persistencia, desconexión/reconexión serial | Suite backend | API sigue activa y eventos guardados/publicados una sola vez | 21 pruebas pasaron | Aprobada |
| HW-01 | Desconectar FastAPI/dashboard/UART durante operación | Procedimiento manual de abajo | Arduino continúa la FSM local | No ejecutado en este entorno | Pendiente de validación manual |
| HW-02 | Flujo completo con SimulIDE, UART y sirena | Procedimiento manual de abajo | Eventos y transiciones observables en SimulIDE | No ejecutado en este entorno | Pendiente de validación manual |
| BUILD-01 | Compilación nativa C++/PlatformIO | `pio run` / `g++` | Compilación sin errores | Herramientas no disponibles en este entorno | Pendiente de entorno compatible |

Las suites FSM ya existentes incluyen las transiciones solicitadas; no se
duplicaron. El backend usa rutas SQLite temporales en sus pruebas, mientras la
base por defecto de ejecución queda en `backend/data/siv_events.sqlite3` (o en
la ruta indicada por `SIV_DATABASE_PATH`). Las pruebas no abren esa base por
defecto.

## Semántica temporal y mediciones

- **Detección acústica:** el firmware no registra el instante físico en que
  empieza el sonido. `indicio_ms` mide desde el primer indicio tonal clasificable
  conservado por Goertzel hasta la confirmación; no permite calcular la
  latencia acústica real.
- **Respuesta del controlador:** `response_ms` mide detección confirmada hasta
  activación efectiva de prioridad. `detected_uptime_ms` y
  `priority_uptime_ms` pertenecen a la ejecución/sesión; su diferencia unsigned
  de 32 bits tolera el wrap de `millis()` si el intervalo es menor que una
  vuelta (~49,7 días). No comparar uptimes entre reinicios. Si A ya está verde,
  cero es una respuesta válida.
- **Duración:** `duration_ms` va desde la detección confirmada hasta la
  finalización de la prioridad, no desde el inicio físico de la sirena.
- **Recuperación:** `recovery_ms` va desde `EMERGENCIA_FINALIZADA` hasta
  `CICLO_RECUPERADO`. Puede valer cero cuando ambos eventos se producen en el
  mismo tick; no es un dato faltante.
- **Latencia del monitoreo:** los timestamps de Arduino (uptime) y
  `received_at` (reloj del backend) no comparten una referencia sincronizada.
  Los tests verifican orden, persistencia y publicación, pero no afirman una
  latencia exacta Arduino→API→navegador.

La integración automatizada contiene esta única repetición **sintética** para
verificar wrap y coherencia de los campos, no como benchmark de hardware:

| Dato sintético | Valor | Cálculo/interpretación |
|---|---:|---|
| `detected_uptime_ms` | 4294966295 ms | Antes del wrap de 32 bits |
| `priority_uptime_ms` | 1000 ms | Después del wrap |
| `response_ms` | 2001 ms | Diferencia modular, misma sesión |
| `finished_uptime_ms` | 9000 ms | Duración reportada de 10001 ms desde detección |
| `recovered_uptime_ms` | 13000 ms | Recuperación reportada de 4000 ms tras finalización |
| Repeticiones | 1 | Traza automatizada sintética; no hay muestra física |

No se fijan umbrales de aceptación de rendimiento: la configuración de fase
describe tiempos esperados, pero no equivale a una medición ejecutada.

## Ejecución reproducible

Desde la raíz del repositorio:

```powershell
node test\test_ciclo.mjs
powershell -ExecutionPolicy Bypass -NoProfile -File test\test_goertzel.ps1
python -m unittest discover -s test -p "test_serial_protocol.py" -v
python -m unittest discover -s test -p "test_phase6a_integration.py" -v
python -m unittest backend.tests.test_backend -v
```

Las pruebas nativas existentes se ejecutan con `pio run -e test_ciclo` y
`pio run -e test_telemetria`, seguido por los ejecutables en
`.pio\build\test_ciclo\` y `.pio\build\test_telemetria\`. Para compilar el
firmware real se usa `pio run -e uno`. No se pudieron ejecutar aquí porque no
están disponibles `pio` ni `g++`.

## Validación manual pendiente

1. Compilar y cargar `.pio\build\uno\firmware.hex` en SimulIDE; conectar UART
   mediante la topología documentada en
   `docs/GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md`. Mantener un solo lector del
   puerto serial.
2. Observar el ciclo normal A→B→A. Activar la sirena en cada fase indicada en
   FSM-02 y registrar la fase inicial, eventos SIV, uptime, respuesta y
   secuencia de luces; repetir cada escenario varias veces. No sustituir el
   inicio acústico ausente por `indicio_ms`.
3. Esperar `EMERGENCIA_FINALIZADA` y `CICLO_RECUPERADO`; contrastar los uptimes
   dentro de la misma sesión. Registrar cero como medición si los eventos
   ocurren en el mismo tick.
4. Con el controlador en marcha, cerrar el dashboard; luego detener FastAPI y,
   en una prueba separada, interrumpir UART/socat. Confirmar que las luces
   siguen el ciclo local. Restaurar los servicios y observar nueva conexión,
   heartbeats y cualquier pérdida reportada.
5. Para reinicio del backend, utilizar una SQLite desechable indicada mediante
   `SIV_DATABASE_PATH`; no apuntar la prueba a la base operativa. Confirmar
   persistencia y sesiones tras reiniciar.

No se deben inyectar trazas sintéticas en el puerto conectado a la base
operativa. La entrada malformada se cubre en pruebas del parser sin hardware.
