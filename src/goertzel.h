#ifndef GOERTZEL_H
#define GOERTZEL_H

#include <math.h>
#include <stdint.h>

static const int GOERTZEL_N = 64;
static const float GOERTZEL_FS = 8000.0f;
static const float GOERTZEL_THRESHOLD = 5000000.0f;
static const float GOERTZEL_PEAK_RATIO = 2.0f;

static const float GOERTZEL_SIREN_HZ[] = {650.0f, 800.0f, 950.0f, 1100.0f, 1250.0f};
static const int GOERTZEL_SIREN_COUNT = 5;

static const float SIREN_LOW_HZ = 850.0f;
static const float SIREN_HIGH_HZ = 1100.0f;
static const uint32_t SIREN_SWEEP_MS = 2000;

inline float goertzel_power(const int16_t* samples, int n, float freq_hz, float sample_rate_hz) {
  const float k = roundf((float)n * freq_hz / sample_rate_hz);
  const float w = 2.0f * 3.14159265358979323846f * k / (float)n;
  const float coeff = 2.0f * cosf(w);
  float s0 = 0.0f;
  float s1 = 0.0f;
  float s2 = 0.0f;
  for (int i = 0; i < n; i++) {
    s0 = (float)samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

struct SirenTone {
  bool present;
  float freq_hz;
};

inline SirenTone siren_tone(const int16_t* samples, int n, float sample_rate_hz) {
  SirenTone tone;
  tone.present = false;
  tone.freq_hz = 0.0f;

  float best = 0.0f;
  float second = 0.0f;
  float best_hz = 0.0f;
  for (int i = 0; i < GOERTZEL_SIREN_COUNT; i++) {
    const float p = goertzel_power(samples, n, GOERTZEL_SIREN_HZ[i], sample_rate_hz);
    if (p > best) {
      second = best;
      best = p;
      best_hz = GOERTZEL_SIREN_HZ[i];
    } else if (p > second) {
      second = p;
    }
  }

  if (best >= GOERTZEL_THRESHOLD && best >= second * GOERTZEL_PEAK_RATIO) {
    tone.present = true;
    tone.freq_hz = best_hz;
  }
  return tone;
}

struct SirenEar {
  uint32_t last_low_ms;
  uint32_t last_high_ms;

  void reset() {
    last_low_ms = 0;
    last_high_ms = 0;
  }

  bool feed(const SirenTone& tone, uint32_t now_ms) {
    if (last_low_ms != 0 && (now_ms - last_low_ms) > SIREN_SWEEP_MS) {
      last_low_ms = 0;
    }
    if (last_high_ms != 0 && (now_ms - last_high_ms) > SIREN_SWEEP_MS) {
      last_high_ms = 0;
    }
    if (!tone.present) {
      return false;
    }
    if (tone.freq_hz < SIREN_LOW_HZ) {
      last_low_ms = now_ms;
    }
    if (tone.freq_hz > SIREN_HIGH_HZ) {
      last_high_ms = now_ms;
    }
    return last_low_ms != 0 && last_high_ms != 0;
  }
};

#endif
