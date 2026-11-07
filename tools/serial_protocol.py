"""Parser and sequence tracking for the SIV UART supervision protocol."""

import re


VERSION_PROTOCOLO = 1
FASES = {
    "A_VERDE",
    "A_AMARILLO",
    "TODO_ROJO",
    "B_VERDE",
    "B_AMARILLO",
    "PRIORIDAD_A",
    "RECUPERACION_A_AMARILLO",
    "FALLO_SEGURO",
}
MODOS = {"NORMAL", "EMERGENCIA", "RECUPERACION", "FALLO"}
TIPOS = {
    "BOOT",
    "INDICIO_SIRENA",
    "EMERGENCIA_DETECTADA",
    "PRIORIDAD_ACTIVADA",
    "EMERGENCIA_FINALIZADA",
    "CICLO_RECUPERADO",
    "FALLO_SEGURO",
    "STATE",
    "HEARTBEAT",
    "PERDIDA",
}
_ENTERO = re.compile(r"^(0|[1-9][0-9]*)$")


class ProtocoloError(ValueError):
    """Un mensaje no pertenece al protocolo documentado."""


def _entero(texto, campo, maximo):
    if not _ENTERO.fullmatch(texto):
        raise ProtocoloError("campo {} no es un entero decimal".format(campo))
    valor = int(texto)
    if valor > maximo:
        raise ProtocoloError("campo {} fuera de rango".format(campo))
    return valor


def _luz(texto, campo):
    if texto not in {"R", "Y", "G"}:
        raise ProtocoloError("campo {} debe ser R, Y o G".format(campo))
    return texto


def _fase(texto):
    if texto not in FASES:
        raise ProtocoloError("fase desconocida: {}".format(texto))
    return texto


def parsear_mensaje(linea):
    """Parsea una línea completa terminada en LF y devuelve un evento tipado."""
    if not isinstance(linea, str):
        raise ProtocoloError("la línea debe ser texto")
    if not linea.endswith("\n"):
        raise ProtocoloError("línea incompleta: falta LF")

    texto = linea[:-1]
    if texto.endswith("\r"):
        texto = texto[:-1]
    if not texto or any(ord(char) < 32 for char in texto):
        raise ProtocoloError("carácter de control no permitido")

    campos = texto.split(",")
    if len(campos) < 6 or campos[0] != "SIV":
        raise ProtocoloError("cabecera inválida")

    version = _entero(campos[1], "version", 255)
    if version != VERSION_PROTOCOLO:
        raise ProtocoloError("versión no soportada: {}".format(version))

    secuencia = _entero(campos[2], "secuencia", 65535)
    uptime = _entero(campos[3], "uptime_ms", 4294967295)
    tipo = campos[4]
    if tipo not in TIPOS:
        raise ProtocoloError("tipo de mensaje desconocido: {}".format(tipo))
    incidente = _entero(campos[5], "incidente_id", 65535)
    datos = campos[6:]
    if tipo in {
        "EMERGENCIA_DETECTADA",
        "PRIORIDAD_ACTIVADA",
        "EMERGENCIA_FINALIZADA",
        "CICLO_RECUPERADO",
    } and incidente == 0:
        raise ProtocoloError("{} requiere incidente_id no nulo".format(tipo))

    mensaje = {
        "version": version,
        "secuencia": secuencia,
        "uptime_ms": uptime,
        "tipo": tipo,
        "incidente_id": incidente,
        "datos": {},
    }

    if tipo == "BOOT":
        if incidente != 0 or datos:
            raise ProtocoloError("BOOT no lleva incidente ni datos")
    elif tipo in {"STATE", "HEARTBEAT"}:
        if len(datos) != 5:
            raise ProtocoloError("{} requiere 5 campos".format(tipo))
        modo = datos[3]
        if modo not in MODOS:
            raise ProtocoloError("modo desconocido: {}".format(modo))
        mensaje["datos"] = {
            "a": _luz(datos[0], "luz_a"),
            "b": _luz(datos[1], "luz_b"),
            "fase": _fase(datos[2]),
            "modo": modo,
            "restante_ms": _entero(datos[4], "restante_ms", 4294967295),
        }
    elif tipo == "INDICIO_SIRENA":
        if len(datos) != 1 or datos[0] not in {"LOW", "HIGH"}:
            raise ProtocoloError("INDICIO_SIRENA requiere LOW o HIGH")
        mensaje["datos"] = {"banda": datos[0]}
    elif tipo == "EMERGENCIA_DETECTADA":
        if len(datos) != 5 or datos[0] != "A":
            raise ProtocoloError("EMERGENCIA_DETECTADA requiere carril A y 4 campos")
        mensaje["datos"] = {
            "carril": datos[0],
            "a": _luz(datos[1], "luz_a"),
            "b": _luz(datos[2], "luz_b"),
            "fase": _fase(datos[3]),
            "indicio_ms": _entero(datos[4], "indicio_ms", 4294967295),
        }
    elif tipo == "PRIORIDAD_ACTIVADA":
        if len(datos) != 4:
            raise ProtocoloError("PRIORIDAD_ACTIVADA requiere 4 campos")
        mensaje["datos"] = {
            "respuesta_ms": _entero(datos[0], "respuesta_ms", 4294967295),
            "a": _luz(datos[1], "luz_a"),
            "b": _luz(datos[2], "luz_b"),
            "fase": _fase(datos[3]),
        }
    elif tipo == "EMERGENCIA_FINALIZADA":
        if len(datos) != 1:
            raise ProtocoloError("EMERGENCIA_FINALIZADA requiere duracion_ms")
        mensaje["datos"] = {
            "duracion_ms": _entero(datos[0], "duracion_ms", 4294967295)
        }
    elif tipo == "CICLO_RECUPERADO":
        if len(datos) != 1:
            raise ProtocoloError("CICLO_RECUPERADO requiere recuperacion_ms")
        mensaje["datos"] = {
            "recuperacion_ms": _entero(datos[0], "recuperacion_ms", 4294967295)
        }
    elif tipo == "FALLO_SEGURO":
        if len(datos) != 4 or datos[0] != "NO_DISPONIBLE":
            raise ProtocoloError("FALLO_SEGURO requiere motivo y 3 campos")
        mensaje["datos"] = {
            "motivo": datos[0],
            "a": _luz(datos[1], "luz_a"),
            "b": _luz(datos[2], "luz_b"),
            "fase": _fase(datos[3]),
        }
    elif tipo == "PERDIDA":
        if len(datos) != 2:
            raise ProtocoloError("PERDIDA requiere 2 contadores")
        mensaje["datos"] = {
            "criticos": _entero(datos[0], "perdidas_criticas", 65535),
            "supervision": _entero(datos[1], "perdidas_supervision", 65535),
        }

    return mensaje


class RastreadorSecuencia:
    """Detecta gaps, duplicados y reinicios señalizados por BOOT."""

    def __init__(self):
        self.ultima = None
        self.arranque = 0

    def observar(self, mensaje):
        tipo = mensaje["tipo"]
        secuencia = mensaje["secuencia"]
        if tipo == "BOOT":
            self.arranque += 1
            self.ultima = secuencia
            return ["Nuevo arranque {}".format(self.arranque)]

        if self.ultima is None:
            self.ultima = secuencia
            return []

        distancia = (secuencia - self.ultima) & 0xFFFF
        if distancia == 0:
            return ["Secuencia duplicada: {}".format(secuencia)]
        if distancia > 0x8000:
            return ["Secuencia fuera de orden: {}".format(secuencia)]

        self.ultima = secuencia
        if distancia > 1:
            return ["Faltan {} mensaje(s) antes de la secuencia {}".format(
                distancia - 1, secuencia
            )]
        return []


def describir(mensaje):
    """Devuelve una descripción breve y legible para la terminal."""
    tipo = mensaje["tipo"]
    datos = mensaje["datos"]
    incidente = mensaje["incidente_id"]
    prefijo = "[{} ms] ".format(mensaje["uptime_ms"])

    if tipo == "BOOT":
        return prefijo + "Arranque del controlador"
    if tipo in {"STATE", "HEARTBEAT"}:
        return prefijo + "{}: fase={}, modo={}, A={}, B={}, restante={} ms".format(
            "Estado" if tipo == "STATE" else "Heartbeat",
            datos["fase"], datos["modo"], datos["a"], datos["b"],
            datos["restante_ms"]
        )
    if tipo == "INDICIO_SIRENA":
        return prefijo + "Indicio acústico {}".format(datos["banda"])
    if tipo == "EMERGENCIA_DETECTADA":
        return prefijo + "Incidente {} detectado; prioridad A; fase={}, A={}, B={}, indicios hace {} ms".format(
            incidente, datos["fase"], datos["a"], datos["b"], datos["indicio_ms"]
        )
    if tipo == "PRIORIDAD_ACTIVADA":
        return prefijo + "Incidente {}: prioridad A activa; respuesta={} ms; A={}, B={}".format(
            incidente, datos["respuesta_ms"], datos["a"], datos["b"]
        )
    if tipo == "EMERGENCIA_FINALIZADA":
        return prefijo + "Incidente {} finalizado; duración={} ms".format(
            incidente, datos["duracion_ms"]
        )
    if tipo == "CICLO_RECUPERADO":
        return prefijo + "Incidente {}: ciclo normal recuperado {} ms después del fin".format(
            incidente, datos["recuperacion_ms"]
        )
    if tipo == "FALLO_SEGURO":
        return prefijo + "FALLO SEGURO: motivo={}, A={}, B={}, fase={}".format(
            datos["motivo"], datos["a"], datos["b"], datos["fase"]
        )
    if tipo == "PERDIDA":
        return prefijo + "Pérdida de telemetría: críticos={}, supervisión={}".format(
            datos["criticos"], datos["supervision"]
        )
    return prefijo + tipo
