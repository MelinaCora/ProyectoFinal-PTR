#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "goertzel.h"

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
const int HITS_PARA_ENTRAR = 2;
const int MISS_PARA_SALIR = 25;

// Si el I2C del LCD está mal, lcd.init() se cuelga y no enciende ningún LED.
// Dejá true cuando el display esté cableado; false para probar solo semáforos.
const bool USAR_LCD = true;

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

void mostrarAmbulancia() {
  lcdTexto(0, 0, "AMBULANCIA      ");
  lcdTexto(0, 1, "DETECTADA!      ");
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

  if (USAR_LCD) {
    lcd.init();
    lcd.backlight();
    lcd.clear();
    mostrarNormal();
  }
}

bool haySirena() {
  int16_t samples[GOERTZEL_N];
  unsigned long t0 = micros();
  long suma = 0;
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = (int16_t)analogRead(PIN_MIC);
    suma += samples[i];
  }
  unsigned long elapsed = micros() - t0;
  int16_t media = (int16_t)(suma / GOERTZEL_N);
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = (int16_t)(samples[i] - media);
  }
  float fs = (elapsed > 0)
      ? (1000000.0f * (float)(GOERTZEL_N - 1) / (float)elapsed)
      : GOERTZEL_FS;
  return siren_detected(samples, GOERTZEL_N, fs);
}

void semaforoAmbulancia() {
  digitalWrite(LED_ROJO_1, LOW);
  digitalWrite(LED_AMARILLO_1, LOW);
  digitalWrite(LED_VERDE_1, HIGH);
  digitalWrite(LED_ROJO_2, HIGH);
  digitalWrite(LED_AMARILLO_2, LOW);
  digitalWrite(LED_VERDE_2, LOW);
}

void modoAmbulancia() {
  mostrarAmbulancia();

  int misses = 0;
  while (misses < MISS_PARA_SALIR) {
    semaforoAmbulancia();
    if (haySirena()) {
      misses = 0;
    } else {
      misses++;
    }
  }

  mostrarNormal();
}

bool comprobarAmbulancia(int tiempoMs) {
  int hits = 0;
  unsigned long fin = millis() + (unsigned long)tiempoMs;
  while ((long)(millis() - fin) < 0) {
    if (haySirena()) {
      hits++;
      if (hits >= HITS_PARA_ENTRAR) {
        modoAmbulancia();
        return true;
      }
    } else {
      hits = 0;
    }
  }
  return false;
}

void loop() {
  mostrarNormal();

  // FASE 1: Semáforo 1 VERDE | Semáforo 2 ROJO
  digitalWrite(LED_VERDE_1, HIGH);   digitalWrite(LED_AMARILLO_1, LOW);  digitalWrite(LED_ROJO_1, LOW);
  digitalWrite(LED_VERDE_2, LOW);    digitalWrite(LED_AMARILLO_2, LOW);  digitalWrite(LED_ROJO_2, HIGH);
  if (comprobarAmbulancia(5000)) return;

  // FASE 2: Semáforo 1 AMARILLO | Semáforo 2 ROJO
  digitalWrite(LED_VERDE_1, LOW);    digitalWrite(LED_AMARILLO_1, HIGH);
  if (comprobarAmbulancia(2000)) return;

  // FASE 3: Semáforo 1 ROJO | Semáforo 2 VERDE
  digitalWrite(LED_AMARILLO_1, LOW); digitalWrite(LED_ROJO_1, HIGH);
  digitalWrite(LED_ROJO_2, LOW);     digitalWrite(LED_VERDE_2, HIGH);
  if (comprobarAmbulancia(5000)) return;

  // FASE 4: Semáforo 1 ROJO | Semáforo 2 AMARILLO
  digitalWrite(LED_VERDE_2, LOW);    digitalWrite(LED_AMARILLO_2, HIGH);
  if (comprobarAmbulancia(2000)) return;
}
