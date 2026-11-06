# DECISIONES.md

Registro de decisiones del proyecto. Cada una: contexto, decisión, alternativas, consecuencias. Las marcadas **PENDIENTE** necesitan respuesta de David antes de la fase indicada.

---

## DEC-001 — Nombre de marca

- **Decisión (David, 2026-11-06):** el nombre oficial es **AIM Desarrollo y Automatizaciones** (antes "AIM · Desarrollo Web y Automatización"), con David como fundador. Se escribe con AIM en mayúsculas y el resto normal; en textos cortos basta "AIM". El sitio es de marca (sin foto personal): logo AIM y video de presentación.
- **Consecuencia:** el nombre visible (`brand.fullName`, `brand.name`, `brand.descriptor`) y todos los datos de contacto salen de `apps/web/src/content/site.json`.

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
- **Actualización (David, 2026-11-06):** por ahora se queda el subdominio gratuito `aimweb-9hc.pages.dev`; `aimweb.dev` se compra más adelante.
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

## DEC-014 — API híbrida

- **Decisión (David, 2026-11-06):** los contactos, el cotizador y el login del panel corren en **Cloudflare Pages Functions con Hono** (`apps/edge`), en el mismo dominio del sitio (`/api/*`): gratis, sin arranque en frío y sin CORS. **NestJS** (`apps/api`) se despliega en Render (plan gratuito) solo para la demo API Playground del Lab (Fase 3), donde esperar a que despierte es aceptable.
- **Reemplaza** parcialmente DEC-005 (NestJS ya no recibe los contactos).
- **Restricción:** el plan gratuito de Workers limita la CPU a ~10 ms por petición: nada de hashes de contraseña costosos en `apps/edge`.

## DEC-015 — Datos en Neon Postgres

- **Decisión (David, 2026-11-06):** proyecto nuevo `aim` en la cuenta personal de Neon. Drizzle ORM con `pg`; migraciones con drizzle-kit. En local, el Postgres de `docker-compose.yml`; en pruebas, PGlite (Postgres en memoria, sin Docker).

## DEC-016 — Avisos de contactos

- **Decisión (David, 2026-11-06):** correo con **Resend** al llegar un contacto (mientras no haya dominio, Resend solo envía al correo de la cuenta, que es el destinatario). En local, Mailpit por su API HTTP. En la Fase 4, además, un flujo de n8n.

## DEC-017 — Login propio del panel /admin

- **Decisión (David, 2026-11-06):** login propio con **correo + código de un solo uso** (6 dígitos, 10 min, 5 intentos) enviado por Resend, solo para correos de `ADMIN_EMAILS`.
- **Middleware estilo OAuth 2.0 (seguridad media):** endpoint de token con concesiones `urn:aim:grant-type:email-otp` y `refresh_token`; token de acceso JWT (HS256, 15 min) con `scope` (`leads:read`, `leads:write`, `audit:read`); token de renovación opaco (7 días) con **rotación y detección de reutilización** por familia; ambos en cookies `HttpOnly`, `Secure`, `SameSite=Strict`. El middleware también acepta `Authorization: Bearer` (RFC 6750) para clientes de API. Peticiones que cambian estado exigen `Origin` del propio sitio.
- **Protecciones:** sin enumeración de usuarios (la respuesta a "pedir código" es siempre igual), límites de intentos por correo e IP, códigos y tokens guardados solo como HMAC-SHA-256, registro de auditoría de accesos.
- **Alternativas descartadas:** usuario + contraseña (el hash seguro no cabe en la CPU gratuita de Workers) y login con GitHub (David prefirió un login propio).

## DEC-018 — Modelo gratuito para el Asistente IA

- **Contexto:** David no quiere pagar créditos de Anthropic por ahora.
- **Decisión (David, 2026-11-06):** el asistente usa **Cloudflare Workers AI con Gemma 4** (`@cf/google/gemma-4-26b-a4b-it`) mediante el binding `AI` del proyecto de Pages: gratis (10.000 neurons diarios), sin API key ni tarjeta. Límite diario de 120 mensajes para no pasar el cupo.
- **Alternativas:** Qwen3 30B en Workers AI (más mensajes, a veces razona de más); Gemini con plan gratuito (requiere key y Google puede usar las conversaciones).
- **Consecuencia:** el adaptador de Claude se conserva: si existe `ANTHROPIC_API_KEY`, se usa Claude automáticamente (`apps/edge/src/runtime.ts`).

## DEC-019 — Content Security Policy estricta

- **Decisión (2026-11-06):** CSP nativa de Astro 7 como `<meta>` en cada página, con hashes de scripts y estilos y **sin** `'unsafe-inline'` ni `'unsafe-eval'`. Orígenes externos solo los necesarios: `https://challenges.cloudflare.com` (Turnstile, script e iframe) y el origen de `PUBLIC_PLAYGROUND_API_URL` en `connect-src` (API Playground en Render).
- **Consecuencias:** Zod corre en modo `jitless` (`src/lib/boot.ts`); nada de `style=` en las islas; fuentes siempre como archivos; resaltado de código con Prism. `e2e/csp.e2e.ts` falla si alguna página o demo provoca una violación. `frame-ancestors` no cabe en `<meta>`: lo cubre `X-Frame-Options: DENY` en `_headers`.
- **Rendimiento (Lighthouse, local, mediana de 3):** 98–100 en las cuatro categorías, móvil y escritorio (`docs/RENDIMIENTO.md`).
