---
slug: marea
title: Marea, finanzas en pareja por ciclos
summary: App para llevar los gastos de una pareja por quincena o por mes, sincronizada entre dos celulares, que funciona sin conexión y cuesta cero en la nube.
kind: app
year: 2026
order: 2
role: Diseño y desarrollo completo
stack: [JavaScript, Service Worker, Cloudflare Pages Functions, Cloudflare D1, PWA]
challenge: Dos personas anotan gastos al mismo tiempo desde celulares distintos, a veces sin señal, y ninguna escritura se puede perder ni pisar la de la otra. Además tenía que ser seguro y no costar nada al mes.
solution: Cada movimiento es una fila independiente en la base de datos y los cambios se sincronizan con un cursor que no pierde escrituras. Sin conexión, los cambios esperan en una cola y se envían al volver la señal, con deshacer y papelera de 30 días. El acceso se protege con comparación en tiempo constante, bloqueo tras intentos fallidos e invitaciones de un solo uso que vencen en 24 horas.
results:
  - Unas 290 verificaciones automáticas en 18 archivos de prueba
  - 6 endpoints y un esquema de 5 tablas
  - Instalable como app y usable sin conexión
highlights:
  - Importa extractos bancarios en CSV
  - Metas de ahorro, cuentas compartidas y temas de color
  - Cabeceras de seguridad y política de contenido (CSP)
featured: true
public: true
links: {}
---
Nació como una herramienta personal y se convirtió en una app completa que corre en el plan gratuito de Cloudflare.
