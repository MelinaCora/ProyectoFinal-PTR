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
  const float p950 = goertzel_power(samples, n, 950.0f, fs);
  const float p650 = goertzel_power(samples, n, 650.0f, fs);
  expect_true("1000 Hz sine has much more power near 950 Hz than at 650 Hz", p950 > p650 * 10.0f);

  SirenEar ear;
  ear.reset();
  bool confirmed = false;
  for (int w = 0; w < 40; w++) {
    fill_sine(samples, n, 1000.0f, fs, 400.0f);
    if (ear.feed(siren_tone(samples, n, fs), (uint32_t)(w * 8))) {
      confirmed = true;
    }
  }
  expect_true("1000 Hz sine is not a siren pattern", !confirmed);

  ear.reset();
  confirmed = false;
  for (int w = 0; w < 40; w++) {
    fill_sine(samples, n, 200.0f, fs, 400.0f);
    if (ear.feed(siren_tone(samples, n, fs), (uint32_t)(w * 8))) {
      confirmed = true;
    }
  }
  expect_true("200 Hz sine is not a siren pattern", !confirmed);

  fill_silence(samples, n);
  ear.reset();
  expect_true("silence is not a siren pattern", !ear.feed(siren_tone(samples, n, fs), 0));

  ear.reset();
  confirmed = false;
  fill_sine(samples, n, 650.0f, fs, 400.0f);
  ear.feed(siren_tone(samples, n, fs), 0);
  fill_sine(samples, n, 1250.0f, fs, 400.0f);
  if (ear.feed(siren_tone(samples, n, fs), 500)) {
    confirmed = true;
  }
  expect_true("low then high confirms siren pattern", confirmed);

  if (g_failed) {
    std::printf("%d test(s) failed\n", g_failed);
    return 1;
  }
  std::printf("all tests passed\n");
  return 0;
}
