import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "../src/lib/auth/return-path.ts";

test("returns to a protected module after login", () => {
  assert.equal(safeReturnPath("/admissions"), "/admissions");
  assert.equal(safeReturnPath("/administration/users"), "/administration/users");
});

test("rejects external and authentication loop destinations", () => {
  for (const value of [undefined, "https://example.com", "//example.com", "/\\example.com", "/login", "/auth/change-password", "/admissions?next=//example.com", "/admissions\nLocation: https://example.com"]) {
    assert.equal(safeReturnPath(value), "/patients");
  }
});
