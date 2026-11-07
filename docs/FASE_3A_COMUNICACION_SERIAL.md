# Fase 3A — Validación de comunicación serial

## 1. Objetivo

Validar la transmisión de diagnóstico del Arduino simulado por UART antes de
implementar el backend o el dashboard. Esta prueba no modifica Goertzel, la FSM,
el cableado actual ni el formato de eventos futuro.

## 2. Archivos modificados

- `src/sketch.ino`: agrega `Serial.begin(9600)` y un mensaje de diagnóstico cada
  1000 ms medidos por `millis()`.
- `tools/serial_receiver.py`: receptor opcional de un puerto COM de Windows.
- `docs/FASE_3A_COMUNICACION_SERIAL.md`: estas instrucciones y resultados.

No se modificaron `src/ciclo.h`, `src/goertzel.h`, los pines del circuito ni
`platformio.ini`.

## 3. UART y mensaje de prueba

El sketch inicializa el UART integrado del ATmega328P a **9600 baudios**. El
mensaje es ASCII, termina en LF (`\n`) y tiene este formato:

```text
SIV_TEST,UPTIME_MS=12500,STATUS=OK
```

`UPTIME_MS` es el tiempo transcurrido desde que arrancó el microcontrolador, no
una fecha/hora de calendario. El envío se intenta una vez por cada intervalo
de 1000 ms de `millis()`. Si el buffer de transmisión no tiene espacio para
todo el mensaje, se descarta esa muestra en vez de bloquear el control. El
sketch usa un buffer fijo y no usa `delay()` para transmitir.

El mensaje ocupa aproximadamente 41 bytes en el peor caso del contador. A
9600 baudios, incluyendo bits de inicio/parada, su tiempo de transmisión es
aproximadamente 43 ms por segundo (alrededor del 4,3 % de ocupación del UART).
La cadencia es tiempo del microcontrolador/simulador; no necesariamente un
segundo de reloj de pared si SimulIDE corre la simulación a otra velocidad.

En un Uno, UART0 utiliza D0/RX y D1/TX. Los LEDs usan D5–D10, la sirena A0 y el
LCD I2C A4/A5; D0 y D1 no están asignados por el sketch ni conectados en el
circuito existente. No agregarles conexiones físicas para observar el monitor
interno.

## 4. Monitor serial interno de SimulIDE

El circuito del repositorio es SimulIDE **1.1.0 SR2** según
[`simulide/ARMADO.md`](../simulide/ARMADO.md), y su archivo es de formato
`1.1.0-SR2`. La página oficial lista 1.1.0 SR2 como versión estable. No se
detectó una instalación local de SimulIDE en las carpetas estándar de este
entorno, por lo que la disponibilidad del menú en la instalación del usuario
no se comprobó visualmente.

Pasos manuales:

1. En la raíz del proyecto, ejecutar `pio run -e uno`.
2. En SimulIDE, abrir `Citcuito1.sim1`; clic derecho en el Arduino UNO →
   **mega328 → Load firmware** y elegir `.pio/build/uno/firmware.hex`.
3. En las propiedades del microcontrolador, activar **Reload HEX at Simulation
   Start**.
4. Iniciar la simulación con **Power**.
5. Clic derecho sobre el microcontrolador y elegir **Open Serial Monitor**.
   Si se ofrece una lista de UARTs, seleccionar el UART del Uno (UART0/USART0,
   según cómo lo nombre esa compilación).
6. Seleccionar vista **ASCII** si el monitor ofrece formato de impresión.
   Deben aparecer líneas con el prefijo `SIV_TEST,UPTIME_MS=` y el sufijo
   `,STATUS=OK`.

La documentación oficial indica que el monitor se abre desde el menú contextual
del microcontrolador y muestra datos enviados y recibidos por UART. Para
comprobar que la salida es íntegra, confirmar que cada línea contiene texto
legible, un número creciente de `UPTIME_MS` y `STATUS=OK`. La diferencia entre
valores sucesivos debería ser cercana a 1000 ms de tiempo simulado. No estimar
la cadencia solo con el reloj de pared si la velocidad de SimulIDE no es 1:1.

## 5. Componente Serial Port y recepción externa en Windows

El circuito actual **no tiene** un componente `Serial Port`; el atributo
`SerialMon="-1"` en `simulide/Citcuito1.sim1` tampoco configura un puerto COM.
El monitor interno y un COM de Windows son funciones distintas.

La documentación oficial consultada explica el monitor interno, pero no
documenta suficientemente el componente externo para afirmar que está
disponible en toda distribución binaria 1.1.0 SR2. El código oficial de
SimulIDE sí contiene un componente `SerialPort` con propiedades `Mcu_Uart`,
`Port_Name`, `BaudRate`, `DataBits`, `Parity`, `StopBits` y `FlowControl`;
por ello la comunicación externa es viable **si el componente aparece en la
instalación concreta**. Confirmarlo en el buscador de componentes de SimulIDE
es una prueba pendiente antes de configurar Windows.

Si aparece:

1. Agregar `Serial Port` al circuito.
2. En sus propiedades seleccionar el UART del microcontrolador (UART 1/UART0,
   según el índice mostrado), el puerto COM que será un extremo del enlace y
   `9600`, `8` bits de datos, paridad `None`, `1` bit de parada y control de
   flujo `None`.
3. Abrir el puerto con el botón **Open** del componente (o activar
   **Auto Open**, si se desea que lo abra al iniciar la simulación).

Este componente enlaza el UART del microcontrolador internamente mediante la
propiedad `Mcu_Uart`; no requiere cables TX/RX en el diagrama para ese enlace
interno. En el Uno, UART0 corresponde eléctricamente a D0/RX y D1/TX. Si la
versión instalada presenta otro tipo de componente que sí tiene pines UART,
conectar TX del Uno a RX del dispositivo y RX del Uno a TX, además de GND,
pero no asumir este cableado para el componente `Serial Port` de software.

Para que otro proceso de Windows pueda leer una simulación sin hardware,
normalmente se necesita un **par de puertos COM virtuales emparejados**:

- SimulIDE abre un extremo, por ejemplo `COM10`.
- El receptor Python abre el otro, por ejemplo `COM11`.
- Los bytes enviados a un extremo aparecen en el otro.

Una opción conocida es com0com (Null-modem emulator); es software/controlador
de terceros y **no se instaló**. La instalación de controladores puede requerir
permisos administrativos y aprobación del usuario. También puede usarse otro
emulador de pares COM ya aprobado en la máquina. Crear/verificar el par en el
administrador de la herramienta y el Administrador de dispositivos, y anotar
qué extremo corresponde a cada nombre. No abrir el mismo extremo COM en
SimulIDE y Python: los puertos suelen ser exclusivos y el segundo proceso
recibirá un error de acceso.

Configuración de ejemplo:

| Programa | Puerto | UART/serial |
|---|---|---|
| SimulIDE `Serial Port` | COM10 | UART0, 9600, 8-N-1, sin flow control |
| Receptor Python | COM11 | 9600, 8-N-1 |

No está comprobado que la instalación gráfica concreta exponga `Serial Port`
ni que un puerto virtual resulte interoperable con ella. No se afirma que se
hayan recibido mensajes desde un proceso externo.

## 6. Receptor Windows

`tools/serial_receiver.py` escucha líneas desde el COM indicado, muestra el
texto en la terminal, informa errores de apertura/lectura y cierra el puerto al
usar Ctrl+C.

No se instaló `pyserial`. Si se autoriza/prepara esa dependencia manualmente:

```powershell
py -m pip install pyserial
py tools\serial_receiver.py --port COM11
```

Para otro puerto o velocidad:

```powershell
py tools\serial_receiver.py --port COM7 --baud 9600
```

El programa externo solo debe abrir el extremo que no está abierto por
SimulIDE. Si aparece `No module named serial`, falta pyserial. Si aparece
`Access is denied`/`PermissionError`, comprobar que el COM no esté abierto en
otro programa y que el nombre del extremo sea correcto. Un puerto retirado o
cerrado puede causar una excepción serial; el receptor la imprime y finaliza.

## 7. Pruebas y estado

Ejecutadas en el workspace:

- `pio run -e uno`: **correcto**. Uso reportado: 459/2048 bytes RAM y
  11270/32256 bytes flash.
- `node test\test_ciclo.mjs`: **correcto**.
- `powershell -ExecutionPolicy Bypass -NoProfile -File test\test_goertzel.ps1`:
  **correcto**.
- Inspección del diff: el cambio de firmware se limita a `Serial.begin()` y a
  una rutina periódica de diagnóstico; no altera las reglas de la FSM ni el
  detector.
- Transmisión observada en la GUI del monitor interno: **pendiente de prueba
  manual**; no hubo acceso a SimulIDE en esta sesión.
- Recepción por COM externo: **pendiente**, requiere que el componente exista
  en la instalación y que Windows tenga disponible un par COM virtual u otro
  destino serial compatible.

## 8. Errores frecuentes

- **No aparecen líneas:** verificar que se cargó el HEX recién compilado,
  iniciar Power y abrir el UART correcto.
- **Caracteres ilegibles:** el sketch usa 9600 baudios; comprobar el UART y la
  vista ASCII del monitor.
- **El tiempo entre mensajes no parece un segundo real:** el intervalo se
  mide con `millis()` simulado, no con el reloj de pared.
- **El COM no existe o no abre:** revisar que se haya creado el par virtual y
  usar el extremo asignado a cada aplicación.
- **Puerto ocupado:** cerrar otros monitores/programas que tengan abierto ese
  mismo COM. El monitor interno no crea ni libera automáticamente un COM
  externo.
- **Se pierde una línea:** el sketch descarta la muestra si no hay suficiente
  espacio en el buffer; no bloquea la FSM esperando espacio.

## 9. Conclusión y siguiente fase

La salida UART a 9600 baudios es compatible con el Uno y compila dentro de sus
límites. El monitor interno está documentado oficialmente. La arquitectura de
recepción externa también es posible mediante el componente `Serial Port` y
un par COM virtual, pero su presencia en la instalación y el enlace extremo a
extremo siguen sin validarse.

Antes de Fase 3B: comprobar manualmente el monitor interno; buscar `Serial
Port` en SimulIDE; si está disponible, probar un par COM previamente aprobado
y ejecutar el receptor. Luego definir el protocolo definitivo antes de
reemplazar o ampliar este mensaje de diagnóstico.

## Referencias

- [SimulIDE 1.1.0 SR2 — descarga y versión estable](https://simulide.com/p/download110/)
- [Base de conocimiento oficial — Serial Monitor](https://simulide.com/p/serial-monitor/)
- [Código del componente SerialPort en SimulIDE](https://github.com/SimulIDE/SimulIDE/blob/master/src/gui/circuitwidget/components/mcu/serialport.cpp)
- [Definición de propiedades UART del SerialPort](https://github.com/SimulIDE/SimulIDE/blob/master/src/gui/circuitwidget/components/mcu/serialport.h)
- [com0com — Null-modem emulator](https://github.com/com0com/com0com)
