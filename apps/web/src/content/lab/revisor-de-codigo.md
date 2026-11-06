---
slug: revisor-de-codigo
title: Revisor de código con IA
summary: Pega un fragmento de TypeScript, JavaScript, Python o SQL y recibe una revisión con resumen, riesgos con su categoría OWASP, pruebas sugeridas y mejoras, mientras se escribe.
status: live
runsOn: server
href: /lab/revisor-de-codigo/
order: 8
stack: [Workers AI, Gemma, Hono, Zod, SSE]
certificates: [testing-code-review-ia, claude-code]
---
Muestra cómo uso agentes de IA para revisar y probar código sin perder el criterio humano.

El código pasa por la API de AIM en Cloudflare y lo revisa el modelo abierto Gemma en Workers AI, con instrucciones de reviewer senior: responder siempre con las mismas cuatro secciones, no inventar APIs ni contexto y avisar cuando el fragmento es muy corto o ambiguo. La revisión llega por Server-Sent Events y se muestra a medida que el modelo la escribe.

Tu código viaja como datos dentro de un bloque delimitado, nunca como instrucciones: si trae comentarios que piden ignorar las reglas o revelar el prompt, el revisor tiene la orden de no obedecerlos y de señalarlos como hallazgo. Aun así, es una IA y puede equivocarse.

Comparte la sesión y los límites con el Asistente IA: pasas la verificación de seguridad una sola vez para los dos, y ambos cuentan en el mismo cupo diario del modelo gratuito. El sitio no guarda tu código.
