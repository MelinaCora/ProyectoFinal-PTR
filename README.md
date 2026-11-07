# Cruce de 2 semáforos con prioridad de ambulancia

Proyecto para simular en **SimulIDE** un cruce de dos carriles controlado por
Arduino Uno. En el ciclo normal, los semáforos alternan el paso. Un Wave
Generator reproduce [`sirena.wav`](sirena.wav) en `A0`: el firmware analiza su
frecuencia con Goertzel y, al detectar la sirena, da prioridad al carril A.

## Funcionamiento

El ciclo normal alterna los dos carriles. Cada cambio de derecho de paso pasa
por un intervalo configurable de **1 s con ambos semáforos en rojo** (valor
académico de simulación, no normativo para tránsito real):

| Fase | Carril A (semáforo 1) | Carril B (semáforo 2) | Duración |
|------|-----------------------|-----------------------|----------|
| Verde A | Verde                 | Rojo                  | 5 s      |
| Amarillo A | Amarillo          | Rojo                  | 2 s      |
| Seguridad hacia B | Rojo       | Rojo                  | 1 s      |
| Verde B | Rojo                  | Verde                 | 5 s      |
| Amarillo B | Rojo              | Amarillo              | 2 s      |
| Seguridad hacia A | Rojo       | Rojo                  | 1 s      |

El firmware toma ventanas de 64 muestras y mide la frecuencia de muestreo real
de esa ventana. Busca un pico tonal en las bandas 650, 800, 950, 1100 y
1250 Hz. Para entrar en modo ambulancia tiene que ver un tono grave y uno
agudo del barrido en unos 2 s: un sonido fuerte o un tono fijo no alcanza.
La prioridad es exclusiva del carril A y no habilita A mientras B siga en
verde o amarillo. Una solicitud confirmada queda pendiente hasta ser atendida;
las detecciones repetidas no reinician la secuencia. Durante prioridad, la
sirena se considera finalizada después de 25 ventanas consecutivas sin tono.
El resto del verde interrumpido se conserva cuando aplica; las fases amarillas
se completan antes de cambiar de derecho de paso:

| Interrupción en | Entrada a prioridad | Al terminar la ambulancia |
|-----------------|---------------------|---------------------------|
| A verde | Prioridad A inmediata | A retoma el verde con el tiempo restante |
| A amarillo | Completa el amarillo, todo-rojo 1 s, prioridad A | Amarillo A 2 s, todo-rojo 1 s y verde B completo |
| B verde | Amarillo B 2 s, todo-rojo 1 s, prioridad A | Amarillo A 2 s, todo-rojo 1 s y verde B con el tiempo restante |
| B amarillo | Completa el amarillo, todo-rojo 1 s, prioridad A | A inicia un verde normal completo de 5 s |
| Todo-rojo | Mantiene el intervalo restante y luego prioridad A | Continúa la recuperación asociada al cambio pendiente |

Las solicitudes confirmadas quedan enclavadas: aunque la sirena se interrumpa
durante un despeje, la transición segura continúa y la prioridad se atiende.

La fase `TODO_ROJO` utiliza un destino explícito (verde A, verde B o prioridad
A), evitando duplicar estados. Si el estado interno resulta inválido o una
actualización excede el límite de recuperación configurado, el controlador
queda enclavado en `FALLO_SEGURO`, con ambos carriles en rojo; requiere reinicio
para salir de ese estado. Al iniciar, las salidas también comienzan con ambos
carriles en rojo mientras se inicializa el sistema.

El LCD muestra `FUNCIONAMIENTO` / `NORMAL`, `AMBULANCIA` con el tiempo de
respuesta, o `FALLO SEGURO` / `AMBOS EN ROJO`. El tiempo de respuesta se mide
desde la confirmación del patrón de sirena hasta la activación efectiva de la
prioridad A; si A ya está verde, la respuesta es inmediata. En el ciclo normal,
el exceso de tiempo de una actualización se consume a través de las fases
siguientes. Una demora extrema que supera el límite de transiciones provoca el
estado seguro.

## Componentes del circuito

- Arduino Uno (con `RESET` conectado a 5 V).
- Seis LEDs: dos rojos, dos amarillos y dos verdes.
- Una resistencia de 220 Ω en serie con cada LED.
- LCD 1602 HD44780 con adaptador I2C to Parallel, dirección `0x27`.
- Wave Generator en modo Wav, con [`sirena.wav`](sirena.wav) en `A0`.

### Mapeo de pines

| Señal | Pin Arduino |
|-------|-------------|
| Semáforo 1 - rojo | D8 |
| Semáforo 1 - amarillo | D9 |
| Semáforo 1 - verde | D10 |
| Semáforo 2 - rojo | D5 |
| Semáforo 2 - amarillo | D6 |
| Semáforo 2 - verde | D7 |
| Wave Generator - salida | A0 |
| LCD - SDA | A4 |
| LCD - SCL | A5 |

Ambos semáforos van en orden rojo–amarillo–verde. El sketch (`src/sketch.ino`)
es la referencia.

Cada LED se conecta desde su pin del Arduino, a través de una resistencia de
220 Ω, hasta el ánodo. Conectá el cátodo a GND.

Las instrucciones de conexión del LCD y de configuración del generador están
en [`simulide/ARMADO.md`](simulide/ARMADO.md).

## Sirena

El modo ambulancia lo dispara el patrón de [`sirena.wav`](sirena.wav), en la
raíz del proyecto, junto a `Citcuito1.sim1`. Es PCM de 16 bit, mono, a 8000 Hz,
de 20 segundos. El tono barre entre 650 y 1300 Hz. La amplitud simula la
distancia: 4 s muy baja (lejos), 4 s de acercamiento, 4 s en el pico, 4 s
alejándose y 4 s otra vez lejos. El reloj de respuesta arranca cuando `A0`
deja el silencio; el semáforo cambia recién cuando el barrido confirma grave
y agudo, no al tocar el botón del WaveGen.

En el Wave Generator de SimulIDE:

| Propiedad | Valor |
|-----------|--------|
| Wave type | Wav |
| Input File | `sirena.wav` (solo el nombre; el archivo va en la misma carpeta que el circuito) |
| Always On | no |
| Middle Voltage | 2.5 V |
| Semi amplitude | 2 V |

El botón izquierdo del WaveGen enciende y apaga esa sirena. Para volver a
generar el WAV:

```powershell
powershell -NoProfile -File simulide\generar_sirena.ps1
```

## Preparar y ejecutar la simulación

### 1. Instalar las herramientas

Instalá **SimulIDE 1.1.0 SR2** desde
[la página de descargas de SimulIDE](https://simulide.com/p/download110/).

Para compilar el firmware, instalá la extensión **PlatformIO IDE** en VS Code.
En Cursor a veces no aparece en el marketplace: instalá el `.vsix` de
[v3.3.4](https://github.com/platformio/platformio-vscode-ide/releases/tag/v3.3.4)
y recargá la ventana (`Ctrl+Shift+P` → **Developer: Reload Window**).
También podés usar PlatformIO Core si el comando `pio` está disponible en la
terminal.

### 2. Generar el firmware `.hex`

La forma fiable en Cursor y VS Code es el ícono de PlatformIO (la hormiga):
**Project Tasks > uno > General > Build**.

Si `pio` está en el PATH, desde la carpeta raíz del proyecto:

```powershell
pio run
```

Si la compilación termina correctamente, el archivo que se carga en SimulIDE
queda en:

```text
.pio/build/uno/firmware.hex
```

### 3. Armar el circuito en SimulIDE y cargar el firmware

Seguí [`simulide/ARMADO.md`](simulide/ARMADO.md) para conectar los componentes
y guardar el circuito dentro de la carpeta `simulide/`.

En SimulIDE, hacé clic derecho sobre el Arduino Uno y elegí
**mega328 > Load firmware**. Seleccioná `.pio/build/uno/firmware.hex`.
En las propiedades del microcontrolador, activá **Reload HEX at Simulation
Start** para que se cargue el firmware al iniciar la simulación.

### 4. Probar el comportamiento

Iniciá la simulación con **Power** y usá el botón izquierdo del Wave Generator:

- Al encenderlo, los primeros segundos la sirena está lejos: el ciclo sigue normal.
- Cuando el barrido confirma grave y agudo (cerca del pico), solicita prioridad A.
- Si B tiene el paso, termina su amarillo y el todo-rojo de seguridad antes
  de habilitar A; el LCD mide desde la confirmación hasta esa activación.
- Cuando se aleja y ya no hay tono en la banda, tras 25 ventanas comienza la
  recuperación segura y retoma la fase interrumpida cuando corresponde.
- Apagado: también corta la detección y, tras esas ventanas, retoma esa fase.

En el osciloscopio de `A0` la onda tiene que verse centrada en unos 2,5 V,
barriendo alrededor de 1 kHz, con amplitud que crece y después decrece.
Recompilá y volvé a cargar el `.hex` después de este cambio.

## Telemetría UART

El firmware transmite eventos, cambios de estado y heartbeats por UART0 a
9600 baudios mediante el protocolo SIV v1. La conexión es solo de supervisión:
Arduino sigue controlando los semáforos aunque Python esté desconectado.
Consultá la especificación en
[`docs/FASE_3B_EVENTOS_METRICAS.md`](docs/FASE_3B_EVENTOS_METRICAS.md) y los
pasos para conectar SimulIDE Linux, `socat` y Python en
[`docs/GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md`](docs/GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md).

La Fase 3A documenta la prueba histórica `SIV_TEST`; no es el formato del
firmware actual. La investigación de la alternativa WSL2 sin controladores COM
está en [`docs/FASE_3A_ALTERNATIVA_COMUNICACION.md`](docs/FASE_3A_ALTERNATIVA_COMUNICACION.md).

## Prueba opcional del detector y del ciclo

La prueba de Goertzel se puede ejecutar en PowerShell sin conectar hardware:

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -File test\test_goertzel.ps1
```

Comprueba que un tono fijo de 1000 Hz, 200 Hz y el silencio no confirmen el
patrón, y que `sirena.wav` no dispare de lejos, sí en el pico y no otra vez al
alejarse.

La lógica de fases e interrupción (`src/ciclo.h`) se prueba siempre con el
runner JavaScript. Las pruebas nativas adicionales de ciclo y telemetría
requieren `g++`:

```powershell
node test\test_ciclo.mjs
pio run -e test_ciclo
.pio\build\test_ciclo\program.exe
pio run -e test_telemetria
.pio\build\test_telemetria\program.exe
```

## Problemas comunes

- **`pio` no se reconoce:** compilá con **PlatformIO > Project Tasks > uno >
  General > Build**. En Windows el ejecutable `pio` a veces está bloqueado por
  Control de aplicaciones.
- **SimulIDE no encuentra el firmware:** compilá y seleccioná
  `.pio/build/uno/firmware.hex`.
- **El microcontrolador no arranca:** verificá que `RESET` esté conectado a
  5 V.
- **El LCD queda en blanco:** en el I2C to Parallel poné **I2C Address = 39**
  (`0x27`). Conectá A0, A1 y A2 del adaptador a 5 V, SDA a A4 y SCL a A5.
  RW del HD44780 va a P1 o a GND. Consultá
  [`simulide/ARMADO.md`](simulide/ARMADO.md).
- **No se detecta la sirena:** el Wave Generator tiene que estar en modo Wav,
  conectado a A0, con Input File `sirena.wav` (el archivo en la misma carpeta
  que el circuito), tensión central de 2.5 V y amplitud de 2 V. El botón
  izquierdo tiene que estar encendido. Esperá el pico del barrido: un tono
  fijo no dispara. Recompilá y recargá el `.hex` si el firmware es anterior.
