#ifndef GOERTZEL_H
#define GOERTZEL_H

#include <math.h>
#include <stdint.h>

static const int GOERTZEL_N = 64;
static const float GOERTZEL_FS = 8000.0f;
static const float GOERTZEL_THRESHOLD = 5000000.0f;

static const float GOERTZEL_SIREN_HZ[] = {750.0f, 1000.0f, 1250.0f};
static const int GOERTZEL_SIREN_COUNT = 3;

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

inline bool siren_detected(const int16_t* samples, int n, float sample_rate_hz) {
  for (int i = 0; i < GOERTZEL_SIREN_COUNT; i++) {
    if (goertzel_power(samples, n, GOERTZEL_SIREN_HZ[i], sample_rate_hz) >= GOERTZEL_THRESHOLD) {
      return true;
    }
  }
  return false;
}

#endif
