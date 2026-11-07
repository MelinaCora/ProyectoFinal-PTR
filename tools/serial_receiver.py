import argparse
import sys

if __package__:
    from .serial_protocol import (
        ProtocoloError,
        RastreadorSecuencia,
        describir,
        parsear_mensaje,
    )
else:
    from serial_protocol import (
        ProtocoloError,
        RastreadorSecuencia,
        describir,
        parsear_mensaje,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Lee eventos de supervisión UART del controlador de semáforos."
    )
    parser.add_argument(
        "--port",
        required=True,
        help="Puerto COM (Windows) o ruta de dispositivo serial (Linux)",
    )
    parser.add_argument("--baud", type=int, default=9600, help="Baudios (default: 9600)")
    args = parser.parse_args()

    try:
        import serial
    except ImportError:
        print(
            "Falta pyserial. Instalalo manualmente con: python -m pip install pyserial",
            file=sys.stderr,
        )
        return 1

    port = None
    rastreador = RastreadorSecuencia()
    try:
        port = serial.Serial(
            port=args.port,
            baudrate=args.baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=1,
        )
        print(f"Escuchando {args.port} a {args.baud} baudios. Ctrl+C para salir.")
        while True:
            line = port.readline()
            if line:
                try:
                    texto = line.decode("ascii")
                    mensaje = parsear_mensaje(texto)
                except UnicodeDecodeError as exc:
                    print(f"Mensaje inválido: no es ASCII ({exc})", file=sys.stderr)
                    continue
                except ProtocoloError as exc:
                    print(f"Mensaje inválido: {exc}: {line!r}", file=sys.stderr)
                    continue

                for aviso in rastreador.observar(mensaje):
                    print(f"AVISO: {aviso}", file=sys.stderr)
                print(describir(mensaje), flush=True)
    except KeyboardInterrupt:
        print("\nLectura finalizada.")
    except (serial.SerialException, OSError) as exc:
        print(f"Error de puerto serial {args.port}: {exc}", file=sys.stderr)
        return 1
    finally:
        if port is not None and port.is_open:
            port.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
