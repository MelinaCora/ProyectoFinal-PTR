# Guía de ejecución — Sistema de Semáforos

Guía para conectar el Arduino UNO simulado en SimulIDE para Linux con el
receptor Python mediante dos pseudo-terminales enlazados por `socat`. El
firmware actual usa el protocolo de eventos SIV v1 descrito en
[`FASE_3B_EVENTOS_METRICAS.md`](FASE_3B_EVENTOS_METRICAS.md).

## Requisitos

- Windows 11 con WSL2 y una distribución Ubuntu.
- SimulIDE 1.1.0-SR2 para Linux.
- `socat` instalado en Ubuntu.
- Python 3 y `pyserial` instalados en Ubuntu.
- Firmware del Arduino UNO compilado con PlatformIO.
- Circuito `Semaforos_UART_Linux.sim1`.

Antes de comenzar, confirma que existen el circuito y el firmware en las rutas
indicadas. Si los archivos están en otra ubicación, usa sus rutas reales en los
pasos siguientes. En particular, el nombre del circuito de esta guía debe
coincidir con el archivo `.sim1` que preparaste.

## 1. Iniciar los puertos virtuales

Abre una terminal de Ubuntu y ejecuta:

```bash
socat -d -d \
  PTY,raw,echo=0,link=/tmp/siv-simulide,mode=666 \
  PTY,raw,echo=0,link=/tmp/siv-python,mode=666
```

Mantén esta terminal abierta mientras uses la conexión.

## 2. Iniciar SimulIDE

En una segunda terminal de Ubuntu, inicia SimulIDE:

```bash
cd ~/simulide-linux/SimulIDE_1.1.0-SR2_Lin64
./simulide
```

En SimulIDE:

1. Abre el circuito:
   `/mnt/c/Users/mcora/PTR-Semaforos/simulide/Semaforos_UART_Linux.sim1`
2. Carga el firmware:
   `/mnt/c/Users/mcora/PTR-Semaforos/.pio/build/uno/firmware.hex`
3. Inicia la simulación.
4. Presiona **Abrir** en el componente **Serial Port**.
5. Comprueba que indique **Conectado** y que haya actividad de transmisión.

Si el firmware cambió, recompílalo desde PowerShell en la carpeta del proyecto:

```powershell
pio run -e uno
```

Después, vuelve a cargar `.pio/build/uno/firmware.hex` en SimulIDE.

## 3. Ejecutar el receptor Python

En una tercera terminal de Ubuntu:

```bash
cd /mnt/c/Users/mcora/PTR-Semaforos
python3 tools/serial_receiver.py --port /tmp/siv-python --baud 9600
```

Si aparece `No module named serial`, instala `pyserial` en Ubuntu:

```bash
python3 -m pip install pyserial
```

Si Ubuntu indica que la instalación está administrada por el sistema, crea y
usa un entorno virtual:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install pyserial
python tools/serial_receiver.py --port /tmp/siv-python --baud 9600
```

## 4. Verificar la comunicación

La terminal de Python debe mostrar descripciones legibles para mensajes como:

```text
[120 ms] Arranque del controlador
[121 ms] Estado: fase=A_VERDE, modo=NORMAL, A=G, B=R, restante=5000 ms
[1121 ms] Heartbeat: fase=A_VERDE, modo=NORMAL, A=G, B=R, restante=4000 ms
```

Comprueba que:

- Aparezca el mensaje de arranque, seguido por el estado y heartbeats.
- El tiempo Arduino avance entre mensajes y los heartbeats se generen cada
  1000 ms de tiempo simulado. La cadencia observada en el reloj de pared puede
  variar con la velocidad de SimulIDE.
- Al activar la sirena, aparezcan los eventos de detección, prioridad,
  finalización y recuperación de acuerdo con la transición real de los
  semáforos.
- No se esperan eventos de emergencia si solo se deja correr el ciclo normal.

## 5. Detener el sistema

1. Detén la simulación en SimulIDE.
2. Cierra el componente **Serial Port** y SimulIDE.
3. Detén Python con `Ctrl+C`.
4. Detén `socat` con `Ctrl+C`.

## Consideraciones

- Los enlaces `/tmp/siv-simulide` y `/tmp/siv-python` se recrean al iniciar
  `socat`. Si quedaron enlaces obsoletos tras una interrupción, confirma que
  ningún proceso los esté usando antes de eliminarlos y volver a iniciar
  `socat`.
- Los números `/dev/pts/N` pueden cambiar en cada ejecución. Usa siempre las
  rutas `/tmp/siv-*` configuradas en el circuito y en el receptor.
- SimulIDE debe usar `/tmp/siv-simulide`; Python debe usar
  `/tmp/siv-python`. No abras el mismo extremo en ambos programas.
- Los dos programas y `socat` deben ejecutarse dentro de la misma distribución
  WSL2. Python en WSL no obtiene automáticamente acceso a un puerto COM abierto
  por SimulIDE para Windows.
- Conserva el circuito original como respaldo y realiza cambios de prueba en
  una copia.
- La comunicación es solo de supervisión: cerrar Python no debe cambiar la
  FSM ni detener los semáforos.
- El código fuente UART transmitido es `SIV,1,...`; `SIV_TEST,...` pertenece a
  la prueba anterior de Fase 3A y ya no es el formato del firmware actual.
- Esta guía no afirma que la recepción nueva se haya probado gráficamente; la
  validación manual sigue pendiente hasta observar los mensajes en el receptor.
