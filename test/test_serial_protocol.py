import unittest

from tools.serial_protocol import (
    ProtocoloError,
    RastreadorSecuencia,
    describir,
    parsear_mensaje,
)


class ProtocoloSerialTests(unittest.TestCase):
    def test_parsea_estado_y_heartbeat(self):
        state = parsear_mensaje(
            "SIV,1,1,1000,STATE,0,G,R,A_VERDE,NORMAL,4000\n"
        )
        self.assertEqual(state["datos"]["a"], "G")
        self.assertEqual(state["datos"]["restante_ms"], 4000)

        heartbeat = parsear_mensaje(
            "SIV,1,2,2000,HEARTBEAT,0,R,G,B_VERDE,NORMAL,3000\r\n"
        )
        self.assertEqual(heartbeat["tipo"], "HEARTBEAT")
        self.assertIn("Heartbeat", describir(heartbeat))

    def test_parsea_tipos_de_evento(self):
        examples = (
            "SIV,1,1,10,BOOT,0\n",
            "SIV,1,2,20,INDICIO_SIRENA,0,LOW\n",
            "SIV,1,3,30,EMERGENCIA_DETECTADA,7,A,R,G,B_VERDE,25\n",
            "SIV,1,4,40,PRIORIDAD_ACTIVADA,7,10,G,R,PRIORIDAD_A\n",
            "SIV,1,5,50,EMERGENCIA_FINALIZADA,7,1000\n",
            "SIV,1,6,60,CICLO_RECUPERADO,7,300\n",
            "SIV,1,7,70,FALLO_SEGURO,7,NO_DISPONIBLE,R,R,FALLO_SEGURO\n",
            "SIV,1,8,80,PERDIDA,0,1,2\n",
        )
        self.assertEqual(
            [parsear_mensaje(line)["tipo"] for line in examples],
            [
                "BOOT",
                "INDICIO_SIRENA",
                "EMERGENCIA_DETECTADA",
                "PRIORIDAD_ACTIVADA",
                "EMERGENCIA_FINALIZADA",
                "CICLO_RECUPERADO",
                "FALLO_SEGURO",
                "PERDIDA",
            ],
        )

    def test_rechaza_lineas_incompletas_y_mensajes_invalidos(self):
        invalid = (
            "SIV,1,1,1000,BOOT,0",
            "SIV,2,1,1000,BOOT,0\n",
            "SIV,1,-1,1000,BOOT,0\n",
            "SIV,1,1,1000,BOOT,0,extra\n",
            "SIV,1,1,1000,STATE,0,G,R,NO_EXISTE,NORMAL,1\n",
            "SIV,1,1,1000,EMERGENCIA_DETECTADA,7,B,R,G,B_VERDE,0\n",
            "SIV,1,1,1000,PERDIDA,0,999999,0\n",
            "SIV,1,1,1000,PRIORIDAD_ACTIVADA,0,0,G,R,PRIORIDAD_A\n",
            "SIV,1,1,1000,FALLO_SEGURO,0,CAUSA_INVENTADA,R,R,FALLO_SEGURO\n",
        )
        for line in invalid:
            with self.subTest(line=line):
                with self.assertRaises(ProtocoloError):
                    parsear_mensaje(line)

    def test_detecta_gaps_wrap_y_reinicio(self):
        tracker = RastreadorSecuencia()
        self.assertEqual(
            tracker.observar(parsear_mensaje("SIV,1,65534,0,BOOT,0\n")),
            ["Nuevo arranque 1"],
        )
        self.assertEqual(
            tracker.observar(
                parsear_mensaje("SIV,1,65535,1,HEARTBEAT,0,R,R,A_VERDE,NORMAL,1\n")
            ),
            [],
        )
        self.assertEqual(
            tracker.observar(
                parsear_mensaje("SIV,1,0,2,HEARTBEAT,0,R,R,A_VERDE,NORMAL,1\n")
            ),
            [],
        )
        self.assertEqual(
            tracker.observar(
                parsear_mensaje("SIV,1,2,3,HEARTBEAT,0,R,R,A_VERDE,NORMAL,1\n")
            ),
            ["Faltan 1 mensaje(s) antes de la secuencia 2"],
        )
        self.assertEqual(
            tracker.observar(parsear_mensaje("SIV,1,0,4,BOOT,0\n")),
            ["Nuevo arranque 2"],
        )


if __name__ == "__main__":
    unittest.main()
