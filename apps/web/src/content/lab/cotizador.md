---
slug: cotizador
title: Cotizador interactivo
summary: Elige el servicio y lo que necesitas y ve al instante un rango de precio en pesos o dólares. Termina con tu resumen listo para enviar por WhatsApp.
status: live
runsOn: browser
href: /cotizar/
order: 1
stack: [Preact, Signals, Zod, TypeScript]
certificates: []
---
La lógica del cálculo es una función pura con pruebas, y los precios salen de un archivo de configuración validado con Zod: cambiar una tarifa no toca el código.
