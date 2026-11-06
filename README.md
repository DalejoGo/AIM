# AIM · Desarrollo Web y Automatización

Sitio de AIM (servicios) y portafolio de David Alejandro Gómez Ramírez. Monorepo TypeScript (pnpm + Turborepo).

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Decisiones: [`docs/DECISIONES.md`](docs/DECISIONES.md)
- Diseño: [`docs/DISENO.md`](docs/DISENO.md)
- **Editar precios, contactos, proyectos y demos:** [`docs/CONTENIDO.md`](docs/CONTENIDO.md)
- Reglas: [`CLAUDE.md`](CLAUDE.md)

## Requisitos

Node 22 (`.nvmrc`), pnpm 10, Docker.

## Inicio rápido

```bash
fnm use                 # o nvm use → Node 22
pnpm install
cp .env.example .env
docker compose up -d    # Postgres :54321, Valkey :6381, Mailpit :8026
pnpm dev                # web http://localhost:4321, api http://localhost:3000/docs
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/web` | Sitio público (Astro + Preact + Tailwind) |
| `apps/web/src/content` | Contenido editable: servicios, precios, proyectos, Lab, certificados |
| `apps/web/src/features` | Demos interactivas del Lab (lógica pura + isla Preact) |
| `apps/api` | API (NestJS 12) con Swagger en `/docs` |
| `packages/contracts` | Esquemas Zod compartidos |
| `packages/config` | tsconfig compartidos |
| `services/py-lab` | Demos en Python (Fase 4) |
| `automations` | Flujos n8n (Fase 4) |
| `scripts/ci` | Lógica de CI; el YAML solo la invoca |

## Verificación

```bash
bash scripts/ci/all.sh   # lint, tipos, pruebas, build, E2E + accesibilidad
```
