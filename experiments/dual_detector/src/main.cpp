#include <Arduino.h>
#include "../../../src/goertzel.h"

static const uint8_t INPUT_PINS[] = {A0, A1};
static const char CHANNEL_NAMES[] = {'A', 'B'};
static const uint8_t CHANNEL_COUNT = 2;
static const int AMPLITUDE_FLOOR = 4;
static const uint32_t REPORT_INTERVAL_MS = 1000UL;

SirenEar ears[CHANNEL_COUNT];
bool was_detected[CHANNEL_COUNT] = {false, false};

struct ChannelStats {
  uint32_t sample_rate_hz;
  uint32_t switch_us;
  uint32_t acquisition_us;
  uint32_t processing_us;
  uint32_t windows;
  uint32_t detections;
};

ChannelStats stats[CHANNEL_COUNT] = {};
uint8_t next_channel = 0;
uint32_t last_report_ms = 0;

SirenTone read_tone(uint8_t pin, SirenEar* ear,
                    ChannelStats* channel_stats) {
  int16_t samples[GOERTZEL_N];
  const uint32_t switch_start_us = micros();
  analogRead(pin);
  const uint32_t sample_start_us = micros();
  channel_stats->switch_us = sample_start_us - switch_start_us;

  long sum = 0;
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = static_cast<int16_t>(analogRead(pin));
    sum += samples[i];
  }
  const uint32_t sample_end_us = micros();
  channel_stats->acquisition_us = sample_end_us - sample_start_us;

  const int16_t mean = static_cast<int16_t>(sum / GOERTZEL_N);
  long energy = 0;
  for (int i = 0; i < GOERTZEL_N; i++) {
    samples[i] = static_cast<int16_t>(samples[i] - mean);
    energy += abs(samples[i]);
  }

  if (energy / GOERTZEL_N < AMPLITUDE_FLOOR) {
    ear->reset();
  }

  const float sample_rate_hz = channel_stats->acquisition_us > 0
      ? 1000000.0f * static_cast<float>(GOERTZEL_N - 1)
          / static_cast<float>(channel_stats->acquisition_us)
      : GOERTZEL_FS;
  const uint32_t processing_start_us = micros();
  const SirenTone tone = siren_tone(samples, GOERTZEL_N, sample_rate_hz);
  channel_stats->processing_us = micros() - processing_start_us;
  channel_stats->sample_rate_hz = static_cast<uint32_t>(sample_rate_hz + 0.5f);
  channel_stats->windows++;
  return tone;
}

void report_channel(uint8_t channel) {
  Serial.print(F("DIAG "));
  Serial.print(CHANNEL_NAMES[channel]);
  Serial.print(F(" windows="));
  Serial.print(stats[channel].windows);
  Serial.print(F(" detections="));
  Serial.print(stats[channel].detections);
  Serial.print(F(" fs_hz="));
  Serial.print(stats[channel].sample_rate_hz);
  Serial.print(F(" switch_us="));
  Serial.print(stats[channel].switch_us);
  Serial.print(F(" acquire_us="));
  Serial.print(stats[channel].acquisition_us);
  Serial.print(F(" process_us="));
  Serial.println(stats[channel].processing_us);
  stats[channel].windows = 0;
}

void setup() {
  Serial.begin(115200);
  for (uint8_t channel = 0; channel < CHANNEL_COUNT; channel++) {
    ears[channel].reset();
  }
  last_report_ms = millis();
  Serial.println(F("DUAL_DETECTOR_DIAGNOSTIC_ONLY"));
}

void loop() {
  const uint8_t channel = next_channel;
  const uint8_t pin = INPUT_PINS[channel];
  const SirenTone tone = read_tone(pin, &ears[channel], &stats[channel]);
  const bool detected = ears[channel].feed(tone, millis());
  if (detected && !was_detected[channel]) {
    stats[channel].detections++;
    Serial.print(F("DIAG DETECTED channel="));
    Serial.println(CHANNEL_NAMES[channel]);
  }
  was_detected[channel] = detected;
  next_channel = (channel + 1) % CHANNEL_COUNT;

  const uint32_t now_ms = millis();
  if (static_cast<uint32_t>(now_ms - last_report_ms) >= REPORT_INTERVAL_MS) {
    last_report_ms = now_ms;
    report_channel(0);
    report_channel(1);
  }
}
