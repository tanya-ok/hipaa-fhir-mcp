"""Real SPIRE mTLS/OAuth/FHIR checks, printing only bounded synthetic outcomes."""

from __future__ import annotations

import asyncio
import json
import ssl
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx2
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat
from spiffe import WorkloadApiClient

from mcp_svid_auth.agent_client import UrlPolicy, call_tool
from mcp_svid_auth.authz import CLIENT_ASSERTION_TYPE
from mcp_svid_auth.pinned_transport import PinnedTransport

ISSUER = "http://authz:8100"
RESOURCE = "https://fhir.security-lab.svc.cluster.local:8443/mcp"
POLICY = UrlPolicy(allow_http=True, allow_private=True)


def assertion() -> str:
    with WorkloadApiClient() as client:
        return str(client.fetch_jwt_svid(audience={ISSUER}).token)


def token(resource: str = RESOURCE, scope: str = "fhir:read") -> str:
    result = httpx2.post(
        ISSUER + "/token",
        timeout=10,
        trust_env=False,
        data={
            "grant_type": "client_credentials",
            "client_assertion_type": CLIENT_ASSERTION_TYPE,
            "client_assertion": assertion(),
            "resource": resource,
            "scope": scope,
        },
    )
    result.raise_for_status()
    return str(result.json()["access_token"])


def tls_context(directory: Path, *, certificate: bool = True) -> ssl.SSLContext:
    with WorkloadApiClient() as client:
        material = client.fetch_x509_context()
        svid = material.default_svid
        bundle = material.x509_bundle_set.get_bundle_for_trust_domain(svid.spiffe_id.trust_domain)
        if bundle is None:
            raise RuntimeError("trust bundle unavailable")
        ca = b"".join(cert.public_bytes(Encoding.PEM) for cert in bundle.x509_authorities)
        context = ssl.create_default_context(cadata=ca.decode("ascii"))
        if certificate:
            cert_path, key_path = directory / "cert.pem", directory / "key.pem"
            cert_path.write_bytes(
                b"".join(cert.public_bytes(Encoding.PEM) for cert in svid.cert_chain)
            )
            key_path.write_bytes(
                svid.private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
            )
            cert_path.chmod(0o600)
            key_path.chmod(0o600)
            context.load_cert_chain(cert_path, key_path)
        return context


async def run(mode: str) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="fhir-probe-") as staging:
        context = tls_context(Path(staging), certificate=mode != "no-cert")

        if mode == "no-cert":
            # Only the container probe needs this shared, image-local helper.
            from probe_mtls import missing_certificate_is_rejected

            addresses = await POLICY.addresses(RESOURCE)
            for address in addresses:
                if not await asyncio.to_thread(
                    missing_certificate_is_rejected,
                    context,
                    address,
                    "fhir.security-lab.svc.cluster.local",
                    8443,
                ):
                    return {"event": "fhir_no-cert", "ok": False}
            return {"event": "fhir_no-cert", "ok": bool(addresses)}

        def http(**kwargs: Any) -> httpx2.AsyncClient:
            return httpx2.AsyncClient(
                trust_env=False,
                timeout=15,
                transport=PinnedTransport(POLICY.addresses, verify=context),
                **kwargs,
            )

        async with http() as client:
            if mode == "intruder":
                try:
                    response = await client.post(
                        RESOURCE, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
                    )
                    ok = response.status_code == 401
                except (ssl.SSLError, httpx2.TransportError):
                    ok = False
                return {"event": "fhir_" + mode, "ok": ok}
            deadline = time.monotonic() + 90
            while True:
                try:
                    metadata = await client.get(
                        RESOURCE.replace("/mcp", "/.well-known/oauth-protected-resource/mcp")
                    )
                    if metadata.status_code == 200 and metadata.json().get("resource") == RESOURCE:
                        break
                except httpx2.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("FHIR readiness timeout")
                await asyncio.sleep(2)
            credential = token()
            for tool, arguments, marker in (
                ("get_patient", {"patient_id": "demo-001"}, '"resourceType": "Patient"'),
                (
                    "search_observations",
                    {"patient_id": "demo-001", "code": "http://loinc.org|8867-4"},
                    '"resourceType": "Observation"',
                ),
                (
                    "get_medication_list",
                    {"patient_id": "demo-001"},
                    '"resourceType": "MedicationRequest"',
                ),
            ):
                result = await call_tool(
                    RESOURCE, credential, tool, arguments, http=http, url_policy=POLICY
                )
                if marker not in result:
                    raise RuntimeError("FHIR tool check failed")
            base = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "get_patient", "arguments": {"patient_id": "demo-001"}},
            }
            wrong = await client.post(
                RESOURCE,
                headers={
                    "Authorization": "Bearer " + token("http://notes-a:8101/mcp", "notes:read")
                },
                json=base,
            )
            missing = await client.post(RESOURCE, json=base)
            invalid = await client.post(
                RESOURCE,
                headers={"Authorization": "Bearer " + credential},
                json={
                    **base,
                    "params": {"name": "get_patient", "arguments": {"patient_id": "/bad/"}},
                },
            )
            unknown = await client.post(
                RESOURCE,
                headers={"Authorization": "Bearer " + credential},
                json={**base, "params": {"name": "unknown", "arguments": {}}},
            )
            statuses = [
                wrong.status_code,
                missing.status_code,
                invalid.status_code,
                unknown.status_code,
            ]
            return {
                "event": "fhir_integration",
                "ok": statuses == [401, 401, 400, 400],
                "tools": 3,
                "denial_statuses": statuses,
            }


def audit_check(output: str) -> dict[str, Any]:
    records = [json.loads(line) for line in output.splitlines() if '"patient_id_hmac"' in line]
    ok = (
        len(records) == 4
        and all(
            record["caller_identity"] == "spiffe://example.org/agent/research" for record in records
        )
        and "demo-001" not in output
        and "/bad/" not in output
    )
    return {"event": "fhir_audit", "ok": ok}


if __name__ == "__main__":
    try:
        result = (
            audit_check(sys.stdin.read())
            if sys.argv[1] == "audit"
            else asyncio.run(run(sys.argv[1]))
        )
        print(json.dumps(result))
    except Exception:
        print(json.dumps({"event": "fhir_probe_failed", "ok": False}))
        raise SystemExit(1) from None
