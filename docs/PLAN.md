# PLAN.md — AIM · Desarrollo Web y Automatización

> Estado: **APROBADO (2026-11-06)**, con las recomendaciones de la sección 7 aceptadas. Las decisiones pendientes viven en [`DECISIONES.md`](DECISIONES.md); donde lo contradiga, manda ese archivo.
> **Fase 1 (sitio público):** construida en local (2026-11-06): inicio, servicios, proyectos (agencia anónima y Marea), Lab con 3 demos en vivo (Cotizador, Migrador de datos, Auth Lab) y 5 próximamente, sobre mí con certificados, privacidad. Contenido editable en `apps/web/src/content` (ver `docs/CONTENIDO.md`). Publicada en https://aimweb-9hc.pages.dev (2026-11-06); pendiente conectar aimweb.dev.
> **Fase 0 (base):** completada (2026-11-06). `scripts/ci/all.sh` en verde (13 pruebas); `docker compose up -d` levanta Postgres :54321, Valkey :6381 y Mailpit :8026. Publicada en GitHub (DalejoGo/AIM).

---

## 1. Concepto

Sitio de **AIM** como empresa de servicios y, dentro de él, el portafolio y la hoja de vida de **David Alejandro Gómez Ramírez**, fundador.

- El inicio vende servicios como una empresa; el portafolio y la hoja de vida viven en `/sobre-mi` y `/proyectos`.
- Orden de las freelancers bien organizadas (Sara Soueidan, Brittany Chiang): cada servicio con alcance claro, proceso por pasos, página de contratación directa.
- Interactividad (Josh Comeau, Bruno Simon) solo donde demuestra algo.
- **Lab**: demos en vivo del stack. Mostrar, no solo contar.
- Identidad visual tomada de la tarjeta AIM: fondo oscuro con violeta, más modo claro.

## 2. Secciones

| Ruta | Contenido |
|---|---|
| `/` | Promesa de AIM, CTA a WhatsApp o cotizar, video de 30 s, tecnologías, servicios, 3 proyectos destacados, proceso, testimonios (cuando existan), CTA final |
| `/servicios/[servicio]` | Páginas web, aplicativos, automatizaciones, blogs, chatbots: problema, qué incluye, entregables, tiempos, tecnologías, FAQ, casos relacionados |
| `/proyectos/[proyecto]` | Casos de estudio: reto, solución, rol, stack, resultados, capturas, enlaces. Filtros por tecnología y tipo |
| `/lab` | Demos en vivo (sección 3) |
| `/cotizar` | Cotizador por pasos: tipo → funcionalidades → plazo → resumen; guarda el contacto y abre WhatsApp |
| `/sobre-mi` | Historia, experiencia, estudios, habilidades, certificados con visor PDF, descarga de hoja de vida |
| `/blog` | Notas técnicas (Fase 5) |
| `/privacidad` | Tratamiento de datos (Ley 1581 de 2012) |
| `/admin` | Panel protegido de contactos |

En todo el sitio: paleta de comandos (Ctrl+K), botón flotante de WhatsApp, modo claro/oscuro, animaciones que respetan `prefers-reduced-motion`.

Proyectos candidatos: Agencia de viajes, ERP contable, Marea, catálogo e-commerce, apps móviles (Ionic/Angular/Capacitor), flujos n8n. El trabajo en SAEM se describe de forma general, sin código.

## 3. Lab

| Demo | Qué demuestra | Tecnología |
|---|---|---|
| Asistente AIM | Chatbot sobre los servicios con contenido propio; captura contactos | Claude (Haiku) detrás de la API, con límite de uso |
| API Playground | Consola de endpoints reales con respuesta y latencia; Swagger | NestJS, Drizzle, Postgres |
| Automatización en vivo | Formulario → flujo ejecutándose paso a paso | n8n, webhooks, SSE |
| Migrador de datos | CSV/Excel desordenado → datos limpios y validados, sin persistir | FastAPI, Python |
| Auth Lab | Visualizador de OAuth2 / OIDC con PKCE | — |
| Seguridad en acción | Ráfaga de peticiones → 429; cabeceras de seguridad | Prácticas OWASP |

Cada demo es un módulo independiente que se enciende o apaga por configuración.

## 4. Arquitectura

```
repopage/
├─ apps/
│  ├─ web/          Astro + islas Preact (sitio público, estático)
│  └─ api/          NestJS (contactos, cotizador, chat, demos) + Swagger
├─ services/
│  └─ py-lab/       FastAPI (demos de Python) — Fase 4
├─ packages/
│  ├─ contracts/    Esquemas Zod compartidos web ↔ api
│  ├─ ui/           Tokens de diseño y componentes — Fase 1
│  └─ config/       tsconfig compartidos
├─ automations/     Flujos n8n exportados — Fase 4
├─ docs/            PLAN.md, DECISIONES.md
├─ scripts/ci/      Lógica de CI (el YAML solo la invoca)
└─ docker-compose.yml   Postgres, Valkey, Mailpit (+ n8n con perfil)
```

- **Contenido como datos:** proyectos, servicios y certificados son MDX/JSON validados con los esquemas de `@aim/contracts`. Publicar un proyecto = agregar un archivo.
- **Separación:** el sitio público es estático y carga aunque la API esté caída. La API solo atiende lo dinámico.

## 5. Buenas prácticas

- TypeScript estricto, Biome, Vitest, Playwright + axe, Conventional Commits.
- CI con la lógica en `scripts/ci/`; vista previa por PR; Lighthouse ≥ 95.
- CSP y HSTS, Turnstile, límite de tasa, validación Zod en ambos lados, secretos solo en entorno (`.env.example`).
- SEO: sitemap, Open Graph, JSON-LD (Person, ProfessionalService); español primero, inglés después.
- Versiones exactas; nada publicado hace menos de 14 días (DEC-002).

## 6. Fases

| Fase | Entregable verificable |
|---|---|
| **0. Base** | `pnpm install` y `bash scripts/ci/all.sh` en verde (lint, tipos, pruebas, build); `docker compose up` levanta Postgres, Valkey y Mailpit; docs |
| **1. Sitio público** | Inicio, servicios, proyectos (3 casos), sobre mí, certificados, contacto por WhatsApp; desplegado en Cloudflare |
| **2. API y cotizador** | NestJS con contactos y cotizador, Swagger, Neon, Turnstile, aviso por correo, `/admin` básico. Antes: `@aim/contracts` debe compilarse a JS para que la API (ESM, NodeNext) lo consuma |
| **3. Lab, parte 1** | Asistente AIM, API Playground, Seguridad en acción |
| **4. Lab, parte 2** | Automatización con n8n, Migrador de datos (FastAPI), Auth Lab |
| **5. Crecimiento** | Blog, inglés, analítica respetuosa con la privacidad, testimonios |

Cada fase cierra con lint + tipos + pruebas + build en verde y un resumen.

## 7. Decisiones del arranque

Registradas en [`DECISIONES.md`](DECISIONES.md): nombre de marca (DEC-001), dominio (DEC-007), hosting de NestJS (DEC-005), precios (DEC-006), proyectos públicos (DEC-008).
