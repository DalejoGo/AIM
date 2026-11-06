// Un-composites the two logo PNGs (white and black backgrounds) into transparent assets and icons.
import fs from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const [srcDir, outDir] = process.argv.slice(2)
const files = { light: 'aim-logo-claro-original.png', dark: 'aim-logo-neon-original.png' }

async function unblend(file, over) {
  const img = await loadImage(`${srcDir}/${file}`)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height)
  const p = data.data
  let minX = img.width,
    minY = img.height,
    maxX = 0,
    maxY = 0
  for (let i = 0; i < p.length; i += 4) {
    const [r, g, b] = [p[i], p[i + 1], p[i + 2]]
    // Alpha that, composited over the original background, reproduces the pixel exactly.
    let a = over === 'white' ? Math.max(255 - r, 255 - g, 255 - b) / 255 : Math.max(r, g, b) / 255
    if (a < 0.03) a = 0
    if (a > 0) {
      const un = (v) => (over === 'white' ? (v - 255 * (1 - a)) / a : v / a)
      p[i] = Math.min(255, Math.max(0, Math.round(un(r))))
      p[i + 1] = Math.min(255, Math.max(0, Math.round(un(g))))
      p[i + 2] = Math.min(255, Math.max(0, Math.round(un(b))))
      if (a > 0.08) {
        const x = (i / 4) % img.width,
          y = Math.floor(i / 4 / img.width)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
    p[i + 3] = Math.round(a * 255)
  }
  ctx.putImageData(data, 0, 0)
  const pad = 12
  const box = { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad), w: 0, h: 0 }
  box.w = Math.min(img.width, maxX + pad) - box.x
  box.h = Math.min(img.height, maxY + pad) - box.y
  return { canvas: c, box, original: img }
}

function render(src, box, w, h, { bg, fit = 1 } = {}) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
  }
  const scale = Math.min(w / box.w, h / box.h) * fit
  const dw = box.w * scale,
    dh = box.h * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, box.x, box.y, box.w, box.h, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return c
}

const light = await unblend(files.light, 'white')
const dark = await unblend(files.dark, 'black')
const save = (name, canvas, type = 'image/png') => {
  const buf = type === 'image/webp' ? canvas.toBuffer('image/webp', 90) : canvas.toBuffer('image/png')
  fs.writeFileSync(`${outDir}/${name}`, buf)
  console.log(name, canvas.width + 'x' + canvas.height, buf.length, 'bytes')
}
const ratio = light.box.w / light.box.h
for (const [theme, l] of [
  ['light', light],
  ['dark', dark],
]) {
  const h = 128,
    w = Math.round(h * (l.box.w / l.box.h))
  save(`aim-logo-${theme}.webp`, render(l.canvas, l.box, w, h), 'image/webp')
  save(
    `aim-logo-${theme}-512.webp`,
    render(l.canvas, l.box, Math.round(512 * (l.box.w / l.box.h)), 512),
    'image/webp',
  )
  // Header logo at 2x of its 32 px height (srcset in Logo.astro).
  save(
    `aim-logo-${theme}-64.webp`,
    render(l.canvas, l.box, Math.round(64 * (l.box.w / l.box.h)), 64),
    'image/webp',
  )
}
// Icons: the neon version on the brand's ink colour, so they read on any browser tab or home screen.
for (const [name, size, fit] of [
  ['favicon-32.png', 32, 0.98],
  ['favicon-48.png', 48, 0.96],
  ['apple-touch-icon.png', 180, 0.8],
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
]) {
  save(name, render(dark.canvas, dark.box, size, size, { bg: '#15122b', fit }))
}
save('og-image.png', render(dark.canvas, dark.box, 1200, 630, { bg: '#15122b', fit: 0.72 }))
console.log('aspect', ratio.toFixed(3))
