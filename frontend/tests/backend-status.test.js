import assert from "node:assert/strict";
import test from "node:test";
import { classifyBackendStatus } from "../js/backend-status.js";

test("one failed history request does not classify a responding backend as unavailable", () => {
  assert.equal(classifyBackendStatus({
    healthFailures: 0,
    lastApiSuccessAt: 1000,
    now: 2000,
    resourceErrors: { historial: "HTTP 500" },
  }), "temporary");
});

test("repeated health failures classify a backend without recent REST success as unavailable", () => {
  assert.equal(classifyBackendStatus({
    healthFailures: 2,
    lastApiSuccessAt: 1000,
    now: 31_001,
    resourceErrors: { health: "network error" },
  }), "unavailable");
});

test("successful recovery clears the temporary state", () => {
  assert.equal(classifyBackendStatus({
    healthFailures: 0,
    lastApiSuccessAt: 2000,
    now: 2001,
    resourceErrors: {},
  }), "connected");
});
