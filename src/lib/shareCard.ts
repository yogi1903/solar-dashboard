export interface ShareCardData {
  monthLabel: string // "July 2026"
  kwh: number
  savedRs: number
  co2Kg: number
  percentile: number
  trees: number
}

const W = 1080
const H = 1350
const PAD = 90

const COLORS = {
  parchment: '#f3f1ea',
  ink: '#0d201d',
  muted: '#5a6e6a',
  forest: '#061e1c',
  teal: '#237a6e',
  gold: '#c9a460',
  deepGold: '#8a6826',
  divider: '#e8e4d8',
  white: '#ffffff',
}

const FONT_STACK = 'Inter, system-ui, -apple-system, sans-serif'

function font(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`
}

/** Letter-spaced text drawing: uses ctx.letterSpacing when supported, else spaces manually. */
function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacingPx: number,
): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if (typeof c.letterSpacing === 'string') {
    c.letterSpacing = `${spacingPx}px`
    ctx.fillText(text, x, y)
    c.letterSpacing = '0px'
    return
  }
  let cursor = x
  for (const ch of text) {
    ctx.fillText(ch, cursor, y)
    cursor += ctx.measureText(ch).width + spacingPx
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

export function downloadShareCard(d: ShareCardData): void {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.textBaseline = 'alphabetic'

  // Background: full parchment
  ctx.fillStyle = COLORS.parchment
  ctx.fillRect(0, 0, W, H)

  // Top band: forest, full width, ~200px tall
  const bandH = 200
  ctx.fillStyle = COLORS.forest
  ctx.fillRect(0, 0, W, bandH)

  // Band content
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.gold
  ctx.font = font(30, true)
  drawSpacedText(ctx, 'GREENTEK ALLIANCE', PAD, 78, 6)

  ctx.fillStyle = COLORS.white
  ctx.font = font(44, false)
  ctx.fillText(`Solar Report · ${d.monthLabel}`, PAD, 148)

  // Center block: huge kWh number
  const contentTop = bandH + 130
  ctx.fillStyle = COLORS.ink
  ctx.font = font(110, true)
  ctx.fillText(`${d.kwh.toLocaleString('en-IN')} kWh`, PAD, contentTop)

  ctx.fillStyle = COLORS.muted
  ctx.font = font(34, false)
  ctx.fillText('generated this month', PAD, contentTop + 58)

  // Gold accent bar: 220x10 rounded, below the big number
  const barY = contentTop + 96
  const grad = ctx.createLinearGradient(PAD, 0, PAD + 220, 0)
  grad.addColorStop(0, '#dcc086')
  grad.addColorStop(0.5, '#c9a460')
  grad.addColorStop(1, '#8a6826')
  ctx.fillStyle = grad
  roundRect(ctx, PAD, barY, 220, 10, 5)
  ctx.fill()

  // Three stat rows with dividers
  const rows: Array<{ label: string; value: string; valueColor: string }> = [
    {
      label: 'Money saved',
      value: `₹${d.savedRs.toLocaleString('en-IN')}`,
      valueColor: COLORS.teal,
    },
    {
      label: 'CO₂ avoided',
      value: `${d.co2Kg.toLocaleString('en-IN')} kg ≈ ${d.trees.toLocaleString('en-IN')} trees`,
      valueColor: COLORS.ink,
    },
    {
      label: 'Plant performance',
      value: `Top ${100 - d.percentile}% in Gujarat`,
      valueColor: COLORS.deepGold,
    },
  ]

  const rowsTop = barY + 110
  const rowH = 110

  rows.forEach((row, i) => {
    const y = rowsTop + i * rowH

    // Divider above each row (including the first)
    ctx.strokeStyle = COLORS.divider
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD, y)
    ctx.lineTo(W - PAD, y)
    ctx.stroke()

    const textY = y + 68

    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.muted
    ctx.font = font(32, false)
    ctx.fillText(row.label, PAD, textY)

    ctx.textAlign = 'right'
    ctx.fillStyle = row.valueColor
    ctx.font = font(40, true)
    ctx.fillText(row.value, W - PAD, textY)

    ctx.textAlign = 'left'
  })

  // Footer centered ~90px from bottom
  ctx.textAlign = 'center'
  const cx = W / 2

  ctx.fillStyle = COLORS.muted
  ctx.font = font(28, false)
  ctx.fillText('alliance.greentekindia.co.in', cx, H - PAD - 44)

  ctx.fillStyle = 'rgba(90, 110, 106, 0.6)'
  ctx.font = font(24, false)
  ctx.fillText('Greentek India Limited', cx, H - PAD)

  ctx.textAlign = 'left'

  // Download: toBlob -> object URL -> temp <a download> click -> revoke
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const slug = d.monthLabel.trim().replace(/\s+/g, '-')
    const a = document.createElement('a')
    a.href = url
    a.download = `greentek-solar-${slug}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 'image/png')
}
