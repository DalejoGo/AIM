---
slug: api-playground
title: API Playground
summary: Una consola para probar una API REST real hecha con NestJS. Lista, crea, edita y borra tareas en tu propio sandbox, y mira el código de estado, los tiempos, las cabeceras y el JSON de cada respuesta.
status: live
runsOn: server
href: /lab/api-playground/
order: 5
stack: [NestJS, Zod, Swagger, Vitest, Supertest, Docker]
certificates: [nestjs-modular, e2e-testing-apis-node]
---
La API de ejemplo Tareas corre en Render, en otro dominio, y el navegador la llama con CORS. Cada visitante trabaja en su propio sandbox en memoria: la consola crea un id, lo envía en la cabecera X-Sandbox-Id y la API te da 3 tareas de ejemplo. Admite hasta 50, y el sandbox se borra tras 30 minutos sin uso.

Los datos se validan con esquemas de Zod y todos los errores llegan con la misma forma: un código, un mensaje en español y, si aplica, los problemas campo por campo. La lista filtra por estado y prioridad, busca sin importar tildes, ordena por fecha y pagina con cursor. Hay un límite de 60 peticiones por minuto por conexión (responde 429 con Retry-After), cada respuesta trae su tiempo en el servidor (X-Response-Time) y todo está documentado con OpenAPI en Swagger.

Los datos pasan por un repositorio: hoy se guardan en memoria y pueden pasar a Postgres sin tocar el controlador ni las reglas. Las pruebas de extremo a extremo, con Vitest y Supertest, cubren cada endpoint, la validación, el sandbox, CORS y el límite de tasa.

La API usa el plan gratuito de Render: si nadie la usa en unos 15 minutos se duerme, y la primera petición tarda cerca de un minuto mientras despierta. La consola te avisa cuando eso pasa.
