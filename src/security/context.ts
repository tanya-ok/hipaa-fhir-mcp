/**
 * Who is calling, and how that was established. Built by the transport from
 * credentials it has already verified; never from tool arguments or headers
 * the model controls.
 */
export type Provenance = "spiffe-mtls+token" | "local-synthetic" | "none";

export interface RequestContext {
  readonly principal: string | null;
  readonly provenance: Provenance;
}

export const NO_CONTEXT: RequestContext = Object.freeze({
  principal: null,
  provenance: "none",
});

export function requestContext(
  principal: string,
  provenance: Exclude<Provenance, "none">,
): RequestContext {
  if (principal.length === 0) return NO_CONTEXT;
  return Object.freeze({ principal, provenance });
}
