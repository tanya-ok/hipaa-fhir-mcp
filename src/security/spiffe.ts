// SPIFFE Workload Identity stub.
//
// Production path:
//   1. Read the X.509-SVID from the SPIFFE Workload API over the Unix
//      Domain Socket at `$SPIFFE_ENDPOINT_SOCKET`, typically
//      `unix:///spiffe-workload-api/spire-agent.sock`.
//   2. Validate the SVID chain against the trust bundle served by the
//      SPIRE Agent - trust bundles rotate, never pin the CA.
//   3. Enforce that the SPIFFE ID of the caller matches an allowlist
//      (e.g. `spiffe://rescue.internal/hipaa-fhir-mcp`).
//   4. SVIDs are intentionally short-lived - refresh on the interval
//      recommended by the Workload API (minutes, not hours).
//
// In the prototype we surface a static identity from the env so audit
// records still carry a caller identity.

export interface WorkloadIdentity {
  spiffeId: string;
  notAfter: Date;
}

export interface SpiffeIdentityProvider {
  getIdentity(): Promise<WorkloadIdentity>;
  validatePeerSvid(pemChain: string, expectedId: string): boolean;
}

export class StaticSpiffeIdentityProvider implements SpiffeIdentityProvider {
  constructor(private readonly spiffeId: string) {}

  async getIdentity(): Promise<WorkloadIdentity> {
    return {
      spiffeId: this.spiffeId,
      notAfter: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  validatePeerSvid(_pemChain: string, _expectedId: string): boolean {
    throw new Error(
      "SPIFFE SVID validation not implemented in prototype - run against SPIRE Agent",
    );
  }
}

export class WorkloadApiSpiffeIdentityProvider
  implements SpiffeIdentityProvider
{
  constructor(private readonly socketPath: string) {}

  // TODO(prod): open a gRPC stream against the Workload API and parse
  // the X509SVIDResponse into an x509-svid structure.
  async getIdentity(): Promise<WorkloadIdentity> {
    throw new Error(
      `Workload API client not implemented in prototype (socket=${this.socketPath})`,
    );
  }

  // TODO(prod): verify the presented PEM chain against the current trust
  // bundle and enforce `expectedId` equality on the SAN URI.
  validatePeerSvid(_pemChain: string, _expectedId: string): boolean {
    throw new Error("SPIFFE SVID validation not implemented in prototype");
  }
}
