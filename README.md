# Cruce de 2 Semáforos con Prioridad de Ambulancia

Simulación de un cruce controlado por Arduino Uno: dos semáforos que alternan
el paso entre dos carriles. El LCD muestra el estado. Una senoidal de sirena
en `A0` (Wave Generator de SimulIDE) se analiza con **Goertzel**; si hay energía
en 750 / 1000 / 1250 Hz, el Carril A queda en verde y el Carril B en rojo.

El simulador principal es **SimulIDE** (gratis). Wokwi no puede inyectar una
onda de audio fiable; el circuito viejo quedó en `diagram.json` solo como
referencia visual.

## Cómo funciona

El ciclo normal tiene 4 fases:

| Fase | Carril A (Semáforo 1) | Carril B (Semáforo 2) | Duración |
|------|------------------------|-------------------------|----------|
| 1    | Verde                  | Rojo                    | 5 s      |
| 2    | Amarillo               | Rojo                    | 2 s      |
| 3    | Rojo                   | Verde                   | 5 s      |
| 4    | Rojo                   | Amarillo                | 2 s      |

Durante cada fase el firmware toma ventanas de 64 muestras a 8 kHz (~8 ms) y
corre Goertzel. Dos ventanas seguidas en banda de sirena interrumpen el ciclo
y entran en **modo ambulancia**. Tres ventanas sin sirena lo sueltan. El LCD
muestra "AMBULANCIA DETECTADA!" y después "TRAFICO NORMAL".

## Circuito (SimulIDE)

- **Arduino Uno** (Reset unido a 5V)
- **6 LEDs** (rojo/amarillo/verde ×2), cada uno con 220 Ω al GND del Uno
- **LCD 1602 HD44780 + I2C to Parallel** (dirección `0x27`)
- **Wave Generator** senoidal en `A0` (1000 Hz, 2,5 V ± 2 V)

Instrucciones paso a paso: [`simulide/ARMADO.md`](simulide/ARMADO.md).

### Mapeo de pines

| Señal | Pin Arduino |
|-------|-------------|
| Semáforo 1 - Rojo | D8 |
| Semáforo 1 - Amarillo | D9 |
| Semáforo 1 - Verde | D10 |
| Semáforo 2 - Verde | D5 |
| Semáforo 2 - Amarillo | D6 |
| Semáforo 2 - Rojo | D7 |
| Sirena (WaveGen) | A0 |
| LCD SDA | A4 |
| LCD SCL | A5 |

Los pines del Semáforo 2 (rojo/verde) no siguen el orden 5-6-7 porque así
estaba el Wokwi original. El sketch (`src/sketch.ino`) es la referencia.

## Estructura del proyecto

```
project/
├── src/sketch.ino          # ciclo de semáforos + detector
├── src/goertzel.h          # Goertzel en 750 / 1000 / 1250 Hz
├── simulide/ARMADO.md      # cómo armar el circuito en SimulIDE
├── test/test_goertzel.ps1  # prueba del detector (sin Arduino)
├── platformio.ini
├── diagram.json            # circuito Wokwi (legado)
└── evidencia.md            # por qué SimulIDE y no Wokwi
```

## Cómo levantarlo

### 1. Compilar el firmware (Cursor)

Hace falta la extensión **PlatformIO IDE**. En la carpeta del proyecto:

```
pio run
```

O el ícono de PlatformIO → `Project Tasks > uno > General > Build`.

El archivo que carga SimulIDE es `.pio/build/uno/firmware.hex`.

### 2. Instalar SimulIDE (una vez)

Bajá **1.1.0 SR2** de https://simulide.com/p/download110/ (zip de Windows).
No hace falta cuenta.

### 3. Armar el circuito

Seguí [`simulide/ARMADO.md`](simulide/ARMADO.md). Guardá el archivo en
`simulide/` para no perderlo.

Clic derecho en el Uno → `mega328` → **Load firmware** →
`.pio/build/uno/firmware.hex`. Activá **Reload HEX at Simulation Start**.

### 4. Simular

Power en SimulIDE. Encendé el WaveGen (botón izquierdo):

- 1000 Hz On → modo ambulancia
- Off → tráfico normal
- 200 Hz On → no debe disparar

### 5. Tests del detector (opcional)

```
powershell -NoProfile -File test\test_goertzel.ps1
```

Comprueba que 1000 Hz se detecta y 200 Hz / silencio no.

## Problemas comunes

- **VS Code marca error en `#include <Wire.h>`**: IntelliSense, no la
  compilación. `PlatformIO: Rebuild IntelliSense Index`.
- **SimulIDE no encuentra el hex**: `pio run` y path sin espacios raros.
- **El MCU no arranca**: Reset del Uno a 5V.
- **LCD en blanco**: Control Code del I2C to Parallel = 32, A0/A1/A2 a 5V,
  RW del HD44780 a P1 o GND. Detalle en `simulide/ARMADO.md`.
- **No detecta la sirena**: Wave type Sine, 1000 Hz, Middle 2.5 V,
  Semi amplitude 2 V, Always On desactivado, OUT a A0.
- **Wokwi ya no demuestra la sirena**: el potenciómetro no es una onda;
  para frecuencia usá SimulIDE.
