#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "goertzel.h"
#include "ciclo.h"

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
const unsigned long DIAGNOSTICO_INTERVALO_MS = 1000UL;

// Si el I2C del LCD está mal, lcd.init() se cuelga y no enciende ningún LED.
// Dejá true cuando el display esté cableado; false para probar solo semáforos.
const bool USAR_LCD = true;

SirenEar oido;
Ciclo ciclo;
unsigned long tSolicitudMs = 0;
unsigned long tRespuestaMs = 0;
unsigned long tUltimoMs = 0;
unsigned long tUltimoDiagnosticoMs = 0;
int missesSirena = 0;
bool solicitudConTiempo = false;
bool respuestaDisponible = false;
bool lcdActualizado = false;
bool lcdMuestraAmbulancia = false;
bool lcdFalloSeguro = false;
unsigned long lcdRespuestaMs = 0;

void emitirDiagnosticoSerial(unsigned long ahora) {
  if ((unsigned long)(ahora - tUltimoDiagnosticoMs) < DIAGNOSTICO_INTERVALO_MS) {
    return;
  }
  tUltimoDiagnosticoMs = ahora;

  char mensaje[48];
  const int longitud = snprintf(mensaje, sizeof(mensaje),
                                "SIV_TEST,UPTIME_MS=%lu,STATUS=OK\n",
                                ahora);
  if (longitud <= 0 || (size_t)longitud >= sizeof(mensaje)) return;
  if (Serial.availableForWrite() < longitud) return;
  Serial.write((const uint8_t*)mensaje, (size_t)longitud);
}

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

void setup() {
  Serial.begin(9600);
  tUltimoDiagnosticoMs = millis();

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

  if (USAR_LCD) {
    lcd.init();
    lcd.backlight();
    lcd.clear();
    mostrarNormal();
    lcdActualizado = true;
  }

  aplicarSemaforos();
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
  bool patron = false;
  if (oido.feed(tono, ahora)) {
    patron = true;
    missesSirena = 0;
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

  const uint8_t eventos = ciclo_avanzar(&ciclo, dt, patron, sirenaActiva);
  const unsigned long instanteEvento = millis();
  if (eventos & CICLO_EVENTO_SOLICITUD) {
    tSolicitudMs = instanteEvento;
    tRespuestaMs = 0;
    solicitudConTiempo = true;
    respuestaDisponible = false;
  }
  if (eventos & CICLO_EVENTO_PRIORIDAD_ACTIVA) {
    tRespuestaMs = solicitudConTiempo
        ? (unsigned long)(instanteEvento - tSolicitudMs)
        : 0;
    respuestaDisponible = true;
  }
  if (eventos & CICLO_EVENTO_EMERGENCIA_FINALIZADA) {
    oido.reset();
    missesSirena = 0;
    solicitudConTiempo = false;
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

  emitirDiagnosticoSerial(millis());
}
