# Fase 3B — Eventos y métricas por UART

## Objetivo y límites

La UART transmite una copia de supervisión del estado del controlador. Python
no envía comandos al Arduino: si el receptor se desconecta, la FSM, Goertzel y
las salidas de los semáforos continúan funcionando localmente. No se
implementan API, WebSocket, base de datos ni dashboard en esta fase.

No se cambiaron las transiciones ni los criterios de la FSM o Goertzel. Se
agregó a `ciclo.h` una variante de `ciclo_avanzar` que también devuelve la
instantánea de luces/fase justo antes de aplicar una solicitud confirmada; el
`ciclo_avanzar` original conserva su interfaz y delega en esa variante. La
detección confirmada, finalización y recuperación se toman de los eventos que
ya expone la FSM; no se replica esa lógica en la instrumentación.

## Formato del protocolo

El protocolo es ASCII, CSV posicional, una trama por línea terminada en LF,
sin JSON ni memoria dinámica:

```text
SIV,1,<secuencia>,<uptime_ms>,<tipo>,<incidente_id>[,<dato>...]\n
```

| Campo | Significado |
|---|---|
| `SIV` | Identificador del protocolo |
| `1` | Versión del protocolo |
| `secuencia` | Contador de 16 bits, comienza en 0 y se incrementa por cada trama intentada; puede envolver |
| `uptime_ms` | `millis()` del Arduino al generar el evento, como entero decimal de 32 bits |
| `tipo` | Tipo de evento indicado en la tabla siguiente |
| `incidente_id` | Identificador de 16 bits; `0` cuando la trama no corresponde a un incidente |
| `dato` | Campos adicionales específicos del tipo, en el orden documentado |

No se incluye un identificador aleatorio o persistente de sesión: el Uno no
tiene RTC ni una fuente de aleatoriedad fiable para ello. `BOOT` identifica el
reinicio, y la secuencia se reinicia en ese punto. El receptor incrementa un
contador local de arranques al ver `BOOT`; ese contador no es un ID persistente
entre ejecuciones del receptor.

## Tipos de mensaje

| Tipo | Campos posteriores al ID | Uso |
|---|---|---|
| `BOOT` | ninguno | Inicio del firmware |
| `INDICIO_SIRENA` | `LOW` o `HIGH` | Primer tono clasificable de una banda; es un indicio, no una emergencia confirmada |
| `STATE` | `luz_a,luz_b,fase,modo,restante_ms` | Cambio significativo de fase, luces o modo |
| `HEARTBEAT` | `luz_a,luz_b,fase,modo,restante_ms` | Supervisión periódica, una vez por cada 1000 ms de `millis()` |
| `EMERGENCIA_DETECTADA` | `A,luz_a,luz_b,fase,indicio_ms` | Solicitud de prioridad confirmada por la FSM |
| `PRIORIDAD_ACTIVADA` | `respuesta_ms,luz_a,luz_b,fase` | La FSM habilitó efectivamente la prioridad A |
| `EMERGENCIA_FINALIZADA` | `duracion_ms` | La FSM cerró la prioridad al cumplirse su criterio actual |
| `CICLO_RECUPERADO` | `recuperacion_ms` | La FSM terminó la recuperación asociada |
| `FALLO_SEGURO` | `NO_DISPONIBLE,luz_a,luz_b,fase` | La FSM informó estado inválido y el controlador quedó en fallo seguro |
| `PERDIDA` | `perdidas_criticas,perdidas_supervision` | Cantidad acumulada de mensajes no encolados o desplazados |

Las luces usan `R` (rojo), `Y` (amarillo) y `G` (verde). Las fases son
`A_VERDE`, `A_AMARILLO`, `TODO_ROJO`, `B_VERDE`, `B_AMARILLO`, `PRIORIDAD_A`,
`RECUPERACION_A_AMARILLO` y `FALLO_SEGURO`. Los modos son `NORMAL`,
`EMERGENCIA`, `RECUPERACION` y `FALLO`. `restante_ms` es el tiempo restante de
la fase vigente; puede ser cero en fases sin temporizador.

Ejemplos:

```text
SIV,1,0,120,BOOT,0
SIV,1,1,121,STATE,0,G,R,A_VERDE,NORMAL,5000
SIV,1,2,1121,HEARTBEAT,0,G,R,A_VERDE,NORMAL,4000
SIV,1,3,8300,EMERGENCIA_DETECTADA,1,A,R,G,B_VERDE,143
SIV,1,4,10301,PRIORIDAD_ACTIVADA,1,2001,G,R,PRIORIDAD_A
SIV,1,5,18600,EMERGENCIA_FINALIZADA,1,8299
SIV,1,6,22600,CICLO_RECUPERADO,1,4000
```

Los valores de ejemplo son ilustrativos, no una medición de SimulIDE. El
receptor valida cabecera, versión, rangos, cantidad y valores de los campos;
rechaza mensajes sin LF, no ASCII o con campos inválidos.

## Incidentes y cronología

- Al recibir `CICLO_EVENTO_SOLICITUD`, se crea un ID no nulo para la nueva
  emergencia. Si ya hay un incidente abierto, no se crea otro. La FSM existente
  ya suprime solicitudes repetidas durante una emergencia en curso.
- La detección nueva durante recuperación recibe otro ID. Las recuperaciones
  anteriores pendientes conservan sus propios IDs en una lista fija.
- Los IDs van de 1 a 65535, saltan 0 al envolver y pueden reutilizarse tras
  suficientes incidentes en una misma ejecución.
- Si A ya está verde y la FSM activa la prioridad en la misma llamada que
  confirma la emergencia, `PRIORIDAD_ACTIVADA` se registra con `respuesta_ms=0`.
- `EMERGENCIA_FINALIZADA` se emite únicamente cuando la FSM entrega
  `CICLO_EVENTO_EMERGENCIA_FINALIZADA`. La lógica existente termina la prioridad
  después de 25 ventanas consecutivas sin tono clasificable; no se cambia ese
  criterio en esta fase.
- `CICLO_RECUPERADO` se emite al recibir
  `CICLO_EVENTO_RECUPERACION_COMPLETA`. La instrumentación guarda hasta cuatro
  recuperaciones pendientes; si se supera ese límite, informa una pérdida
  crítica en vez de asociar el cierre a un ID incorrecto.
- La FSM no expone motivo detallado del fallo. Por eso se transmite
  `NO_DISPONIBLE`, no una causa inferida.

`indicio_ms` es el tiempo desde el primer indicio tonal clasificable que
conserva Goertzel hasta la confirmación. No representa el comienzo físico del
sonido. Los timestamps, duraciones y diferencias se calculan con aritmética
unsigned de 32 bits, por lo que las restas siguen siendo correctas al desbordar
`millis()` siempre que el intervalo medido sea menor que una vuelta completa
(aproximadamente 49.7 días).

La detección tonal existente usa el valor cero como centinela de timestamp;
un tono que ocurra exactamente en `millis()==0` no puede distinguirse de un
timestamp vacío. La instrumentación no cambia Goertzel en esta fase.

## Cola UART y comportamiento ante pérdidas

- Cola estática de cuatro tramas, con buffers fijos de 96 bytes.
- `BOOT`, cambios de estado y eventos de incidentes son críticos. Heartbeats e
  indicios son de supervisión.
- Si la cola está llena, un evento crítico puede desplazar la trama de
  supervisión más antigua que todavía no comenzó a transmitirse. Una trama
  parcialmente enviada no se elimina para evitar concatenar líneas y
  corromper el mensaje crítico que la sigue.
- Si no hay una trama de supervisión reemplazable, se contabiliza la pérdida
  en un contador saturado de 16 bits. Cuando haya espacio se encola `PERDIDA`;
  la secuencia también permite detectar saltos y wrap de 16 bits.
- El drenaje solo escribe si `Serial.availableForWrite()` indica espacio y
  limita cada iteración a 16 bytes. No hay `delay()` ni espera activa. La cola
  acota la memoria y el tiempo empleado en la transmisión no controla las
  transiciones de la FSM.
- La pérdida de telemetría nunca pausa ni modifica el control local. Si la
  desconexión persiste, la cola puede saturarse; los contadores dan cuenta de
  pérdidas hasta su máximo de 65535.

## Receptor Python

`tools/serial_protocol.py` contiene el parser y el rastreador de secuencia
independientes del puerto. `tools/serial_receiver.py` abre el puerto indicado,
valida cada línea, imprime una descripción legible, informa mensajes inválidos
y advierte de huecos, duplicados, desorden y nuevos arranques. Acepta rutas de
dispositivo Linux y nombres COM de Windows. La dependencia `pyserial` no se
instala automáticamente.

Ejecutar pruebas del parser desde PowerShell en la raíz:

```powershell
python -m unittest discover -s test -p "test_serial_protocol.py" -v
```

## Ejecución con SimulIDE Linux, `socat` y Python

La configuración detallada de WSL2/WSLg, `socat`, pseudo-terminales y carga
del firmware está en
[`GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md`](GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md).
La conexión debe seguir siendo: Arduino simulado → UART del componente
`Serial Port` → `/tmp/siv-simulide` → `socat` → `/tmp/siv-python` → receptor.

Después de cargar el firmware de esta fase, la salida ya no es
`SIV_TEST,UPTIME_MS=...`; debe contener tramas `SIV,1,...`, incluyendo `BOOT`,
`STATE` y `HEARTBEAT`. Para producir eventos de emergencia, activar el Wave
Generator con el archivo de sirena y observar el ciclo del semáforo.

## Pruebas y resultados

Pruebas automatizadas previstas:

- Cola llena, desplazamiento de supervisión, pérdida crítica y escritura
  parcial.
- Captura de fase y luces tras avanzar el tiempo del tick, justo antes de
  aplicar la solicitud de emergencia.
- Identidad de incidentes, deduplicación, múltiples recuperaciones pendientes
  y saturación de ese seguimiento.
- Wrap de secuencia y de `millis()`.
- Parser de cada tipo de mensaje, campos inválidos, líneas incompletas y
  detección de secuencias faltantes.
- Regresiones existentes de FSM y Goertzel y compilación para Arduino Uno.

Las pruebas nativas C++ se ejecutan con `pio run -e test_telemetria` y luego
`.pio\build\test_telemetria\program.exe`; requieren `g++`.

Resultados de esta implementación:

- `pio run -e uno`: correcto; RAM estática 1462/2048 bytes (71.4%), flash
  15726/32256 bytes (48.8%). Quedan 586 bytes de SRAM para pila; no se midió
  el máximo de pila en ejecución.
- `python -m unittest discover -s test -p "test_serial_protocol.py" -v`:
  correctas, 4 pruebas.
- `node test\test_ciclo.mjs`: correcto.
- `powershell -ExecutionPolicy Bypass -NoProfile -File test\test_goertzel.ps1`:
  correcto.
- `pio run -e test_telemetria`: intentado, no compiló porque `g++` no está
  instalado/disponible en Windows. La prueba C++ de cola e incidentes queda
  pendiente de ejecutarse en un entorno con compilador nativo.
- La recepción nueva desde SimulIDE y `socat` requiere validación manual. No se
  afirma como probada por compilar el firmware; WSL no pudo iniciar `bash` en
  este entorno.

## Limitaciones y próximos pasos

- El heartbeat depende del tiempo simulado. Una pausa o velocidad reducida de
  SimulIDE puede parecer una interrupción si se interpreta con tiempo de pared.
- No hay ID de sesión persistente ni sincronización de hora real.
- Los contadores se saturan en 65535; después indican al menos ese número de
  pérdidas.
- El tamaño estático de RAM deja margen limitado para la pila. Si se agregan
  funciones, volver a revisar el reporte de PlatformIO y validar la simulación.
- Falta observar manualmente los mensajes nuevos en el receptor Linux y
  comprobar detección, activación inmediata con A verde, finalización,
  recuperación y respuesta a la desconexión de Python.
- Una fase posterior puede consumir estos eventos para un backend/dashboard,
  manteniendo a Arduino como controlador autónomo.
