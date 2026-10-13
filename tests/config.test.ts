import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";

const base = { AUDIT_HMAC_KEY: "ab".repeat(32), NODE_ENV: "test" };

describe("endpoint policy", () => {
  it("keeps an explicit synthetic development default", () => {
    expect(ConfigSchema.parse(base).FHIR_BASE_URL).toBe(
      "https://r4.smarthealthit.org",
    );
  });
  it("requires production to choose its endpoint without requiring a static token or file sink", () => {
    expect(
      ConfigSchema.safeParse({ ...base, NODE_ENV: "production" }).success,
    ).toBe(false);
    expect(
      ConfigSchema.parse({
        ...base,
        NODE_ENV: "production",
        FHIR_BASE_URL: "https://example.org/fhir",
        AUDIT_LOG_FILE: "",
      }),
    ).toMatchObject({ FHIR_BASE_URL: "https://example.org/fhir" });
  });
  it("requires an endpoint when execution mode is omitted", () => {
    expect(
      ConfigSchema.safeParse({ AUDIT_HMAC_KEY: base.AUDIT_HMAC_KEY }).success,
    ).toBe(false);
  });
  it("never combines a backend token with an implicit sandbox destination", () => {
    expect(
      ConfigSchema.safeParse({ ...base, FHIR_AUTH_TOKEN: "synthetic-token" })
        .success,
    ).toBe(false);
  });
  it("accepts an explicit HTTPS destination when execution mode is omitted", () => {
    expect(
      ConfigSchema.parse({
        AUDIT_HMAC_KEY: base.AUDIT_HMAC_KEY,
        FHIR_BASE_URL: "https://example.org/fhir",
      }).FHIR_BASE_URL,
    ).toBe("https://example.org/fhir");
  });
  it.each([
    "http://example.org/fhir",
    "https://user:pass@example.org/fhir",
    "https://example.org/fhir?token=x",
    "https://example.org/fhir#x",
    "file:///tmp/fhir",
    "not-a-url",
  ])("refuses unsafe endpoint %s", (FHIR_BASE_URL) => {
    expect(ConfigSchema.safeParse({ ...base, FHIR_BASE_URL }).success).toBe(
      false,
    );
  });
});

describe("audit HMAC key", () => {
  it.each([
    ["too short", "a".repeat(32)],
    ["too long", "a".repeat(65)],
    ["non-hex", "g".repeat(64)],
    ["whitespace", ` ${"a".repeat(63)}`],
  ])("refuses a %s key", (_label, AUDIT_HMAC_KEY) => {
    const result = ConfigSchema.safeParse({ ...base, AUDIT_HMAC_KEY });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "openssl rand -hex 32",
    );
  });
  it("accepts upper-case hex", () => {
    expect(
      ConfigSchema.safeParse({
        ...base,
        AUDIT_HMAC_KEY: base.AUDIT_HMAC_KEY.toUpperCase(),
      }).success,
    ).toBe(true);
  });
  it.each(["0".repeat(64), "A".repeat(32) + "a".repeat(32)])(
    "refuses a repeated-character key in production",
    (AUDIT_HMAC_KEY) => {
      const production = {
        ...base,
        AUDIT_HMAC_KEY,
        NODE_ENV: "production",
        FHIR_BASE_URL: "https://example.org/fhir",
      };
      expect(ConfigSchema.safeParse(production).success).toBe(false);
      expect(
        ConfigSchema.safeParse({ ...production, NODE_ENV: "development" })
          .success,
      ).toBe(true);
    },
  );
});
