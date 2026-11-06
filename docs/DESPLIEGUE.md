# DESPLIEGUE.md — Publicar el sitio

El sitio es estático y vive en **Cloudflare Pages**, proyecto `aimweb`, en la cuenta personal de David (DEC-009).

- URL actual: https://aimweb-9hc.pages.dev (`aimweb.pages.dev` ya estaba tomado).
- Dominio elegido: **aimweb.dev** (pendiente de compra, DEC-007).

## Publicar una nueva versión

```bash
wrangler login            # solo la primera vez (o si la sesión venció)
PUBLIC_BASE_URL=https://aimweb-9hc.pages.dev pnpm deploy:web
```

`scripts/deploy-web.sh` compila en modo producción con esa URL (de ella salen canonical, sitemap, Open Graph y datos estructurados) y sube `apps/web/dist` a Pages. Antes de publicar, corre `bash scripts/ci/all.sh`.

Las cabeceras de seguridad salen de `apps/web/public/_headers` y la página 404 de `404.html`.

## Conectar aimweb.dev

1. **David compra el dominio** en Cloudflare: panel → Registro de dominios → Registrar dominios → `aimweb.dev`. Al comprarlo en Cloudflare, el DNS queda en la misma cuenta.
2. En el panel: Workers y Pages → `aimweb` → Dominios personalizados → Configurar un dominio → `aimweb.dev` (y, si se quiere, `www.aimweb.dev`). Cloudflare crea el DNS y el certificado. Los `.dev` exigen HTTPS, y Cloudflare lo da automáticamente.
3. Volver a publicar con la nueva URL para que canonical y sitemap apunten al dominio:
   ```bash
   PUBLIC_BASE_URL=https://aimweb.dev pnpm deploy:web
   ```
4. Actualizar este archivo, `.env.example`, el README y DEC-007.

## Historial

- 2026-11-06: primer despliegue. Wrangler 4.152 envía `pages project create` a Workers por defecto, y los Workers quedan bajo el subdominio de la cuenta (`subdominio-de-la-cuenta.workers.dev`), que deja ver el nombre del cliente de la agencia. Se borraron esos dos Workers y el proyecto se creó como Pages clásico (una sola vez con `--force`; las publicaciones siguientes no lo necesitan).
