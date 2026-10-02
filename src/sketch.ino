#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "goertzel.h"

LiquidCrystal_I2C lcd(0x27, 16, 2);

// Semáforo 1 (Carril A - Principal)
const int LED_ROJO_1 = 8;
const int LED_AMARILLO_1 = 9;
const int LED_VERDE_1 = 10;

// Semáforo 2 (Carril B - Cruzado)
const int LED_VERDE_2 = 5;
const int LED_AMARILLO_2 = 6;
const int LED_ROJO_2 = 7;

const int PIN_MIC = A0;
const unsigned int PERIODO_MUESTRA_US = 125;  // 8 kHz
const int HITS_PARA_ENTRAR = 2;
const int MISS_PARA_SALIR = 3;

void setup() {
  pinMode(LED_ROJO_1, OUTPUT);
  pinMode(LED_AMARILLO_1, OUTPUT);
  pinMode(LED_VERDE_1, OUTPUT);

  pinMode(LED_ROJO_2, OUTPUT);
  pinMode(LED_AMARILLO_2, OUTPUT);
  pinMode(LED_VERDE_2, OUTPUT);

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("CRUCE 2 SEMAFOROS");
  lcd.setCursor(0, 1);
  lcd.print("SIRENA GOERTZEL");
  delay(2000);
  lcd.clear();
}

bool haySirena() {
  int16_t samples[GOERTZEL_N];
  unsigned long next = micros();
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = (int16_t)analogRead(PIN_MIC) - 512;
    next += PERIODO_MUESTRA_US;
    while ((long)(micros() - next) < 0) {
    }
  }
  return siren_detected(samples, GOERTZEL_N, GOERTZEL_FS);
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
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("  AMBULANCIA  ");
  lcd.setCursor(0, 1);
  lcd.print("  DETECTADA!  ");

  int misses = 0;
  while (misses < MISS_PARA_SALIR) {
    semaforoAmbulancia();
    if (haySirena()) {
      misses = 0;
    } else {
      misses++;
    }
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("TRAFICO NORMAL");
  delay(1000);
  lcd.clear();
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
  // FASE 1: Semáforo 1 VERDE | Semáforo 2 ROJO
  lcd.setCursor(0, 0);
  lcd.print("C1: VERDE       ");
  lcd.setCursor(0, 1);
  lcd.print("C2: ROJO        ");
  digitalWrite(LED_VERDE_1, HIGH);   digitalWrite(LED_AMARILLO_1, LOW);  digitalWrite(LED_ROJO_1, LOW);
  digitalWrite(LED_VERDE_2, LOW);    digitalWrite(LED_AMARILLO_2, LOW);  digitalWrite(LED_ROJO_2, HIGH);
  if (comprobarAmbulancia(5000)) return;

  // FASE 2: Semáforo 1 AMARILLO | Semáforo 2 ROJO
  lcd.setCursor(0, 0);
  lcd.print("C1: AMARILLO    ");
  digitalWrite(LED_VERDE_1, LOW);    digitalWrite(LED_AMARILLO_1, HIGH);
  if (comprobarAmbulancia(2000)) return;

  // FASE 3: Semáforo 1 ROJO | Semáforo 2 VERDE
  lcd.setCursor(0, 0);
  lcd.print("C1: ROJO        ");
  lcd.setCursor(0, 1);
  lcd.print("C2: VERDE       ");
  digitalWrite(LED_AMARILLO_1, LOW); digitalWrite(LED_ROJO_1, HIGH);
  digitalWrite(LED_ROJO_2, LOW);     digitalWrite(LED_VERDE_2, HIGH);
  if (comprobarAmbulancia(5000)) return;

  // FASE 4: Semáforo 1 ROJO | Semáforo 2 AMARILLO
  lcd.setCursor(0, 1);
  lcd.print("C2: AMARILLO    ");
  digitalWrite(LED_VERDE_2, LOW);    digitalWrite(LED_AMARILLO_2, HIGH);
  if (comprobarAmbulancia(2000)) return;
}
