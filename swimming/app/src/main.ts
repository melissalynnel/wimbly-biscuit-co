import { prepareWithSegments, layoutWithLines, type LayoutLine } from '@chenglou/pretext'
import { LYRICS } from './lyrics'

// ─── canvases ───────────────────────────────────────────────────────────────
// #bg         — pixelated low-res: water + border
// #text-layer — full-res crisp:    lyrics text
// #fg         — pixelated low-res: swimmer (transparent bg)

const bgCanvas   = document.getElementById('bg')         as HTMLCanvasElement
const textCanvas = document.getElementById('text-layer') as HTMLCanvasElement
const fgCanvas   = document.getElementById('fg')         as HTMLCanvasElement
const bgCtx   = bgCanvas.getContext('2d')!
const textCtx = textCanvas.getContext('2d')!
const fgCtx   = fgCanvas.getContext('2d')!

const PIXEL_SCALE  = 3
let   EDGE         = 25       // canvas pixels of sidewalk — computed proportionally in resize()
const LINE_H       = 5        // canvas pixels per text lane
const TEXT_PAD     = 5        // screen px padding inside pool edge
const SCREEN_FONT  = '11px Inter, system-ui, -apple-system, sans-serif'
let   REPEL_RADIUS = 80       // screen px — how far swimmer disturbs text (slider-controlled)
const REPEL_FORCE  = 28       // screen px — max character displacement

let W = 0, H = 0

// Text
let allLines: LayoutLine[] = []

// Swimmer / cursor state
let mouseScreenX  = -999
let mouseScreenY  = -999
let swimFacing    = 1     // 1 = right, -1 = left
let swimPhase     = 0
let waveT         = 0
let lastTime      = 0

// ─── geometry ────────────────────────────────────────────────────────────────

function pool() {
  return { l: EDGE, t: EDGE, r: W - EDGE, b: H - EDGE, w: W - EDGE * 2, h: H - EDGE * 2 }
}

function visibleLines() {
  return Math.max(1, Math.ceil(pool().h / LINE_H))
}



function screenPoolW() { return (W - EDGE * 2) * PIXEL_SCALE - TEXT_PAD * 2 }

// Swimmer position in canvas pixels (clamped to pool) — used for physics/repulsion
function swimCanvasPos() {
  const p = pool()
  const cx = Math.min(Math.max(mouseScreenX / PIXEL_SCALE, p.l + 4), p.r - 4)
  const cy = Math.min(Math.max(mouseScreenY / PIXEL_SCALE, p.t + 4), p.b - 4)
  return { cx, cy }
}

// Draw position shifts swimmer above finger on touch so the finger doesn't cover it
const TOUCH_LIFT_PX = 55   // screen pixels above touch point
let isTouchActive = false

function swimDrawPos() {
  const { cx, cy } = swimCanvasPos()
  const liftCanvas = isTouchActive ? TOUCH_LIFT_PX / PIXEL_SCALE : 0
  const p = pool()
  return { cx, cy: Math.min(Math.max(cy - liftCanvas, p.t + 4), p.b - 4) }
}

// ─── setup ───────────────────────────────────────────────────────────────────

function cleanLyrics(raw: string) {
  return raw
    .split('\n')
    .map(line => line.replace(/\[.*?\]/g, '').trimEnd())
    .filter(line => line.trim() !== '' && line.trim() !== '* * *')
    .join('\n')
}

function layoutText() {
  const prepared = prepareWithSegments(cleanLyrics(LYRICS), SCREEN_FONT)
  const baseLines = layoutWithLines(prepared, screenPoolW(), LINE_H * PIXEL_SCALE).lines

  // Remove every empty line the layout engine produces — no gaps anywhere
  const trimmed = baseLines.filter(line => line.text.trim() !== '')

  const poolLines = Math.ceil(pool().h / LINE_H)
  allLines = []
  while (allLines.length < poolLines) {
    for (const line of trimmed) {
      allLines.push(line)
      if (allLines.length >= poolLines) break
    }
  }
}

function resize() {
  // Read the pool-wrap's rendered size — CSS already subtracts safe-area-inset-bottom
  const wrap = document.getElementById('pool-wrap')!
  const wrapW = wrap.clientWidth
  const wrapH = wrap.clientHeight

  W = Math.floor(wrapW / PIXEL_SCALE)
  H = Math.floor(wrapH / PIXEL_SCALE)

  // Keep sidewalk proportional: ~8.2% of smaller canvas dimension matches 25px on 1440px desktop
  // On touch devices use a larger minimum (22 canvas-px = 66 screen-px) so the slider pill has
  // comfortable breathing room below the browser URL bar and above the pool edge
  const isMobile = window.matchMedia('(pointer: coarse)').matches
  EDGE = Math.max(isMobile ? 22 : 14, Math.round(Math.min(W, H) * 0.082))

  bgCanvas.width   = W;  bgCanvas.height   = H
  fgCanvas.width   = W;  fgCanvas.height   = H
  textCanvas.width  = wrapW
  textCanvas.height = wrapH

  // Reposition slider — vertically centered in the top sidewalk
  const sliderWrap = document.getElementById('space-slider-wrap')
  if (sliderWrap) sliderWrap.style.top = `${Math.round(EDGE * PIXEL_SCALE / 2)}px`
  const creditWrap = document.getElementById('wimbly-credit')
  if (creditWrap) creditWrap.style.bottom = `${Math.round(EDGE * PIXEL_SCALE / 2)}px`

  layoutText()
  initFloatie()
}

// ─── bg: border + water ───────────────────────────────────────────────────────

function drawBorder() {
  const { l, t, r, b } = pool()
  const ts = 8
  const colors = ['#f0a8cc', '#e890c0', '#f8b8d8', '#e098c4']

  function strip(x: number, y: number, w: number, h: number) {
    for (let tx = x; tx < x + w; tx += ts)
      for (let ty = y; ty < y + h; ty += ts) {
        bgCtx.fillStyle = colors[((tx / ts | 0) + (ty / ts | 0)) % colors.length]
        bgCtx.fillRect(tx, ty, ts - 1, ts - 1)
      }
  }

  strip(0, 0, W, EDGE);           strip(0, H - EDGE, W, EDGE)
  strip(0, EDGE, EDGE, H - EDGE * 2); strip(W - EDGE, EDGE, EDGE, H - EDGE * 2)

  bgCtx.strokeStyle = 'rgba(190,120,175,0.4)'
  bgCtx.lineWidth = 0.5
  for (let x = 0; x < W; x += ts) { bgCtx.beginPath(); bgCtx.moveTo(x,0); bgCtx.lineTo(x,H); bgCtx.stroke() }
  for (let y = 0; y < H; y += ts) { bgCtx.beginPath(); bgCtx.moveTo(0,y); bgCtx.lineTo(W,y); bgCtx.stroke() }

  bgCtx.strokeStyle = 'rgba(255,255,255,0.85)'
  bgCtx.lineWidth = 1.5
  bgCtx.strokeRect(l, t, r - l, b - t)
}

function drawWater(t: number) {
  const { l, t: pt, w, h } = { l: pool().l, t: pool().t, w: pool().w, h: pool().h }

  bgCtx.save()
  bgCtx.beginPath()
  bgCtx.rect(l, pt, w, h)
  bgCtx.clip()

  // ── Base fill ────────────────────────────────────────────────────────────
  bgCtx.fillStyle = '#0d9ab8'
  bgCtx.fillRect(l, pt, w, h)

  // ── Pool tile grid (wave-distorted) ──────────────────────────────────────
  const GRID = 9    // canvas pixels between tile lines
  bgCtx.lineWidth = 0.7

  // Vertical grid lines — distorted horizontally
  for (let gx = l; gx <= l + w; gx += GRID) {
    bgCtx.strokeStyle = 'rgba(8,75,105,0.55)'
    bgCtx.beginPath()
    for (let gy = pt; gy <= pt + h; gy += 2) {
      const disp = Math.sin((gy - pt) / h * Math.PI * 5 + t * 0.65) * 2.5
                 + Math.sin((gy - pt) / h * Math.PI * 9 - t * 0.4)  * 1.2
      gy === pt ? bgCtx.moveTo(gx + disp, gy) : bgCtx.lineTo(gx + disp, gy)
    }
    bgCtx.stroke()
  }

  // Horizontal grid lines — distorted vertically
  for (let gy = pt; gy <= pt + h; gy += GRID) {
    bgCtx.strokeStyle = 'rgba(8,75,105,0.55)'
    bgCtx.beginPath()
    for (let gx = l; gx <= l + w; gx += 2) {
      const disp = Math.sin((gx - l) / w * Math.PI * 5 + t * 0.55) * 2.5
                 + Math.sin((gx - l) / w * Math.PI * 8 - t * 0.45)  * 1.2
      gx === l ? bgCtx.moveTo(gx, gy + disp) : bgCtx.lineTo(gx, gy + disp)
    }
    bgCtx.stroke()
  }

  bgCtx.restore()
}

// ─── text layer: lyrics with wave + swimmer repulsion ────────────────────────

function drawText(t: number) {
  textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height)

  // Clip to pool bounds so text never overlaps the sidewalk
  const p = pool()
  textCtx.save()
  textCtx.beginPath()
  textCtx.rect(p.l * PIXEL_SCALE, p.t * PIXEL_SCALE, p.w * PIXEL_SCALE, p.h * PIXEL_SCALE)
  textCtx.clip()

  textCtx.font = SCREEN_FONT
  textCtx.textBaseline = 'top'
  textCtx.globalAlpha = 0.72
  textCtx.fillStyle   = '#d8f2ff'

  const vis    = visibleLines()
  const { cx: _swimCX, cy: _swimCY } = swimDrawPos()
  const swimSX = _swimCX * PIXEL_SCALE
  const swimSY = _swimCY * PIXEL_SCALE
  const floatieSX = floatieX * PIXEL_SCALE
  const floatieSY = floatieY * PIXEL_SCALE
  const poolTop    = pool().t
  const poolCenterX = EDGE * PIXEL_SCALE + (W - EDGE * 2) * PIXEL_SCALE / 2

  // Use a separate render row counter so blank lines never claim vertical space
  let row = 0
  for (let i = 0; row < vis && i < allLines.length; i++) {
    const text = allLines[i % allLines.length].text.trim()
    if (!text) continue

    const screenY   = (poolTop + row * LINE_H) * PIXEL_SCALE
    const linePhase = t * 0.25 + row * 0.45
    row++

    const lineWidth = textCtx.measureText(text).width
    let charX = poolCenterX - lineWidth / 2
    for (const char of text) {
      const charW = textCtx.measureText(char).width

      const waveY = Math.sin(linePhase + charX * 0.035) * 5

      // Repulsion from swimmer
      const sdx  = charX - swimSX
      const sdy  = screenY - swimSY
      const sd   = Math.sqrt(sdx * sdx + sdy * sdy)
      let repX = 0, repY = 0
      if (sd < REPEL_RADIUS && sd > 0) {
        const strength = (1 - sd / REPEL_RADIUS) ** 2 * REPEL_FORCE
        repX = (sdx / sd) * strength
        repY = (sdy / sd) * strength
      }

      // Repulsion from floatie — same radius as swimmer, slider-controlled
      const fdx = charX - floatieSX
      const fdy = screenY - floatieSY
      const fd  = Math.sqrt(fdx * fdx + fdy * fdy)
      if (fd < REPEL_RADIUS && fd > 0) {
        const strength = (1 - fd / REPEL_RADIUS) ** 2 * REPEL_FORCE
        repX += (fdx / fd) * strength
        repY += (fdy / fd) * strength
      }

      textCtx.fillText(char, charX + repX, screenY + waveY + repY)
      charX += charW
    }
  }

  textCtx.globalAlpha = 1
  textCtx.restore()
}

// ─── fg: swimmer follows cursor ───────────────────────────────────────────────
// Three-stage freestyle stroke viewed from directly above.
// Swimmer faces +x (right). y-negative = swimmer's right side (top of screen).

// Draw a thick pixel line between two canvas points
function pline(x1: number, y1: number, x2: number, y2: number, w: number) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const n   = Math.ceil(len)
  const hw  = Math.floor(w / 2)
  for (let i = 0; i <= n; i++) {
    const t  = i / n
    const px = Math.round(x1 + (x2 - x1) * t)
    const py = Math.round(y1 + (y2 - y1) * t)
    fgCtx.fillRect(px - hw, py - hw, w, w)
  }
}

// Three key stroke poses — [shoulderX, shoulderY, handX, handY] for each arm
// "top" arm = swimmer's right (y-negative), "bot" = swimmer's left (y-positive)
const POSES = [
  // Pose 0: top arm fully extended forward, bot arm trailed back
  { tSh: [5, -4] as [number,number], tHa: [19,-13] as [number,number],
    bSh: [4,  4] as [number,number], bHa: [-14, 8] as [number,number] },
  // Pose 1: mid-arc — both arms transitioning
  { tSh: [5, -4] as [number,number], tHa: [ 9,-15] as [number,number],
    bSh: [4,  4] as [number,number], bHa: [  9,15] as [number,number] },
  // Pose 2: bot arm fully extended forward, top arm trailed back
  { tSh: [4, -4] as [number,number], tHa: [-14,-8] as [number,number],
    bSh: [5,  4] as [number,number], bHa: [ 19,13] as [number,number] },
]

function lerpV(a: [number,number], b: [number,number], t: number): [number,number] {
  return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]
}

function drawSwimmer(phase: number) {
  if (mouseScreenX < 0) return

  const { cx, cy } = swimDrawPos()

  fgCtx.save()
  fgCtx.translate(Math.round(cx), Math.round(cy))
  if (swimFacing === -1) fgCtx.scale(-0.5, 0.5)
  else fgCtx.scale(0.5, 0.5)

  // Interpolate between the 3 poses over one full cycle
  const cycleT  = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)
  const poseF   = cycleT * 3
  const poseIdx = Math.floor(poseF) % 3
  const poseT   = poseF % 1
  const A       = POSES[poseIdx]
  const B       = POSES[(poseIdx + 1) % 3]
  const tSh = lerpV(A.tSh, B.tSh, poseT)
  const tHa = lerpV(A.tHa, B.tHa, poseT)
  const bSh = lerpV(A.bSh, B.bSh, poseT)
  const bHa = lerpV(A.bHa, B.bHa, poseT)

  const SKIN = '#f0c090'
  const SUIT = '#7c3aed'
  const CAP  = '#f97316'
  const WAKE = 'rgba(210,240,255,0.5)'

  // ── Wake splash on the forward hand ─────────────────────────────────────
  const fwdHand = tHa[0] > bHa[0] ? tHa : bHa
  fgCtx.fillStyle = WAKE
  const [fhx, fhy] = [Math.round(fwdHand[0]), Math.round(fwdHand[1])]
  for (const [ox, oy] of [[-4,-2],[-2,-4],[0,-5],[2,-4],[4,-2],
                           [ 5, 0],[ 4, 2],[2, 4],[0, 5],[-2, 4],
                           [-4, 2],[-5, 0]])
    fgCtx.fillRect(fhx+ox, fhy+oy, 2, 2)

  // ── Flutter kick legs ────────────────────────────────────────────────────
  const kick    = Math.sin(phase * 3.5) * 4   // foot travel range
  const kickVel = Math.abs(Math.cos(phase * 3.5))  // 1 at max speed, 0 at extremes

  // Fixed hip points inside the body, only feet move
  const tfx = -20, tfy = Math.round(-4 + kick)   // top foot
  const bfx = -20, bfy = Math.round( 4 - kick)   // bot foot

  fgCtx.fillStyle = SKIN
  pline(-8, -2, tfx, tfy, 3)   // top leg
  pline(-8,  2, bfx, bfy, 3)   // bot leg
  fgCtx.fillRect(tfx - 1, tfy - 1, 3, 3)  // top foot
  fgCtx.fillRect(bfx - 1, bfy - 1, 3, 3)  // bot foot

  // ── Splash at feet ────────────────────────────────────────────────────────
  fgCtx.fillStyle = WAKE
  fgCtx.globalAlpha = kickVel * 0.7
  const splashPts = [[-4,-1],[-3,-3],[-1,-4],[1,-3],[3,-2],[4,0],[3,2],[1,3],[-1,3],[-3,2]]
  const rot = phase * 1.5
  for (const [ox, oy] of splashPts) {
    const rx = Math.round(ox * Math.cos(rot) - oy * Math.sin(rot))
    const ry = Math.round(ox * Math.sin(rot) + oy * Math.cos(rot))
    fgCtx.fillRect(tfx + rx, tfy + ry, 2, 2)
    fgCtx.fillRect(bfx + rx, bfy + ry, 2, 2)
  }
  fgCtx.globalAlpha = 1

  // ── Body oval (red swimsuit) ──────────────────────────────────────────────
  // Built from stacked rows to approximate an oval
  fgCtx.fillStyle = SUIT
  const rows: [number,number][] = [
    [-4,10],[-6,12],[-8,13],[-9,13],[-10,13],
    [-10,13],[-10,13],[-9,13],[-9,12],[-9,10],[-9,8],
  ]
  rows.forEach(([x1, x2], row) => {
    fgCtx.fillRect(x1, row - 8, x2 - x1, 1)
  })

  // ── Arms ─────────────────────────────────────────────────────────────────
  fgCtx.fillStyle = SKIN
  // Top arm: shoulder → mid-elbow → hand, tapering
  const tMid = lerpV(tSh, tHa, 0.5)
  pline(tSh[0], tSh[1], tMid[0], tMid[1], 3)   // upper arm (thick)
  pline(tMid[0], tMid[1], tHa[0], tHa[1], 2)   // forearm (thinner)
  fgCtx.fillRect(Math.round(tHa[0])-1, Math.round(tHa[1])-1, 3, 3)  // hand

  // Bottom arm
  const bMid = lerpV(bSh, bHa, 0.5)
  pline(bSh[0], bSh[1], bMid[0], bMid[1], 3)
  pline(bMid[0], bMid[1], bHa[0], bHa[1], 2)
  fgCtx.fillRect(Math.round(bHa[0])-1, Math.round(bHa[1])-1, 3, 3)

  // ── Bubbles trailing from head ────────────────────────────────────────────
  // Head tip in local pre-scale coords ≈ x=18, y=-2; after 0.5 scale → +9, -1 canvas px
  const headCanvasX = Math.round(cx) + swimFacing * 9
  const headCanvasY = Math.round(cy) - 1
  fgCtx.restore()   // exit scaled transform before drawing bubbles in canvas space
  tickBubbles(headCanvasX, headCanvasY)
  drawBubbles()
  fgCtx.save()
  fgCtx.translate(Math.round(cx), Math.round(cy))
  if (swimFacing === -1) fgCtx.scale(-0.5, 0.5)
  else fgCtx.scale(0.5, 0.5)

  // ── Head ─────────────────────────────────────────────────────────────────
  fgCtx.fillStyle = SKIN
  fgCtx.fillRect(10, -6, 8, 8)
  fgCtx.fillRect(11, -7, 6, 10)
  fgCtx.fillStyle = CAP
  fgCtx.fillRect(10, -6, 8, 5)
  fgCtx.fillRect(11, -7, 6, 3)

  // ── Trailing wake ────────────────────────────────────────────────────────
  fgCtx.fillStyle = WAKE
  fgCtx.fillRect(-23, -2, 4, 2)
  fgCtx.fillRect(-27, -1, 3, 1)
  fgCtx.fillRect(-30,  0, 2, 1)
  fgCtx.fillRect(-24,  1, 4, 2)
  fgCtx.fillRect(-28,  2, 3, 1)

  fgCtx.restore()
}

// ─── bubble trail ────────────────────────────────────────────────────────────

type Bubble = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }
const bubbles: Bubble[] = []

function tickBubbles(headX: number, headY: number) {
  // Emit a new bubble occasionally
  if (bubbles.length < 35 && Math.random() < 0.3) {
    bubbles.push({
      x: headX + (Math.random() - 0.5) * 1.5,
      y: headY + (Math.random() - 0.5),
      vx: (Math.random() - 0.5) * 0.12,
      vy: -(0.18 + Math.random() * 0.18),
      life: 0,
      maxLife: 45 + Math.random() * 35,
      size: Math.random() < 0.6 ? 1 : 2,
    })
  }
  // Update positions with slight wobble
  for (const b of bubbles) {
    b.x  += b.vx + Math.sin(b.life * 0.4) * 0.06
    b.y  += b.vy
    b.life++
  }
  // Cull expired
  for (let i = bubbles.length - 1; i >= 0; i--)
    if (bubbles[i].life >= bubbles[i].maxLife) bubbles.splice(i, 1)
}

function drawBubbles() {
  for (const b of bubbles) {
    const t = b.life / b.maxLife
    const alpha = Math.sin(t * Math.PI) * 0.7
    fgCtx.fillStyle = `rgba(215,248,255,${alpha.toFixed(2)})`
    const s = b.size
    fgCtx.fillRect(Math.round(b.x) - (s >> 1), Math.round(b.y) - (s >> 1), s, s)
  }
}

// ─── input ───────────────────────────────────────────────────────────────────

let prevMouseX = -999
let mouseDX = 0, mouseDY = 0   // cursor velocity in screen px per event

function applyPointer(x: number, y: number) {
  if (x > prevMouseX + 1) swimFacing = 1
  else if (x < prevMouseX - 1) swimFacing = -1
  mouseDX      = x - (prevMouseX < 0 ? x : prevMouseX)
  mouseDY      = y - mouseScreenY
  prevMouseX   = x
  mouseScreenX = x
  mouseScreenY = y
}

document.addEventListener('mousemove', e => { isTouchActive = false; applyPointer(e.clientX, e.clientY) })

document.addEventListener('touchstart', e => {
  if ((e.target as HTMLElement).closest('#space-slider-wrap, #wimbly-credit')) return
  e.preventDefault()
  isTouchActive = true
  const t = e.touches[0]
  // Only activate swimmer if touch starts inside the pool
  const p = pool()
  const tx = t.clientX / PIXEL_SCALE, ty = t.clientY / PIXEL_SCALE
  if (tx < p.l || tx > p.r || ty < p.t || ty > p.b) return
  prevMouseX   = t.clientX
  mouseScreenX = t.clientX
  mouseScreenY = t.clientY
  mouseDX = 0; mouseDY = 0
}, { passive: false })

document.addEventListener('touchmove', e => {
  if ((e.target as HTMLElement).closest('#space-slider-wrap, #wimbly-credit')) return
  e.preventDefault()
  isTouchActive = true
  // Clamp pointer to pool bounds so swimmer stays inside
  const p = pool()
  const t = e.touches[0]
  const clampedX = Math.min(Math.max(t.clientX, p.l * PIXEL_SCALE), p.r * PIXEL_SCALE)
  const clampedY = Math.min(Math.max(t.clientY, p.t * PIXEL_SCALE), p.b * PIXEL_SCALE)
  applyPointer(clampedX, clampedY)
}, { passive: false })

// ─── floatie ─────────────────────────────────────────────────────────────────

let floatieX = 0, floatieY = 0
let floatieVX = 0, floatieVY = 0
let floatieTargetX = 0, floatieTargetY = 0
let floatieTargetAge = 0
let floatieBobT = 0

function pickFloatieTarget() {
  const p = pool()
  const m = 16
  floatieTargetX = p.l + m + Math.random() * (p.w - m * 2)
  floatieTargetY = p.t + m + Math.random() * (p.h - m * 2)
  floatieTargetAge = 0
}

function initFloatie() {
  const p = pool()
  floatieX = p.l + p.w * 0.6
  floatieY = p.t + p.h * 0.4
  pickFloatieTarget()
}

function updateFloatie(dt: number) {
  floatieBobT    += dt * 1.2
  floatieTargetAge += dt

  if (floatieTargetAge > 4) pickFloatieTarget()

  const swimCX = mouseScreenX / PIXEL_SCALE
  const swimCY = mouseScreenY / PIXEL_SCALE
  const sdx = floatieX - swimCX
  const sdy = floatieY - swimCY
  const sd  = Math.hypot(sdx, sdy)

  const BUMP_R  = 24  // canvas px — large enough that swimmer and floatie never visually overlap
  const AVOID_R = 38

  if (sd < BUMP_R && sd >= 0 && (Math.abs(mouseDX) > 0.5 || Math.abs(mouseDY) > 0.5)) {
    // Cursor bumped into floatie — transfer velocity as strong impulse
    floatieVX += (mouseDX / PIXEL_SCALE) * 6.4
    floatieVY += (mouseDY / PIXEL_SCALE) * 6.4
    // Aim drift target far in the launch direction so it coasts freely
    floatieTargetX = floatieX + floatieVX * 80
    floatieTargetY = floatieY + floatieVY * 80
    floatieTargetAge = 0
  } else if (sd < AVOID_R && sd > 0) {
    // Gentle repulsion when swimmer is nearby but not bumping
    const f = ((AVOID_R - sd) / AVOID_R) ** 2 * 22.4
    floatieVX += (sdx / sd) * f * dt
    floatieVY += (sdy / sd) * f * dt
  }

  const spd = Math.hypot(floatieVX, floatieVY)

  // Drift toward target only when coasting slowly
  if (spd < 6) {
    const tdx = floatieTargetX - floatieX
    const tdy = floatieTargetY - floatieY
    const td  = Math.hypot(tdx, tdy)
    if (td > 2) {
      floatieVX += (tdx / td) * 4.8 * dt
      floatieVY += (tdy / td) * 4.8 * dt
    }
  }

  // Low damping when coasting fast (after a toss), normal when drifting
  const damping = spd > 10 ? 0.985 : 0.88
  floatieVX *= damping
  floatieVY *= damping

  const maxSpd = 240
  if (spd > maxSpd) { floatieVX = floatieVX / spd * maxSpd; floatieVY = floatieVY / spd * maxSpd }

  floatieX += floatieVX * dt
  floatieY += floatieVY * dt

  // Clamp to pool
  const p = pool(); const m = 12
  floatieX = Math.max(p.l + m, Math.min(p.r - m, floatieX))
  floatieY = Math.max(p.t + m, Math.min(p.b - m, floatieY))
  if (floatieX <= p.l + m || floatieX >= p.r - m) { floatieVX *= -0.6; floatieTargetAge = 99 }
  if (floatieY <= p.t + m || floatieY >= p.b - m) { floatieVY *= -0.6; floatieTargetAge = 99 }
}

function drawFloatie() {
  const bob = Math.sin(floatieBobT) * 0.7
  const px  = Math.round(floatieX)
  const py  = Math.round(floatieY + bob)
  const OR  = 9    // outer radius (canvas px)
  const IR  = 4    // inner hole radius

  const ringMid  = (IR + OR) / 2   // radial midpoint = top of the tube = lightest
  const ringHalfW = (OR - IR) / 2

  for (let dy = -OR; dy <= OR; dy++) {
    for (let dx = -OR; dx <= OR; dx++) {
      const dist = Math.hypot(dx, dy)
      if (dist > OR || dist < IR) continue

      // t=1 at ring midpoint (top of tube, lightest), t=0 at inner/outer edges (darkest)
      const t = 1 - Math.abs(dist - ringMid) / ringHalfW

      // Map t → color: dark gold → bright yellow
      const r = Math.round(160 + t * 95)
      const g = Math.round(100 + t * 130)
      const b = Math.round(5   + t * 15)

      fgCtx.fillStyle = `rgb(${r},${g},${b})`
      fgCtx.fillRect(px + dx, py + dy, 1, 1)
    }
  }

  // Water visible through hole (inner teal circle)
  for (let dy = -(IR - 1); dy <= IR - 1; dy++) {
    for (let dx = -(IR - 1); dx <= IR - 1; dx++) {
      if (Math.hypot(dx, dy) < IR - 1) {
        fgCtx.fillStyle = '#0d9ab8'
        fgCtx.fillRect(px + dx, py + dy, 1, 1)
      }
    }
  }
}

// ─── loop ────────────────────────────────────────────────────────────────────

function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime  = now
  waveT    += dt
  swimPhase += dt * 3.5

  updateFloatie(dt)

  bgCtx.clearRect(0, 0, W, H)
  fgCtx.clearRect(0, 0, W, H)
  drawBorder()
  drawWater(waveT)
  drawText(waveT)
  drawFloatie()
  drawSwimmer(swimPhase)

  requestAnimationFrame(frame)
}

// ─── slider control ──────────────────────────────────────────────────────────

function setupSlider() {
  const wrap = document.getElementById('pool-wrap')!

  const container = document.createElement('div')
  container.id = 'space-slider-wrap'
  container.style.cssText = `
    position: absolute;
    top: ${Math.round(EDGE * PIXEL_SCALE / 2)}px;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(10,60,90,0.45);
    border: 1px solid rgba(255,255,255,0.25);
    border-radius: 20px;
    padding: 6px 14px;
    pointer-events: all;
    user-select: none;
    backdrop-filter: blur(4px);
    z-index: 10;
  `

  const label = document.createElement('span')
  label.textContent = 'give me space'
  label.style.cssText = `
    color: rgba(210,240,255,0.75);
    font: 10px Inter, system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  `

  const slider = document.createElement('input')
  slider.type  = 'range'
  slider.min   = '50'
  slider.max   = '250'
  slider.value = String(REPEL_RADIUS)
  slider.style.cssText = `
    -webkit-appearance: none;
    appearance: none;
    width: 140px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.25);
    outline: none;
    cursor: pointer;
  `

  // Inject thumb styles via a <style> tag (can't do ::pseudo inline)
  if (!document.getElementById('slider-style')) {
    const st = document.createElement('style')
    st.id = 'slider-style'
    st.textContent = `
      #repel-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 13px; height: 13px;
        border-radius: 50%;
        background: #d8f2ff;
        border: 2px solid rgba(255,255,255,0.6);
        cursor: pointer;
      }
      #repel-slider::-moz-range-thumb {
        width: 13px; height: 13px;
        border-radius: 50%;
        background: #d8f2ff;
        border: 2px solid rgba(255,255,255,0.6);
        cursor: pointer;
      }
    `
    document.head.appendChild(st)
  }
  slider.id = 'repel-slider'

  slider.addEventListener('input', () => { REPEL_RADIUS = Number(slider.value) })

  container.appendChild(label)
  container.appendChild(slider)
  wrap.appendChild(container)
}

function setupCredit() {
  const wrap = document.getElementById('pool-wrap')!

  const container = document.createElement('div')
  container.id = 'wimbly-credit'
  container.style.cssText = `
    position: absolute;
    bottom: ${Math.round(EDGE * PIXEL_SCALE / 2)}px;
    left: 50%;
    transform: translate(-50%, 50%);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    max-width: calc(100vw - 24px);
    pointer-events: auto;
    user-select: none;
    z-index: 10;
  `

  const label = document.createElement('p')
  label.innerHTML = 'absurdities provided by<br />wimbly biscuit co.'
  label.style.cssText = `
    margin: 0;
    color: rgba(132,70,180,0.86);
    font: 10px Inter, system-ui, sans-serif;
    letter-spacing: 0.08em;
    line-height: 1.15;
    text-align: center;
    text-transform: lowercase;
    white-space: nowrap;
    text-shadow:
      0 0 5px rgba(255,255,255,0.48),
      0 0 12px rgba(166,96,214,0.42);
  `

  const homeLink = document.createElement('a')
  homeLink.href = 'https://melissalynnel.github.io/wimbly-biscuit-co/worldwide/'
  homeLink.setAttribute('aria-label', 'world wide wimbly home')
  homeLink.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex: 0 0 auto;
    color: #fff;
    text-decoration: none;
  `
  homeLink.innerHTML = `
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true" style="
      width: 100%;
      height: 100%;
      fill: none;
      stroke: #fff;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter:
        drop-shadow(0 0 6px rgba(255,255,255,0.95))
        drop-shadow(0 0 13px rgba(255,255,255,0.8))
        drop-shadow(0 0 22px rgba(70,185,230,0.7));
    ">
      <circle cx="32" cy="32" r="22" />
      <ellipse cx="32" cy="32" rx="10" ry="22" />
      <ellipse cx="32" cy="32" rx="18" ry="8" />
      <path d="M10 32h44" />
    </svg>
  `

  container.appendChild(label)
  container.appendChild(homeLink)
  wrap.appendChild(container)
}


window.addEventListener('resize', resize)
resize()
setupSlider()
setupCredit()
requestAnimationFrame((now) => { lastTime = now; frame(now) })
