# Marca AIM

Originales del logo, entregados por David (fondo blanco y fondo negro, 1254 × 1254, sin transparencia).

Los recursos del sitio (`apps/web/public/brand/`, favicons e íconos en `apps/web/public/`) se generan quitando el fondo por "des-composición" (el color exacto que, sobre blanco o negro, da el píxel original), así el brillo neón se conserva como transparencia:

```bash
# Requiere @napi-rs/canvas instalado en una carpeta temporal.
node scripts/brand-assets.mjs assets/brand <carpeta-de-salida>
```

Si cambian los originales, actualiza en `scripts/brand-assets.mjs` los nombres de archivo de `files`.
