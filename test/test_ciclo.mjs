const CICLO_VERDE_MS = 5000;
const CICLO_AMARILLO_MS = 2000;
const CICLO_TODO_ROJO_MS = 1000;
const CICLO_MAX_TRANSICIONES_POR_TICK = 16;

const CICLO_ROJO = 0, CICLO_AMARILLO = 1, CICLO_VERDE = 2;
const CICLO_A_VERDE = 0, CICLO_A_AMARILLO = 1, CICLO_TODO_ROJO = 2;
const CICLO_B_VERDE = 3, CICLO_B_AMARILLO = 4, CICLO_PRIORIDAD_A = 5;
const CICLO_RECUPERACION_A_AMARILLO = 6, CICLO_FALLO_SEGURO = 7;
const CICLO_DESTINO_NINGUNO = 0, CICLO_DESTINO_A_VERDE = 1;
const CICLO_DESTINO_B_VERDE = 2, CICLO_DESTINO_PRIORIDAD_A = 3;
const CICLO_ORIGEN_NINGUNO = 0, CICLO_ORIGEN_A_VERDE = 1;
const CICLO_ORIGEN_A_AMARILLO = 2, CICLO_ORIGEN_B_VERDE = 3;
const CICLO_ORIGEN_B_AMARILLO = 4;
const CICLO_EVENTO_NINGUNO = 0, CICLO_EVENTO_SOLICITUD = 1;
const CICLO_EVENTO_PRIORIDAD_ACTIVA = 2, CICLO_EVENTO_EMERGENCIA_FINALIZADA = 4;
const CICLO_EVENTO_RECUPERACION_COMPLETA = 8, CICLO_EVENTO_ESTADO_INVALIDO = 16;

function ciclo_init() {
  return {
    fase: CICLO_A_VERDE,
    destino_todo_rojo: CICLO_DESTINO_NINGUNO,
    restante_ms: CICLO_VERDE_MS,
    origen: CICLO_ORIGEN_NINGUNO,
    restante_guardado_ms: 0,
    ambulancia_pendiente: false,
    emergencia_en_curso: false,
  };
}

function ciclo_fase_valida(fase) {
  return fase >= CICLO_A_VERDE && fase <= CICLO_FALLO_SEGURO;
}

function ciclo_destino_valido(destino) {
  return destino >= CICLO_DESTINO_NINGUNO && destino <= CICLO_DESTINO_PRIORIDAD_A;
}

function ciclo_origen_valido(origen) {
  return origen >= CICLO_ORIGEN_NINGUNO && origen <= CICLO_ORIGEN_B_AMARILLO;
}

function ciclo_estado_valido(c) {
  if (!c || !ciclo_fase_valida(c.fase) || !ciclo_destino_valido(c.destino_todo_rojo)
      || !ciclo_origen_valido(c.origen)) return false;
  return c.fase !== CICLO_TODO_ROJO
      || (c.destino_todo_rojo >= CICLO_DESTINO_A_VERDE
          && c.destino_todo_rojo <= CICLO_DESTINO_PRIORIDAD_A);
}

function ciclo_luz_a(c) {
  if (!c || !ciclo_fase_valida(c.fase)) return CICLO_ROJO;
  switch (c.fase) {
    case CICLO_A_VERDE:
    case CICLO_PRIORIDAD_A: return CICLO_VERDE;
    case CICLO_A_AMARILLO:
    case CICLO_RECUPERACION_A_AMARILLO: return CICLO_AMARILLO;
    default: return CICLO_ROJO;
  }
}

function ciclo_luz_b(c) {
  if (!c || !ciclo_fase_valida(c.fase)) return CICLO_ROJO;
  switch (c.fase) {
    case CICLO_B_VERDE: return CICLO_VERDE;
    case CICLO_B_AMARILLO: return CICLO_AMARILLO;
    default: return CICLO_ROJO;
  }
}

function ciclo_muestra_ambulancia(c) {
  return !!c && (c.fase === CICLO_PRIORIDAD_A || c.ambulancia_pendiente);
}

function ciclo_iniciar_todo_rojo(c, destino) {
  c.fase = CICLO_TODO_ROJO;
  c.destino_todo_rojo = destino;
  c.restante_ms = CICLO_TODO_ROJO_MS;
}

function ciclo_limpiar_origen(c) {
  c.origen = CICLO_ORIGEN_NINGUNO;
  c.restante_guardado_ms = 0;
}

function ciclo_entrar_prioridad(c) {
  c.fase = CICLO_PRIORIDAD_A;
  c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  c.restante_ms = 0;
  c.ambulancia_pendiente = false;
}

function ciclo_solicitar_prioridad(c) {
  if (c.emergencia_en_curso || c.fase === CICLO_PRIORIDAD_A) return CICLO_EVENTO_NINGUNO;
  c.ambulancia_pendiente = true;
  c.emergencia_en_curso = true;
  let eventos = CICLO_EVENTO_SOLICITUD;
  switch (c.fase) {
    case CICLO_A_VERDE:
      c.origen = CICLO_ORIGEN_A_VERDE;
      c.restante_guardado_ms = c.restante_ms;
      ciclo_entrar_prioridad(c);
      eventos |= CICLO_EVENTO_PRIORIDAD_ACTIVA;
      break;
    case CICLO_A_AMARILLO:
      if (c.origen === CICLO_ORIGEN_NINGUNO) {
        c.origen = CICLO_ORIGEN_A_AMARILLO;
        c.restante_guardado_ms = 0;
      }
      break;
    case CICLO_B_VERDE:
      c.origen = CICLO_ORIGEN_B_VERDE;
      c.restante_guardado_ms = c.restante_ms;
      c.fase = CICLO_B_AMARILLO;
      c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
      c.restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_B_AMARILLO:
      if (c.origen === CICLO_ORIGEN_NINGUNO) {
        c.origen = CICLO_ORIGEN_B_AMARILLO;
        c.restante_guardado_ms = 0;
      }
      break;
    case CICLO_TODO_ROJO:
      if (c.origen === CICLO_ORIGEN_NINGUNO) {
        c.origen = c.destino_todo_rojo === CICLO_DESTINO_B_VERDE
          ? CICLO_ORIGEN_A_AMARILLO : CICLO_ORIGEN_B_AMARILLO;
      }
      c.destino_todo_rojo = CICLO_DESTINO_PRIORIDAD_A;
      break;
    case CICLO_RECUPERACION_A_AMARILLO:
      break;
    case CICLO_PRIORIDAD_A:
    case CICLO_FALLO_SEGURO:
      c.ambulancia_pendiente = false;
      c.emergencia_en_curso = false;
      return CICLO_EVENTO_NINGUNO;
  }
  return eventos;
}

function ciclo_finalizar_prioridad(c) {
  c.emergencia_en_curso = false;
  c.ambulancia_pendiente = false;
  let eventos = CICLO_EVENTO_EMERGENCIA_FINALIZADA;
  switch (c.origen) {
    case CICLO_ORIGEN_A_VERDE:
      c.fase = CICLO_A_VERDE;
      c.restante_ms = c.restante_guardado_ms;
      ciclo_limpiar_origen(c);
      eventos |= CICLO_EVENTO_RECUPERACION_COMPLETA;
      break;
    case CICLO_ORIGEN_B_AMARILLO:
      c.fase = CICLO_A_VERDE;
      c.restante_ms = CICLO_VERDE_MS;
      ciclo_limpiar_origen(c);
      eventos |= CICLO_EVENTO_RECUPERACION_COMPLETA;
      break;
    case CICLO_ORIGEN_A_AMARILLO:
    case CICLO_ORIGEN_B_VERDE:
      c.fase = CICLO_RECUPERACION_A_AMARILLO;
      c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
      c.restante_ms = CICLO_AMARILLO_MS;
      break;
    case CICLO_ORIGEN_NINGUNO:
      ciclo_iniciar_todo_rojo(c, CICLO_DESTINO_A_VERDE);
      break;
  }
  return eventos;
}

function ciclo_resolver_todo_rojo(c) {
  const destino = c.destino_todo_rojo;
  c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  if (destino === CICLO_DESTINO_PRIORIDAD_A) {
    ciclo_entrar_prioridad(c);
    return CICLO_EVENTO_PRIORIDAD_ACTIVA;
  }
  if (destino === CICLO_DESTINO_A_VERDE) {
    c.fase = CICLO_A_VERDE;
    c.restante_ms = CICLO_VERDE_MS;
  } else if (destino === CICLO_DESTINO_B_VERDE) {
    c.fase = CICLO_B_VERDE;
    c.restante_ms = c.origen === CICLO_ORIGEN_B_VERDE
      ? c.restante_guardado_ms : CICLO_VERDE_MS;
  } else {
    c.fase = CICLO_TODO_ROJO;
    c.destino_todo_rojo = CICLO_DESTINO_A_VERDE;
    c.restante_ms = CICLO_TODO_ROJO_MS;
    return CICLO_EVENTO_ESTADO_INVALIDO;
  }
  if (c.origen !== CICLO_ORIGEN_NINGUNO) {
    ciclo_limpiar_origen(c);
    return CICLO_EVENTO_RECUPERACION_COMPLETA;
  }
  return CICLO_EVENTO_NINGUNO;
}

function ciclo_fallar_seguro(c) {
  c.fase = CICLO_FALLO_SEGURO;
  c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  c.restante_ms = 0;
  c.origen = CICLO_ORIGEN_NINGUNO;
  c.restante_guardado_ms = 0;
  c.ambulancia_pendiente = false;
  c.emergencia_en_curso = false;
  return CICLO_EVENTO_ESTADO_INVALIDO;
}

function ciclo_avanzar(c, dt, patron, sirena) {
  if (!c) return CICLO_EVENTO_ESTADO_INVALIDO;
  if (c.fase === CICLO_FALLO_SEGURO) return CICLO_EVENTO_NINGUNO;
  if (!ciclo_estado_valido(c)) return ciclo_fallar_seguro(c);
  let eventos = CICLO_EVENTO_NINGUNO;
  if (c.fase === CICLO_PRIORIDAD_A && !sirena) {
    eventos |= ciclo_finalizar_prioridad(c);
  } else {
    let transiciones = 0;
    while (transiciones < CICLO_MAX_TRANSICIONES_POR_TICK) {
      if (c.fase === CICLO_PRIORIDAD_A) break;
      if (dt < c.restante_ms) {
        c.restante_ms -= dt;
        dt = 0;
        break;
      }
      dt -= c.restante_ms;
      c.restante_ms = 0;
      transiciones++;
      switch (c.fase) {
        case CICLO_A_VERDE:
          c.fase = CICLO_A_AMARILLO;
          c.restante_ms = CICLO_AMARILLO_MS;
          break;
        case CICLO_A_AMARILLO:
          ciclo_iniciar_todo_rojo(c, c.ambulancia_pendiente
            ? CICLO_DESTINO_PRIORIDAD_A : CICLO_DESTINO_B_VERDE);
          break;
        case CICLO_TODO_ROJO:
          eventos |= ciclo_resolver_todo_rojo(c);
          break;
        case CICLO_B_VERDE:
          c.fase = CICLO_B_AMARILLO;
          c.restante_ms = CICLO_AMARILLO_MS;
          break;
        case CICLO_B_AMARILLO:
          ciclo_iniciar_todo_rojo(c, c.ambulancia_pendiente
            ? CICLO_DESTINO_PRIORIDAD_A : CICLO_DESTINO_A_VERDE);
          break;
        case CICLO_PRIORIDAD_A:
          break;
        case CICLO_RECUPERACION_A_AMARILLO:
          ciclo_iniciar_todo_rojo(c, c.ambulancia_pendiente
            ? CICLO_DESTINO_PRIORIDAD_A : CICLO_DESTINO_B_VERDE);
          break;
        case CICLO_FALLO_SEGURO:
          break;
      }
      if (c.fase === CICLO_PRIORIDAD_A) break;
      if (dt === 0 && c.restante_ms !== 0) break;
    }
    if (dt > 0 && c.fase !== CICLO_PRIORIDAD_A) return eventos | ciclo_fallar_seguro(c);
  }
  if (!ciclo_estado_valido(c)) return eventos | ciclo_fallar_seguro(c);
  if (patron) eventos |= ciclo_solicitar_prioridad(c);
  return eventos;
}

let failed = 0;
function expectTrue(name, cond) {
  if (!cond) { console.log(`FAIL: ${name}`); failed++; }
  else console.log(`PASS: ${name}`);
}
function expectEq(name, got, want) {
  if (got !== want) { console.log(`FAIL: ${name} (got ${got} want ${want})`); failed++; }
  else console.log(`PASS: ${name}`);
}
function expectLights(name, c, a, b) {
  expectEq(name, `${ciclo_luz_a(c)},${ciclo_luz_b(c)}`, `${a},${b}`);
  expectTrue("nunca hay dos verdes", !(ciclo_luz_a(c) === CICLO_VERDE
    && ciclo_luz_b(c) === CICLO_VERDE));
}
function advanceToBGreen(c) {
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  ciclo_avanzar(c, CICLO_TODO_ROJO_MS, false, false);
}

{
  let noConflictingGreens = true;
  for (let fase = CICLO_A_VERDE; fase <= CICLO_FALLO_SEGURO; fase++) {
    const c = ciclo_init();
    c.fase = fase;
    if (ciclo_luz_a(c) === CICLO_VERDE && ciclo_luz_b(c) === CICLO_VERDE) {
      noConflictingGreens = false;
    }
  }
  expectTrue("ninguna fase permite dos verdes", noConflictingGreens);
}

{
  const c = ciclo_init();
  expectEq("inicia A verde", c.fase, CICLO_A_VERDE);
  expectLights("A verde/B rojo", c, CICLO_VERDE, CICLO_ROJO);
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  expectEq("A verde -> A amarillo", c.fase, CICLO_A_AMARILLO);
  ciclo_avanzar(c, CICLO_AMARILLO_MS, false, false);
  expectEq("A amarillo -> todo rojo", c.fase, CICLO_TODO_ROJO);
  expectLights("todo rojo hacia B", c, CICLO_ROJO, CICLO_ROJO);
  expectEq("todo rojo de 1 segundo", c.restante_ms, CICLO_TODO_ROJO_MS);
  ciclo_avanzar(c, CICLO_TODO_ROJO_MS - 1, false, false);
  expectEq("todo rojo antes del segundo", c.fase, CICLO_TODO_ROJO);
  ciclo_avanzar(c, 1, false, false);
  expectEq("todo rojo -> B verde", c.fase, CICLO_B_VERDE);
  ciclo_avanzar(c, CICLO_VERDE_MS, false, false);
  expectEq("B verde -> B amarillo", c.fase, CICLO_B_AMARILLO);
  ciclo_avanzar(c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
  expectEq("B despeja y vuelve A", c.fase, CICLO_A_VERDE);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, 2000, false, false);
  const events = ciclo_avanzar(c, 0, true, true);
  expectEq("prioridad inmediata con A verde", c.fase, CICLO_PRIORIDAD_A);
  expectLights("prioridad mantiene A", c, CICLO_VERDE, CICLO_ROJO);
  expectEq("guarda restante A", c.restante_guardado_ms, 3000);
  expectEq("eventos solicitud y prioridad", events,
    CICLO_EVENTO_SOLICITUD | CICLO_EVENTO_PRIORIDAD_ACTIVA);
  expectEq("deteccion repetida deduplicada",
    ciclo_avanzar(c, 100, true, true), CICLO_EVENTO_NINGUNO);
  expectEq("mantiene prioridad activa",
    ciclo_avanzar(c, 10000, false, true), CICLO_EVENTO_NINGUNO);
  const ended = ciclo_avanzar(c, 0, false, false);
  expectEq("retoma verde A", c.fase, CICLO_A_VERDE);
  expectEq("restaura restante A", c.restante_ms, 3000);
  expectEq("eventos fin y recuperacion", ended,
    CICLO_EVENTO_EMERGENCIA_FINALIZADA | CICLO_EVENTO_RECUPERACION_COMPLETA);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS + 500, false, false);
  const request = ciclo_avanzar(c, 0, true, true);
  expectEq("emergencia durante amarillo A", c.fase, CICLO_A_AMARILLO);
  expectTrue("marca solicitud pendiente", (request & CICLO_EVENTO_SOLICITUD) !== 0);
  ciclo_avanzar(c, c.restante_ms + CICLO_TODO_ROJO_MS, false, true);
  expectEq("amarillo A y rojo -> prioridad", c.fase, CICLO_PRIORIDAD_A);
  ciclo_avanzar(c, 0, false, false);
  expectEq("inicia recuperacion amarilla A", c.fase, CICLO_RECUPERACION_A_AMARILLO);
  expectLights("amarillo de recuperacion", c, CICLO_AMARILLO, CICLO_ROJO);
  ciclo_avanzar(c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
  expectEq("recupera B", c.fase, CICLO_B_VERDE);
}

{
  const c = ciclo_init();
  advanceToBGreen(c);
  ciclo_avanzar(c, 1500, false, false);
  ciclo_avanzar(c, 0, true, true);
  expectEq("B verde -> B amarillo", c.fase, CICLO_B_AMARILLO);
  expectEq("guarda tiempo de B", c.restante_guardado_ms, 3500);
  expectEq("deteccion repetida no reinicia despeje",
    ciclo_avanzar(c, 500, true, true), CICLO_EVENTO_NINGUNO);
  expectEq("amarillo sigue corriendo", c.restante_ms, CICLO_AMARILLO_MS - 500);
  ciclo_avanzar(c, c.restante_ms + CICLO_TODO_ROJO_MS, false, false);
  expectEq("despeje B -> prioridad A", c.fase, CICLO_PRIORIDAD_A);
  expectLights("solo A verde con prioridad", c, CICLO_VERDE, CICLO_ROJO);
  ciclo_avanzar(c, 0, false, false);
  expectEq("salida de prioridad", c.fase, CICLO_RECUPERACION_A_AMARILLO);
  ciclo_avanzar(c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
  expectEq("restaura B", c.fase, CICLO_B_VERDE);
  expectEq("restaura resto congelado", c.restante_ms, 3500);
}

{
  const c = ciclo_init();
  advanceToBGreen(c);
  ciclo_avanzar(c, CICLO_VERDE_MS + 800, false, false);
  ciclo_avanzar(c, 0, true, true);
  expectEq("emergencia conserva B amarillo", c.fase, CICLO_B_AMARILLO);
  expectEq("conserva resto del amarillo B", c.restante_ms, 1200);
  ciclo_avanzar(c, 1200 + CICLO_TODO_ROJO_MS, false, true);
  expectEq("B amarillo -> prioridad", c.fase, CICLO_PRIORIDAD_A);
  ciclo_avanzar(c, 0, false, false);
  expectEq("retoma A tras B amarillo", c.fase, CICLO_A_VERDE);
  expectEq("verde A normal completo", c.restante_ms, CICLO_VERDE_MS);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, CICLO_VERDE_MS + CICLO_AMARILLO_MS, false, false);
  const request = ciclo_avanzar(c, 0, true, true);
  expectEq("emergencia durante todo rojo", c.fase, CICLO_TODO_ROJO);
  expectTrue("solicitud conservada", (request & CICLO_EVENTO_SOLICITUD) !== 0);
  expectEq("destino cambia a prioridad", c.destino_todo_rojo, CICLO_DESTINO_PRIORIDAD_A);
  expectEq("temporizador no se reinicia", c.restante_ms, CICLO_TODO_ROJO_MS);
  ciclo_avanzar(c, CICLO_TODO_ROJO_MS, false, true);
  expectEq("entra prioridad al completar el rojo", c.fase, CICLO_PRIORIDAD_A);
}

{
  const c = ciclo_init();
  advanceToBGreen(c);
  ciclo_avanzar(c, 2000, false, false);
  ciclo_avanzar(c, 0, true, true);
  ciclo_avanzar(c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, true);
  ciclo_avanzar(c, 0, false, false);
  expectEq("primera emergencia inicia recuperacion",
    c.fase, CICLO_RECUPERACION_A_AMARILLO);
  ciclo_avanzar(c, 500, false, false);
  ciclo_avanzar(c, 0, true, true);
  expectEq("segunda solicitud mantiene amarillo",
    c.fase, CICLO_RECUPERACION_A_AMARILLO);
  expectEq("segunda solicitud no reinicia amarillo", c.restante_ms, 1500);
  ciclo_avanzar(c, c.restante_ms + CICLO_TODO_ROJO_MS, false, true);
  expectEq("segunda solicitud reentra tras todo rojo", c.fase, CICLO_PRIORIDAD_A);
  ciclo_avanzar(c, 0, false, false);
  ciclo_avanzar(c, CICLO_AMARILLO_MS + CICLO_TODO_ROJO_MS, false, false);
  expectEq("recupera B con la fase original", c.fase, CICLO_B_VERDE);
  expectEq("conserva resto B tras reentrada", c.restante_ms, 3000);
}

{
  const c = ciclo_init();
  ciclo_avanzar(c, 9000, false, false);
  expectEq("el exceso atraviesa A y habilita B", c.fase, CICLO_B_VERDE);
  expectEq("consume el exceso sin perder tiempo", c.restante_ms, 4000);
  expectLights("la transicion conserva exclusividad", c, CICLO_ROJO, CICLO_VERDE);
}

{
  const before = 0xFFFFFFFC;
  const now = 2;
  const dt = (now - before) >>> 0;
  expectEq("delta millis atraviesa wrap", dt, 6);
  const c = ciclo_init();
  ciclo_avanzar(c, dt, false, false);
  expectEq("contador funciona tras wrap", c.restante_ms, CICLO_VERDE_MS - 6);
}

{
  const c = ciclo_init();
  c.fase = 99;
  expectLights("fase invalida es roja", c, CICLO_ROJO, CICLO_ROJO);
  expectEq("invalidez genera evento",
    ciclo_avanzar(c, 0, false, false), CICLO_EVENTO_ESTADO_INVALIDO);
  expectEq("falla queda enclavada", c.fase, CICLO_FALLO_SEGURO);
  expectLights("falla mantiene todo rojo", c, CICLO_ROJO, CICLO_ROJO);
  ciclo_avanzar(c, 0xFFFFFFFF, true, true);
  expectEq("no se auto-habilita tras falla", c.fase, CICLO_FALLO_SEGURO);
}

{
  const c = ciclo_init();
  expectEq("sobretiempo extremo falla seguro",
    ciclo_avanzar(c, 0xFFFFFFFF, false, false), CICLO_EVENTO_ESTADO_INVALIDO);
  expectLights("sobretiempo extremo ambos rojos", c, CICLO_ROJO, CICLO_ROJO);
}

{
  const c = ciclo_init();
  c.fase = CICLO_TODO_ROJO;
  c.destino_todo_rojo = CICLO_DESTINO_NINGUNO;
  expectEq("destino invalido enclava fallo seguro",
    ciclo_avanzar(c, 0, false, false), CICLO_EVENTO_ESTADO_INVALIDO);
  expectEq("destino invalido permanece seguro", c.fase, CICLO_FALLO_SEGURO);
  expectLights("destino invalido conserva ambos rojos", c, CICLO_ROJO, CICLO_ROJO);
}

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
console.log("all tests passed");
