---
slug: seguridad-en-accion
title: Seguridad en acción
summary: Envía 15 peticiones seguidas a la API y mira cómo el límite de tasa deja pasar 10 y frena el resto con un 429, y revisa las cabeceras de seguridad reales que protegen este sitio.
status: live
runsOn: server
href: /lab/seguridad-en-accion/
order: 6
stack: [Hono, Postgres, Drizzle, Preact]
certificates: [owasp-top-10]
---
El límite es real: la API de AIM en Cloudflare acepta 10 peticiones cada 10 segundos por conexión, lleva la cuenta en Postgres con una huella de la IP (nunca la IP) y responde con las cabeceras RateLimit y Retry-After. Frena la fuerza bruta y el abuso de formularios (OWASP A04 y A07). Las cabeceras se leen en vivo desde la respuesta de la portada: HTTPS obligatorio, bloqueo de marcos, política de permisos y las demás que manda el sitio, cada una con el ataque que frena y su categoría OWASP.
