---
slug: automatizacion-en-vivo
title: Automatización en vivo
summary: Envía una solicitud de prueba y sigue en tiempo real cómo un flujo de n8n la valida, la califica, decide la ruta, redacta la respuesta y la registra.
status: live
runsOn: server
href: /lab/automatizacion-en-vivo/
order: 7
stack: [n8n, Webhooks, SSE, Hono]
certificates: [n8n-low-code]
---
El flujo de n8n se versiona en el repositorio y corre en Render. La API de este sitio, en Cloudflare, verifica que eres una persona, despierta a n8n si está dormido, le pasa tu solicitud por un webhook y te muestra cada paso con Server-Sent Events a medida que n8n lo reporta.

Las reglas de negocio viven en n8n y se cambian sin tocar el código del sitio: qué cuenta como correo corporativo, cuántos puntos suma cada presupuesto y qué respuesta recibe cada tipo de cliente. El correo no se envía: solo se muestra.

Usa datos de prueba: la ejecución y sus pasos se borran a la hora.
