# DECISIONES.md

Registro de decisiones del proyecto. Cada una: contexto, decisión, alternativas, consecuencias. Las marcadas **PENDIENTE** necesitan respuesta de David antes de la fase indicada.

---

## DEC-001 — Nombre de marca

- **Decisión (David, 2026-11-06):** la marca es **AIM · Desarrollo Web y Automatización**, con David como fundador. El sitio es de marca (sin foto personal): logo AIM y video de presentación.
- **Consecuencia:** el nombre visible y todos los datos de contacto salen de `apps/web/src/content/site.json`.

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

## DEC-006 — Precios en el sitio

- **Decisión (David, 2026-11-06):** rangos "desde" por servicio. David pidió que Claude propusiera las tarifas iniciales y que sean **editables**: viven en `apps/web/src/content/services/*.json` (COP y USD) y en `quote.json` (cotizador). Son una referencia de arranque, no un dato de mercado verificado.
- **Consecuencia:** cambiar un precio es editar un JSON; si un servicio no tiene precio, el sitio muestra "Cotiza sin costo".

## DEC-007 — Dominio

- **Decisión (David, 2026-11-06):** `aim.dev` está registrado por otra persona; David eligió **aimweb.dev** y lo comprará él. Mientras tanto el sitio está en Cloudflare Pages: https://aimweb-9hc.pages.dev.
- **Descartado:** la URL de Workers (`*.subdominio-de-la-cuenta.workers.dev`), porque el subdominio de la cuenta deja ver el nombre del cliente de la agencia (DEC-008).
- **Consecuencia:** ningún host escrito en el código; todo sale de `PUBLIC_BASE_URL`. Pasos en `docs/DESPLIEGUE.md`.

## DEC-008 — Proyectos públicos

- **Decisión (David, 2026-11-06):** se publican **la agencia de viajes (anónima)** y **Marea**. El resto del portafolio son proyectos nuevos e interactivos del Lab.
- **Agencia:** sin nombre ni logo del cliente, sin enlaces al repo privado ni a staging, sin IDs de cuentas.
- **Marea:** sin datos financieros reales en capturas.
- **Métricas:** solo hechos verificables en cada repo (pruebas, módulos, Lighthouse), nunca métricas de negocio inventadas.

## DEC-009 — Cuentas

- **Decisión:** este es un proyecto personal de David; se usan sus cuentas personales (GitHub `DalejoGo`, Cloudflare, Neon). Nada de este proyecto toca cuentas de SAEM ni de la agencia.

## DEC-010 — Visitantes de cualquier lugar

- **Decisión (David, 2026-11-06):** el sitio no se ata a una ciudad: atención 100 % remota y trato que haga sentir bienvenido a cualquier visitante. Tono cercano (tú).
- **Consecuencia:** precios en COP y USD con selector; el idioma inglés llega en la Fase 5 y los textos de interfaz viven en `src/i18n/` desde ya.

## DEC-011 — Lab guiado por certificaciones

- **Decisión (David, 2026-11-06):** cada certificación tiene (o tendrá) una demo en el Lab que la pruebe. Arranque: Cotizador, Migrador de datos y Auth Lab (solo navegador, Fase 1) y Asistente IA (necesita servidor, Fase 2-3). El resto aparece como "próximamente" y se agrega con un archivo en `apps/web/src/content/lab/`.

## DEC-012 — Contacto editable

- **Decisión (David, 2026-11-06):** se muestran WhatsApp, correo, LinkedIn, GitHub y formulario, todos configurables en `site.json`.

## DEC-013 — Librerías de la Fase 1

- **Decisión:** Tailwind CSS 4 (tokens con `@theme`), fuentes auto-hospedadas con Fontsource (Unbounded, Instrument Sans, JetBrains Mono), `@preact/signals` para el estado de las islas, Lucide y Simple Icons para íconos, PapaParse para CSV, `oauth4webapi` para PKCE, `schema-dts` para tipar JSON-LD, Playwright + axe para E2E y accesibilidad. Todas con más de 14 días publicadas (DEC-002).
