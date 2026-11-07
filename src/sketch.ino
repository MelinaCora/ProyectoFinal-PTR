#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "goertzel.h"
#include "ciclo.h"
#include "telemetria.h"

LiquidCrystal_I2C lcd(0x27, 16, 2);

// Semáforo 1 (Carril A - Principal)
const int LED_ROJO_1 = 8;
const int LED_AMARILLO_1 = 9;
const int LED_VERDE_1 = 10;

// Semáforo 2 (Carril B - Cruzado): mismo orden que el 1 (rojo, amarillo, verde)
const int LED_ROJO_2 = 5;
const int LED_AMARILLO_2 = 6;
const int LED_VERDE_2 = 7;

const int PIN_MIC = A0;
const int MISS_PARA_SALIR = 25;
// Piso de amplitud media (ADC): el tramo lejano del WAV ya mueve A0.
const int AMPLITUD_PISO = 4;
const unsigned long TELEMETRIA_INTERVALO_MS = 1000UL;

// Si el I2C del LCD está mal, lcd.init() se cuelga y no enciende ningún LED.
// Dejá true cuando el display esté cableado; false para probar solo semáforos.
const bool USAR_LCD = true;

SirenEar oido;
Ciclo ciclo;
TelemetriaCola telemetria;
TelemetriaIncidente incidentes;
unsigned long tRespuestaMs = 0;
unsigned long tUltimoMs = 0;
unsigned long tUltimoHeartbeatMs = 0;
unsigned long tIndicioMs = 0;
int missesSirena = 0;
bool respuestaDisponible = false;
bool lcdActualizado = false;
bool lcdMuestraAmbulancia = false;
bool lcdFalloSeguro = false;
unsigned long lcdRespuestaMs = 0;
bool estadoTelemetriaConocido = false;
CicloFase faseTelemetria;
CicloLuz luzATelemetria;
CicloLuz luzBTelemetria;
const char* modoTelemetria;

void lcdTexto(int col, int fil, const char* texto) {
  if (!USAR_LCD) return;
  lcd.setCursor(col, fil);
  lcd.print(texto);
}

void mostrarNormal() {
  lcdTexto(0, 0, "FUNCIONAMIENTO  ");
  lcdTexto(0, 1, "NORMAL          ");
}

void mostrarFalloSeguro() {
  lcdTexto(0, 0, "FALLO SEGURO    ");
  lcdTexto(0, 1, "AMBOS EN ROJO   ");
}

void mostrarAmbulancia(unsigned long respuestaMs) {
  lcdTexto(0, 0, "AMBULANCIA      ");
  char linea[17];
  if (respuestaMs > 9999UL) {
    unsigned long ms = respuestaMs > 99999UL ? 99999UL : respuestaMs;
    snprintf(linea, sizeof(linea), "RESPUESTA%5lums", ms);
  } else {
    snprintf(linea, sizeof(linea), "RESPUESTA %4lums", respuestaMs);
  }
  lcdTexto(0, 1, linea);
}

void aplicarLuz(CicloLuz luz, int pinRojo, int pinAmarillo, int pinVerde) {
  digitalWrite(pinRojo, luz == CICLO_ROJO ? HIGH : LOW);
  digitalWrite(pinAmarillo, luz == CICLO_AMARILLO ? HIGH : LOW);
  digitalWrite(pinVerde, luz == CICLO_VERDE ? HIGH : LOW);
}

void aplicarSemaforos() {
  aplicarLuz(ciclo_luz_a(&ciclo), LED_ROJO_1, LED_AMARILLO_1, LED_VERDE_1);
  aplicarLuz(ciclo_luz_b(&ciclo), LED_ROJO_2, LED_AMARILLO_2, LED_VERDE_2);
}

const char* nombreFase(CicloFase fase) {
  switch (fase) {
    case CICLO_A_VERDE: return "A_VERDE";
    case CICLO_A_AMARILLO: return "A_AMARILLO";
    case CICLO_TODO_ROJO: return "TODO_ROJO";
    case CICLO_B_VERDE: return "B_VERDE";
    case CICLO_B_AMARILLO: return "B_AMARILLO";
    case CICLO_PRIORIDAD_A: return "PRIORIDAD_A";
    case CICLO_RECUPERACION_A_AMARILLO: return "RECUPERACION_A_AMARILLO";
    case CICLO_FALLO_SEGURO: return "FALLO_SEGURO";
  }
  return "FALLO_SEGURO";
}

const char* nombreLuz(CicloLuz luz) {
  switch (luz) {
    case CICLO_ROJO: return "R";
    case CICLO_AMARILLO: return "Y";
    case CICLO_VERDE: return "G";
  }
  return "R";
}

const char* nombreModo() {
  if (ciclo.fase == CICLO_FALLO_SEGURO) return "FALLO";
  if (ciclo.fase == CICLO_PRIORIDAD_A || ciclo.ambulancia_pendiente) {
    return "EMERGENCIA";
  }
  if (ciclo.origen != CICLO_ORIGEN_NINGUNO
      || ciclo.fase == CICLO_RECUPERACION_A_AMARILLO) {
    return "RECUPERACION";
  }
  return "NORMAL";
}

uint16_t idContextoIncidente() {
  if (incidentes.activo_id != 0) return incidentes.activo_id;
  if (incidentes.recuperaciones_pendientes != 0) {
    return incidentes.recuperaciones[
        incidentes.recuperaciones_pendientes - 1].incidente_id;
  }
  return 0;
}

bool encolarMensaje(unsigned long ahora, const char* tipo, uint16_t incidente,
                    const char* datos, bool critica) {
  char mensaje[TELEMETRIA_TAMANO_LINEA];
  const uint16_t secuencia = telemetria_tomar_secuencia(&telemetria);
  const int longitud = snprintf(
      mensaje, sizeof(mensaje), "SIV,1,%u,%lu,%s,%u%s\n",
      (unsigned int)secuencia, ahora, tipo, (unsigned int)incidente, datos);
  if (longitud <= 0 || (size_t)longitud >= sizeof(mensaje)) {
    telemetria_sumar_perdida(
        critica ? &telemetria.perdidas_criticas
                : &telemetria.perdidas_supervision);
    return false;
  }
  return telemetria_encolar(&telemetria, mensaje, (uint8_t)longitud, critica);
}

void emitirEstado(unsigned long ahora, bool forzar) {
  const CicloLuz luzA = ciclo_luz_a(&ciclo);
  const CicloLuz luzB = ciclo_luz_b(&ciclo);
  const char* modo = nombreModo();
  if (!forzar && estadoTelemetriaConocido && faseTelemetria == ciclo.fase
      && luzATelemetria == luzA && luzBTelemetria == luzB
      && strcmp(modoTelemetria, modo) == 0) {
    return;
  }

  char datos[72];
  snprintf(datos, sizeof(datos), ",%s,%s,%s,%s,%lu",
           nombreLuz(luzA), nombreLuz(luzB), nombreFase(ciclo.fase),
           modo, (unsigned long)ciclo.restante_ms);
  encolarMensaje(ahora, "STATE", idContextoIncidente(), datos, true);
  faseTelemetria = ciclo.fase;
  luzATelemetria = luzA;
  luzBTelemetria = luzB;
  modoTelemetria = modo;
  estadoTelemetriaConocido = true;
}

void emitirHeartbeat(unsigned long ahora) {
  char datos[72];
  snprintf(datos, sizeof(datos), ",%s,%s,%s,%s,%lu",
           nombreLuz(ciclo_luz_a(&ciclo)), nombreLuz(ciclo_luz_b(&ciclo)),
           nombreFase(ciclo.fase), nombreModo(),
           (unsigned long)ciclo.restante_ms);
  encolarMensaje(ahora, "HEARTBEAT", idContextoIncidente(), datos, false);
}

void emitirPerdidas(unsigned long ahora) {
  if (telemetria.cantidad >= TELEMETRIA_CAPACIDAD_COLA
      || (telemetria.perdidas_criticas == 0
          && telemetria.perdidas_supervision == 0)) {
    return;
  }
  const uint16_t criticas = telemetria.perdidas_criticas;
  const uint16_t supervision = telemetria.perdidas_supervision;
  char datos[24];
  snprintf(datos, sizeof(datos), ",%u,%u",
           (unsigned int)criticas, (unsigned int)supervision);
  if (encolarMensaje(ahora, "PERDIDA", 0, datos, true)) {
    telemetria.perdidas_criticas = 0;
    telemetria.perdidas_supervision = 0;
  }
}

void drenarTelemetria() {
  const int disponible = Serial.availableForWrite();
  if (disponible <= 0) return;
  uint8_t presupuesto = (uint8_t)(disponible < 16 ? disponible : 16);
  while (presupuesto > 0) {
    const TelemetriaTrama* trama = telemetria_frente(&telemetria);
    if (trama == 0) return;
    Serial.write((uint8_t)trama->datos[trama->desplazamiento]);
    telemetria_consumir(&telemetria, 1);
    presupuesto--;
  }
}

bool timestampIndicioValido(uint32_t timestamp, uint32_t ahora) {
  return timestamp != 0 && (uint32_t)(ahora - timestamp) <= SIREN_SWEEP_MS;
}

void emitirRecuperaciones(unsigned long ahora) {
  uint16_t incidente;
  uint32_t desdeFinalizacion;
  while (telemetria_siguiente_recuperacion(
      &incidentes, (uint32_t)ahora, &incidente, &desdeFinalizacion)) {
    char datos[24];
    snprintf(datos, sizeof(datos), ",%lu", (unsigned long)desdeFinalizacion);
    encolarMensaje(ahora, "CICLO_RECUPERADO", incidente, datos, true);
  }
}

void setup() {
  Serial.begin(9600);
  telemetria_inicializar_cola(&telemetria);
  telemetria_inicializar_incidentes(&incidentes);

  pinMode(LED_ROJO_1, OUTPUT);
  pinMode(LED_AMARILLO_1, OUTPUT);
  pinMode(LED_VERDE_1, OUTPUT);

  pinMode(LED_ROJO_2, OUTPUT);
  pinMode(LED_AMARILLO_2, OUTPUT);
  pinMode(LED_VERDE_2, OUTPUT);

  // Mantiene ambos carriles en rojo durante la inicialización.
  digitalWrite(LED_ROJO_1, HIGH);
  digitalWrite(LED_AMARILLO_1, LOW);
  digitalWrite(LED_VERDE_1, LOW);
  digitalWrite(LED_ROJO_2, HIGH);
  digitalWrite(LED_AMARILLO_2, LOW);
  digitalWrite(LED_VERDE_2, LOW);

  oido.reset();
  ciclo_init(&ciclo);
  tUltimoMs = millis();
  tUltimoHeartbeatMs = tUltimoMs;

  if (USAR_LCD) {
    lcd.init();
    lcd.backlight();
    lcd.clear();
    mostrarNormal();
    lcdActualizado = true;
  }

  aplicarSemaforos();
  encolarMensaje(tUltimoMs, "BOOT", 0, "", true);
  emitirEstado(tUltimoMs, true);
}

SirenTone leerTono() {
  int16_t samples[GOERTZEL_N];
  unsigned long t0 = micros();
  long suma = 0;
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = (int16_t)analogRead(PIN_MIC);
    suma += samples[i];
  }
  unsigned long elapsed = micros() - t0;
  int16_t media = (int16_t)(suma / GOERTZEL_N);
  long energia = 0;
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = (int16_t)(samples[i] - media);
    energia += abs(samples[i]);
  }

  const int amplitud = (int)(energia / GOERTZEL_N);
  if (amplitud < AMPLITUD_PISO) oido.reset();

  float fs = (elapsed > 0)
      ? (1000000.0f * (float)(GOERTZEL_N - 1) / (float)elapsed)
      : GOERTZEL_FS;
  return siren_tone(samples, GOERTZEL_N, fs);
}

void loop() {
  unsigned long ahora = millis();
  uint32_t dt = (uint32_t)(ahora - tUltimoMs);
  tUltimoMs = ahora;

  SirenTone tono = leerTono();
  const bool habiaIndicio = timestampIndicioValido(oido.last_low_ms, ahora)
      || timestampIndicioValido(oido.last_high_ms, ahora);
  const uint32_t lowAnterior = oido.last_low_ms;
  bool patron = false;
  if (oido.feed(tono, ahora)) {
    patron = true;
    missesSirena = 0;
  }
  const bool hayIndicio = timestampIndicioValido(oido.last_low_ms, ahora)
      || timestampIndicioValido(oido.last_high_ms, ahora);
  if (!habiaIndicio && hayIndicio) {
    tIndicioMs = oido.last_low_ms != 0 ? oido.last_low_ms : oido.last_high_ms;
    const char* banda = oido.last_low_ms != lowAnterior ? ",LOW" : ",HIGH";
    encolarMensaje(ahora, "INDICIO_SIRENA", 0, banda, false);
  }

  bool sirenaActiva = false;
  if (ciclo.fase == CICLO_PRIORIDAD_A) {
    if (!patron) {
      if (tono.present) {
        missesSirena = 0;
      } else {
        missesSirena++;
      }
    }
    sirenaActiva = missesSirena < MISS_PARA_SALIR;
  } else {
    missesSirena = 0;
  }

  CicloLuz luzAConfirmacion;
  CicloLuz luzBConfirmacion;
  CicloFase faseConfirmacion;
  const uint8_t eventos = ciclo_avanzar_con_instantanea(
      &ciclo, dt, patron, sirenaActiva, &faseConfirmacion,
      &luzAConfirmacion, &luzBConfirmacion);
  const unsigned long instanteEvento = millis();
  const bool recuperacionCompleta =
      (eventos & CICLO_EVENTO_RECUPERACION_COMPLETA) != 0;
  uint16_t incidenteSinRegistroRecuperacion = 0;
  uint32_t finSinRegistroRecuperacionMs = 0;

  if (eventos & CICLO_EVENTO_EMERGENCIA_FINALIZADA) {
    uint16_t incidenteFinalizado = 0;
    uint32_t duracionMs = 0;
    bool recuperacionGuardada = false;
    if (telemetria_finalizar_incidente(
        &incidentes, (uint32_t)instanteEvento, &incidenteFinalizado,
        &duracionMs, &recuperacionGuardada)) {
      char datos[24];
      snprintf(datos, sizeof(datos), ",%lu", (unsigned long)duracionMs);
      encolarMensaje(instanteEvento, "EMERGENCIA_FINALIZADA",
                     incidenteFinalizado, datos, true);
      if (!recuperacionGuardada) {
        incidenteSinRegistroRecuperacion = incidenteFinalizado;
        finSinRegistroRecuperacionMs = (uint32_t)instanteEvento;
      }
    }
    oido.reset();
    missesSirena = 0;
  }

  if (recuperacionCompleta) emitirRecuperaciones(instanteEvento);
  if (incidenteSinRegistroRecuperacion != 0) {
    if (recuperacionCompleta) {
      char datos[24];
      const uint32_t desdeFin =
          (uint32_t)instanteEvento - finSinRegistroRecuperacionMs;
      snprintf(datos, sizeof(datos), ",%lu", (unsigned long)desdeFin);
      encolarMensaje(instanteEvento, "CICLO_RECUPERADO",
                     incidenteSinRegistroRecuperacion, datos, true);
    } else {
      telemetria_sumar_perdida(&telemetria.perdidas_criticas);
    }
  }

  if (eventos & CICLO_EVENTO_SOLICITUD) {
    const uint16_t incidente = telemetria_iniciar_incidente(
        &incidentes, (uint32_t)instanteEvento);
    tRespuestaMs = 0;
    respuestaDisponible = false;
    if (incidente != 0) {
      const uint32_t indicioMs = hayIndicio
          ? (uint32_t)instanteEvento - tIndicioMs
          : 0;
      char datos[64];
      snprintf(datos, sizeof(datos), ",A,%s,%s,%s,%lu",
               nombreLuz(luzAConfirmacion), nombreLuz(luzBConfirmacion),
               nombreFase(faseConfirmacion), (unsigned long)indicioMs);
      encolarMensaje(instanteEvento, "EMERGENCIA_DETECTADA", incidente,
                     datos, true);
    } else {
      telemetria_sumar_perdida(&telemetria.perdidas_criticas);
    }
  }

  if (eventos & CICLO_EVENTO_PRIORIDAD_ACTIVA) {
    const uint32_t respuesta = incidentes.activo_id != 0
        ? (uint32_t)instanteEvento - incidentes.detectado_ms
        : 0;
    tRespuestaMs = respuesta;
    respuestaDisponible = true;
    char datos[64];
    snprintf(datos, sizeof(datos), ",%lu,%s,%s,%s",
             (unsigned long)respuesta, nombreLuz(ciclo_luz_a(&ciclo)),
             nombreLuz(ciclo_luz_b(&ciclo)), nombreFase(ciclo.fase));
    encolarMensaje(instanteEvento, "PRIORIDAD_ACTIVADA",
                   incidentes.activo_id, datos, true);
  }

  if (eventos & CICLO_EVENTO_ESTADO_INVALIDO) {
    char datos[64];
    snprintf(datos, sizeof(datos), ",NO_DISPONIBLE,%s,%s,%s",
             nombreLuz(ciclo_luz_a(&ciclo)), nombreLuz(ciclo_luz_b(&ciclo)),
             nombreFase(ciclo.fase));
    encolarMensaje(instanteEvento, "FALLO_SEGURO",
                   incidentes.activo_id, datos, true);
  }

  aplicarSemaforos();

  const bool falloSeguro = ciclo.fase == CICLO_FALLO_SEGURO;
  const bool mostrarEmergencia = ciclo_muestra_ambulancia(&ciclo);
  if (!lcdActualizado || falloSeguro != lcdFalloSeguro
      || (!falloSeguro && mostrarEmergencia != lcdMuestraAmbulancia)
      || (mostrarEmergencia && respuestaDisponible && tRespuestaMs != lcdRespuestaMs)) {
    if (falloSeguro) {
      mostrarFalloSeguro();
    } else if (mostrarEmergencia) {
      mostrarAmbulancia(respuestaDisponible ? tRespuestaMs : 0);
      lcdRespuestaMs = respuestaDisponible ? tRespuestaMs : 0;
    } else {
      mostrarNormal();
    }
    lcdMuestraAmbulancia = mostrarEmergencia;
    lcdFalloSeguro = falloSeguro;
    lcdActualizado = true;
  }

  emitirEstado(instanteEvento, false);
  if ((uint32_t)(instanteEvento - tUltimoHeartbeatMs)
      >= TELEMETRIA_INTERVALO_MS) {
    tUltimoHeartbeatMs = instanteEvento;
    emitirHeartbeat(instanteEvento);
  }
  emitirPerdidas(instanteEvento);
  drenarTelemetria();
}
