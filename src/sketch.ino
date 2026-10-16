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

// Si el I2C del LCD está mal, lcd.init() se cuelga y no enciende ningún LED.
// Dejá true cuando el display esté cableado; false para probar solo semáforos.
const bool USAR_LCD = true;

SirenEar oido;
Ciclo ciclo;
unsigned long tSenalInicio = 0;
unsigned long tRespuestaMs = 0;
unsigned long tUltimoMs = 0;
int missesSirena = 0;

void apagarSemaforos() {
  digitalWrite(LED_ROJO_1, LOW);
  digitalWrite(LED_AMARILLO_1, LOW);
  digitalWrite(LED_VERDE_1, LOW);
  digitalWrite(LED_ROJO_2, LOW);
  digitalWrite(LED_AMARILLO_2, LOW);
  digitalWrite(LED_VERDE_2, LOW);
}

void encenderTodos() {
  digitalWrite(LED_ROJO_1, HIGH);
  digitalWrite(LED_AMARILLO_1, HIGH);
  digitalWrite(LED_VERDE_1, HIGH);
  digitalWrite(LED_ROJO_2, HIGH);
  digitalWrite(LED_AMARILLO_2, HIGH);
  digitalWrite(LED_VERDE_2, HIGH);
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

bool faseEscuchaSirena(CicloFase fase) {
  return fase == CICLO_AMBULANCIA || fase == CICLO_DESPEJE_B;
}

bool fasePrioridad(CicloFase fase) {
  return fase == CICLO_AMBULANCIA
      || fase == CICLO_DESPEJE_B
      || fase == CICLO_DESPEJE_A;
}

void setup() {
  pinMode(LED_ROJO_1, OUTPUT);
  pinMode(LED_AMARILLO_1, OUTPUT);
  pinMode(LED_VERDE_1, OUTPUT);

  pinMode(LED_ROJO_2, OUTPUT);
  pinMode(LED_AMARILLO_2, OUTPUT);
  pinMode(LED_VERDE_2, OUTPUT);

  // Prueba: si esto no parpadea, el MCU no corre o los LEDs están mal.
  for (int i = 0; i < 3; i++) {
    encenderTodos();
    delay(300);
    apagarSemaforos();
    delay(300);
  }

  oido.reset();
  ciclo_init(&ciclo);
  tUltimoMs = millis();

  if (USAR_LCD) {
    lcd.init();
    lcd.backlight();
    lcd.clear();
    mostrarNormal();
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
  if (amplitud >= AMPLITUD_PISO) {
    if (tSenalInicio == 0) {
      tSenalInicio = millis();
    }
  } else {
    tSenalInicio = 0;
    oido.reset();
  }

  float fs = (elapsed > 0)
      ? (1000000.0f * (float)(GOERTZEL_N - 1) / (float)elapsed)
      : GOERTZEL_FS;
  return siren_tone(samples, GOERTZEL_N, fs);
}

void loop() {
  unsigned long ahora = millis();
  uint32_t dt = (uint32_t)(ahora - tUltimoMs);
  tUltimoMs = ahora;

  const CicloFase faseAntes = ciclo.fase;
  const bool prioridadAntes = fasePrioridad(faseAntes) || ciclo.ambulancia_pendiente;

  SirenTone tono = leerTono();
  bool patron = false;
  if (oido.feed(tono, ahora)) {
    patron = true;
    missesSirena = 0;
    // El oído sigue confirmando el barrido; el tiempo de respuesta se fija
    // solo en la primera entrada a prioridad (no se actualiza en vivo).
    if (!ciclo_muestra_ambulancia(&ciclo)) {
      tRespuestaMs = (tSenalInicio != 0) ? (ahora - tSenalInicio) : 0;
    }
  }

  bool sirenaActiva = false;
  if (faseEscuchaSirena(ciclo.fase)) {
    if (!patron) {
      if (tono.present) {
        missesSirena = 0;
      } else {
        missesSirena++;
      }
    }
    sirenaActiva = missesSirena < MISS_PARA_SALIR;
  }

  ciclo_avanzar(&ciclo, dt, patron, sirenaActiva);

  // Al salir de ambulancia (despeje o retoma) se reinicia el oído para un patrón nuevo.
  if (faseAntes == CICLO_AMBULANCIA && ciclo.fase != CICLO_AMBULANCIA) {
    oido.reset();
    tSenalInicio = 0;
    tRespuestaMs = 0;
    missesSirena = 0;
  } else if (prioridadAntes && !fasePrioridad(ciclo.fase) && !ciclo.ambulancia_pendiente) {
    oido.reset();
    tSenalInicio = 0;
    tRespuestaMs = 0;
    missesSirena = 0;
  }

  aplicarSemaforos();

  if (ciclo_muestra_ambulancia(&ciclo)) {
    mostrarAmbulancia(tRespuestaMs);
  } else {
    mostrarNormal();
  }
}
