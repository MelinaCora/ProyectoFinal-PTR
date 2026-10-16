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
}

static void avanzar(Ciclo* c, uint32_t dt, bool patron, bool sirena) {
  ciclo_avanzar(c, dt, patron, sirena);
}

int main() {
  // --- Ciclo normal completo ---
  {
    Ciclo c;
    ciclo_init(&c);
    expect_fase("init A verde", c, CICLO_A_VERDE);
    expect_luces("init luces", c, CICLO_VERDE, CICLO_ROJO);
    expect_eq_u32("init 5s", c.restante_ms, CICLO_VERDE_MS);

    avanzar(&c, CICLO_VERDE_MS, false, false);
    expect_fase("tras 5s A amarillo", c, CICLO_A_AMARILLO);
    expect_luces("A amarillo luces", c, CICLO_AMARILLO, CICLO_ROJO);

    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    expect_fase("tras A amarillo B verde", c, CICLO_B_VERDE);
    expect_luces("B verde luces", c, CICLO_ROJO, CICLO_VERDE);

    avanzar(&c, CICLO_VERDE_MS, false, false);
    expect_fase("tras B verde B amarillo", c, CICLO_B_AMARILLO);
    expect_luces("B amarillo luces", c, CICLO_ROJO, CICLO_AMARILLO);

    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    expect_fase("ciclo vuelve a A verde", c, CICLO_A_VERDE);
    expect_eq_u32("nuevo verde 5s", c.restante_ms, CICLO_VERDE_MS);
  }

  // --- A verde: conserva resto ---
  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, 2000, false, false);
    expect_eq_u32("A verde resto 3s", c.restante_ms, 3000);
    avanzar(&c, 0, true, true);
    expect_fase("A verde -> ambulancia", c, CICLO_AMBULANCIA);
    expect_luces("ambulancia luces", c, CICLO_VERDE, CICLO_ROJO);
    expect_true("LCD ambulancia en prioridad", ciclo_muestra_ambulancia(&c));

    avanzar(&c, 8000, false, true);
    expect_fase("sigue ambulancia con sirena", c, CICLO_AMBULANCIA);
    expect_eq_u32("resto A no consume ambulancia", c.restante_guardado_ms, 3000);

    avanzar(&c, 10, false, false);
    expect_fase("fin -> retoma A verde", c, CICLO_A_VERDE);
    expect_eq_u32("retoma con 3s", c.restante_ms, 3000);
    expect_true("LCD normal al retomar", !ciclo_muestra_ambulancia(&c));
  }

  // --- A amarillo: despeje A completo y luego B verde ---
  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    avanzar(&c, 500, false, false);
    expect_fase("en A amarillo", c, CICLO_A_AMARILLO);
    avanzar(&c, 0, true, true);
    expect_fase("A amarillo -> ambulancia", c, CICLO_AMBULANCIA);
    expect_luces("abre A verde", c, CICLO_VERDE, CICLO_ROJO);

    avanzar(&c, 100, false, false);
    expect_fase("fin A amarillo -> despeje A", c, CICLO_DESPEJE_A);
    expect_luces("despeje A luces", c, CICLO_AMARILLO, CICLO_ROJO);
    expect_true("LCD normal en despeje salida", !ciclo_muestra_ambulancia(&c));
    expect_eq_u32("despeje A 2s", c.restante_ms, CICLO_AMARILLO_MS);

    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    expect_fase("despues despeje B verde", c, CICLO_B_VERDE);
    expect_eq_u32("B verde completo", c.restante_ms, CICLO_VERDE_MS);
  }

  // --- B verde: despeje entrada, ambulancia, despeje salida, retoma resto ---
  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    avanzar(&c, 1500, false, false);
    expect_fase("en B verde", c, CICLO_B_VERDE);
    expect_eq_u32("B verde resto 3.5s", c.restante_ms, 3500);

    avanzar(&c, 0, true, true);
    expect_fase("B verde -> despeje B", c, CICLO_DESPEJE_B);
    expect_luces("despeje B luces", c, CICLO_ROJO, CICLO_AMARILLO);
    expect_true("LCD ambulancia en despeje entrada", ciclo_muestra_ambulancia(&c));
    expect_eq_u32("despeje B 2s", c.restante_ms, CICLO_AMARILLO_MS);
    expect_eq_u32("congela resto B", c.restante_guardado_ms, 3500);

    avanzar(&c, CICLO_AMARILLO_MS, false, true);
    expect_fase("despues despeje B -> ambulancia", c, CICLO_AMBULANCIA);
    expect_luces("ambulancia tras despeje", c, CICLO_VERDE, CICLO_ROJO);

    avanzar(&c, 50, false, false);
    expect_fase("fin B verde -> despeje A", c, CICLO_DESPEJE_A);
    expect_luces("despeje salida A", c, CICLO_AMARILLO, CICLO_ROJO);

    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    expect_fase("retoma B verde", c, CICLO_B_VERDE);
    expect_eq_u32("retoma resto 3.5s", c.restante_ms, 3500);
    expect_luces("B verde luces retoma", c, CICLO_ROJO, CICLO_VERDE);
  }

  // --- Sirena corta durante despeje B ---
  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    avanzar(&c, 1000, false, false);
    avanzar(&c, 0, true, true);
    expect_fase("despeje B activo", c, CICLO_DESPEJE_B);
    avanzar(&c, 500, false, false);
    expect_fase("sirena corta -> B verde", c, CICLO_B_VERDE);
    expect_eq_u32("restaura resto congelado", c.restante_ms, 4000);
    expect_luces("B verde otra vez", c, CICLO_ROJO, CICLO_VERDE);
    expect_true("LCD normal al cancelar", !ciclo_muestra_ambulancia(&c));
  }

  // --- B amarillo: termina amarillo, ambulancia, luego A verde 5s ---
  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    avanzar(&c, 800, false, false);
    expect_fase("en B amarillo", c, CICLO_B_AMARILLO);
    expect_eq_u32("B amarillo resto 1.2s", c.restante_ms, 1200);

    avanzar(&c, 0, true, true);
    expect_fase("sigue B amarillo pendiente", c, CICLO_B_AMARILLO);
    expect_true("LCD ambulancia pendiente", ciclo_muestra_ambulancia(&c));
    expect_luces("sigue B amarillo luces", c, CICLO_ROJO, CICLO_AMARILLO);

    avanzar(&c, 1200, false, true);
    expect_fase("amarillo listo -> ambulancia", c, CICLO_AMBULANCIA);
    expect_luces("ambulancia desde B amarillo", c, CICLO_VERDE, CICLO_ROJO);

    avanzar(&c, 10, false, false);
    expect_fase("fin -> A verde completo", c, CICLO_A_VERDE);
    expect_eq_u32("A verde 5s", c.restante_ms, CICLO_VERDE_MS);
  }

  // --- Reentrada durante despeje A (venia de B verde) ---
  {
    Ciclo c;
    ciclo_init(&c);
    avanzar(&c, CICLO_VERDE_MS, false, false);
    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    avanzar(&c, 2000, false, false);
    avanzar(&c, 0, true, true);
    avanzar(&c, CICLO_AMARILLO_MS, false, true);
    expect_fase("en ambulancia", c, CICLO_AMBULANCIA);
    avanzar(&c, 10, false, false);
    expect_fase("en despeje A", c, CICLO_DESPEJE_A);
    expect_eq_u32("B pendiente 3s", c.restante_guardado_ms, 3000);

    avanzar(&c, 400, true, true);
    expect_fase("sirena otra vez -> ambulancia", c, CICLO_AMBULANCIA);
    expect_eq_u32("B sigue pendiente 3s", c.restante_guardado_ms, 3000);

    avanzar(&c, 10, false, false);
    expect_fase("otra vez despeje A", c, CICLO_DESPEJE_A);
    avanzar(&c, CICLO_AMARILLO_MS, false, false);
    expect_fase("retoma B con mismo resto", c, CICLO_B_VERDE);
    expect_eq_u32("resto B intacto", c.restante_ms, 3000);
  }

  if (g_failed) {
    std::printf("%d test(s) failed\n", g_failed);
    return 1;
  }
  std::printf("all tests passed\n");
  return 0;
}
