---
slug: asistente-ia
title: Asistente IA
summary: Pregúntale por los servicios, los precios de referencia y los proyectos de AIM, y lee la respuesta mientras se escribe, con la información real del sitio.
status: live
runsOn: server
href: /lab/asistente-ia/
order: 4
stack: [Workers AI, Gemma, Hono, Zod, SSE]
certificates: [chatbots-openai, claude-cowork]
---
Las llamadas al modelo pasan por la API de AIM en Cloudflare, con límite de uso y sin exponer llaves. La respuesta llega por Server-Sent Events y se muestra a medida que el modelo la escribe.
