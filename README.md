# Cruce de 2 semáforos con prioridad de ambulancia

Proyecto para simular en **SimulIDE** un cruce de dos carriles controlado por
Arduino Uno. En el ciclo normal, los semáforos alternan el paso. Un Wave
Generator reproduce [`sirena.wav`](sirena.wav) en `A0`: el firmware analiza su
frecuencia con Goertzel y, al detectar la sirena, da prioridad al carril A.

## Funcionamiento

El ciclo normal consta de cuatro fases:

| Fase | Carril A (semáforo 1) | Carril B (semáforo 2) | Duración |
|------|-----------------------|-----------------------|----------|
| 1    | Verde                 | Rojo                  | 5 s      |
| 2    | Amarillo              | Rojo                  | 2 s      |
| 3    | Rojo                  | Verde                 | 5 s      |
| 4    | Rojo                  | Amarillo              | 2 s      |

El firmware toma ventanas de 64 muestras y mide la frecuencia de muestreo real
de esa ventana. Busca un pico tonal en las bandas 650, 800, 950, 1100 y
1250 Hz. Para entrar en modo ambulancia tiene que ver un tono grave y uno
agudo del barrido en unos 2 s: un sonido fuerte o un tono fijo no alcanza.
El carril A queda en verde y el carril B en rojo. El tiempo de la fase
interrumpida se congela: la ambulancia no lo consume. Al dejar de detectar
tono en la banda durante 25 ventanas, se retoma esa fase:

| Interrupción en | Entrada a prioridad | Al terminar la ambulancia |
|-----------------|---------------------|---------------------------|
| A verde | A verde / B rojo de inmediato | Sigue el verde de A con el tiempo que faltaba |
| A amarillo | A verde / B rojo de inmediato | Amarillo de A (2 s) y después verde de B completo |
| B verde | Amarillo de B (2 s) y después A verde / B rojo | Amarillo de A (2 s) y después verde de B con el tiempo congelado |
| B amarillo | Termina el amarillo de B y después A verde / B rojo | Verde de A completo (5 s); el turno de B ya estaba cerrando |

Si la sirena se corta durante el amarillo de entrada de B, se cancela la
prioridad y B recupera su verde con el tiempo congelado. Si vuelve durante
el amarillo de salida de A, se reentra en prioridad y el verde de B sigue
pendiente con el mismo resto.

Con el Wave Generator apagado el LCD muestra `FUNCIONAMIENTO` / `NORMAL`.
Con el patrón confirmado (y durante el despeje de entrada de B) muestra
`AMBULANCIA` y en la segunda línea el tiempo de respuesta, por ejemplo
`RESPUESTA 4200ms`, desde que `A0` empezó a moverse hasta ese cambio. En el
amarillo de salida de A vuelve a `FUNCIONAMIENTO` / `NORMAL`.

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
- Cuando el barrido confirma grave y agudo (cerca del pico), entra el modo ambulancia.
- El LCD muestra `AMBULANCIA` y `RESPUESTA xxxxms` (desde el primer movimiento de `A0`).
- Cuando se aleja y ya no hay tono en la banda, a las 25 ventanas retoma la fase
  que se había interrumpido (con despejes en amarillo si hace falta).
- Apagado: también corta la detección y, tras esas ventanas, retoma esa fase.

En el osciloscopio de `A0` la onda tiene que verse centrada en unos 2,5 V,
barriendo alrededor de 1 kHz, con amplitud que crece y después decrece.
Recompilá y volvé a cargar el `.hex` después de este cambio.

## Prueba opcional del detector y del ciclo

La prueba de Goertzel se puede ejecutar en PowerShell sin conectar hardware:

```powershell
powershell -NoProfile -File test\test_goertzel.ps1
```

Comprueba que un tono fijo de 1000 Hz, 200 Hz y el silencio no confirmen el
patrón, y que `sirena.wav` no dispare de lejos, sí en el pico y no otra vez al
alejarse.

La lógica de fases e interrupción (`src/ciclo.h`) se prueba en el host con
`test/test_ciclo.cpp`. Si hay un `g++` en el PATH:

```powershell
pio run -e test_ciclo
.pio\build\test_ciclo\program.exe
```

También:

```powershell
node test\test_ciclo.mjs
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
