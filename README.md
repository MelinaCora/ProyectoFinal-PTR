# Cruce de 2 semáforos con prioridad de ambulancia

Proyecto para simular en **SimulIDE** un cruce de dos carriles controlado por
Arduino Uno. En el ciclo normal, los semáforos alternan el paso. Un generador
de señal conectado a `A0` simula la sirena: el firmware analiza su frecuencia
con Goertzel y, al detectarla, da prioridad al carril A.

## Funcionamiento

El ciclo normal consta de cuatro fases:

| Fase | Carril A (semáforo 1) | Carril B (semáforo 2) | Duración |
|------|-----------------------|-----------------------|----------|
| 1    | Verde                 | Rojo                  | 5 s      |
| 2    | Amarillo              | Rojo                  | 2 s      |
| 3    | Rojo                  | Verde                 | 5 s      |
| 4    | Rojo                  | Amarillo              | 2 s      |

El firmware toma ventanas de 64 muestras a 8 kHz y analiza las frecuencias
750, 1000 y 1250 Hz. Dos ventanas consecutivas con señal en esas bandas
interrumpen el ciclo: el carril A queda en verde y el carril B en rojo. Al
dejar de detectar la señal durante tres ventanas, se reanuda el ciclo normal.
El LCD indica el estado del cruce.

## Componentes del circuito

- Arduino Uno (con `RESET` conectado a 5 V).
- Seis LEDs: dos rojos, dos amarillos y dos verdes.
- Una resistencia de 220 Ω en serie con cada LED.
- LCD 1602 HD44780 con adaptador I2C to Parallel, dirección `0x27`.
- Wave Generator para simular la sirena en `A0`.

### Mapeo de pines

| Señal | Pin Arduino |
|-------|-------------|
| Semáforo 1 - rojo | D8 |
| Semáforo 1 - amarillo | D9 |
| Semáforo 1 - verde | D10 |
| Semáforo 2 - verde | D5 |
| Semáforo 2 - amarillo | D6 |
| Semáforo 2 - rojo | D7 |
| Wave Generator - salida | A0 |
| LCD - SDA | A4 |
| LCD - SCL | A5 |

Cada LED se conecta desde su pin del Arduino, a través de una resistencia de
220 Ω, hasta el ánodo. Conectá el cátodo a GND.

Las instrucciones de conexión del LCD y de configuración del generador están
en [`simulide/ARMADO.md`](simulide/ARMADO.md).

## Preparar y ejecutar la simulación

### 1. Instalar las herramientas

Instalá **SimulIDE 1.1.0 SR2** desde
[la página de descargas de SimulIDE](https://simulide.com/p/download110/).

Para compilar el firmware, instalá la extensión **PlatformIO IDE** en VS Code.
También podés usar PlatformIO Core si el comando `pio` está disponible en la
terminal.

### 2. Generar el firmware `.hex`

Abrí una terminal en la carpeta raíz del proyecto y ejecutá:

```powershell
pio run
```

PlatformIO compila el proyecto para Arduino Uno. Si la compilación termina
correctamente, el archivo que se carga en SimulIDE queda en:

```text
.pio/build/uno/firmware.hex
```

También podés compilar desde VS Code: **PlatformIO > Project Tasks > uno >
General > Build**.

### 3. Armar el circuito en SimulIDE y cargar el firmware

Seguí [`simulide/ARMADO.md`](simulide/ARMADO.md) para conectar los componentes
y guardar el circuito dentro de la carpeta `simulide/`.

En SimulIDE, hacé clic derecho sobre el Arduino Uno y elegí
**mega328 > Load firmware**. Seleccioná `.pio/build/uno/firmware.hex`.
En las propiedades del microcontrolador, activá **Reload HEX at Simulation
Start** para que se cargue el firmware al iniciar la simulación.

### 4. Probar el comportamiento

Iniciá la simulación con **Power** y probá el Wave Generator:

- Senoidal de 1000 Hz encendida: debe activarse el modo ambulancia.
- Señal apagada: después de unas ventanas debe volver el ciclo normal.
- Senoidal de 200 Hz: no debe activar el modo ambulancia.

Configurá la salida senoidal con frecuencia de 1000 Hz, tensión central de
2.5 V y amplitud de 2 V. Dejá **Always On** desactivado para poder encenderla y
apagarla durante la simulación.

## Prueba opcional del detector

La prueba de Goertzel se puede ejecutar en PowerShell sin conectar hardware:

```powershell
powershell -NoProfile -File test\test_goertzel.ps1
```

Comprueba la detección de 1000 Hz y que 200 Hz y el silencio no se detecten.

## Problemas comunes

- **`pio` no se reconoce:** instalá PlatformIO IDE/Core y abrí una terminal
  donde el comando `pio` esté disponible, o compilá con **PlatformIO > Project
  Tasks > uno > General > Build**.
- **SimulIDE no encuentra el firmware:** ejecutá `pio run` y seleccioná
  `.pio/build/uno/firmware.hex`.
- **El microcontrolador no arranca:** verificá que `RESET` esté conectado a
  5 V.
- **El LCD queda en blanco:** revisá la dirección `0x27`, `Control Code = 32`,
  las conexiones de A0/A1/A2 a 5 V y que RW del HD44780 esté conectado a P1 o
  GND. Consultá [`simulide/ARMADO.md`](simulide/ARMADO.md).
- **No se detecta la sirena:** verificá que el Wave Generator sea senoidal,
  esté conectado a A0 y use una frecuencia de 1000 Hz, tensión central de
  2.5 V y amplitud de 2 V.
