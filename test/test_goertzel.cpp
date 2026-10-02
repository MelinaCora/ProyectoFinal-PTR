#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

#include "../src/goertzel.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static void fill_sine(int16_t* buf, int n, float freq_hz, float sample_rate_hz, float amplitude) {
  for (int i = 0; i < n; i++) {
    buf[i] = (int16_t)(amplitude * sinf(2.0f * (float)M_PI * freq_hz * (float)i / sample_rate_hz));
  }
}

static void fill_silence(int16_t* buf, int n) {
  for (int i = 0; i < n; i++) buf[i] = 0;
}

static int g_failed = 0;

static void expect_true(const char* name, bool cond) {
  if (!cond) {
    std::printf("FAIL: %s\n", name);
    g_failed++;
  } else {
    std::printf("PASS: %s\n", name);
  }
}

int main() {
  const int n = GOERTZEL_N;
  const float fs = GOERTZEL_FS;
  int16_t samples[GOERTZEL_N];

  fill_sine(samples, n, 1000.0f, fs, 400.0f);
  const float p1000 = goertzel_power(samples, n, 1000.0f, fs);
  const float p200 = goertzel_power(samples, n, 200.0f, fs);
  expect_true("1000 Hz sine has much more power at 1000 Hz than at 200 Hz", p1000 > p200 * 10.0f);
  expect_true("1000 Hz sine is detected as siren", siren_detected(samples, n, fs));

  fill_sine(samples, n, 200.0f, fs, 400.0f);
  expect_true("200 Hz sine is not a siren", !siren_detected(samples, n, fs));

  fill_silence(samples, n);
  expect_true("silence is not a siren", !siren_detected(samples, n, fs));

  if (g_failed) {
    std::printf("%d test(s) failed\n", g_failed);
    return 1;
  }
  std::printf("all tests passed\n");
  return 0;
}
