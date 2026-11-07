# n8n for the Lab's "Automatización en vivo" (docs/AUTOMATIZACION.md). Same image on Render and in
# docker-compose.yml. Stateless: the workflow is imported and published while the image is built, so a
# boot only runs `n8n start` (each extra n8n command costs about a minute on Render Free's 0.1 CPU).
# Build context: automations/. Details: automations/README.md.

# n8n 2.45.2, published 2026-10-22 (DEC-002). The digest is the multi-arch index, identical on docker.n8n.io and
# Docker Hub. Pulled from GitHub's registry: Render builds from shared IPs that hit Docker Hub's anonymous pull
# limit (429 Too Many Requests on the first deploy, 2026-11-07).
FROM ghcr.io/n8n-io/n8n:2.45.2@sha256:fd7f4dc4617e9113c499ba62a6c58f17df2dce3dd82028e357485947af383041

# Settings shared by the build and every boot. scripts/entrypoint.sh adds the per-mode ones.
ENV GENERIC_TIMEZONE=America/Bogota \
    TZ=America/Bogota \
    # Heap cap: leaves room for code and native memory inside Render Free's 512 MB.
    NODE_OPTIONS=--max-old-space-size=320 \
    # Filled while the image is built (scripts/prepare-image.sh); saves 13–35 s of parsing per boot
    # on 0.1 CPU for ~30–60 MiB of memory.
    NODE_COMPILE_CACHE=/home/node/.cache/node-compile \
    N8N_PROXY_HOPS=1 \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_VERSION_NOTIFICATIONS_ENABLED=false \
    N8N_TEMPLATES_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    N8N_HIRING_BANNER_ENABLED=false \
    N8N_DYNAMIC_BANNERS_ENABLED=false \
    N8N_LICENSE_AUTO_RENEW_ENABLED=false \
    N8N_PUBLIC_API_DISABLED=true \
    N8N_PUBLIC_API_SWAGGERUI_DISABLED=true \
    EXECUTIONS_DATA_SAVE_ON_SUCCESS=none \
    EXECUTIONS_DATA_SAVE_ON_ERROR=none \
    EXECUTIONS_DATA_SAVE_ON_PROGRESS=false \
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=false \
    N8N_CONCURRENCY_PRODUCTION_LIMIT=5 \
    N8N_PAYLOAD_SIZE_MAX=1 \
    # The workflow reads AIM_SITE_ORIGIN with $env. Nothing secret lives in the environment.
    N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
    N8N_UNVERIFIED_PACKAGES_ENABLED=false \
    N8N_RUNNERS_TASK_TIMEOUT=60 \
    N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES=268435456 \
    N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES=1000 \
    # Webhook mode loads none of these (the editor mode turns them back on).
    N8N_DISABLED_MODULES=insights,external-secrets,community-packages,data-table,oauth-server,mcp,mcp-discovery,provisioning,breaking-changes,source-control,dynamic-credentials,chat-hub,sso-oidc,sso-saml,log-streaming,ldap,quick-connect,workflow-builder,favorites,redaction,instance-registry,otel,token-exchange,instance-version-history,oauth-jwe,n8n-packages,runtime-credentials,mcp-registry,workflow-reviews,inbox,instance-ai,agents,agent-evals,scim,type-availability-policies,inbound-auth-core,policy-infrastructure,encryption-key-manager

COPY --chown=node:node workflows/lead-demo.json /opt/aim/workflows/lead-demo.json
COPY --chown=node:node scripts/entrypoint.sh scripts/prepare-image.sh /opt/aim/scripts/

# Runs as the image's non-root `node` user: imports and publishes the workflow, warms the compile cache
# and leaves no instance key behind (a new random one is created on every boot).
RUN sh /opt/aim/scripts/prepare-image.sh

USER node
EXPOSE 5678
ENTRYPOINT ["tini", "--", "sh", "/opt/aim/scripts/entrypoint.sh"]
