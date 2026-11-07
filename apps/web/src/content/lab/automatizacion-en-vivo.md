---
slug: automatizacion-en-vivo
title: Automatización en vivo
summary: Envía una solicitud de prueba y mira, paso a paso, cómo un flujo diseñado en n8n la valida, la califica, decide la ruta, redacta la respuesta y la registra.
status: live
runsOn: server
href: /lab/automatizacion-en-vivo/
order: 7
stack: [n8n, Cloudflare, SSE, Hono]
certificates: [n8n-low-code]
---
El flujo se diseña y se prueba en n8n, y se exporta como JSON al repositorio. La API de este sitio, en Cloudflare, verifica que eres una persona, ejecuta el flujo en memoria con las reglas de ese archivo y te envía cada paso con Server-Sent Events. El flujo tarda menos de un milisegundo y no hay ningún servidor que despertar.

Las reglas de negocio están en un nodo del flujo en n8n: qué cuenta como correo corporativo, cuántos puntos suma cada presupuesto y qué respuesta recibe cada tipo de cliente. Se cambian ahí y se exportan, sin tocar el código del sitio. Las pruebas comparan cada paso con lo que n8n respondió para los mismos contactos de prueba, así que el sitio no puede apartarse del flujo sin que se note.

Usa datos de prueba: tu solicitud se procesa en memoria y no se guarda, y el correo no se envía: solo se muestra.
