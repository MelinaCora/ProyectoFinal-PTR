#ifndef TELEMETRIA_H
#define TELEMETRIA_H

#include <stdint.h>
#include <stdio.h>
#include <string.h>

static const uint8_t TELEMETRIA_CAPACIDAD_COLA = 4;
static const uint8_t TELEMETRIA_TAMANO_LINEA = 96;
static const uint8_t TELEMETRIA_MAX_RECUPERACIONES_PENDIENTES = 4;

struct TelemetriaTrama {
  char datos[TELEMETRIA_TAMANO_LINEA];
  uint8_t longitud;
  uint8_t desplazamiento;
  bool critica;
};

struct TelemetriaCola {
  TelemetriaTrama tramas[TELEMETRIA_CAPACIDAD_COLA];
  uint8_t cantidad;
  uint16_t siguiente_secuencia;
  uint16_t perdidas_criticas;
  uint16_t perdidas_supervision;
};

struct TelemetriaRecuperacionPendiente {
  uint16_t incidente_id;
  uint32_t finalizada_ms;
};

struct TelemetriaIncidente {
  uint16_t activo_id;
  uint16_t siguiente_id;
  uint32_t detectado_ms;
  TelemetriaRecuperacionPendiente recuperaciones[
      TELEMETRIA_MAX_RECUPERACIONES_PENDIENTES];
  uint8_t recuperaciones_pendientes;
};

inline void telemetria_inicializar_cola(TelemetriaCola* cola) {
  cola->cantidad = 0;
  cola->siguiente_secuencia = 0;
  cola->perdidas_criticas = 0;
  cola->perdidas_supervision = 0;
}

inline uint16_t telemetria_tomar_secuencia(TelemetriaCola* cola) {
  const uint16_t secuencia = cola->siguiente_secuencia;
  cola->siguiente_secuencia++;
  return secuencia;
}

inline void telemetria_sumar_perdida(uint16_t* contador) {
  if (*contador != UINT16_MAX) (*contador)++;
}

inline void telemetria_quitar_trama(TelemetriaCola* cola, uint8_t indice) {
  for (uint8_t i = indice; i + 1 < cola->cantidad; i++) {
    cola->tramas[i] = cola->tramas[i + 1];
  }
  cola->cantidad--;
}

inline bool telemetria_encolar(TelemetriaCola* cola, const char* datos,
                               uint8_t longitud, bool critica) {
  if (cola == 0 || datos == 0 || longitud == 0
      || longitud >= TELEMETRIA_TAMANO_LINEA) {
    if (cola != 0 && critica) telemetria_sumar_perdida(&cola->perdidas_criticas);
    return false;
  }

  if (cola->cantidad == TELEMETRIA_CAPACIDAD_COLA) {
    uint8_t reemplazable = TELEMETRIA_CAPACIDAD_COLA;
    for (uint8_t i = 0; i < cola->cantidad; i++) {
      if (!cola->tramas[i].critica
          && cola->tramas[i].desplazamiento == 0) {
        reemplazable = i;
        break;
      }
    }

    if (critica && reemplazable < TELEMETRIA_CAPACIDAD_COLA) {
      telemetria_quitar_trama(cola, reemplazable);
      telemetria_sumar_perdida(&cola->perdidas_supervision);
    } else {
      telemetria_sumar_perdida(
          critica ? &cola->perdidas_criticas : &cola->perdidas_supervision);
      return false;
    }
  }

  TelemetriaTrama& trama = cola->tramas[cola->cantidad++];
  memcpy(trama.datos, datos, longitud);
  trama.longitud = longitud;
  trama.desplazamiento = 0;
  trama.critica = critica;
  return true;
}

inline const TelemetriaTrama* telemetria_frente(const TelemetriaCola* cola) {
  return cola != 0 && cola->cantidad > 0 ? &cola->tramas[0] : 0;
}

inline void telemetria_consumir(TelemetriaCola* cola, uint8_t cantidad) {
  if (cola == 0 || cola->cantidad == 0) return;
  TelemetriaTrama& trama = cola->tramas[0];
  const uint8_t restante = trama.longitud - trama.desplazamiento;
  trama.desplazamiento += cantidad < restante ? cantidad : restante;
  if (trama.desplazamiento >= trama.longitud) telemetria_quitar_trama(cola, 0);
}

inline void telemetria_inicializar_incidentes(TelemetriaIncidente* estado) {
  estado->activo_id = 0;
  estado->siguiente_id = 1;
  estado->detectado_ms = 0;
  estado->recuperaciones_pendientes = 0;
}

inline uint16_t telemetria_iniciar_incidente(TelemetriaIncidente* estado,
                                             uint32_t ahora_ms) {
  if (estado == 0 || estado->activo_id != 0) return 0;
  uint16_t id = estado->siguiente_id++;
  if (id == 0) id = estado->siguiente_id++;
  estado->activo_id = id;
  estado->detectado_ms = ahora_ms;
  return id;
}

inline bool telemetria_finalizar_incidente(TelemetriaIncidente* estado,
                                           uint32_t ahora_ms,
                                           uint16_t* incidente_id,
                                           uint32_t* duracion_ms,
                                           bool* recuperacion_guardada) {
  if (estado == 0 || estado->activo_id == 0) return false;
  if (incidente_id != 0) *incidente_id = estado->activo_id;
  if (duracion_ms != 0) *duracion_ms = ahora_ms - estado->detectado_ms;

  const bool hay_lugar = estado->recuperaciones_pendientes
      < TELEMETRIA_MAX_RECUPERACIONES_PENDIENTES;
  if (recuperacion_guardada != 0) *recuperacion_guardada = hay_lugar;
  if (hay_lugar) {
    TelemetriaRecuperacionPendiente& pendiente =
        estado->recuperaciones[estado->recuperaciones_pendientes++];
    pendiente.incidente_id = estado->activo_id;
    pendiente.finalizada_ms = ahora_ms;
  }
  estado->activo_id = 0;
  return true;
}

inline bool telemetria_siguiente_recuperacion(
    TelemetriaIncidente* estado, uint32_t ahora_ms, uint16_t* incidente_id,
    uint32_t* desde_finalizacion_ms) {
  if (estado == 0 || estado->recuperaciones_pendientes == 0) return false;
  const TelemetriaRecuperacionPendiente pendiente = estado->recuperaciones[0];
  if (incidente_id != 0) *incidente_id = pendiente.incidente_id;
  if (desde_finalizacion_ms != 0) {
    *desde_finalizacion_ms = ahora_ms - pendiente.finalizada_ms;
  }
  for (uint8_t i = 0; i + 1 < estado->recuperaciones_pendientes; i++) {
    estado->recuperaciones[i] = estado->recuperaciones[i + 1];
  }
  estado->recuperaciones_pendientes--;
  return true;
}

#endif
