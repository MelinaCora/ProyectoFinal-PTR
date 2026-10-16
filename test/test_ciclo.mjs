// Host runner mirroring src/ciclo.h when no system g++ is available.
const CICLO_VERDE_MS = 5000;
const CICLO_AMARILLO_MS = 2000;

const CICLO_ROJO = 0, CICLO_AMARILLO = 1, CICLO_VERDE = 2;
const CICLO_A_VERDE = 0, CICLO_A_AMARILLO = 1, CICLO_B_VERDE = 2, CICLO_B_AMARILLO = 3;
const CICLO_AMBULANCIA = 4, CICLO_DESPEJE_B = 5, CICLO_DESPEJE_A = 6;
const CICLO_ORIGEN_NINGUNO = 0, CICLO_ORIGEN_A_VERDE = 1, CICLO_ORIGEN_A_AMARILLO = 2;
const CICLO_ORIGEN_B_VERDE = 3, CICLO_ORIGEN_B_AMARILLO = 4;

function ciclo_init() {
  return {
    fase: CICLO_A_VERDE,
    restante_ms: CICLO_VERDE_MS,
    origen: CICLO_ORIGEN_NINGUNO,
    restante_guardado_ms: 0,
    ambulancia_pendiente: false,
  };
}

function ciclo_luz_a(c) {
  switch (c.fase) {
    case CICLO_A_VERDE:
    case CICLO_AMBULANCIA:
      return CICLO_VERDE;
    case CICLO_A_AMARILLO:
    case CICLO_DESPEJE_A:
      return CICLO_AMARILLO;
    default:
      return CICLO_ROJO;
  }
}

function ciclo_luz_b(c) {
  switch (c.fase) {
    case CICLO_B_VERDE:
      return CICLO_VERDE;
    case CICLO_B_AMARILLO:
    case CICLO_DESPEJE_B:
      return CICLO_AMARILLO;
    default:
      return CICLO_ROJO;
  }
}

function ciclo_muestra_ambulancia(c) {
  return c.fase === CICLO_AMBULANCIA || c.fase === CICLO_DESPEJE_B || c.ambulancia_pendiente;
}

function ciclo_entrar_ambulancia(c) {
  c.fase = CICLO_AMBULANCIA;
  c.restante_ms = 0;
  c.ambulancia_pendiente = false;
}

function ciclo_salir_ambulancia(c) {
  switch (c.origen) {
    case CICLO_ORIGEN_A_VERDE:
      c.fase = CICLO_A_VERDE;
      c.restante_ms = c.restante_guardado_ms;
      c.origen = CICLO_ORIGEN_NINGUNO;
      c.restante_guardado_ms = 0;
      break;
    case CICLO_ORIGEN_A_AMARILLO:
    case CICLO_ORIGEN_B_VERDE:
      c.fase = CICLO_DESPEJE_A;
      c.restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_ORIGEN_B_AMARILLO:
      c.fase = CICLO_A_VERDE;
      c.restante_ms = CICLO_VERDE_MS;
      c.origen = CICLO_ORIGEN_NINGUNO;
      c.restante_guardado_ms = 0;
      break;
    default:
      c.fase = CICLO_A_VERDE;
      c.restante_ms = CICLO_VERDE_MS;
      break;
  }
}

function ciclo_siguiente_normal(c) {
  switch (c.fase) {
    case CICLO_A_VERDE:
      c.fase = CICLO_A_AMARILLO;
      c.restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_A_AMARILLO:
      c.fase = CICLO_B_VERDE;
      c.restante_ms = CICLO_VERDE_MS;
      break;
    case CICLO_B_VERDE:
      c.fase = CICLO_B_AMARILLO;
      c.restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_B_AMARILLO:
      c.fase = CICLO_A_VERDE;
      c.restante_ms = CICLO_VERDE_MS;
      break;
  }
}

function ciclo_avanzar(c, dt_ms, patron_confirmado, sirena_activa) {
  if (c.fase === CICLO_AMBULANCIA) {
    if (!sirena_activa) ciclo_salir_ambulancia(c);
    return;
  }
  if (c.fase === CICLO_DESPEJE_B) {
    if (!sirena_activa) {
      c.fase = CICLO_B_VERDE;
      c.restante_ms = c.restante_guardado_ms;
      c.origen = CICLO_ORIGEN_NINGUNO;
      c.restante_guardado_ms = 0;
      c.ambulancia_pendiente = false;
      return;
    }
    if (dt_ms >= c.restante_ms) ciclo_entrar_ambulancia(c);
    else c.restante_ms -= dt_ms;
    return;
  }
  if (c.fase === CICLO_DESPEJE_A) {
    if (patron_confirmado) {
      ciclo_entrar_ambulancia(c);
      return;
    }
    if (dt_ms >= c.restante_ms) {
      if (c.origen === CICLO_ORIGEN_B_VERDE) {
        c.fase = CICLO_B_VERDE;
        c.restante_ms = c.restante_guardado_ms;
      } else {
        c.fase = CICLO_B_VERDE;
        c.restante_ms = CICLO_VERDE_MS;
      }
      c.origen = CICLO_ORIGEN_NINGUNO;
      c.restante_guardado_ms = 0;
    } else c.restante_ms -= dt_ms;
    return;
  }
  if (c.ambulancia_pendiente) {
    if (dt_ms >= c.restante_ms) ciclo_entrar_ambulancia(c);
    else c.restante_ms -= dt_ms;
    return;
  }
  if (patron_confirmado) {
    switch (c.fase) {
      case CICLO_A_VERDE:
        c.origen = CICLO_ORIGEN_A_VERDE;
        c.restante_guardado_ms = c.restante_ms;
        ciclo_entrar_ambulancia(c);
        return;
      case CICLO_A_AMARILLO:
        c.origen = CICLO_ORIGEN_A_AMARILLO;
        c.restante_guardado_ms = 0;
        ciclo_entrar_ambulancia(c);
        return;
      case CICLO_B_VERDE:
        c.origen = CICLO_ORIGEN_B_VERDE;
        c.restante_guardado_ms = c.restante_ms;
        c.fase = CICLO_DESPEJE_B;
        c.restante_ms = CICLO_AMARILLO_MS;
        return;
      case CICLO_B_AMARILLO:
        c.origen = CICLO_ORIGEN_B_AMARILLO;
        c.restante_guardado_ms = 0;
        c.ambulancia_pendiente = true;
        return;
    }
  }
  if (dt_ms >= c.restante_ms) ciclo_siguiente_normal(c);
  else c.restante_ms -= dt_ms;
}

let failed = 0;
function expect_true(name, cond) {
  if (!cond) { console.log(`FAIL: ${name}`); failed++; }
  else console.log(`PASS: ${name}`);
}
function expect_eq(name, got, want) {
  if (got !== want) { console.log(`FAIL: ${name} (got ${got} want ${want})`); failed++; }
  else console.log(`PASS: ${name}`);
}

{
  const c = ciclo_init();
  expect_eq("init A verde", c.fase, CICLO_A_VERDE);
  expect_eq("init luces A", ciclo_luz_a(c), CICLO_VERDE);
  expect_eq("init luces B", ciclo_luz_b(c), CICLO_ROJO);
  expect_eq("init 5s", c.restante_ms, CICLO_VERDE_MS);
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  expect_eq("tras 5s A amarillo", c.fase, CICLO_A_AMARILLO);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  expect_eq("tras A amarillo B verde", c.fase, CICLO_B_VERDE);
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  expect_eq("tras B verde B amarillo", c.fase, CICLO_B_AMARILLO);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  expect_eq("ciclo vuelve a A verde", c.fase, CICLO_A_VERDE);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, 2000, false, false);
  expect_eq("A verde resto 3s", c.restante_ms, 3000);
  ciclo_avanzar(c, 0, true, true);
  expect_eq("A verde -> ambulancia", c.fase, CICLO_AMBULANCIA);
  expect_true("LCD ambulancia", ciclo_muestra_ambulancia(c));
  ciclo_avanzar(c, 8000, false, true);
  expect_eq("resto A no consume", c.restante_guardado_ms, 3000);
  ciclo_avanzar(c, 10, false, false);
  expect_eq("fin -> retoma A verde", c.fase, CICLO_A_VERDE);
  expect_eq("retoma con 3s", c.restante_ms, 3000);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, 500, false, false);
  ciclo_avanzar(c, 0, true, true);
  expect_eq("A amarillo -> ambulancia", c.fase, CICLO_AMBULANCIA);
  ciclo_avanzar(c, 100, false, false);
  expect_eq("fin A amarillo -> despeje A", c.fase, CICLO_DESPEJE_A);
  expect_true("LCD normal despeje", !ciclo_muestra_ambulancia(c));
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  expect_eq("despues despeje B verde", c.fase, CICLO_B_VERDE);
  expect_eq("B verde completo", c.restante_ms, CICLO_VERDE_MS);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  ciclo_avanzar(c, 1500, false, false);
  ciclo_avanzar(c, 0, true, true);
  expect_eq("B verde -> despeje B", c.fase, CICLO_DESPEJE_B);
  expect_eq("congela resto B", c.restante_guardado_ms, 3500);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, true);
  expect_eq("despues despeje B -> ambulancia", c.fase, CICLO_AMBULANCIA);
  ciclo_avanzar(c, 50, false, false);
  expect_eq("fin B verde -> despeje A", c.fase, CICLO_DESPEJE_A);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  expect_eq("retoma B verde", c.fase, CICLO_B_VERDE);
  expect_eq("retoma resto 3.5s", c.restante_ms, 3500);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  ciclo_avanzar(c, 1000, false, false);
  ciclo_avanzar(c, 0, true, true);
  ciclo_avanzar(c, 500, false, false);
  expect_eq("sirena corta -> B verde", c.fase, CICLO_B_VERDE);
  expect_eq("restaura resto congelado", c.restante_ms, 4000);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, 800, false, false);
  ciclo_avanzar(c, 0, true, true);
  expect_eq("sigue B amarillo pendiente", c.fase, CICLO_B_AMARILLO);
  expect_true("LCD ambulancia pendiente", ciclo_muestra_ambulancia(c));
  ciclo_avanzar(c, 1200, false, true);
  expect_eq("amarillo listo -> ambulancia", c.fase, CICLO_AMBULANCIA);
  ciclo_avanzar(c, 10, false, false);
  expect_eq("fin -> A verde completo", c.fase, CICLO_A_VERDE);
  expect_eq("A verde 5s", c.restante_ms, CICLO_VERDE_MS);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  ciclo_avanzar(c, 2000, false, false);
  ciclo_avanzar(c, 0, true, true);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, true);
  ciclo_avanzar(c, 10, false, false);
  expect_eq("en despeje A", c.fase, CICLO_DESPEJE_A);
  expect_eq("B pendiente 3s", c.restante_guardado_ms, 3000);
  ciclo_avanzar(c, 400, true, true);
  expect_eq("sirena otra vez -> ambulancia", c.fase, CICLO_AMBULANCIA);
  expect_eq("B sigue pendiente 3s", c.restante_guardado_ms, 3000);
  ciclo_avanzar(c, 10, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  expect_eq("retoma B con mismo resto", c.fase, CICLO_B_VERDE);
  expect_eq("resto B intacto", c.restante_ms, 3000);
}

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("all tests passed");
