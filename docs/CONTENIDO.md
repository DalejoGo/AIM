# CONTENIDO.md — Cómo editar el sitio sin tocar código

Todo el contenido vive en `apps/web/src/content/`. Cada archivo se valida al compilar: si algo está mal escrito, `pnpm build` falla y dice qué campo revisar, en vez de publicar una página rota.

Después de cualquier cambio: `bash scripts/ci/all.sh` (o al menos `pnpm build`).

## Datos de contacto y marca

`site.json`: nombre de la marca, descripción, WhatsApp (solo dígitos con indicativo, p. ej. `573027015524`), mensaje inicial de WhatsApp, correo, LinkedIn, GitHub, Platzi, hoja de vida y video. Si quitas el correo o una red, desaparece de todo el sitio.

## Precios

- **Precio "desde" de cada servicio:** `services/<servicio>.json`, campo `priceFrom` con `COP` y `USD`. Si borras `priceFrom`, el servicio muestra "Cotiza sin costo".
- **Cotizador:** `quote.json`. Cada servicio tiene un `base` y sus `options` (funcionalidades con su precio). `timelines` son los plazos con su multiplicador (1 = normal). `spread` es el ancho del rango que se muestra (0.35 = hasta 35 % más).
- Los precios iniciales los propuso Claude como referencia (DEC-006): ajústalos a tu realidad.

## Servicios

`services/<id>.json`. El `id` es interno (`web`, `app`, `automation`, `content`, `chatbot`); el `slug` es la URL en español. `order` define el orden en el sitio. Agregar un servicio nuevo requiere sumar su id en `packages/contracts/src/services.ts` y su entrada en `quote.json`.

## Proyectos (casos de estudio)

Un archivo Markdown por proyecto en `projects/`. El nombre del archivo debe ser igual a su `slug`. Campos clave:

- `public: false` lo oculta (útil mientras esperas permiso del cliente).
- `featured: true` lo muestra en el inicio (debe ser público).
- `results`: solo hechos verificables (pruebas, módulos, Lighthouse). Nunca métricas inventadas.
- El texto bajo el bloque `---` aparece al final del caso.

## Lab (demos)

Un archivo Markdown por demo en `lab/`, con el nombre igual a su `slug`.

- `status: soon` crea automáticamente una página "en construcción" en `/lab/<slug>/`.
- `status: live` exige un `href` y una página propia en `apps/web/src/pages/lab/` que use `<LabShell slug="...">` con la demo dentro.
- `certificates`: ids de `certificates.json` que respaldan la demo.

## Certificados

`certificates.json`. Copia el PDF a `apps/web/public/certificados/` (nombre en minúsculas y con guiones) y agrega una entrada con `id`, `title`, `issuer`, `issuedOn` (AAAA-MM-DD), `hours`, `file` y, si existe, `demo` (slug del Lab que lo prueba). Una prueba verifica que el PDF exista y que la demo exista.

## Preguntas frecuentes y perfil

- `faq.json`: pares `q` / `a`. También se publican como datos estructurados para Google.
- `profile.json`: resumen, experiencia, estudios y habilidades de "Sobre mí".

## Textos de la interfaz

`apps/web/src/i18n/es.ts`: botones, menús y etiquetas. Ahí se agregará el inglés en la Fase 5.
