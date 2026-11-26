import { generateKeyPairSync, verify } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import axios, {
  type AxiosAdapter,
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { HttpFhirClient } from "../src/fhir/client.js";
import {
  loadPrivateKey,
  SmartAuthError,
  SmartBackendTokens,
} from "../src/security/smart-backend.js";

const BASE = new URL("https://fhir.example.org/r4/");
const TOKEN_URL = "https://auth.example.org/token";
const ec = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = mkdtempSync(path.join(tmpdir(), "smart-backend-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Reply = { status: number; data: unknown };
interface Seen {
  method: string;
  url: string;
  auth?: string;
  body?: string;
}

function http(replies: Reply[]) {
  const seen: Seen[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    seen.push({
      method: (config.method ?? "get").toUpperCase(),
      url: config.url ?? "",
      auth: AxiosHeaders.from(config.headers).get("Authorization") as
        | string
        | undefined,
      body: typeof config.data === "string" ? config.data : undefined,
    });
    const reply = replies.shift() ?? { status: 500, data: {} };
    const response = {
      config,
      data: reply.data,
      headers: new AxiosHeaders(),
      status: reply.status,
      statusText: String(reply.status),
    };
    if (reply.status >= 400)
      throw new AxiosError("fail", "ERR", config, null, response);
    return response;
  };
  return { instance: axios.create({ adapter }), seen, adapter };
}

const discovery: Reply = { status: 200, data: { token_endpoint: TOKEN_URL } };
const token = (value = "synthetic-access", expires_in = 300): Reply => ({
  status: 200,
  data: { access_token: value, token_type: "bearer", expires_in },
});

function tokens(
  replies: Reply[],
  key = ec.privateKey,
  now = () => 1_800_000_000_000,
) {
  const { instance, seen } = http(replies);
  const source = new SmartBackendTokens({
    fhirBase: BASE,
    clientId: "synthetic-client",
    keyId: "synthetic-kid",
    privateKey: key,
    scope: "system/Patient.rs",
    timeoutMs: 1000,
    http: instance,
    now,
  });
  return { source, seen };
}

function decode(jwt: string) {
  const [h, c] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h ?? "", "base64url").toString()),
    claims: JSON.parse(Buffer.from(c ?? "", "base64url").toString()),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("SMART Backend Services tokens", () => {
  it("discovers the token endpoint and sends a signed ES384 client assertion", async () => {
    const { source, seen } = tokens([discovery, token()]);
    expect(await source.token()).toBe("synthetic-access");
    expect(seen[0]?.url).toBe(
      "https://fhir.example.org/r4/.well-known/smart-configuration",
    );
    const form = new URLSearchParams(seen[1]?.body);
    expect(seen[1]?.url).toBe(TOKEN_URL);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("system/Patient.rs");
    expect(form.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    const jwt = form.get("client_assertion") ?? "";
    const { header, claims } = decode(jwt);
    expect(header).toEqual({ alg: "ES384", kid: "synthetic-kid", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: "synthetic-client",
      sub: "synthetic-client",
      aud: TOKEN_URL,
    });
    expect(claims.exp - claims.iat).toBe(300);
    const [h, c, s] = jwt.split(".");
    expect(
      verify(
        "sha384",
        Buffer.from(`${h}.${c}`),
        { key: ec.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(s ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("signs RS384 with an RSA key and uses a fresh jti each time", () => {
    const { source } = tokens([], rsa.privateKey);
    const a = source.assertion(new URL(TOKEN_URL));
    const b = source.assertion(new URL(TOKEN_URL));
    expect(decode(a).header.alg).toBe("RS384");
    expect(decode(a).claims.jti).not.toBe(decode(b).claims.jti);
    const [h, c, s] = a.split(".");
    expect(
      verify(
        "sha384",
        Buffer.from(`${h}.${c}`),
        rsa.publicKey,
        Buffer.from(s ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("refuses keys that are not RSA 2048+ or EC P-384", () => {
    const weak = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() => tokens([], weak.privateKey)).toThrow(SmartAuthError);
  });

  it("caches the token and shares one request between concurrent callers", async () => {
    const { source, seen } = tokens([discovery, token()]);
    const results = await Promise.all([
      source.token(),
      source.token(),
      source.token(),
    ]);
    expect(new Set(results)).toEqual(new Set(["synthetic-access"]));
    await source.token();
    expect(seen.filter((s) => s.url === TOKEN_URL)).toHaveLength(1);
  });

  it("requests a new token shortly before expiry", async () => {
    let now = 1_800_000_000_000;
    const { source, seen } = tokens(
      [discovery, token("first", 120), token("second", 120)],
      ec.privateKey,
      () => now,
    );
    expect(await source.token()).toBe("first");
    now += 61_000;
    expect(await source.token()).toBe("second");
    expect(seen.filter((s) => s.url === TOKEN_URL)).toHaveLength(2);
  });

  it("refuses a non-HTTPS token endpoint from discovery", async () => {
    const { source, seen } = tokens([
      {
        status: 200,
        data: { token_endpoint: "http://auth.example.org/token" },
      },
    ]);
    await expect(source.token()).rejects.toThrow(
      "Invalid SMART token endpoint",
    );
    expect(seen).toHaveLength(1);
  });

  it("never surfaces the token response body", async () => {
    const { source } = tokens([
      discovery,
      {
        status: 400,
        data: { error: "invalid_client", detail: "synthetic-secret-detail" },
      },
    ]);
    const error = await source.token().catch((e: Error) => e);
    expect(String(error)).toBe("SmartAuthError: SMART token request failed");
  });

  it("refuses a token response that is not a bearer token", async () => {
    const { source } = tokens([
      discovery,
      {
        status: 200,
        data: { access_token: "x", token_type: "mac", expires_in: 300 },
      },
    ]);
    await expect(source.token()).rejects.toThrow("SMART token request failed");
  });
});

describe("FHIR client with SMART tokens", () => {
  const config = ConfigSchema.parse({
    AUDIT_HMAC_KEY: "a".repeat(64),
    FHIR_BASE_URL: BASE.href,
  });
  const patient = {
    status: 200,
    data: { resourceType: "Patient", id: "synthetic-1" },
  };

  function fhir(replies: Reply[], tokenReplies: Reply[]) {
    const { adapter, seen } = http(replies);
    axios.defaults.adapter = adapter;
    const { source } = tokens(tokenReplies);
    return { client: new HttpFhirClient(config, source), seen };
  }

  it("sends the bearer token to the FHIR server", async () => {
    const { client, seen } = fhir([patient], [discovery, token()]);
    await client.getPatient("synthetic-1");
    expect(seen[0]?.auth).toBe("Bearer synthetic-access");
  });

  it("retries once with a new token after a 401", async () => {
    const { client, seen } = fhir(
      [{ status: 401, data: {} }, patient],
      [discovery, token("old"), token("new")],
    );
    await client.getPatient("synthetic-1");
    expect(seen.map((s) => s.auth)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("fails after a second 401 without looping", async () => {
    const { client, seen } = fhir(
      [
        { status: 401, data: {} },
        { status: 401, data: {} },
      ],
      [discovery, token("old"), token("new")],
    );
    await expect(client.getPatient("synthetic-1")).rejects.toThrow(
      "FHIR request failed",
    );
    expect(seen).toHaveLength(2);
  });

  it("maps token failures to a fixed FHIR error", async () => {
    const { client, seen } = fhir([patient], [{ status: 500, data: {} }]);
    await expect(client.getPatient("synthetic-1")).rejects.toThrow(
      "FHIR authorization failed",
    );
    expect(seen).toHaveLength(0);
  });
});

describe("SMART configuration", () => {
  const base = {
    AUDIT_HMAC_KEY: "a".repeat(64),
    FHIR_BASE_URL: BASE.href,
    NODE_ENV: "test",
  };

  it("needs client id, key id and key file together", () => {
    expect(
      ConfigSchema.safeParse({ ...base, SMART_CLIENT_ID: "c" }).success,
    ).toBe(false);
    expect(
      ConfigSchema.safeParse({
        ...base,
        SMART_CLIENT_ID: "c",
        SMART_KEY_ID: "k",
        SMART_PRIVATE_KEY_FILE: "/k.pem",
      }).success,
    ).toBe(true);
  });

  it("refuses a static token together with SMART", () => {
    expect(
      ConfigSchema.safeParse({
        ...base,
        FHIR_AUTH_TOKEN: "t",
        SMART_CLIENT_ID: "c",
        SMART_KEY_ID: "k",
        SMART_PRIVATE_KEY_FILE: "/k.pem",
      }).success,
    ).toBe(false);
  });

  it("accepts only system scopes", () => {
    const smart = {
      ...base,
      SMART_CLIENT_ID: "c",
      SMART_KEY_ID: "k",
      SMART_PRIVATE_KEY_FILE: "/k.pem",
    };
    expect(
      ConfigSchema.safeParse({ ...smart, SMART_SCOPE: "patient/*.rs" }).success,
    ).toBe(false);
    expect(
      ConfigSchema.parse(smart)
        .SMART_SCOPE.split(" ")
        .every((s) => s.startsWith("system/")),
    ).toBe(true);
  });

  it("refuses a private key file readable by others", () => {
    const file = path.join(dir, "key.pem");
    writeFileSync(
      file,
      ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    chmodSync(file, 0o644);
    expect(() => loadPrivateKey(file)).toThrow("chmod 600");
    chmodSync(file, 0o600);
    expect(loadPrivateKey(file).asymmetricKeyType).toBe("ec");
    const link = path.join(dir, "key-link.pem");
    symlinkSync(file, link);
    expect(() => loadPrivateKey(link)).toThrow("could not be read");
  });
});
