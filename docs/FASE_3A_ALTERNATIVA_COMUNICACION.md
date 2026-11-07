# Fase 3A — Alternativa de comunicación sin COM virtual de Windows

> Investigación histórica de la prueba `SIV_TEST`. El firmware actual usa el
> protocolo SIV v1 documentado en
> [`FASE_3B_EVENTOS_METRICAS.md`](FASE_3B_EVENTOS_METRICAS.md); la guía vigente
> de ejecución es [`GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md`](GUIA_EJECUCION_SEMAFOROS_UART_LINUX.md).

## 1. Objetivo y conclusión ejecutiva

Evaluar una ruta reproducible para enviar el UART del Arduino UNO simulado a
Python sin com0com, controladores COM virtuales ni cambios en la seguridad de
Windows.

**Recomendación:** ejecutar el simulador Linux y el receptor Python dentro de
la misma distribución WSL 2, y enlazarlos mediante dos pseudo-terminales
emparejados con `socat`. Para reducir riesgo, comenzar con SimulIDE **1.1.0
SR2**, que es la versión estable declarada oficialmente y la versión del
circuito actual. No migrar todavía a SimulIDE 2.

La ruta es técnicamente coherente con el componente `SerialPort` del código
oficial: éste asocia el puerto con un UART del microcontrolador y abre el
dispositivo del sistema operativo mediante `QSerialPort`. `socat` puede crear
un par PTY local en Linux. Sin embargo, **la conexión de extremo a extremo
queda pendiente de ejecución manual**: este entorno no tiene una distribución
Ubuntu disponible ni acceso gráfico a SimulIDE. No se afirma que Python haya
recibido mensajes.

## 2. Estado y archivos

Archivos de proyecto relevantes:

- `src/sketch.ino`: transmite `SIV_TEST,UPTIME_MS=...,STATUS=OK` por UART0 a
  9600 baudios, aproximadamente una vez cada 1000 ms de `millis()`.
- `tools/serial_receiver.py`: receptor Python existente; acepta tanto nombres
  COM como rutas de dispositivo, por ejemplo `/tmp/siv-python-uart`.
- `Citcuito1.sim1`: circuito actual. Hace referencia relativa a
  `.pio/build/uno/firmware.hex` y a `sirena.wav`; no contiene un componente
  `Serial Port`.
- `platformio.ini`: compila para Arduino UNO con PlatformIO.

Cambios de esta investigación:

- `tools/serial_receiver.py`: su ayuda y su instrucción de dependencia ahora
  también son válidas para Linux.
- `docs/FASE_3A_ALTERNATIVA_COMUNICACION.md`: este informe y la prueba manual.
- `README.md`: enlace a esta guía.

No se modificaron el firmware, el cableado, el detector Goertzel ni la FSM.
Toda modificación futura del circuito para esta prueba debe hacerse sobre una
copia, no sobre `Citcuito1.sim1`.

## 3. SimulIDE 2 y TCP/IP

### Versión disponible

Al consultar la página oficial de descargas, ésta identifica **SimulIDE 2.0.0
como “Unstable”**, actualizada en junio de 2026. La misma página identifica
**SimulIDE 1.1.0 SR2 como la última versión estable**. La descarga ofrece
selección por sistema operativo; no se instaló ni ejecutó ninguna versión.

### UART no es TCP

La existencia de una capacidad TCP/IP en algún componente programable no
demuestra por sí sola el puente requerido. La ruta debe hacer explícitamente:

1. Recibir los bytes transmitidos por el UART del Arduino.
2. Detectar líneas completas (LF).
3. Enviar esas líneas por un socket TCP al proceso receptor.

La documentación y los ejemplos oficiales que se pudieron verificar no
proporcionaron una prueba reproducible de un componente de SimulIDE 2 que haga
esas tres operaciones. En el repositorio oficial consultado, el componente
`SerialPort` sí conecta su propiedad `Mcu_Uart` con la señal UART del
microcontrolador y abre un `Port_Name` mediante `QSerialPort`; no se encontró
en ese código un ejemplo `QTcpSocket`/`QTcpServer` que implemente el puente.
La página de descargas y el repositorio consultados no permiten concluir que
SimulIDE 2 carezca definitivamente de una función nueva o separada; permiten
concluir que **no tenemos evidencia suficiente para basar la demostración en
ella**.

Por lo tanto:

- Un componente que sólo pueda iniciar/enviar TCP no basta: también debe estar
  suscrito al UART del Arduino y pasar los bytes recibidos al socket.
- No se identificó un ejemplo oficial verificable de puente UART→TCP listo
  para usar.
- Migrar a SimulIDE 2 exigiría comprobar la API de componentes programables,
  escribir o configurar el puente y probar la compatibilidad del circuito.
- El HEX probablemente sea reutilizable porque el objetivo de compilación y el
  ATmega328P no cambian, pero la lectura del HEX no valida el modelo del
  microcontrolador ni la compatibilidad de los periféricos.
- No se comprobó que el circuito, el Wave Generator con archivo WAV, el LCD
  I2C ni la detección acústica funcionen en SimulIDE 2.

**Resultado:** SimulIDE 2 queda como alternativa de investigación, no como
opción recomendada para la prueba actual.

## 4. Alternativa Linux con WSL 2 y `socat`

### Arquitectura

```text
ATmega328P simulado
   UART0 (9600, 8-N-1)
          |
Componente SerialPort de SimulIDE para Linux
   Port_Name = PTY de SimulIDE
          |
      socat (PTY ↔ PTY)
          |
tools/serial_receiver.py
   --port /ruta/al/PTY-de-Python
```

Los dos pseudo-terminales son dispositivos Linux. SimulIDE y Python deben
ejecutarse dentro de la **misma distribución WSL 2** y con el mismo usuario.
Python en WSL no obtiene automáticamente acceso a un puerto COM abierto por
SimulIDE para Windows. Esta propuesta evita por completo esa frontera:
ninguno de los dos procesos abre un COM de Windows.

Microsoft documenta que WSL 2 admite aplicaciones Linux gráficas mediante
WSLg en Windows 11. Eso hace posible intentar ejecutar el SimulIDE Linux con
ventana gráfica, pero no demuestra que la distribución, sus dependencias
gráficas ni el simulador estén instalados en este equipo.

### Versión a probar y compatibilidad

La opción inicial recomendada es descargar **SimulIDE 1.1.0 SR2 para Linux**
desde el sitio oficial, no SimulIDE 2. Así se mantiene la versión mayor del
circuito existente y se evita una migración durante la prueba.

La compatibilidad concreta de `Citcuito1.sim1`, del LCD, del Wave Generator y
de `sirena.wav` bajo el binario Linux sigue pendiente. El archivo usa firmware
HEX relativo y audio WAV relativo. Para probar sin tocar el original, copiar a
una carpeta de prueba:

1. `Citcuito1.sim1`, renombrado, por ejemplo, a `Citcuito1_poc.sim1`.
2. `sirena.wav`.
3. `.pio/build/uno/firmware.hex`.

Al abrir la copia en SimulIDE Linux, cargar el HEX copiado si la ruta relativa
no se resuelve. Confirmar primero el funcionamiento del ciclo, LCD y sirena
antes de evaluar UART.

El proyecto actual no incluye `Serial Port`. Según el código oficial
consultado, ese componente selecciona un UART con `Mcu_Uart`, abre el nombre
de dispositivo `Port_Name` y configura baudrate, bits, paridad, stop bits y
control de flujo. Esa implementación no usa pines externos para enlazar el
UART del microcontrolador: la asociación es interna al simulador. La
disponibilidad y edición del nombre PTY deben confirmarse en el binario Linux
instalado.

### Instalaciones requeridas

No se instaló nada en esta investigación. Para ejecutar la prueba se necesita
preparar, dentro de Ubuntu/WSL 2:

- Un paquete de SimulIDE Linux (recomendado: 1.1.0 SR2).
- `socat`.
- Python 3 y `pyserial` para el receptor.
- WSLg funcional para mostrar la interfaz de SimulIDE.

Usar paquetes y binarios de fuentes oficiales. No instalar controladores COM,
no cambiar la política de firma de controladores y no utilizar com0com.

## 5. Comparación de alternativas

| Alternativa | Compatibilidad actual | Cambios necesarios | Instalaciones | Dificultad | Estabilidad y riesgos | Reproducción en examen | Tiempo real |
|---|---|---|---|---|---|---|---|
| Monitor UART interno de SimulIDE Windows | Compatible para observar texto; no entrega datos a Python | Ninguno | Ninguna | Baja | Estable como diagnóstico; no sirve de puente externo | Fácil para mostrar UART, insuficiente para dashboard | Muestra la salida del simulador, pero no integra procesos |
| SimulIDE 2 + componente TCP programable | No validada; versión oficial etiquetada inestable | Probar API, crear/configurar puente UART→TCP y migrar una copia de circuito | SimulIDE 2; posiblemente herramientas de programación/configuración | Alta | Riesgo de API nueva y compatibilidad de circuito/periféricos; no hay ejemplo verificable localizado | Difícil hasta empaquetar y ensayar el puente | Sí si el puente funciona, pero no probado |
| SimulIDE Windows + par COM virtual | UART viable en teoría, pero el controlador com0com de este equipo falla con código 52 | Instalar y mantener controlador/par | Driver COM virtual firmado y compatible | Media | Dependencia de driver y políticas Windows; descartada por la restricción del usuario | Frágil entre equipos | Sí, sólo si el par COM está operativo |
| SimulIDE Linux + PTY de `socat` en WSL 2 | UART serial estándar; circuito y GUI aún deben probarse en Linux | Añadir `SerialPort` a una copia; iniciar par PTY | SimulIDE Linux, WSLg, `socat`, Python/`pyserial` | Media | Evita drivers COM; depende de WSLg y del binario Linux | Buena si se prepara una guía, archivos y ensayo previo | Adecuada para eventos de diagnóstico de 1 Hz; no es una garantía de tiempo real duro |
| Python WSL leyendo COM de SimulIDE Windows | No compatible automáticamente | Haría falta exponer/puentear el COM de Windows por otra vía | Solución adicional no definida | Alta | Cruza límites de dispositivo entre Windows y WSL; no es el diseño propuesto | Mala | No establecida |

## 6. Prueba de concepto manual

### 6.1 Preparación en Ubuntu/WSL

Abrir una terminal Ubuntu y comprobar que sea WSL 2 y que WSLg esté activo:

```bash
printf 'Distro: %s\nDISPLAY: %s\nWAYLAND_DISPLAY: %s\n' \
  "$WSL_DISTRO_NAME" "$DISPLAY" "$WAYLAND_DISPLAY"
wsl.exe --status
```

`DISPLAY` o `WAYLAND_DISPLAY` deberían tener valor para abrir una aplicación
gráfica WSLg. Si no lo tienen, detener la prueba y resolver WSLg con la guía
oficial de Microsoft; no instalar drivers ni cambiar la seguridad de Windows
como parte de esta fase.

Instalar los paquetes requeridos sólo si el usuario decide hacerlo:

```bash
sudo apt update
sudo apt install socat python3-venv
```

Descargar y extraer el paquete Linux oficial de SimulIDE 1.1.0 SR2 según las
instrucciones de su sitio. No sobrescribir ni eliminar la instalación Windows.
Abrir el SimulIDE Linux desde Ubuntu/WSL con el ejecutable incluido en el
paquete.

### 6.2 Preparar una copia del circuito

Copiar el circuito y sus archivos de entrada a una carpeta independiente,
preferentemente dentro del sistema Linux de WSL:

```bash
mkdir -p "$HOME/siv-serial-poc"
cp /mnt/c/Users/mcora/PTR-Semaforos/Citcuito1.sim1 \
   "$HOME/siv-serial-poc/Citcuito1_poc.sim1"
cp /mnt/c/Users/mcora/PTR-Semaforos/sirena.wav \
   "$HOME/siv-serial-poc/"
cp /mnt/c/Users/mcora/PTR-Semaforos/.pio/build/uno/firmware.hex \
   "$HOME/siv-serial-poc/"
```

Abrir `Citcuito1_poc.sim1`, confirmar/cargar `firmware.hex` y comprobar el
ciclo, el LCD y la sirena. Agregar a **esta copia** el componente `Serial
Port`. Configurarlo así (los nombres visibles pueden variar ligeramente):

| Propiedad | Valor |
|---|---|
| `Mcu_Uart` | UART 1 del Arduino UNO (UART0/USART0 del ATmega328P) |
| `Port_Name` | `$HOME/siv-serial-poc/sim-uart` — reemplazar `$HOME` por la ruta absoluta |
| `BaudRate` | 9600 |
| `DataBits` | 8 |
| `Parity` | None |
| `StopBits` | 1 |
| `FlowControl` | None |

La propiedad `Port_Name` debe aceptar el nombre de dispositivo PTY completo.
Si el binario no permite escribir una ruta o no puede abrir el PTY, registrar
el mensaje exacto y detenerse: no se ha probado un mecanismo alternativo en
esta fase.

### 6.3 Crear el par de PTY

En una segunda terminal WSL:

```bash
mkdir -p "$HOME/siv-serial-poc"
socat -d -d \
  "pty,raw,echo=0,link=$HOME/siv-serial-poc/sim-uart" \
  "pty,raw,echo=0,link=$HOME/siv-serial-poc/python-uart"
```

Dejar `socat` en ejecución. En el log deben aparecer los dispositivos PTY
creados. Comprobar los enlaces simbólicos en una tercera terminal:

```bash
readlink -f "$HOME/siv-serial-poc/sim-uart"
readlink -f "$HOME/siv-serial-poc/python-uart"
```

Cada enlace debe resolver a un dispositivo `/dev/pts/...` distinto. No
compartir ni abrir el mismo extremo en ambos programas: SimulIDE abre
`sim-uart`; Python abre `python-uart`.

### 6.4 Ejecutar el receptor y la simulación

En una tercera terminal WSL, preparar un entorno virtual Python e instalar
`pyserial` en él, si todavía no está disponible:

```bash
cd "$HOME/siv-serial-poc"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install pyserial
```

Ejecutar el receptor del proyecto, usando una ruta Linux al checkout. Si el
proyecto está en la ruta Windows indicada:

```bash
python /mnt/c/Users/mcora/PTR-Semaforos/tools/serial_receiver.py \
  --port "$HOME/siv-serial-poc/python-uart" --baud 9600
```

Luego, en SimulIDE Linux:

1. Abrir la copia `Citcuito1_poc.sim1` y cargar `firmware.hex`.
2. Verificar que la propiedad `Port_Name` sea el enlace `sim-uart`.
3. Iniciar la simulación y abrir el componente `Serial Port` con **Open**.
4. Observar la terminal del receptor.

La recepción correcta debe mostrar varias líneas ASCII con el prefijo
`SIV_TEST,UPTIME_MS=`, el sufijo `,STATUS=OK` y un `UPTIME_MS` creciente.
El intervalo debe ser aproximadamente 1000 ms **de tiempo simulado**; puede
diferir del reloj de pared. No abrir el mismo puerto simultáneamente con otro
receptor/terminal. Para terminar, detener la simulación, cerrar el receptor
con Ctrl+C y detener `socat` con Ctrl+C.

### 6.5 Criterios de aceptación

- SimulIDE abre el PTY sin error.
- Python recibe al menos 10 líneas completas consecutivas.
- Todas contienen `SIV_TEST`, un contador creciente y `STATUS=OK`.
- No hay caracteres corruptos ni pérdida visible de líneas.
- El contador avanza a intervalos cercanos a 1000 ms simulados.
- El ciclo, LCD y detector siguen operativos con la copia del circuito.
- La FSM, Goertzel, firmware y circuito original no fueron modificados.

Guardar capturas de la ventana SimulIDE y de la terminal del receptor para
documentar la prueba. Si algún criterio falla, registrar distribución WSL,
versión exacta del paquete SimulIDE, propiedad de puerto, error completo y
resultado de `readlink`; no inferir que el puente funciona por el solo hecho
de que `socat` haya creado PTY.

## 7. Resultados efectivamente verificados

| Comprobación | Resultado |
|---|---|
| Versión oficial SimulIDE 2 | La página consultada indica 2.0.0, inestable, actualizada en junio de 2026 |
| Versión estable declarada | La página consultada indica 1.1.0 SR2 |
| Código fuente oficial de `SerialPort` | Inspeccionado: asocia `Mcu_Uart`, abre `Port_Name` con `QSerialPort` y tiene propiedades serie configurables |
| Ejemplo oficial verificable UART→TCP en SimulIDE 2 | No localizado; no se afirma que no exista alguna función no cubierta por el repositorio consultado |
| Receptor Python | Acepta una ruta de dispositivo Linux; sintaxis revisada tras el cambio de ayuda |
| Prueba con SimulIDE Linux/WSLg | Pendiente: no se ejecutó el GUI |
| Par PTY `socat` | Pendiente: no se ejecutó en una distribución Ubuntu |
| Recepción Python externa | Pendiente: no se recibió ningún mensaje en esta investigación |
| Distribuciones WSL visibles en este entorno | Sólo `docker-desktop`; Ubuntu no está disponible para probar aquí |
| SimulIDE 2, LCD, Wave Generator y detección en Linux | Pendiente de prueba manual |

El usuario informó que la salida serial del monitor interno fue exitosa en su
prueba previa. Ese resultado no equivale a la recepción por Python ni fue
reproducido en este entorno.

## 8. Problemas pendientes y errores frecuentes

- **WSLg no abre SimulIDE:** comprobar que se está usando WSL 2 y que la
  distribución tiene GUI/WSLg operativo; consultar Microsoft Learn.
- **Ubuntu no aparece en `wsl --list --verbose`:** este entorno de trabajo
  muestra sólo `docker-desktop`. Verificar las distribuciones instaladas en
  el equipo donde se hará la demostración. No instalar Ubuntu desde esta fase
  sin decisión del usuario.
- **El componente no acepta `/home/.../sim-uart`:** comprobar que el archivo
  de propiedades realmente permite editar `Port_Name`. La ruta del PTY debe
  existir antes de abrir el puerto. La interfaz Linux de la versión elegida
  todavía no fue probada.
- **`Cannot Open Port`:** revisar que `socat` siga activo, que el enlace
  resuelva a `/dev/pts/...`, que SimulIDE y `socat` estén en la misma WSL y que
  no haya otro proceso usando el extremo.
- **`No module named serial`:** activar `.venv` e instalar `pyserial` en esa
  misma distribución.
- **PTY simbólico obsoleto tras cerrar `socat`:** detener clientes, verificar
  con `readlink` qué rutas resuelven y limpiar sólo esos enlaces de la carpeta
  de prueba antes de volver a crear el par.
- **LCD, Wave Generator o WAV no funcionan:** probar la copia del circuito
  sin el puente y confirmar primero compatibilidad del paquete Linux.
- **El contador parece lento o rápido:** `millis()` usa tiempo del
  microcontrolador; la velocidad de simulación no tiene por qué igualar al
  reloj de pared.

## 9. Próximos pasos hacia el dashboard

1. Ejecutar manualmente la prueba de aceptación y guardar evidencia.
2. Si pasa, fijar el formato de mensajes de eventos; conservar separados
   `UPTIME_MS` de Arduino y la hora de recepción del backend.
3. Ejecutar el futuro receptor/servicio en WSL para leer el PTY; no intentar
   abrir el PTY Linux desde un proceso Windows como si fuera un COM.
4. Integrar persistencia e interfaz sólo en la Fase 3B, después de estabilizar
   el contrato de eventos y repetir la prueba.
5. Si el dashboard debe correr en Windows, decidir más adelante una frontera
   de red explícita (por ejemplo, backend en WSL y navegador Windows). Eso no
   forma parte de esta prueba y no se agrega aquí.

## 10. Fuentes técnicas

- [Descargas oficiales de SimulIDE](https://simulide.com/p/downloads/) —
  presenta SimulIDE 1.1 como estable y 2 como versión en desarrollo.
- [Descarga oficial de SimulIDE 2](https://simulide.com/p/download200/) —
  identifica la versión 2.0.0 como inestable y su actualización de junio de
  2026.
- [Descarga oficial de SimulIDE 1.1](https://simulide.com/p/download110/) —
  identifica 1.1.0 SR2 como última versión estable.
- [Repositorio oficial SimulIDE](https://github.com/SimulIDE/SimulIDE) —
  código y dependencias del simulador comunitario.
- [Código `SerialPort`](https://github.com/SimulIDE/SimulIDE/blob/master/src/gui/circuitwidget/components/mcu/serialport.cpp)
  y [propiedades de `SerialPort`](https://github.com/SimulIDE/SimulIDE/blob/master/src/gui/circuitwidget/components/mcu/serialport.h)
  — UART interno, puerto del sistema y parámetros de serie.
- [Monitor serial — base de conocimiento oficial](https://simulide.com/p/serial-monitor/)
  — distingue el monitor UART integrado.
- [Ejecutar aplicaciones gráficas Linux con WSL](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)
  — requisitos y alcance de WSLg.
- [Manual de `socat`](https://man7.org/linux/man-pages/man1/socat.1.html)
  — relay entre direcciones de socket/PTY.
