import type { Game } from './Game'
import { AREA_BUILDING, AREA_GREEN, AREA_WATER, type MapData } from './types'
import type { Snake } from './Snake'

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Shape = { g: Float64Array; box: Float64Array; k: number; name?: string }

const COLORS = {
  land: '#11151c',
  green: '#16261b',
  water: '#0f2a42',
  building: '#1f2530',
  buildingEdge: '#2b333f',
  rail: '#3a3f4a',
  casing: '#262d3a',
  label: '#8b96a8',
}

/** Road fill colour per OSM class, biggest first. */
const ROAD_FILL = ['#7a6234', '#7a5b40', '#5b5f74', '#4c5366', '#454c5d', '#3b4250', '#333944']
const ROAD_WIDTH = [16, 14, 12, 10, 9, 7, 5]

function bbox(g: Float64Array): Float64Array {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < g.length; i += 2) {
    if (g[i] < minX) minX = g[i]
    if (g[i] > maxX) maxX = g[i]
    if (g[i + 1] < minY) minY = g[i + 1]
    if (g[i + 1] > maxY) maxY = g[i + 1]
  }
  return Float64Array.of(minX, minY, maxX, maxY)
}

const visible = (b: Float64Array, v: Bounds) =>
  b[2] >= v.minX && b[0] <= v.maxX && b[3] >= v.minY && b[1] <= v.maxY

/**
 * Static OSM geometry, pre-flattened with bounding boxes so each frame only
 * touches what is on screen.
 */
export class MapLayer {
  private buildings: Shape[] = []
  private green: Shape[] = []
  private water: Shape[] = []
  private lines: Shape[] = []
  /** Road edges bucketed by class so casings and fills draw in map order. */
  private roads: Shape[][] = ROAD_WIDTH.map(() => [])

  constructor(data: MapData) {
    for (const a of data.areas) {
      const g = Float64Array.from(a.g)
      const shape: Shape = { g, box: bbox(g), k: a.k }
      if (a.k === AREA_BUILDING) this.buildings.push(shape)
      else if (a.k === AREA_WATER) this.water.push(shape)
      else if (a.k === AREA_GREEN) this.green.push(shape)
    }
    for (const r of [...data.rails, ...data.waterways]) {
      const g = Float64Array.from(r)
      this.lines.push({ g, box: bbox(g), k: 0 })
    }
    for (const e of data.edges) {
      const g = Float64Array.from(e.g)
      this.roads[e.k].push({ g, box: bbox(g), k: e.k, name: e.n })
    }
  }

  draw(ctx: CanvasRenderingContext2D, v: Bounds, zoom: number) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    this.fillAreas(ctx, this.green, v, COLORS.green)
    this.fillAreas(ctx, this.water, v, COLORS.water)

    ctx.strokeStyle = COLORS.rail
    ctx.lineWidth = Math.max(2 / zoom, 3)
    for (const l of this.lines) {
      if (!visible(l.box, v)) continue
      ctx.beginPath()
      trace(ctx, l.g)
      ctx.stroke()
    }

    if (zoom > 0.9) this.fillAreas(ctx, this.buildings, v, COLORS.building, COLORS.buildingEdge, zoom)

    this.strokeRoads(ctx, v, zoom, true)
    this.strokeRoads(ctx, v, zoom, false)
    if (zoom > 1.6) this.drawLabels(ctx, v, zoom)
  }

  private fillAreas(
    ctx: CanvasRenderingContext2D,
    shapes: Shape[],
    v: Bounds,
    fill: string,
    edge?: string,
    zoom = 1,
  ) {
    ctx.fillStyle = fill
    for (const s of shapes) {
      if (!visible(s.box, v)) continue
      ctx.beginPath()
      trace(ctx, s.g)
      ctx.fill()
    }
    if (edge) {
      ctx.strokeStyle = edge
      ctx.lineWidth = 1 / zoom
      ctx.stroke()
    }
  }

  private strokeRoads(ctx: CanvasRenderingContext2D, v: Bounds, zoom: number, casing: boolean) {
    for (let k = this.roads.length - 1; k >= 0; k--) {
      const width = Math.max(ROAD_WIDTH[k], 3 / zoom)
      ctx.lineWidth = casing ? width + Math.max(2, 2 / zoom) : width
      ctx.strokeStyle = casing ? COLORS.casing : ROAD_FILL[k]
      for (const r of this.roads[k]) {
        if (!visible(r.box, v)) continue
        ctx.beginPath()
        trace(ctx, r.g)
        ctx.stroke()
      }
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D, v: Bounds, zoom: number) {
    ctx.fillStyle = COLORS.label
    ctx.font = `${Math.round(11 / zoom)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const seen = new Set<string>()

    for (let k = 0; k <= 5; k++) {
      for (const r of this.roads[k]) {
        if (!r.name || !visible(r.box, v) || seen.has(r.name)) continue
        const mid = (r.g.length >> 2) * 2
        const ax = r.g[mid]
        const ay = r.g[mid + 1]
        const bx = r.g[mid + 2] ?? r.g[0]
        const by = r.g[mid + 3] ?? r.g[1]
        let angle = Math.atan2(by - ay, bx - ax)
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI
        seen.add(r.name)
        ctx.save()
        ctx.translate(ax, ay)
        ctx.rotate(angle)
        ctx.fillText(r.name, 0, 0)
        ctx.restore()
      }
    }
  }
}

function trace(ctx: CanvasRenderingContext2D, g: Float64Array) {
  ctx.moveTo(g[0], g[1])
  for (let i = 2; i < g.length; i += 2) ctx.lineTo(g[i], g[i + 1])
}

export function render(ctx: CanvasRenderingContext2D, game: Game, layer: MapLayer) {
  const { width, height, zoom, camera, dpr } = game

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = COLORS.land
  ctx.fillRect(0, 0, width, height)

  ctx.translate(width / 2, height / 2)
  ctx.scale(zoom, zoom)
  ctx.translate(-camera.x, -camera.y)

  const pad = 40
  const bounds: Bounds = {
    minX: camera.x - width / 2 / zoom - pad,
    minY: camera.y - height / 2 / zoom - pad,
    maxX: camera.x + width / 2 / zoom + pad,
    maxY: camera.y + height / 2 / zoom + pad,
  }

  layer.draw(ctx, bounds, zoom)
  drawFood(ctx, game, bounds)
  drawSnake(ctx, game.snake, zoom)
}

function drawFood(ctx: CanvasRenderingContext2D, game: Game, b: Bounds) {
  game.food.forEachInBounds(b.minX, b.minY, b.maxX, b.maxY, (f) => {
    ctx.fillStyle = `hsl(${f.hue} 85% 62%)`
    ctx.beginPath()
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2)
    ctx.fill()
  })
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  zoom: number,
) {
  const pts = snake.segments
  if (pts.length < 2) return

  const r = snake.radius

  // Project the route the snake will actually take.
  const projected = snake.getProjectedPath(220)

  if (projected.length > 1) {
    ctx.save()

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Draw the prediction as a dashed road-following line.
    ctx.beginPath()
    ctx.moveTo(projected[0].x, projected[0].y)

    for (let i = 1; i < projected.length; i++) {
      ctx.lineTo(projected[i].x, projected[i].y)
    }

    ctx.strokeStyle = 'rgba(255, 209, 102, 0.5)'
    ctx.lineWidth = 2 / zoom
    ctx.setLineDash([7 / zoom, 7 / zoom])
    ctx.stroke()

    ctx.setLineDash([])
    ctx.restore()
  }

  // Snake body.
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)

  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y)
  }

  ctx.strokeStyle = snake.boosting ? '#ffd166' : '#2f81f7'
  ctx.lineWidth = r * 2
  ctx.stroke()

  ctx.strokeStyle = snake.boosting ? '#fff3c4' : '#7cc4ff'
  ctx.lineWidth = r * 0.9
  ctx.stroke()

  // Eyes.
  const angle = Math.atan2(
    snake.heading.y,
    snake.heading.x,
  )

  for (const side of [-1, 1]) {
    const a = angle + side * 0.6

    const ex =
      snake.head.x +
      Math.cos(a) * r * 0.55

    const ey =
      snake.head.y +
      Math.sin(a) * r * 0.55

    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(
      ex,
      ey,
      r * 0.34,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    ctx.fillStyle = '#10131a'
    ctx.beginPath()
    ctx.arc(
      ex + Math.cos(angle) * r * 0.12,
      ey + Math.sin(angle) * r * 0.12,
      r * 0.16,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}
