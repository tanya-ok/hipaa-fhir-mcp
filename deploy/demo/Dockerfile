# Public demo: the released image, the synthetic-only policy, HTTP in demo mode.
# Build after a release that includes the HTTP transport, for example:
#   docker build --build-arg VERSION=0.8.1 -t hipaa-fhir-mcp-demo deploy/demo
ARG VERSION
FROM ghcr.io/tanya-ok/hipaa-fhir-mcp:${VERSION}
COPY --chown=node:node patient-policy.json /app/demo-policy.json
ENV MCP_DEMO=1 \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=8080 \
    MCP_RATE_LIMIT_PER_MINUTE=30 \
    FHIR_BASE_URL=https://r4.smarthealthit.org \
    PATIENT_POLICY_FILE=/app/demo-policy.json \
    NODE_ENV=production
EXPOSE 8080
CMD ["dist/http-server.js"]
