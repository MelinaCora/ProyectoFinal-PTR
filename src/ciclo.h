#ifndef CICLO_H
#define CICLO_H

#include <stdint.h>

static const uint32_t CICLO_VERDE_MS = 5000;
static const uint32_t CICLO_AMARILLO_MS = 2000;
static const uint32_t CICLO_TODO_ROJO_MS = 1000;
static const uint8_t CICLO_MAX_TRANSICIONES_POR_TICK = 16;

enum CicloLuz {
  CICLO_ROJO = 0,
  CICLO_AMARILLO = 1,
  CICLO_VERDE = 2
};

enum CicloFase {
  CICLO_A_VERDE = 0,
  CICLO_A_AMARILLO = 1,
  CICLO_TODO_ROJO = 2,
  CICLO_B_VERDE = 3,
  CICLO_B_AMARILLO = 4,
  CICLO_PRIORIDAD_A = 5,
  CICLO_RECUPERACION_A_AMARILLO = 6,
  CICLO_FALLO_SEGURO = 7
};

enum CicloDestino {
  CICLO_DESTINO_NINGUNO = 0,
  CICLO_DESTINO_A_VERDE = 1,
  CICLO_DESTINO_B_VERDE = 2,
  CICLO_DESTINO_PRIORIDAD_A = 3
};

enum CicloOrigen {
  CICLO_ORIGEN_NINGUNO = 0,
  CICLO_ORIGEN_A_VERDE = 1,
  CICLO_ORIGEN_A_AMARILLO = 2,
  CICLO_ORIGEN_B_VERDE = 3,
  CICLO_ORIGEN_B_AMARILLO = 4
};

enum CicloEvento {
  CICLO_EVENTO_NINGUNO = 0,
  CICLO_EVENTO_SOLICITUD = 1,
  CICLO_EVENTO_PRIORIDAD_ACTIVA = 2,
  CICLO_EVENTO_EMERGENCIA_FINALIZADA = 4,
  CICLO_EVENTO_RECUPERACION_COMPLETA = 8,
  CICLO_EVENTO_ESTADO_INVALIDO = 16
};

struct Ciclo {
  CicloFase fase;
  CicloDestino destino_todo_rojo;
  uint32_t restante_ms;
  CicloOrigen origen;
  uint32_t restante_guardado_ms;
  bool ambulancia_pendiente;
  bool emergencia_en_curso;
};

inline bool ciclo_fase_valida(CicloFase fase) {
  return fase >= CICLO_A_VERDE && fase <= CICLO_FALLO_SEGURO;
}

inline bool ciclo_destino_valido(CicloDestino destino) {
  return destino >= CICLO_DESTINO_NINGUNO
      && destino <= CICLO_DESTINO_PRIORIDAD_A;
}

inline bool ciclo_origen_valido(CicloOrigen origen) {
  return origen >= CICLO_ORIGEN_NINGUNO
      && origen <= CICLO_ORIGEN_B_AMARILLO;
}

inline void ciclo_init(Ciclo* c) {
  c->fase = CICLO_A_VERDE;
  c->destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  c->restante_ms = CICLO_VERDE_MS;
  c->origen = CICLO_ORIGEN_NINGUNO;
  c->restante_guardado_ms = 0;
  c->ambulancia_pendiente = false;
  c->emergencia_en_curso = false;
}

inline bool ciclo_estado_valido(const Ciclo* c) {
  if (c == 0 || !ciclo_fase_valida(c->fase)
      || !ciclo_destino_valido(c->destino_todo_rojo)
      || !ciclo_origen_valido(c->origen)) {
    return false;
  }
  if (c->fase == CICLO_TODO_ROJO) {
    return c->destino_todo_rojo == CICLO_DESTINO_A_VERDE
        || c->destino_todo_rojo == CICLO_DESTINO_B_VERDE
        || c->destino_todo_rojo == CICLO_DESTINO_PRIORIDAD_A;
  }
  return true;
}

inline CicloLuz ciclo_luz_a(const Ciclo* c) {
  if (c == 0 || !ciclo_fase_valida(c->fase)) return CICLO_ROJO;
  switch (c->fase) {
    case CICLO_A_VERDE:
    case CICLO_PRIORIDAD_A:
      return CICLO_VERDE;
    case CICLO_A_AMARILLO:
    case CICLO_RECUPERACION_A_AMARILLO:
      return CICLO_AMARILLO;
    case CICLO_TODO_ROJO:
    case CICLO_B_VERDE:
    case CICLO_B_AMARILLO:
    case CICLO_FALLO_SEGURO:
      return CICLO_ROJO;
  }
  return CICLO_ROJO;
}

inline CicloLuz ciclo_luz_b(const Ciclo* c) {
  if (c == 0 || !ciclo_fase_valida(c->fase)) return CICLO_ROJO;
  switch (c->fase) {
    case CICLO_B_VERDE:
      return CICLO_VERDE;
    case CICLO_B_AMARILLO:
      return CICLO_AMARILLO;
    case CICLO_A_VERDE:
    case CICLO_A_AMARILLO:
    case CICLO_TODO_ROJO:
    case CICLO_PRIORIDAD_A:
    case CICLO_RECUPERACION_A_AMARILLO:
    case CICLO_FALLO_SEGURO:
      return CICLO_ROJO;
  }
  return CICLO_ROJO;
}

inline bool ciclo_muestra_ambulancia(const Ciclo* c) {
  return c != 0 && (c->fase == CICLO_PRIORIDAD_A || c->ambulancia_pendiente);
}

inline void ciclo_iniciar_todo_rojo(Ciclo* c, CicloDestino destino) {
  c->fase = CICLO_TODO_ROJO;
  c->destino_todo_rojo = destino;
  c->restante_ms = CICLO_TODO_ROJO_MS;
}

inline void ciclo_limpiar_origen(Ciclo* c) {
  c->origen = CICLO_ORIGEN_NINGUNO;
  c->restante_guardado_ms = 0;
}

inline void ciclo_entrar_prioridad(Ciclo* c) {
  c->fase = CICLO_PRIORIDAD_A;
  c->destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  c->restante_ms = 0;
  c->ambulancia_pendiente = false;
}

inline uint8_t ciclo_solicitar_prioridad(Ciclo* c) {
  if (c->emergencia_en_curso || c->fase == CICLO_PRIORIDAD_A) {
    return CICLO_EVENTO_NINGUNO;
  }

  c->ambulancia_pendiente = true;
  c->emergencia_en_curso = true;
  uint8_t eventos = CICLO_EVENTO_SOLICITUD;

  switch (c->fase) {
    case CICLO_A_VERDE:
      c->origen = CICLO_ORIGEN_A_VERDE;
      c->restante_guardado_ms = c->restante_ms;
      ciclo_entrar_prioridad(c);
      eventos |= CICLO_EVENTO_PRIORIDAD_ACTIVA;
      break;
    case CICLO_A_AMARILLO:
      if (c->origen == CICLO_ORIGEN_NINGUNO) {
        c->origen = CICLO_ORIGEN_A_AMARILLO;
        c->restante_guardado_ms = 0;
      }
      break;
    case CICLO_B_VERDE:
      c->origen = CICLO_ORIGEN_B_VERDE;
      c->restante_guardado_ms = c->restante_ms;
      c->fase = CICLO_B_AMARILLO;
      c->destino_todo_rojo = CICLO_DESTINO_NINGUNO;
      c->restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_B_AMARILLO:
      if (c->origen == CICLO_ORIGEN_NINGUNO) {
        c->origen = CICLO_ORIGEN_B_AMARILLO;
        c->restante_guardado_ms = 0;
      }
      break;
    case CICLO_TODO_ROJO:
      if (c->origen == CICLO_ORIGEN_NINGUNO) {
        c->origen = c->destino_todo_rojo == CICLO_DESTINO_B_VERDE
            ? CICLO_ORIGEN_A_AMARILLO
            : CICLO_ORIGEN_B_AMARILLO;
      }
      c->destino_todo_rojo = CICLO_DESTINO_PRIORIDAD_A;
      break;
    case CICLO_RECUPERACION_A_AMARILLO:
      break;
    case CICLO_PRIORIDAD_A:
      c->ambulancia_pendiente = false;
      c->emergencia_en_curso = false;
      return CICLO_EVENTO_NINGUNO;
    case CICLO_FALLO_SEGURO:
      return CICLO_EVENTO_NINGUNO;
  }
  return eventos;
}

inline uint8_t ciclo_finalizar_prioridad(Ciclo* c) {
  c->emergencia_en_curso = false;
  c->ambulancia_pendiente = false;
  uint8_t eventos = CICLO_EVENTO_EMERGENCIA_FINALIZADA;

  switch (c->origen) {
    case CICLO_ORIGEN_A_VERDE:
      c->fase = CICLO_A_VERDE;
      c->restante_ms = c->restante_guardado_ms;
      ciclo_limpiar_origen(c);
      eventos |= CICLO_EVENTO_RECUPERACION_COMPLETA;
      break;
    case CICLO_ORIGEN_B_AMARILLO:
      c->fase = CICLO_A_VERDE;
      c->restante_ms = CICLO_VERDE_MS;
      ciclo_limpiar_origen(c);
      eventos |= CICLO_EVENTO_RECUPERACION_COMPLETA;
      break;
    case CICLO_ORIGEN_A_AMARILLO:
    case CICLO_ORIGEN_B_VERDE:
      c->fase = CICLO_RECUPERACION_A_AMARILLO;
      c->destino_todo_rojo = CICLO_DESTINO_NINGUNO;
      c->restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_ORIGEN_NINGUNO:
      ciclo_iniciar_todo_rojo(c, CICLO_DESTINO_A_VERDE);
      break;
  }
  return eventos;
}

inline uint8_t ciclo_resolver_todo_rojo(Ciclo* c) {
  const CicloDestino destino = c->destino_todo_rojo;
  c->destino_todo_rojo = CICLO_DESTINO_NINGUNO;

  if (destino == CICLO_DESTINO_PRIORIDAD_A) {
    ciclo_entrar_prioridad(c);
    return CICLO_EVENTO_PRIORIDAD_ACTIVA;
  }
  if (destino == CICLO_DESTINO_A_VERDE) {
    c->fase = CICLO_A_VERDE;
    c->restante_ms = CICLO_VERDE_MS;
  } else if (destino == CICLO_DESTINO_B_VERDE) {
    c->fase = CICLO_B_VERDE;
    c->restante_ms = c->origen == CICLO_ORIGEN_B_VERDE
        ? c->restante_guardado_ms
        : CICLO_VERDE_MS;
  } else {
    c->fase = CICLO_TODO_ROJO;
    c->destino_todo_rojo = CICLO_DESTINO_A_VERDE;
    c->restante_ms = CICLO_TODO_ROJO_MS;
    return CICLO_EVENTO_ESTADO_INVALIDO;
  }

  if (c->origen != CICLO_ORIGEN_NINGUNO) {
    ciclo_limpiar_origen(c);
    return CICLO_EVENTO_RECUPERACION_COMPLETA;
  }
  return CICLO_EVENTO_NINGUNO;
}

inline uint8_t ciclo_fallar_seguro(Ciclo* c) {
  c->fase = CICLO_FALLO_SEGURO;
  c->destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  c->restante_ms = 0;
  c->origen = CICLO_ORIGEN_NINGUNO;
  c->restante_guardado_ms = 0;
  c->ambulancia_pendiente = false;
  c->emergencia_en_curso = false;
  return CICLO_EVENTO_ESTADO_INVALIDO;
}

inline uint8_t ciclo_avanzar(Ciclo* c, uint32_t dt_ms,
                             bool patron_confirmado, bool sirena_activa) {
  if (c == 0) return CICLO_EVENTO_ESTADO_INVALIDO;
  if (c->fase == CICLO_FALLO_SEGURO) return CICLO_EVENTO_NINGUNO;
  if (!ciclo_estado_valido(c)) return ciclo_fallar_seguro(c);

  uint8_t eventos = CICLO_EVENTO_NINGUNO;
  if (c->fase == CICLO_PRIORIDAD_A && !sirena_activa) {
    eventos |= ciclo_finalizar_prioridad(c);
  } else {
    uint8_t transiciones = 0;
    while (transiciones < CICLO_MAX_TRANSICIONES_POR_TICK) {
      if (c->fase == CICLO_PRIORIDAD_A) break;
      if (dt_ms < c->restante_ms) {
        c->restante_ms -= dt_ms;
        dt_ms = 0;
        break;
      }

      dt_ms -= c->restante_ms;
      c->restante_ms = 0;
      transiciones++;

      switch (c->fase) {
        case CICLO_A_VERDE:
          c->fase = CICLO_A_AMARILLO;
          c->restante_ms = CICLO_AMARILLO_MS;
          break;
        case CICLO_A_AMARILLO:
          ciclo_iniciar_todo_rojo(c, c->ambulancia_pendiente
              ? CICLO_DESTINO_PRIORIDAD_A : CICLO_DESTINO_B_VERDE);
          break;
        case CICLO_TODO_ROJO:
          eventos |= ciclo_resolver_todo_rojo(c);
          if (c->fase == CICLO_PRIORIDAD_A) break;
          break;
        case CICLO_B_VERDE:
          c->fase = CICLO_B_AMARILLO;
          c->restante_ms = CICLO_AMARILLO_MS;
          break;
        case CICLO_B_AMARILLO:
          ciclo_iniciar_todo_rojo(c, c->ambulancia_pendiente
              ? CICLO_DESTINO_PRIORIDAD_A : CICLO_DESTINO_A_VERDE);
          break;
        case CICLO_PRIORIDAD_A:
          break;
        case CICLO_RECUPERACION_A_AMARILLO:
          ciclo_iniciar_todo_rojo(c, c->ambulancia_pendiente
              ? CICLO_DESTINO_PRIORIDAD_A : CICLO_DESTINO_B_VERDE);
          break;
        case CICLO_FALLO_SEGURO:
          break;
      }
      if (c->fase == CICLO_PRIORIDAD_A) break;
      if (dt_ms == 0 && c->restante_ms != 0) break;
    }

    if (dt_ms > 0 && c->fase != CICLO_PRIORIDAD_A) {
      return eventos | ciclo_fallar_seguro(c);
    }
  }

  if (!ciclo_estado_valido(c)) return eventos | ciclo_fallar_seguro(c);
  if (patron_confirmado) eventos |= ciclo_solicitar_prioridad(c);
  return eventos;
}

#endif
