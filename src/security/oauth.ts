// SMART on FHIR OAuth 2.1 + PKCE stub.
//
// Production path:
//   1. Discover SMART endpoints at
//      `${FHIR_BASE_URL}/.well-known/smart-configuration`.
//   2. Run the authorization code flow with PKCE (RFC 7636, S256
//      code challenge) against `authorization_endpoint`.
//   3. Exchange the code at `token_endpoint`, binding the scopes to
//      the granted clinical context (patient/*.read, user/*.read).
//   4. Cache the access token in memory only; refresh before expiry
//      using the refresh_token grant.
//   5. Validate the audience and issuer of the token on every use.
//
// The public r4.smarthealthit.org sandbox does not require auth, so
// this module is intentionally a structured no-op in the prototype.

import { createHash, randomBytes } from "node:crypto";

export interface SmartConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  scopes_supported: string[];
  code_challenge_methods_supported: string[];
}

export interface AccessToken {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: number;
  scope: string;
  refreshToken?: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

export function generatePkcePair(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge, method: "S256" };
}

export class SmartOnFhirClient {
  constructor(
    private readonly fhirBaseUrl: string,
    private readonly clientId: string,
    private readonly redirectUri: string,
  ) {}

  // TODO(prod): GET `${fhirBaseUrl}/.well-known/smart-configuration`.
  async discover(): Promise<SmartConfig> {
    throw new NotImplementedInPrototype(
      "SMART discovery",
      this.fhirBaseUrl,
    );
  }

  // TODO(prod): build the authorize URL with client_id, redirect_uri,
  // scope, state, aud, code_challenge, code_challenge_method=S256.
  buildAuthorizeUrl(_config: SmartConfig, _scope: string, _state: string, _pkce: PkcePair): string {
    throw new NotImplementedInPrototype(
      "authorize URL construction",
      `${this.clientId}@${this.redirectUri}`,
    );
  }

  // TODO(prod): POST to `token_endpoint` with grant_type=authorization_code,
  // the code, the code_verifier, client_id, and redirect_uri.
  async exchangeCode(
    _config: SmartConfig,
    _code: string,
    _pkce: PkcePair,
  ): Promise<AccessToken> {
    throw new NotImplementedInPrototype("SMART token exchange");
  }

  // TODO(prod): refresh the access token using the refresh_token grant.
  async refresh(
    _config: SmartConfig,
    _refreshToken: string,
  ): Promise<AccessToken> {
    throw new NotImplementedInPrototype("SMART token refresh");
  }
}

class NotImplementedInPrototype extends Error {
  constructor(feature: string, detail?: string) {
    super(
      `${feature} not implemented in prototype${detail ? ` (${detail})` : ""}`,
    );
    this.name = "NotImplementedInPrototype";
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
