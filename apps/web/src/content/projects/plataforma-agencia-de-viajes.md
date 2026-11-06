---
slug: plataforma-agencia-de-viajes
title: Plataforma de reservas para una agencia de viajes
summary: Paquetes propios, buscador de vuelos y hoteles, pago a cuotas y panel para asesores, en español e inglés y sobre planes gratuitos en la nube.
kind: web
year: 2026
order: 1
role: Arquitectura y desarrollo de punta a punta, como único desarrollador
stack: [TypeScript, Astro, Preact, Hono, Cloudflare Workers, PostgreSQL, Drizzle, Zod, Vitest, Playwright]
challenge: Una agencia de viajes en Colombia quería vender en línea combinando paquetes propios con plan de pago a cuotas, un buscador multi-proveedor y la atención de sus asesores, cumpliendo la ley colombiana de consumo y de datos personales, con costos de infraestructura en cero y sin tener que reescribir todo al crecer.
solution: Diseñé una arquitectura hexagonal en la que el núcleo de negocio solo conoce interfaces, así cada proveedor (pagos, correo, vuelos) se cambia por configuración. Las páginas son estáticas y solo la API ejecuta código, con un presupuesto de CPU medido por ruta. Los efectos secundarios se registran en la base de datos para no perderse, los pagos y reservas se procesan una sola vez aunque lleguen repetidos, y los datos personales van cifrados campo por campo.
results:
  - Cerca de 600 pruebas automatizadas, incluida una suite de contratos que deben pasar todos los adaptadores
  - 45 tablas y 14 migraciones versionadas
  - 9 módulos de negocio y 56 decisiones de arquitectura documentadas
  - Lighthouse 100 en rendimiento, accesibilidad y buenas prácticas en las páginas medidas
highlights:
  - Inicio de sesión sin contraseña con passkeys para el personal
  - Español e inglés con rutas traducidas
  - Seguridad guiada por OWASP con escaneo de secretos y análisis estático en cada cambio
  - Desarrollo asistido por agentes de IA con reglas y decisiones documentadas
featured: true
public: true
links: {}
---
El proyecto está en staging; la puesta en producción depende de los trámites del cliente. Por confidencialidad no se muestran el nombre, la marca ni el código del cliente.
