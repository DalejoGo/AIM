# DISENO.md — Sistema visual de AIM

Tema: estudio de desarrollo web y automatización. Público: emprendedores, pymes, profesionales independientes, empresas con procesos y otras agencias, **de cualquier país** (DEC-010). Trabajo principal del sitio: generar confianza y llevar a WhatsApp o al cotizador; probar el stack con demos reales del Lab.

## Color

Tinta violeta (no negro neutro) tomada de la tarjeta AIM. Modo claro y oscuro de primera clase.

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `--color-ink` | `#15122B` | `#F5F3FC` | Fondo de página |
| `--color-raised` | `#1E1A3B` | `#FFFFFF` | Superficies elevadas (paneles, formularios) |
| `--color-line` | `#2E2856` | `#DDD8F0` | Bordes y divisores |
| `--color-text` | `#ECE9F8` | `#1A1633` | Texto principal |
| `--color-muted` | `#A7A1C9` | `#5A5478` | Texto secundario |
| `--color-brand` | `#9177FF` | `#5B3FE0` | Marca: botones, enlaces, foco |
| `--color-live` | `#3DDCB0` | `#0B7D60` | Solo estados "en vivo / funcionando" del Lab y validaciones correctas |
| `--color-danger` | `#FF8A9A` | `#C2304A` | Errores |

Contraste mínimo AA en texto. El verde `live` nunca decora: solo comunica estado.

## Tipografía

- **Unbounded** (variable): titulares. Ancha y geométrica, eco del "DESARROLLO WEB" de la tarjeta. Pesos 500–700, interletrado ligeramente negativo en tamaños grandes.
- **Instrument Sans** (variable): texto y UI. 17–18 px, interlineado 1.6, medida ≤ 68ch.
- **JetBrains Mono**: solo código real dentro del Lab. Nunca para etiquetas decorativas.
- Escala: 0.875 / 1 / 1.25 / 1.563 / 1.953 / 2.441 / 3.815 rem.

## Estructura

- Alineación a la izquierda, rejilla de 12 columnas con aire; secciones separadas por espacio, no por cajas.
- **Hexágono** del logo como único motivo estructural: marca el estado de cada demo del Lab (vivo / próximamente). No se usa como adorno en otras partes.
- **Servicios como lista de precios** (filas expandibles con precio "desde" alineado a la derecha), no rejilla de tarjetas iguales.
- **Hero interactivo:** la tríada Idea → Código → Resultado de la tarjeta, como pestañas que cambian un panel. Es una secuencia real, así que aquí sí van flechas y orden.
- Numeración solo en secuencias reales (proceso de trabajo, pasos de un flujo).

## Movimiento

- Un solo momento orquestado: la tríada del hero avanza una vez al cargar; después solo responde al usuario.
- Transiciones entre páginas con `@view-transition` (CSS, sin JS).
- Todo se desactiva con `prefers-reduced-motion`.

## Evitar (rasgos de plantilla)

- Etiquetas en MAYÚSCULAS con interletrado sobre cada título.
- Cadenas con puntos medios (`A · B · C`) y "→" pegado a botones o enlaces.
- Resaltar una sola palabra del titular con otro color o cursiva.
- Rejillas de tarjetas idénticas con la misma sombra gris.
- Monoespaciada para datos o etiquetas.

## Texto

- Tú, cercano y claro (DEC-010). Verbos simples, frases cortas.
- Los botones dicen exactamente lo que pasa: "Escribir por WhatsApp", "Calcular mi presupuesto".
- Errores: qué pasó y cómo arreglarlo, sin disculpas.
- Ninguna cifra sin fuente (CLAUDE.md, regla 5).

## Calidad mínima

Responsive hasta 320 px, foco visible, accesible con teclado, `prefers-reduced-motion`, contraste AA, Lighthouse ≥ 95.
