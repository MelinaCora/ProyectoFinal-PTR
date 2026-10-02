# Evidencia: ¿se puede simular la detección de sirena por frecuencia?

Fecha: 2 de octubre de 2026  
Proyecto: cruce de 2 semáforos con prioridad de ambulancia (`d:\project`)  
Pregunta: reemplazar el potenciómetro por detección de audio de sirena, analizando las frecuencias, y ver si **Wokwi lo hace gratis**. Si no, si **SimulIDE** puede.

## Conclusión

**Wokwi, de forma gratuita y documentada, no.** No hay micrófono en el catálogo oficial, la simulación analógica es básica (casi continua/DC) y el prototipo de micrófono del navegador quedó sin documentar, con aviso explícito de que las frecuencias se distorsionan.

**SimulIDE, sí, y es gratis.** Puede inyectar una senoidal o un archivo WAV en el pin analógico del Arduino. Eso alcanza para que el firmware muestreé la onda con `analogRead()` y decida por frecuencia (Goertzel / FFT), no por un umbral de potenciómetro.

Para este proyecto, el camino de simulación que cierra el requerimiento es **SimulIDE**. Wokwi sigue siendo útil para el circuito visual (LEDs + LCD), pero no para “escuchar” una sirena.

---

## 1. Qué hay que simular (el requisito real)

Hoy el sketch no analiza sonido. En `src/sketch.ino` la ambulancia es un umbral sobre `analogRead(A0)`:

- pin: `A0`
- umbral: `UMBRAL_AMBULANCIA = 600` (aprox. 3/4 del potenciómetro)
- efecto: Carril A en verde, Carril B en rojo, LCD “AMBULANCIA DETECTADA!”

Eso es **amplitud estática** (una tensión continua). El pedido nuevo es:

1. Entrar una **onda de audio** (o un sustituto fiel) al ADC.
2. **Muestrearla** en el tiempo.
3. **Detectar bandas de sirena**, no “hay ruido / no hay ruido”.
4. Con esa decisión, interrumpir el ciclo de semáforos.

Sin un generador de onda en el pin A0, el código de análisis de frecuencias no se puede probar en el simulador.

### Frecuencias típicas de sirena

Las sirenas electrónicas de emergencia no son un tono único; barrren o alternan en audio (cientos a ~2 kHz):

| Tipo | Rango / patrón | Fuente |
|------|----------------|--------|
| Wail / yelp (SAE J1849) | fundamental **650–2000 Hz**, barrido mínimo 850 Hz | [Guía NIJ / SAE J1849](https://www.ojp.gov/pdffiles1/nij/181622.pdf) |
| Wail “estándar” citado en literatura | **600–1200 Hz** @ ~12 ciclos/min | [UPC, sirenas de emergencia](https://upcommons.upc.edu/bitstream/handle/2117/18181/Neuwsirentones.pdf) |
| Two-tone (Europa / ambulancias) | pares del estilo **435–651 Hz**, **450–600 Hz**, **400–1000 Hz** | mismo paper UPC |

El ADC del Arduino Uno, con `analogRead()` por defecto, convierte en ~100 µs (~9–10 kHz). Por Nyquist alcanza para fundamentales de 650–2000 Hz.

En un Uno (2 KB de RAM) el algoritmo razonable es **Goertzel** sobre 1 o 2 bandas (p. ej. 600–800 Hz y 1000–1300 Hz), no un espectrograma completo. Una FFT corta (64–128 muestras) también entra, con menos margen.

---

## 2. Wokwi (plan gratuito)

### 2.1 Lo que el plan Community (€0) cubre

Según [Wokwi Plan and Pricing](https://wokwi.com/pricing):

- simulaciones ilimitadas
- proyectos **públicos** ilimitados
- WiFi virtual compartido

Lo que **no** entra en el plan gratis del sitio: proyectos unlisted, librerías custom subidas al editor web, gateway IoT privado, builds rápidos.

La extensión de VS Code / Cursor es **gratis para proyectos open source**; uso comercial pide licencia. Hay trial de 30 días. Fuente: [Wokwi for VS Code License](https://wokwi.com/license).

**Pagar no desbloquea un micrófono ni una simulación analógica completa.** El límite es de producto, no de tarifa.

### 2.2 No hay micrófono en el hardware soportado

La lista oficial de sensores e inputs ([Supported Hardware](https://docs.wokwi.com/getting-started/supported-hardware)) incluye potenciómetro, joystick, LDR, NTC, PIR, etc. **No lista micrófono.**

Las salidas analógicas documentadas son las de tensión casi continua: potenciómetro, NTC, fotoresistor, joystick. Fuente: [Analog API](https://docs.wokwi.com/chips-api/analog).

El propio potenciómetro lo dice: *“Wokwi does not support full analog simulation”*. Fuente: [wokwi-potentiometer](https://docs.wokwi.com/parts/wokwi-potentiometer).

### 2.3 Hubo un prototipo de micrófono; no sirve para frecuencias

Pedido abierto desde 2021: [wokwi-features#55](https://github.com/wokwi/wokwi-features/issues/55) *Sensors for arduino - Microphone*. Sigue **open**.

Uri Shaked (autor de Wokwi) escribió:

> la simulación no siempre corre al 100%, así que si se stremea el micrófono en tiempo real **las frecuencias se sesgan**.

Etiquetó el pedido como `priority: club` (el viejo plan pago) y dejó un prototipo web que:

- lee `analogRead(A0)`
- enciende un LED si `abs(sample - 512) > 50`

Eso es **detección de pico / volumen**, no análisis espectral. Un comentario de la comunidad lo dice en el mismo issue: si no se puede hacer FFT, al menos volumen y picos.

En [wokwi-features#97](https://github.com/wokwi/wokwi-features/issues/97) el micrófono se menciona como “todavía no documentado”, con esos mismos ejemplos. Nunca entró al catálogo.

Implicaciones para este proyecto:

- El prototipo vive en el **simulador web**, no como parte documentada de la extensión de VS Code.
- Aunque el micrófono del navegador inyectara audio, el autor advierte **distorsión de frecuencia**. Justo lo que hace falta para detectar una ambulancia.
- Los ejemplos públicos (`wokwi-mic`) hacen lo mismo: umbral alrededor de 512. Equivale a “hay sonido fuerte”, no “es una sirena”.

### 2.4 Custom chips: senoidal sintética, no micrófono

Wokwi permite chips custom (API en beta) que escriben tensión con `pin_dac_write()`. Hay ejemplos de generador de señal y de lectura de senoidal. Fuentes: [Analog API](https://docs.wokwi.com/chips-api/analog), [Custom Chips](https://docs.wokwi.com/chips-api/getting-started), [Wave Chip](https://wokwi.com/projects/365938457042245633).

Eso **sí puede hacerse en un proyecto público gratis**, y en VS Code cargando un `.chip.wasm` en `wokwi.toml` ([project-config](https://docs.wokwi.com/vscode/project-config)).

Límites:

- No es audio del mundo real ni un WAV de sirena.
- La analogía de Wokwi es “muy limitada”; no hay red pasiva ni acondicionamiento de micrófono.
- En VS Code hay que **compilar el chip a WebAssembly** (toolchain extra).
- Si el simulador no corre en tiempo real, un Goertzel/FFT medirá otra frecuencia.
- Sigue siendo un **generador sintético**, no “detectar un audio de ambulancia”.

### 2.5 Veredicto Wokwi

| Pregunta | Respuesta |
|----------|-----------|
| ¿Hay micrófono oficial gratis? | No |
| ¿El plan pago lo agrega? | No hay evidencia de que sí |
| ¿Se puede analizar frecuencia de un micrófono de PC de forma fiable? | No: el autor marca sesgo de frecuencia; el issue sigue abierto |
| ¿Workaround gratis? | Chip custom que genere un tono; es trabajo extra y no cubre el enunciado de “detectar audio de ambulancia” |
| ¿Conviene cambiar el proyecto a esto? | No, si el objetivo es análisis de ondas |

---

## 3. SimulIDE (gratis)

Licencia **AGPLv3**, sin cuenta ni plan. Fuente: [simulide.com](https://simulide.com/p/).  
Versión estable actual: **1.1.0 SR2** (12 mar 2026), [descarga](https://simulide.com/p/download110/). Hay rama 1.2 / 2.0 en desarrollo, también gratuita.

SimulIDE es simulador **analógico y digital**, con Arduino Uno / AVR, osciloscopio y generadores de señal. Eso es exactamente lo que Wokwi declara no ser.

### 3.1 Wave Generator → pin A0

Documentación oficial del [Wave Generator](https://simulide.com/p/component-list/):

- tipos: **Sine, Saw, Triangle, Square, Random, Wav**
- frecuencia configurable (default **1000 Hz**, dentro de la banda de sirena)
- `Middle Voltage` y `Semi amplitude` para centrar la onda en 0–5 V (p. ej. 2,5 V ± 2,0 V) y que el ADC del Uno la vea

Un tutorial independiente conecta un generador senoidal a un pin analógico y usa `analogRead()`: [Arduino and SimulIDE Tutorial](https://land-of-kain.de/docs/arduino/).

Con eso se puede:

1. Poner 700 Hz → el detector de ambulancia debe disparar.
2. Poner 200 Hz o 4 kHz → no debe disparar.
3. Alternar 450 / 650 Hz (two-tone) o barrer 600–1200 Hz.

Eso **sí es análisis de ondas**, no un potenciómetro.

### 3.2 Archivo WAV de sirena

El desarrollador (Arcachofo) agregó tipo **Wav** al WaveGen (rev. ~1248) y rechazó el micrófono en vivo del PC como camino principal: si la simulación no va al 100 %, se pierde sincronía con el stream. Recomendó **grabar y usar un WAV**. Fuentes:

- [voltage data from Line-in / mic / file](https://simulide.forumotion.com/t643-voltage-data-from-line-in-mic-file)
- [Generator in mode WAV](https://simulide.forumotion.com/t831-generator-in-mode-wav)
- [R1254: Wave import](https://simulide.forumotion.com/t814-r1254win10-wave-import-not-working)

Formatos que acepta: PCM 8 bit, PCM 16 bit, IEEE float 32 bit (−1 a +1). Canal 0. El WAV junto al `.simu`, o selector de archivo en revisiones posteriores.

En agosto de 2025 el mismo autor confirma: *“You can play a wave file in a WaveGen component”*. Fuente: [foro SimulIDE, audio play](https://simulide.com/p/forum/topic/feature-request-xy-plotter-video-and-audio-play-button-for-circuit-tutorials/).

El tipo Wav está en la lista de componentes vigente. Los videos oficiales lo marcan como “SimulIDE dev”: si 1.1.0 estable no lo mostrara, se usa un build tester / SimulIDE 2, también gratis. **La senoidal de 1 kHz ya alcanza para validar el algoritmo.**

### 3.3 Micrófono en vivo del PC

**No está.** El desarrollador lo planeó y lo dejó de lado por el problema de tiempo real. Mismo criterio que Wokwi, con una diferencia: SimulIDE **sí** te deja inyectar la onda (senoidal o WAV) alineada con la simulación.

### 3.4 Arduino Uno, ADC y LCD

- El ADC del AVR se simula; `analogRead()` sobre una senoidal es el caso de uso documentado.
- Hay LCD HD44780. El backpack I2C PCF8574 (`LiquidCrystal_I2C` en 0x27, como este proyecto) **puede** armarse, pero en el foro a veces conviene el LCD I2C nativo de SimulIDE (p. ej. AIP31068) o un LCD paralelo de 4 bits para no pelear con la librería. Fuente: [Arduino Uno with LCD I2C](https://simulide.com/p/forum/topic/arduino-uno-with-lcd-20x4-i2c-aip31068_i2c-2/).
- El firmware se sigue compilando con PlatformIO (`pio run`) y se carga el `.hex` / `.elf` en el Arduino simulado.

### 3.5 Veredicto SimulIDE

| Pregunta | Respuesta |
|----------|-----------|
| ¿Es gratis? | Sí (AGPLv3, sin cuenta) |
| ¿Micrófono de PC en vivo? | No |
| ¿Onda senoidal en A0 a frecuencia de sirena? | Sí |
| ¿WAV de sirena real en A0? | Sí, en WaveGen tipo Wav (builds actuales / testers) |
| ¿El Arduino puede hacer Goertzel/FFT sobre esa señal? | Sí: es tensión analógica que varía en el tiempo |
| ¿Cubre el enunciado de “analizar ondas”? | Sí, con tono de prueba o con WAV |

---

## 4. Comparación directa

| Criterio | Wokwi Community (gratis) | SimulIDE (gratis) |
|----------|--------------------------|-------------------|
| Precio | €0 (proyectos públicos) | €0 |
| Arduino Uno + LEDs + LCD I2C | Sí, ya está este repo | Sí, con posible ajuste del LCD |
| Micrófono oficial | No | No |
| Tensión DC (potenciómetro) | Sí | Sí |
| Onda senoidal 600–2000 Hz en A0 | Solo con chip custom (beta, WASM) | Wave Generator, nativo |
| WAV de sirena | No | WaveGen tipo Wav |
| FFT/Goertzel fiable sobre la entrada | No recomendado (analogía débil + sesgo de tiempo) | Sí, si la simulación corre cerca de tiempo real |
| Osciloscopio de la onda | No (analizador lógico es digital) | Sí |
| Encaje con Cursor / PlatformIO | Ya configurado (`wokwi.toml`) | Compilar con `pio run` y abrir el hex en SimulIDE |

---

## 5. Recomendación para este proyecto

1. **No intentar “micrófono de ambulancia” en Wokwi.** El producto no lo ofrece; el prototipo no sirve para frecuencias; pagar no cambia eso.
2. **Validar el detector de sirena en SimulIDE**, gratis:
   - Wave Generator senoidal, 2,5 V ± ~2 V, frecuencia 700–1200 Hz, salida a `A0`.
   - Firmware: muestreo + Goertzel (o FFT corta) en esas bandas; si hay energía sostenida, `modoAmbulancia()`.
   - Prueba negativa: 200 Hz o silencio → ciclo normal.
   - Opcional: WAV PCM 16 bit de una sirena en un build con tipo Wav.
3. **Dejar Wokwi para la demo visual** del cruce (LEDs + LCD), o migrar el circuito entero a SimulIDE si se quiere una sola herramienta.
4. **Hardware real** (si más adelante hay placa): micrófono electret con preamp polarizado a VCC/2 → `A0`. El mismo firmware de Goertzel sirve; el simulador solo sustituye al micrófono por el WaveGen.

### Esquema de prueba en SimulIDE (sin implementar aún)

```
WaveGen (Sine, 1000 Hz, mid 2.5 V, amp 2.0 V)
    └── OUT ──► Arduino Uno A0
Arduino D8–D10, D5–D7 ──► LEDs de los dos semáforos
Arduino A4/A5 ──► LCD (I2C o paralelo)
Osciloscopio en A0 para ver la onda que el ADC está leyendo
```

---

## 6. Fuentes

### Wokwi

- [Supported Hardware](https://docs.wokwi.com/getting-started/supported-hardware)
- [Analog API](https://docs.wokwi.com/chips-api/analog) — “digital simulator with basic analog support”
- [wokwi-potentiometer](https://docs.wokwi.com/parts/wokwi-potentiometer)
- [Pricing](https://wokwi.com/pricing)
- [VS Code license](https://wokwi.com/license)
- [Custom chips](https://docs.wokwi.com/chips-api/getting-started)
- [wokwi.toml custom chips](https://docs.wokwi.com/vscode/project-config)
- [Issue #55 Microphone](https://github.com/wokwi/wokwi-features/issues/55) (abierto, sesgo de frecuencia, prototipo de volumen)
- [Issue #97](https://github.com/wokwi/wokwi-features/issues/97) — micrófono “not documented yet”
- [Issue #993 ADC](https://github.com/wokwi/wokwi-features/issues/993) — analogía débil; recomiendan otra herramienta si se necesita analogía seria
- Prototipo: [wokwi-mic](https://wokwi.com/projects/298338066513265161)

### SimulIDE

- [Sitio / licencia AGPLv3](https://simulide.com/p/)
- [Descarga 1.1.0](https://simulide.com/p/download110/)
- [Lista de componentes — Wave Generator](https://simulide.com/p/component-list/)
- [Line-in / mic / WAV](https://simulide.forumotion.com/t643-voltage-data-from-line-in-mic-file)
- [WaveGen modo WAV](https://simulide.forumotion.com/t831-generator-in-mode-wav)
- [Import WAV](https://simulide.forumotion.com/t814-r1254win10-wave-import-not-working)
- [Play WAV 2025](https://simulide.com/p/forum/topic/feature-request-xy-plotter-video-and-audio-play-button-for-circuit-tutorials/)
- [Tutorial analogRead + senoidal](https://land-of-kain.de/docs/arduino/)
- [LCD I2C en SimulIDE](https://simulide.com/p/forum/topic/arduino-uno-with-lcd-20x4-i2c-aip31068_i2c-2/)

### Sirenas

- [NIJ / SAE J1849 — frecuencias wail/yelp](https://www.ojp.gov/pdffiles1/nij/181622.pdf)
- [UPC — wail 600–1200 Hz y two-tone de ambulancias](https://upcommons.upc.edu/bitstream/handle/2117/18181/Neuwsirentones.pdf)
