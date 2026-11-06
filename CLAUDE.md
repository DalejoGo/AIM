# CLAUDE.md — repopage (AIM)

Sitio de AIM (servicios) + portafolio y hoja de vida de David Gómez. Plan en `docs/PLAN.md`, decisiones en `docs/DECISIONES.md`.

## Reglas no negociables

1. Planear antes de construir; trabajar por fases. Cada fase cierra con `bash scripts/ci/all.sh` en verde y un resumen.
2. Versiones exactas; nada publicado hace menos de 14 días (DEC-002). Excepciones solo por seguridad y registradas.
3. Sin secretos en el código. Toda variable nueva se documenta en `.env.example`.
4. Ningún host escrito en el código: sale del entorno (`PUBLIC_BASE_URL`, etc.).
5. Nunca inventar datos sobre David: precios, testimonios, clientes, cifras o proyectos salen de él o de `docs/`.
6. Los contratos (`packages/contracts`) son la única fuente de verdad de las formas de datos entre web y API.
7. Código e identificadores en inglés; textos visibles en español (inglés en Fase 5).
8. Decisiones que cambien estas reglas o la arquitectura se registran en `docs/DECISIONES.md` antes de aplicarse.
9. Conventional Commits. David autorizó (2026-11-06) hacer commit, push, publicación en Cloudflare y migraciones en Neon **sin pedir confirmación**, siempre con `bash scripts/ci/all.sh` en verde y verificando en vivo después. Crear cuentas, pagar o manejar llaves sigue siendo de David.

## Comandos

```bash
pnpm install
pnpm dev                    # web + api
bash scripts/ci/all.sh      # lint, tipos, pruebas, build
docker compose up -d        # Postgres, Valkey, Mailpit
```
