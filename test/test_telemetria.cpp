#include <cstdint>
#include <cstdio>
#include <cstring>

#include "../src/telemetria.h"

static int g_fallidos = 0;

static void verificar(const char* nombre, bool condicion) {
  if (!condicion) {
    std::printf("FAIL: %s\n", nombre);
    g_fallidos++;
  } else {
    std::printf("PASS: %s\n", nombre);
  }
}

static void encolar_mensaje(TelemetriaCola* cola, const char* mensaje,
                            bool critica) {
  telemetria_encolar(cola, mensaje, (uint8_t)strlen(mensaje), critica);
}

static bool trama_es(const TelemetriaTrama* trama, const char* esperado) {
  const size_t longitud = strlen(esperado);
  return trama != 0 && trama->longitud == longitud
      && memcmp(trama->datos, esperado, longitud) == 0;
}

int main() {
  {
    TelemetriaCola cola;
    telemetria_inicializar_cola(&cola);
    cola.siguiente_secuencia = UINT16_MAX;
    verificar("secuencia alcanza 65535",
              telemetria_tomar_secuencia(&cola) == UINT16_MAX);
    verificar("secuencia envuelve a cero", telemetria_tomar_secuencia(&cola) == 0);

    encolar_mensaje(&cola, "HEARTBEAT\n", false);
    encolar_mensaje(&cola, "DETECTADA\n", true);
    encolar_mensaje(&cola, "PRIORIDAD\n", true);
    encolar_mensaje(&cola, "ESTADO\n", true);
    encolar_mensaje(&cola, "FINALIZADA\n", true);
    verificar("evento crítico desplaza supervisión si la cola está llena",
              cola.cantidad == TELEMETRIA_CAPACIDAD_COLA
                  && cola.perdidas_supervision == 1
                  && cola.tramas[0].critica);
    encolar_mensaje(&cola, "RECUPERADA\n", true);
    verificar("pérdida crítica queda contabilizada cuando no hay trama reemplazable",
              cola.perdidas_criticas == 1);

    const TelemetriaTrama* frente = telemetria_frente(&cola);
    verificar("cola conserva el primer evento crítico",
              trama_es(frente, "DETECTADA\n"));
    telemetria_consumir(&cola, 4);
    verificar("escritura parcial no descarta una línea",
              telemetria_frente(&cola) != 0
                  && telemetria_frente(&cola)->desplazamiento == 4);
    telemetria_consumir(&cola, TELEMETRIA_TAMANO_LINEA);
    verificar("línea se quita solo cuando fue consumida completa",
              trama_es(telemetria_frente(&cola), "PRIORIDAD\n"));
  }

  {
    TelemetriaCola cola;
    telemetria_inicializar_cola(&cola);
    encolar_mensaje(&cola, "HEARTBEAT\n", false);
    telemetria_consumir(&cola, 2);
    encolar_mensaje(&cola, "EVENTO_A\n", true);
    encolar_mensaje(&cola, "EVENTO_B\n", true);
    encolar_mensaje(&cola, "EVENTO_C\n", true);
    encolar_mensaje(&cola, "EVENTO_D\n", true);
    verificar("no descarta una línea de supervisión parcialmente transmitida",
              trama_es(telemetria_frente(&cola), "HEARTBEAT\n")
                  && telemetria_frente(&cola)->desplazamiento == 2
                  && cola.perdidas_criticas == 1);
  }

  {
    TelemetriaCola cola;
    telemetria_inicializar_cola(&cola);
    char demasiado_larga[TELEMETRIA_TAMANO_LINEA + 1];
    memset(demasiado_larga, 'X', sizeof(demasiado_larga));
    verificar("rechaza trama que no cabe en el buffer",
              !telemetria_encolar(&cola, demasiado_larga,
                                  (uint8_t)sizeof(demasiado_larga), true));
    verificar("trama crítica inválida incrementa pérdidas",
              cola.perdidas_criticas == 1);
  }

  {
    TelemetriaIncidente incidentes;
    telemetria_inicializar_incidentes(&incidentes);
    const uint16_t primero = telemetria_iniciar_incidente(&incidentes, 100);
    verificar("primer incidente recibe ID no nulo", primero == 1);
    verificar("detección repetida no abre incidente paralelo",
              telemetria_iniciar_incidente(&incidentes, 110) == 0);

    uint16_t finalizado = 0;
    uint32_t duracion = 0;
    bool guardada = false;
    verificar("cierra incidente activo",
              telemetria_finalizar_incidente(&incidentes, 225, &finalizado,
                                             &duracion, &guardada));
    verificar("duración se mide desde confirmación a finalización",
              finalizado == primero && duracion == 125 && guardada);

    const uint16_t segundo = telemetria_iniciar_incidente(&incidentes, 300);
    verificar("nueva detección durante recuperación recibe otro ID",
              segundo != 0 && segundo != primero);
    telemetria_finalizar_incidente(&incidentes, 400, &finalizado, &duracion,
                                   &guardada);
    verificar("recuperaciones de incidentes distintos conservan orden",
              incidentes.recuperaciones_pendientes == 2
                  && incidentes.recuperaciones[0].incidente_id == primero
                  && incidentes.recuperaciones[1].incidente_id == segundo);

    uint16_t recuperado = 0;
    uint32_t desde_fin = 0;
    telemetria_siguiente_recuperacion(&incidentes, 700, &recuperado, &desde_fin);
    verificar("recuperación reportada conserva el primer ID y métrica",
              recuperado == primero && desde_fin == 475);
    telemetria_siguiente_recuperacion(&incidentes, 750, &recuperado, &desde_fin);
    verificar("siguiente recuperación conserva el segundo ID",
              recuperado == segundo && desde_fin == 350);
  }

  {
    TelemetriaIncidente incidentes;
    telemetria_inicializar_incidentes(&incidentes);
    uint16_t id = 0;
    uint32_t duracion = 0;
    bool guardada = false;
    for (uint8_t i = 0; i < TELEMETRIA_MAX_RECUPERACIONES_PENDIENTES; i++) {
      telemetria_iniciar_incidente(&incidentes, i);
      telemetria_finalizar_incidente(&incidentes, i + 1, &id, &duracion, &guardada);
      verificar("recuperación pendiente queda almacenada", guardada);
    }
    telemetria_iniciar_incidente(&incidentes, 10);
    telemetria_finalizar_incidente(&incidentes, 11, &id, &duracion, &guardada);
    verificar("saturación de seguimiento de recuperación se reporta",
              !guardada && incidentes.recuperaciones_pendientes
                  == TELEMETRIA_MAX_RECUPERACIONES_PENDIENTES);
  }

  {
    const uint32_t inicio = UINT32_MAX - 15U;
    const uint32_t fin = 16U;
    verificar("delta monotónico funciona a través del wrap de millis",
              (uint32_t)(fin - inicio) == 32U);
  }

  if (g_fallidos != 0) {
    std::printf("%d test(s) failed\n", g_fallidos);
    return 1;
  }
  std::printf("all tests passed\n");
  return 0;
}
