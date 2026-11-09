# Fase 7A — Viabilidad del segundo detector acústico

## Alcance y estado actual

El detector productivo está en `src/sketch.ino`: lee A0, toma una ventana de
64 muestras con `analogRead`, centra la señal y calcula su frecuencia de
muestreo a partir del tiempo observado. `src/goertzel.h` evalúa cinco tonos
con aritmética `float`; `SirenEar` conserva dos timestamps de 32 bits para
reconocer componentes bajas/altas dentro de dos segundos. La llamada ocurre
antes de avanzar la FSM. No hay temporizador de muestreo dedicado ni muestreo
simultáneo de canales.

El UNO expone A0–A5 como entradas analógicas; A1 no aparece asignada en el
firmware actual (que usa A0 para el micrófono y D5–D10 para LEDs). Por tanto,
A1 está disponible en el microcontrolador, pero su conexión e independencia
eléctrica en SimulIDE quedan pendientes de comprobar.

Se agregó `experiments/dual_detector/`, un proyecto PlatformIO separado. Lee
ventanas alternadas de A0/A1 usando el mismo buffer local de 64 muestras, un
`SirenEar` por canal, una lectura ADC de descarte al cambiar de entrada y
diagnósticos `DIAG` a 115200 baudios. No incorpora FSM, prioridad ni SIV v1.
La salida serie de diagnóstico es deliberadamente incompatible con los
mensajes SIV operativos.

## Recursos verificados

Se compiló el firmware productivo sin cambios y el prototipo como proyecto
independiente con PlatformIO 6.2.0 y toolchain AVR 7.3.0:

| Compilación | SRAM estática (`.data + .bss + .noinit`) | Flash |
|---|---:|---:|
| Firmware actual `uno` | 1462 / 2048 B (71,4 %) | 15726 / 32256 B |
| Prototipo dual aislado `uno` | 283 / 2048 B (13,8 %) | 6198 / 32256 B |

El tamaño del prototipo aislado **no es** el delta de integración: no contiene
LCD, FSM, telemetría ni almacenamiento de incidentes. La medición del firmware
actual coincide con la referencia previa; quedan 586 B entre SRAM estática y
el límite, antes de considerar pila y cualquier heap.

Estimación incremental sobre el firmware actual, sin instrumentación
diagnóstica:

| Alternativa | SRAM adicional estimada | Impacto temporal / limitaciones |
|---|---:|---|
| A. Dos buffers independientes de 64 muestras | +128 B para el segundo buffer y ~8 B para el segundo `SirenEar` (≈136 B); quedarían ~450 B antes de pila/heap | El procesamiento en bloques sigue siendo secuencial; reservar dos buffers no hace simultáneo el ADC. |
| B. Buffer compartido, ventanas completas alternadas | ≈8–10 B de estado adicional (segundo `SirenEar`, indicador y scheduler); sin segundo buffer | Menor RAM. Cada canal espera la ventana y el procesamiento del otro; aumenta el intervalo entre observaciones de un canal. |
| C. Alternar A0/A1 en cada conversión | Al menos 256 B para 64 muestras por canal si se retienen ambas ventanas, salvo procesamiento con stride más complejo | Cada canal recibe aproximadamente la mitad de las conversiones; cambiar de mux puede exigir descartar conversiones. Compartir un array de 64 valores mezclaría los canales y no produce dos señales independientes. |
| D. Un buffer y estado mínimo independiente por canal | Aproximadamente +8–10 B, más variables de planificación | Es la alternativa de menor SRAM y la usada por el prototipo; conserva ventanas independientes, pero no la simultaneidad temporal. |

Los deltas son estimaciones de objetos/datos, no un enlace del firmware
integrado. Las cifras de SRAM estática tampoco incluyen el máximo de pila en
ejecución. La medición de ese margen requiere revisar uso de pila bajo carga;
el porcentaje estático por sí solo no certifica seguridad.

## Temporización y riesgos

- `GOERTZEL_FS` propone 8000 Hz. Una ventana de 64 muestras equivale a 8 ms
  nominales (63 intervalos entre la primera y última muestra: 7,875 ms).
  Actualmente el firmware calcula la tasa real de cada ventana; no usa un
  reloj que garantice 8 kHz.
- A 16 MHz, con prescaler ADC 128, una conversión de 13 ciclos representa
  aproximadamente 104 µs como límite teórico de conversión. `analogRead` y el
  código de adquisición agregan sobrecarga; no se midió aquí la tasa real en
  SimulIDE.
- El prototipo descarta una lectura al seleccionar cada canal para reducir la
  contaminación por el cambio del multiplexor/sample-and-hold. Esto agrega
  como mínimo otra conversión por ventana. Fuentes de alta impedancia o señales
  mal referenciadas a tierra todavía pueden producir asentamiento insuficiente
  o acoplamiento entre entradas.
- Dos ventanas de 64 muestras requieren al menos 128 conversiones más el
  descarte por ventana; se ejecutan además dos análisis Goertzel de cinco tonos.
  La carga de procesamiento casi se duplica respecto de un detector, pero el
  tiempo total **no se midió**. El prototipo puede reportar `switch_us`,
  `acquire_us` y `process_us` cuando se ejecute en el circuito.
- La FSM se avanza desde el mismo `loop()` después de leer/procesar el
  detector. Aumentar el trabajo puede retrasar ese avance, la respuesta y la
  emisión de telemetría; la planificación alternada también reduce la
  frecuencia de actualización de cada `SirenEar`. No se cambian temporizadores
  ni lógica para compensarlo en esta fase.
- Los reportes serie del prototipo son bloqueantes y pueden alterar su
  planificación; no deben usarse como medición de tiempo real definitiva ni
  incorporarse al firmware productivo sin instrumentación no bloqueante.

## Arquitecturas

1. **Un UNO con dos detectores secuenciales:** es la mejor primera prueba. Un
   buffer compartido y estados por canal minimizan SRAM y la lógica de señales
   permanece independiente. No hay simultaneidad y debe validarse el intervalo
   de observación y la contaminación del ADC.
2. **Un UNO alternando muestras individuales:** no recomendable para mantener
   la tasa actual de ambos canales. Reduciría aproximadamente a la mitad la
   frecuencia de muestreo disponible por canal y requiere almacenar o separar
   las dos secuencias. No se implementó en el prototipo.
3. **Segundo microcontrolador:** aporta aislamiento de carga y permite que cada
   detector muestree por separado, a costa de hardware, sincronización,
   arbitraje, enlace entre micros y un protocolo nuevo. No se implementó ni se
   evaluó eléctricamente.

## Validación realizada y pendiente

- Compilación productiva `pio run -e uno`: aprobada, 1462 B SRAM estática y
  15726 B flash.
- Compilación aislada `pio run -e uno` desde `experiments/dual_detector`:
  aprobada, 283 B SRAM estática y 6198 B flash.
- `test\test_goertzel.ps1`: aprobada; valida tonos/sirena para el algoritmo
  existente, pero **no** dos entradas simultáneas.
- No se ejecutó el prototipo en SimulIDE. Quedan pendientes: señal solo en A0,
  solo en A1, ambas activas, silencio, alternancia rápida, falsos cruces,
  estabilidad de muestreo y tiempos reportados. No hay mediciones dinámicas
  duales ni de latencia.
- El firmware original, `platformio.ini`, FSM, detector, protocolo, circuito,
  backend, dashboard, base de datos y pruebas existentes permanecen intactos.

Para validar manualmente, abrir `experiments/dual_detector` como proyecto en
VS Code/PlatformIO y ejecutar **Project Tasks → uno → General → Build**.
También se puede usar `pio run -e uno` desde esa carpeta. Cargar el HEX de ese
proyecto en una copia/instancia de SimulIDE, cablear dos generadores
independientes a A0 y A1 con tierra común, y observar el monitor serie a
115200. Verificar los seis escenarios enumerados arriba. No conectar este
firmware al backend SIV. Para comparar con el sistema estable, compilar el
proyecto raíz por separado.

## Recomendación

**PENDIENTE DE VALIDACIÓN.** La compilación confirma que el prototipo aislado
cabe holgadamente como programa propio; la estimación indica que una
integración con buffer compartido tendría un delta pequeño de datos. Eso no
demuestra que el firmware completo conserve margen de pila suficiente, que el
muestreo sea estable bajo carga, ni que se eviten cruces en SimulIDE. Antes de
avanzar a la Fase 7B se requiere probar los escenarios duales, medir los tiempos
del prototipo y evaluar el uso máximo de pila con la FSM y telemetría activas.
