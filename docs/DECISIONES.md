# DECISIONES.md

Registro de decisiones del proyecto. Cada una: contexto, decisión, alternativas, consecuencias. Las marcadas **PENDIENTE** necesitan respuesta de David antes de la fase indicada.

---

## DEC-001 — Nombre de marca · PENDIENTE (antes de Fase 1)

- **Contexto:** la tarjeta muestra el monograma "AM"; David se refiere a la marca como "AIM".
- **Decisión provisional:** se usa **AIM** en código y textos (`@aim/*`). El nombre visible sale de una sola constante de contenido, así que cambiarlo es un cambio de una línea.
- **Pendiente:** confirmar la grafía oficial y su significado.

## DEC-002 — Cadena de suministro: versiones exactas y 14 días

- **Decisión:** dependencias con versión exacta; nada publicado hace menos de 14 días (`minimumReleaseAge: 20160` en `pnpm-workspace.yaml`, `minimumReleaseAge` en Renovate). Excepciones solo para parches de seguridad, listadas aquí con su aviso.
- **Base:** se reutiliza el conjunto ya probado en el proyecto de la agencia (TypeScript 5.9.3, Biome 2.5.15, Turbo 2.11.7, Vitest 5.0.3, Astro 7.3.8, Preact 10.29.8). TypeScript 7 queda fuera hasta que Astro y NestJS lo soporten de forma probada.
- **Excepciones vigentes:** ninguna.

## DEC-003 — Monorepo y stack

- **Decisión:** pnpm + Turborepo. Web en Astro estático con islas Preact; API en NestJS 12 (ESM, Express); contratos Zod compartidos; demos de Python en FastAPI (Fase 4).
- **Por qué:** es el stack real de David (agencia, ERP contable, SAEM) y cada pieza es parte de lo que el sitio demuestra.
- **Alternativa descartada:** Next.js (más JS en cliente, sin ventaja para un sitio mayormente estático).

## DEC-004 — Contenido como datos

- **Decisión:** proyectos, servicios y certificados viven como MDX/JSON en el repo, validados con `@aim/contracts`.
- **Consecuencia:** publicar es hacer push; sin base de datos ni CMS que mantener. Un CMS (p. ej. Strapi) entraría después como adaptador sin cambiar los esquemas.

## DEC-005 — Hosting de la API NestJS

- **Decisión:** contenedor Docker en un proveedor de contenedores (Render, Fly.io o Railway). Se elige el proveedor al iniciar la Fase 2.
- **Por qué:** Cloudflare Workers no corre NestJS de forma fiable. El sitio público sigue en Cloudflare (estático, gratis).
- **Alternativa descartada:** Hono en Workers (gratis, pero dejaría de mostrar NestJS, que es el núcleo del perfil).

## DEC-006 — Precios en el sitio · PENDIENTE (antes de Fase 1)

- **Decisión:** rangos "desde" por servicio, porque filtran clientes.
- **Pendiente:** los valores. Mientras no existan, el sitio muestra "Cotiza sin costo" y nunca inventa cifras.

## DEC-007 — Dominio · PENDIENTE (antes del despliegue de Fase 1)

- **Decisión provisional:** ningún host escrito en el código; todo sale de `PUBLIC_BASE_URL`.

## DEC-008 — Proyectos públicos · PENDIENTE (antes de Fase 1)

- **Contexto:** el repo de la agencia es privado; los proyectos de clientes requieren su permiso; el trabajo de SAEM no se muestra con código.
- **Decisión provisional:** los casos se publican sin enlaces a repos privados hasta que David confirme cada uno.

## DEC-009 — Cuentas

- **Decisión:** este es un proyecto personal de David; se usan sus cuentas personales (GitHub `DalejoGo`, Cloudflare, Neon). Nada de este proyecto toca cuentas de SAEM ni de la agencia.
