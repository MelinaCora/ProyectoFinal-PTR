#include <cstdint>
#include <cstdio>

#include "../src/ciclo.h"

static int g_failed = 0;

static void expect_true(const char* name, bool cond) {
  if (!cond) {
    std::printf("FAIL: %s\n", name);
    g_failed++;
  } else {
    std::printf("PASS: %s\n", name);
  }
}

static void expect_eq_u32(const char* name, uint32_t got, uint32_t want) {
  if (got != want) {
    std::printf("FAIL: %s (got %lu want %lu)\n", name,
                (unsigned long)got, (unsigned long)want);
    g_failed++;
  } else {
    std::printf("PASS: %s\n", name);
  }
}

static void expect_eq_u8(const char* name, uint8_t got, uint8_t want) {
  if (got != want) {
    std::printf("FAIL: %s (got %u want %u)\n", name,
                (unsigned int)got, (unsigned int)want);
    g_failed++;
  } else {
    std::printf("PASS: %s\n", name);
  }
}

static void expect_fase(const char* name, const Ciclo& c, CicloFase want) {
  if (c.fase != want) {
    std::printf("FAIL: %s (fase %d want %d)\n", name, (int)c.fase, (int)want);
    g_failed++;
  } else {
    std::printf("PASS: %s\n", name);
  }
}

static void expect_luces(const char* name, const Ciclo& c, CicloLuz a, CicloLuz b) {
  const CicloLuz ga = ciclo_luz_a(&c);
  const CicloLuz gb = ciclo_luz_b(&c);
  if (ga != a || gb != b) {
    std::printf("FAIL: %s (A=%d B=%d want A=%d B=%d)\n", name,
                (int)ga, (int)gb, (int)a, (int)b);
    g_failed++;
  } else {
    std::printf("PASS: %s\n", name);
  }
  expect_true("nunca hay dos verdes", !(ga == CICLO_VERDE && gb == CICLO_VERDE));
}

static uint8_t avanzar(Ciclo* c, uint32_t dt, bool patron, bool sirena) {
  return ciclo_avanzar(c, dt, patron, sirena);
}

static void avanzar_a_b_verde(Ciclo* c) {
  avanzar(c, CICLO_VERDE_MS, false, false);
  avanzar(c, CICLO_AMARILLO_MS, false, false);
  avanzar(c, CICLO_TODO_ROJO_MS, false, false);
}

int main() {
  {
    bool sin_verdes_conflictivos = true;
    for (int fase = CICLO_A_VERDE; fase <= CICLO_FALLO_SEGURO; fase++) {
      Ciclo c;
      ciclo_init(&c);
      c.fase = (CicloFase)fase;
      const CicloLuz a = ciclo_luz_a(&c);
      const CicloLuz b = ciclo_luz_b(&c);
      if (a == CICLO_VERDE && b == CICLO_VERDE) sin_verdes_conflictivos = false;
    }
    expect_true("ninguna fase permite dos verdes", sin_verdes_conflictivos);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    expect_fase("inicia A verde", c, CICLO_A_VERDE);
    expect_luces("inicial A verde/B rojo", c, CICLO_VERDE, CICLO_ROJO);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    expect_fase("A verde -> A amarillo", c, CICLO_A_AMARILLO);
    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    expect_fase("A amarillo -> todo rojo", c, CICLO_TODO_ROJO);
    expect_luces("todo rojo hacia B", c, CICLO_ROJO, CICLO_ROJO);
    expect_eq_u32("todo rojo dura 1s", c.restante_ms, CICLO_TODO_ROJO_MS);
    avanzar(&c, CICLO_TODO_ROJO_MS - 1, false, false);
    expect_fase("sigue todo rojo antes de 1s", c, CICLO_TODO_ROJO);
    avanzar(&c, 1, false, false);
    expect_fase("todo rojo -> B verde", c, CICLO_B_VERDE);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    expect_fase("B verde -> B amarillo", c, CICLO_B_AMARILLO);
    avanzar(&c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
    expect_fase("B amarillo y despeje -> A verde", c, CICLO_A_VERDE);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, 2000, false, false);
    const uint8_t eventos = avanzar(&c, 0, true, true);
    expect_fase("emergencia en A verde: prioridad inmediata", c, CICLO_PRIORIDAD_A);
    expect_luces("prioridad A mantiene A verde", c, CICLO_VERDE, CICLO_ROJO);
    expect_eq_u32("conserva resto de A", c.restante_guardado_ms, 3000);
    expect_eq_u8("emite solicitud y prioridad", eventos,
                 CICLO_EVENTO_SOLICITUD | CICLO_EVENTO_PRIORIDAD_ACTIVA);
    expect_eq_u8("deteccion repetida no duplica solicitud",
                 avanzar(&c, 100, true, true), CICLO_EVENTO_NINGUNO);
    expect_fase("repetida mantiene prioridad", c, CICLO_PRIORIDAD_A);
    expect_eq_u8("sirena activa mantiene prioridad",
                 avanzar(&c, 10000, false, true), CICLO_EVENTO_NINGUNO);
    const uint8_t fin = avanzar(&c, 0, false, false);
    expect_fase("fin de emergencia retoma A verde", c, CICLO_A_VERDE);
    expect_eq_u32("retoma resto A", c.restante_ms, 3000);
    expect_eq_u8("emite fin y recuperacion", fin,
                 CICLO_EVENTO_EMERGENCIA_FINALIZADA |
                 CICLO_EVENTO_RECUPERACION_COMPLETA);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS + 500, false, false);
    const uint8_t solicitud = avanzar(&c, 0, true, true);
    expect_fase("emergencia en A amarillo conserva amarillo", c, CICLO_A_AMARILLO);
    expect_true("señaliza solicitud pendiente", (solicitud & CICLO_EVENTO_SOLICITUD) != 0);
    avanzar(&c, c.restante_ms + CICLO_TODO_ROJO_MS, false, true);
    expect_fase("A amarillo y todo rojo -> prioridad", c, CICLO_PRIORIDAD_A);
    expect_luces("prioridad tras despejes", c, CICLO_VERDE, CICLO_ROJO);
    avanzar(&c, 0, false, false);
    expect_fase("salida de prioridad en recuperacion", c, CICLO_RECUPERACION_A_AMARILLO);
    expect_luces("recuperacion despeja A", c, CICLO_AMARILLO, CICLO_ROJO);
    avanzar(&c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
    expect_fase("recuperacion vuelve a B", c, CICLO_B_VERDE);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar_a_b_verde(&c);
    avanzar(&c, 1500, false, false);
    avanzar(&c, 0, true, true);
    expect_fase("emergencia en B verde inicia B amarillo", c, CICLO_B_AMARILLO);
    expect_eq_u32("guarda restante de B", c.restante_guardado_ms, 3500);
    expect_luces("despeje de B", c, CICLO_ROJO, CICLO_AMARILLO);
    expect_eq_u8("deteccion repetida no reinicia despeje",
                 avanzar(&c, 500, true, true), CICLO_EVENTO_NINGUNO);
    expect_eq_u32("el amarillo sigue corriendo", c.restante_ms,
                  CICLO_AMARILLO_MS - 500);
    avanzar(&c, c.restante_ms + CICLO_TODO_ROJO_MS, false, false);
    expect_fase("amarillo B y todo rojo -> prioridad", c, CICLO_PRIORIDAD_A);
    expect_luces("prioridad solo después del despeje", c, CICLO_VERDE, CICLO_ROJO);
    avanzar(&c, 0, false, false);
    expect_fase("fin de prioridad despeja A", c, CICLO_RECUPERACION_A_AMARILLO);
    avanzar(&c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
    expect_fase("recupera B", c, CICLO_B_VERDE);
    expect_eq_u32("recupera resto congelado de B", c.restante_ms, 3500);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar_a_b_verde(&c);
    avanzar(&c, CICLO_VERDE_MS + 800, false, false);
    avanzar(&c, 0, true, true);
    expect_fase("emergencia en B amarillo conserva fase", c, CICLO_B_AMARILLO);
    expect_eq_u32("conserva tiempo de amarillo B", c.restante_ms, 1200);
    avanzar(&c, CICLO_AMARILLO_MS - 800 + CICLO_TODO_ROJO_MS, false, true);
    expect_fase("B amarillo y todo rojo -> prioridad", c, CICLO_PRIORIDAD_A);
    avanzar(&c, 0, false, false);
    expect_fase("fin desde B amarillo deja A verde normal", c, CICLO_A_VERDE);
    expect_eq_u32("nuevo verde A completo", c.restante_ms, CICLO_VERDE_MS);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS + CICLO_AMARILLO_MS, false, false);
    expect_fase("espera en todo rojo normal", c, CICLO_TODO_ROJO);
    const uint8_t solicitud = avanzar(&c, 0, true, true);
    expect_true("emergencia durante todo rojo queda pendiente",
                (solicitud & CICLO_EVENTO_SOLICITUD) != 0);
    expect_luces("todo rojo no se interrumpe", c, CICLO_ROJO, CICLO_ROJO);
    expect_eq_u32("no reinicia el intervalo de todo rojo", c.restante_ms,
                  CICLO_TODO_ROJO_MS);
    avanzar(&c, CICLO_TODO_ROJO_MS, false, true);
    expect_fase("todo rojo pendiente -> prioridad", c, CICLO_PRIORIDAD_A);
    expect_luces("prioridad solo tras todo rojo", c, CICLO_VERDE, CICLO_ROJO);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar_a_b_verde(&c);
    avanzar(&c, 2000, false, false);
    avanzar(&c, 0, true, true);
    avanzar(&c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, true);
    avanzar(&c, 0, false, false);
    expect_fase("primera emergencia inicia recuperacion", c,
                CICLO_RECUPERACION_A_AMARILLO);
    avanzar(&c, 500, false, false);
    avanzar(&c, 0, true, true);
    expect_fase("segunda solicitud mantiene amarillo de recuperacion", c,
                CICLO_RECUPERACION_A_AMARILLO);
    expect_eq_u32("segunda solicitud no reinicia amarillo", c.restante_ms, 1500);
    avanzar(&c, c.restante_ms + CICLO_TODO_ROJO_MS, false, true);
    expect_fase("segunda solicitud reentra tras todo rojo", c, CICLO_PRIORIDAD_A);
    avanzar(&c, 0, false, false);
    avanzar(&c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
    expect_fase("recupera B con la fase original", c, CICLO_B_VERDE);
    expect_eq_u32("conserva resto B tras reentrada", c.restante_ms, 3000);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS + CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS
                 + CICLO_VERDE_MS + CICLO_AMARILLO_MS, false, false);
    expect_fase("el sobretiempo procesa varias fases", c, CICLO_TODO_ROJO);
    expect_eq_u32("el intervalo siguiente conserva su duracion",
                  c.restante_ms, CICLO_TODO_ROJO_MS);
    avanzar(&c, CICLO_TODO_ROJO_MS, false, false);
    expect_fase("el sobretiempo no omite todo rojo", c, CICLO_A_VERDE);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    const uint32_t antes = UINT32_MAX - 3U;
    const uint32_t ahora = 2U;
    const uint32_t dt = (uint32_t)(ahora - antes);
    expect_eq_u32("delta de millis cruza el desbordamiento", dt, 6);
    avanzar(&c, dt, false, false);
    expect_eq_u32("el tiempo restante cruza el desbordamiento", c.restante_ms,
                  CICLO_VERDE_MS - 6);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    c.fase = (CicloFase)99;
    expect_luces("fase invalida produce rojo inmediato", c, CICLO_ROJO, CICLO_ROJO);
    expect_eq_u8("estado invalido reportado",
                 avanzar(&c, 0, false, false), CICLO_EVENTO_ESTADO_INVALIDO);
    expect_fase("estado invalido queda enclavado seguro", c, CICLO_FALLO_SEGURO);
    expect_luces("fallo seguro mantiene ambos rojos", c, CICLO_ROJO, CICLO_ROJO);
    avanzar(&c, UINT32_MAX, true, true);
    expect_fase("fallo seguro no se auto-habilita", c, CICLO_FALLO_SEGURO);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    expect_eq_u8("sobretiempo extremo va a fallo seguro",
                 avanzar(&c, UINT32_MAX, false, false),
                 CICLO_EVENTO_ESTADO_INVALIDO);
    expect_luces("sobretiempo extremo deja ambos rojos", c, CICLO_ROJO, CICLO_ROJO);
  }

  {
    Ciclo c;
    ciclo_init(&c);
    c.fase = CICLO_TODO_ROJO;
    c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
    expect_eq_u8("destino invalido enclava fallo seguro",
                 avanzar(&c, 0, false, false), CICLO_EVENTO_ESTADO_INVALIDO);
    expect_fase("destino invalido permanece seguro", c, CICLO_FALLO_SEGURO);
    expect_luces("destino invalido conserva ambos rojos", c, CICLO_ROJO, CICLO_ROJO);
  }

  if (g_failed) {
    std::printf("%d test(s) failed\n", g_failed);
    return 1;
  }
  std::printf("all tests passed\n");
  return 0;
}
