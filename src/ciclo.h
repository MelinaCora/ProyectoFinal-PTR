#ifndef CICLO_H
#define CICLO_H

#include <stdint.h>

static const uint32_t CICLO_VERDE_MS = 5000;
static const uint32_t CICLO_AMARILLO_MS = 2000;

enum CicloLuz {
  CICLO_ROJO = 0,
  CICLO_AMARILLO = 1,
  CICLO_VERDE = 2
};

enum CicloFase {
  CICLO_A_VERDE = 0,
  CICLO_A_AMARILLO = 1,
  CICLO_B_VERDE = 2,
  CICLO_B_AMARILLO = 3,
  CICLO_AMBULANCIA = 4,
  CICLO_DESPEJE_B = 5,
  CICLO_DESPEJE_A = 6
};

enum CicloOrigen {
  CICLO_ORIGEN_NINGUNO = 0,
  CICLO_ORIGEN_A_VERDE = 1,
  CICLO_ORIGEN_A_AMARILLO = 2,
  CICLO_ORIGEN_B_VERDE = 3,
  CICLO_ORIGEN_B_AMARILLO = 4
};

struct Ciclo {
  CicloFase fase;
  uint32_t restante_ms;
  CicloOrigen origen;
  uint32_t restante_guardado_ms;
  bool ambulancia_pendiente;
};

inline void ciclo_init(Ciclo* c) {
  c->fase = CICLO_A_VERDE;
  c->restante_ms = CICLO_VERDE_MS;
  c->origen = CICLO_ORIGEN_NINGUNO;
  c->restante_guardado_ms = 0;
  c->ambulancia_pendiente = false;
}

inline CicloLuz ciclo_luz_a(const Ciclo* c) {
  switch (c->fase) {
    case CICLO_A_VERDE:
    case CICLO_AMBULANCIA:
      return CICLO_VERDE;
    case CICLO_A_AMARILLO:
    case CICLO_DESPEJE_A:
      return CICLO_AMARILLO;
    case CICLO_B_VERDE:
    case CICLO_B_AMARILLO:
    case CICLO_DESPEJE_B:
      return CICLO_ROJO;
  }
  return CICLO_ROJO;
}

inline CicloLuz ciclo_luz_b(const Ciclo* c) {
  switch (c->fase) {
    case CICLO_B_VERDE:
      return CICLO_VERDE;
    case CICLO_B_AMARILLO:
    case CICLO_DESPEJE_B:
      return CICLO_AMARILLO;
    case CICLO_A_VERDE:
    case CICLO_A_AMARILLO:
    case CICLO_AMBULANCIA:
    case CICLO_DESPEJE_A:
      return CICLO_ROJO;
  }
  return CICLO_ROJO;
}

inline bool ciclo_muestra_ambulancia(const Ciclo* c) {
  return c->fase == CICLO_AMBULANCIA
      || c->fase == CICLO_DESPEJE_B
      || c->ambulancia_pendiente;
}

inline void ciclo_entrar_ambulancia(Ciclo* c) {
  c->fase = CICLO_AMBULANCIA;
  c->restante_ms = 0;
  c->ambulancia_pendiente = false;
}

inline void ciclo_salir_ambulancia(Ciclo* c) {
  switch (c->origen) {
    case CICLO_ORIGEN_A_VERDE:
      c->fase = CICLO_A_VERDE;
      c->restante_ms = c->restante_guardado_ms;
      c->origen = CICLO_ORIGEN_NINGUNO;
      c->restante_guardado_ms = 0;
      break;
    case CICLO_ORIGEN_A_AMARILLO:
    case CICLO_ORIGEN_B_VERDE:
      c->fase = CICLO_DESPEJE_A;
      c->restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_ORIGEN_B_AMARILLO:
      c->fase = CICLO_A_VERDE;
      c->restante_ms = CICLO_VERDE_MS;
      c->origen = CICLO_ORIGEN_NINGUNO;
      c->restante_guardado_ms = 0;
      break;
    case CICLO_ORIGEN_NINGUNO:
      c->fase = CICLO_A_VERDE;
      c->restante_ms = CICLO_VERDE_MS;
      break;
  }
}

inline void ciclo_siguiente_normal(Ciclo* c) {
  switch (c->fase) {
    case CICLO_A_VERDE:
      c->fase = CICLO_A_AMARILLO;
      c->restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_A_AMARILLO:
      c->fase = CICLO_B_VERDE;
      c->restante_ms = CICLO_VERDE_MS;
      break;
    case CICLO_B_VERDE:
      c->fase = CICLO_B_AMARILLO;
      c->restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_B_AMARILLO:
      c->fase = CICLO_A_VERDE;
      c->restante_ms = CICLO_VERDE_MS;
      break;
    default:
      break;
  }
}

inline void ciclo_avanzar(Ciclo* c, uint32_t dt_ms, bool patron_confirmado, bool sirena_activa) {
  if (c->fase == CICLO_AMBULANCIA) {
    if (!sirena_activa) {
      ciclo_salir_ambulancia(c);
    }
    return;
  }

  if (c->fase == CICLO_DESPEJE_B) {
    if (!sirena_activa) {
      c->fase = CICLO_B_VERDE;
      c->restante_ms = c->restante_guardado_ms;
      c->origen = CICLO_ORIGEN_NINGUNO;
      c->restante_guardado_ms = 0;
      c->ambulancia_pendiente = false;
      return;
    }
    if (dt_ms >= c->restante_ms) {
      ciclo_entrar_ambulancia(c);
    } else {
      c->restante_ms -= dt_ms;
    }
    return;
  }

  if (c->fase == CICLO_DESPEJE_A) {
    if (patron_confirmado) {
      ciclo_entrar_ambulancia(c);
      return;
    }
    if (dt_ms >= c->restante_ms) {
      if (c->origen == CICLO_ORIGEN_B_VERDE) {
        c->fase = CICLO_B_VERDE;
        c->restante_ms = c->restante_guardado_ms;
      } else {
        c->fase = CICLO_B_VERDE;
        c->restante_ms = CICLO_VERDE_MS;
      }
      c->origen = CICLO_ORIGEN_NINGUNO;
      c->restante_guardado_ms = 0;
    } else {
      c->restante_ms -= dt_ms;
    }
    return;
  }

  if (c->ambulancia_pendiente) {
    if (dt_ms >= c->restante_ms) {
      ciclo_entrar_ambulancia(c);
    } else {
      c->restante_ms -= dt_ms;
    }
    return;
  }

  if (patron_confirmado) {
    switch (c->fase) {
      case CICLO_A_VERDE:
        c->origen = CICLO_ORIGEN_A_VERDE;
        c->restante_guardado_ms = c->restante_ms;
        ciclo_entrar_ambulancia(c);
        return;
      case CICLO_A_AMARILLO:
        c->origen = CICLO_ORIGEN_A_AMARILLO;
        c->restante_guardado_ms = 0;
        ciclo_entrar_ambulancia(c);
        return;
      case CICLO_B_VERDE:
        c->origen = CICLO_ORIGEN_B_VERDE;
        c->restante_guardado_ms = c->restante_ms;
        c->fase = CICLO_DESPEJE_B;
        c->restante_ms = CICLO_AMARILLO_MS;
        return;
      case CICLO_B_AMARILLO:
        c->origen = CICLO_ORIGEN_B_AMARILLO;
        c->restante_guardado_ms = 0;
        c->ambulancia_pendiente = true;
        return;
      default:
        break;
    }
  }

  if (dt_ms >= c->restante_ms) {
    ciclo_siguiente_normal(c);
  } else {
    c->restante_ms -= dt_ms;
  }
}

#endif
