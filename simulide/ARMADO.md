# Circuito SimulIDE — cruce con sirena

SimulIDE no importa `diagram.json`. Armá este circuito una vez, guardalo como
`simulide/cruce.sim1` (o `.simu` / `.sim2` según tu versión) y recargá el firmware
después de cada `pio run`.

Versión recomendada: **SimulIDE 1.1.0 SR2**  
https://simulide.com/p/download110/

## Mejoras respecto al circuito Wokwi

- El potenciómetro (tensión continua) se reemplaza por un **Wave Generator** senoidal.
  Así el ADC ve una onda de ~1 kHz, no un umbral estático.
- **Reset del Uno a +5 V.** En SimulIDE el pull-up interno del AVR no está simulado;
  sin esto el MCU puede quedar en reset.
- Resistencias de LED **220 Ω** (equivalente práctico a las de 200 Ω; corriente ~13 mA).
- Senoidal **centrada en 2,5 V ± 2 V** para que el ADC trabaje alrededor de 512,
  que es lo que espera Goertzel.
- Cátodos de los 6 LEDs al **GND del Arduino** (una sola malla de masa).
- WaveGen con **Always On = no**: el botón izquierdo es la sirena.

## Componentes

Buscalos en el panel izquierdo (caja de búsqueda arriba de la lista).

| Cant. | Componente | Dónde está |
|------:|------------|------------|
| 1 | Arduino Uno | Micro / Arduino |
| 6 | Led | Outputs / Leds |
| 6 | Resistor 220 Ω | Passive / Resistors |
| 1 | Hd44780 (2 filas, 16 columnas) | Outputs / Displays |
| 1 | I2C to Parallel | Logic / Converters |
| 1 | Wave Generator | Sources |
| 1 | Ground (opcional, extra) | Sources |
| 1 | Probe u Oscope (opcional) | Meters |

Colores de LED: 2 rojos, 2 amarillos, 2 verdes. En propiedades de cada Led,
`Color` = Red / Yellow / Green.

## Pines (igual que el sketch)

| Señal | Pin Arduino |
|-------|-------------|
| Semáforo 1 rojo | D8 |
| Semáforo 1 amarillo | D9 |
| Semáforo 1 verde | D10 |
| Semáforo 2 verde | D5 |
| Semáforo 2 amarillo | D6 |
| Semáforo 2 rojo | D7 |
| Sirena (WaveGen OUT) | A0 |
| LCD SDA | A4 |
| LCD SCL | A5 |
| RST del Uno | 5V |

Cada LED: Arduino pin → resistor 220 Ω → ánodo del LED. Cátodo → GND del Uno.

## Wave Generator (sirena)

Clic derecho → Properties:

| Propiedad | Valor |
|-----------|--------|
| Wave type | Sine |
| Frequency | 1000 Hz |
| Always On | **no** |
| Middle Voltage | 2.5 V |
| Semi amplitude | 2 V |

Salida del WaveGen al pin **A0**. Masa del circuito = GND del Uno.

Para probar: con la simulación corriendo, el botón de la izquierda del WaveGen
enciende/apaga la senoidal.

- **On + 1000 Hz** → LCD "AMBULANCIA DETECTADA!", C1 verde, C2 rojo.
- **Off** → a los ~25 ms (3 ventanas) vuelve el ciclo normal.
- Prueba negativa: Frequency **200 Hz**, On → no debe disparar.

## LCD I2C (dirección 0x27)

El sketch usa `LiquidCrystal_I2C lcd(0x27, 16, 2)`. En SimulIDE eso es
**HD44780 + I2C to Parallel** (el PCF8574 del backpack).

### I2C to Parallel

| Propiedad / pin | Valor |
|-----------------|--------|
| Control Code | **32** (eso es 0x20, la parte alta) |
| A0, A1, A2 | a **5V** del Uno → dirección final **0x27** |
| SDA | A4 |
| SCL | A5 |

### HD44780

Properties: Rows = 2, Columns = 16.

| Pin LCD | Conectar a |
|---------|------------|
| Vss | GND |
| Vdd | 5V |
| V0 (contraste) | GND, o un potenciómetro 10 kΩ entre 5V y GND |
| RS | P0 del I2C to Parallel |
| RW | P1 (o GND si no usás lectura) |
| En | P2 |
| D4 | P4 |
| D5 | P5 |
| D6 | P6 |
| D7 | P7 |
| Led+ | 5V (o P3 si querés backlight por I2C) |
| Led- | GND |

RW del LCD **tiene que estar conectado** (a P1 o a GND). En SimulIDE 1.1, si queda
flotando el display no escribe.

Si el LCD queda en blanco: Control Code 32, A0–A2 a 5V, y misma dirección 0x27
en el código.

## Firmware

SimulIDE no compila este repo. En Cursor, en la carpeta del proyecto:

```
pio run
```

El hex queda en `.pio/build/uno/firmware.hex`.

En el Arduino Uno del circuito:

1. Clic derecho → **mega328** → **Load firmware** → elegí ese `.hex`.
2. Otra vez clic derecho → mega328 → **Properties** → activá
   **Reload HEX at Simulation Start**.

Cada vez que cambies el sketch: `pio run` y después Power en SimulIDE.

## Cómo correr la simulación

1. Instalá SimulIDE 1.1.0 (zip, no hace falta instalador).
2. Armá y guardá el circuito en `simulide/`.
3. `pio run` en este proyecto.
4. Load firmware + Reload HEX at start.
5. Botón Power (arriba).
6. Encendé el WaveGen: tiene que cortar el ciclo y dar paso al carril 1.

## Si el LCD I2C pelea

Plan B (cambia el sketch): LCD paralelo 4 bits en pines libres
D2, D3, D4, D11, D12, D13 con `LiquidCrystal` (no I2C). Los semáforos y el
WaveGen no se tocan. Solo usalo si 0x27 no muestra nada después de revisar
Control Code y A0–A2.
