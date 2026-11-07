---
slug: migrador-de-datos
title: Migrador de datos
summary: Sube un CSV o un Excel desordenado y mira cómo se detectan columnas, se normalizan fechas, teléfonos y correos, y se separan las filas válidas de las que tienen errores.
status: live
runsOn: browser
href: /lab/migrador-de-datos/
order: 2
stack: [TypeScript, PapaParse, Zod, Python, FastAPI, python-calamine, charset-normalizer]
certificates: [python-avanzado]
---
Tiene dos motores con las mismas reglas. Por defecto todo ocurre en tu navegador (TypeScript): el archivo no sale de tu dispositivo. Si eliges el servidor, una API en Python con FastAPI recibe el archivo, lo procesa en memoria sin guardarlo y devuelve el mismo resultado; además lee Excel (.xlsx y .xls), detecta la codificación de los CSV exportados en español y acepta archivos más grandes. Una prueba automática compara los dos motores con los mismos archivos en cada cambio.
