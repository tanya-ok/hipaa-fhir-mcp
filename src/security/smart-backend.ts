// SMART Backend Services client authentication (SMART App Launch 2.2):
// OAuth client_credentials with a private_key_jwt assertion signed by RS384 or ES384.
// https://hl7.org/fhir/smart-app-launch/STU2.2/backend-services.html
import {
  createPrivateKey,
  type KeyObject,
  randomUUID,
  sign,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { Agent } from "node:https";
import axios, { type AxiosInstance } from "axios";
import { z } from "zod";

const ASSERTION_TTL_SECONDS = 300;
const MAX_TOKEN_SECONDS = 3600;
const REFRESH_SKEW_MS = 60_000;
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;

export class SmartAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartAuthError";
  }
}

export interface TokenSource {
  token(): Promise<string>;
  invalidate(): void;
}

export class StaticToken implements TokenSource {
  constructor(private readonly value: string) {}
  async token(): Promise<string> {
    return this.value;
  }
  invalidate(): void {}
}

export interface SmartBackendOptions {
  fhirBase: URL;
  clientId: string;
  keyId: string;
  privateKey: KeyObject;
  scope: string;
  tokenUrl?: URL;
  timeoutMs: number;
  http?: AxiosInstance;
  now?: () => number;
}

const DiscoverySchema = z.object({ token_endpoint: z.string().min(1) });
const TokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().int().positive(),
});

/** Plain HTTPS only: no credentials, query or fragment in the URL. */
export function safeHttpsUrl(raw: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new SmartAuthError("Invalid SMART token endpoint");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new SmartAuthError("Invalid SMART token endpoint");
  return url;
}

export function algorithmFor(key: KeyObject): "RS384" | "ES384" {
  if (key.asymmetricKeyType === "rsa") {
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < 2048)
      throw new SmartAuthError("RSA key must be 2048 bits or more");
    return "RS384";
  }
  if (
    key.asymmetricKeyType === "ec" &&
    key.asymmetricKeyDetails?.namedCurve === "secp384r1"
  )
    return "ES384";
  throw new SmartAuthError("Private key must be RSA or EC P-384");
}

const b64url = (data: Buffer | string) =>
  Buffer.from(data).toString("base64url");

export class SmartBackendTokens implements TokenSource {
  private readonly http: AxiosInstance;
  private readonly alg: "RS384" | "ES384";
  private readonly now: () => number;
  private cached?: { value: string; expiresAt: number };
  private pending?: Promise<string>;
  private tokenUrl?: URL;

  constructor(private readonly options: SmartBackendOptions) {
    this.alg = algorithmFor(options.privateKey);
    this.tokenUrl = options.tokenUrl;
    this.now = options.now ?? Date.now;
    this.http =
      options.http ??
      axios.create({
        timeout: options.timeoutMs,
        httpsAgent: new Agent({ minVersion: "TLSv1.2" }),
        maxRedirects: 0,
        proxy: false,
        maxContentLength: MAX_AUTH_RESPONSE_BYTES,
        maxBodyLength: MAX_AUTH_RESPONSE_BYTES,
      });
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - REFRESH_SKEW_MS > this.now())
      return this.cached.value;
    // One request at a time; concurrent tool calls share it.
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  /** Signed client assertion; public for tests. */
  assertion(audience: URL): string {
    const now = Math.floor(this.now() / 1000);
    const header = { alg: this.alg, kid: this.options.keyId, typ: "JWT" };
    const claims = {
      iss: this.options.clientId,
      sub: this.options.clientId,
      aud: audience.href,
      jti: randomUUID(),
      iat: now,
      exp: now + ASSERTION_TTL_SECONDS,
    };
    const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = sign(
      "sha384",
      Buffer.from(input),
      this.alg === "ES384"
        ? { key: this.options.privateKey, dsaEncoding: "ieee-p1363" }
        : this.options.privateKey,
    );
    return `${input}.${b64url(signature)}`;
  }

  private async discover(): Promise<URL> {
    if (this.tokenUrl) return this.tokenUrl;
    const discovery = new URL(
      ".well-known/smart-configuration",
      this.options.fhirBase,
    );
    let data: unknown;
    try {
      data = (
        await this.http.get(discovery.href, {
          headers: { Accept: "application/json" },
        })
      ).data;
    } catch {
      throw new SmartAuthError("SMART discovery failed");
    }
    const parsed = DiscoverySchema.safeParse(data);
    if (!parsed.success) throw new SmartAuthError("SMART discovery failed");
    this.tokenUrl = safeHttpsUrl(parsed.data.token_endpoint);
    return this.tokenUrl;
  }

  private async fetchToken(): Promise<string> {
    const tokenUrl = await this.discover();
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: this.options.scope,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: this.assertion(tokenUrl),
    });
    let data: unknown;
    try {
      data = (
        await this.http.post(tokenUrl.href, body.toString(), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        })
      ).data;
    } catch {
      // The response body may echo the assertion or server detail; never surface it.
      throw new SmartAuthError("SMART token request failed");
    }
    const parsed = TokenSchema.safeParse(data);
    if (!parsed.success) throw new SmartAuthError("SMART token request failed");
    const seconds = Math.min(parsed.data.expires_in, MAX_TOKEN_SECONDS);
    this.cached = {
      value: parsed.data.access_token,
      expiresAt: this.now() + seconds * 1000,
    };
    return this.cached.value;
  }
}

/** Reads the PEM key; refuses keys readable by group or others. */
export function loadPrivateKey(path: string): KeyObject {
  const mode = statSync(path).mode;
  if (mode & 0o077)
    throw new SmartAuthError(
      "SMART private key file must not be readable by group or others (chmod 600)",
    );
  try {
    return createPrivateKey(readFileSync(path, "utf8"));
  } catch {
    throw new SmartAuthError("SMART private key could not be read");
  }
}
