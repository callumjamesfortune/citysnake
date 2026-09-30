import type { Game } from './Game'
import { AREA_BUILDING, AREA_GREEN, AREA_WATER, type MapData } from './types'
import type { Snake } from './Snake'

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type Shape = {
  g: Float64Array
  box: Float64Array
  k: number
  name?: string
}

const COLORS = {
  land: '#11151c',
  green: '#16261b',
  water: '#0f2a42',

  building: '#1f2530',
  buildingEdge: '#2b333f',

  rail: '#7a7a7a',
  railLight: '#b5673e',

  road: '#777',
  roadCasing: '#474747',

  label: '#8b96a8',
}

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
  b[2] >= v.minX &&
  b[0] <= v.maxX &&
  b[3] >= v.minY &&
  b[1] <= v.maxY

/**
 * Static OSM geometry, pre-flattened with bounding boxes so each frame only
 * touches what is on screen.
 */
export class MapLayer {
  private buildings: Shape[] = []
  private green: Shape[] = []
  private water: Shape[] = []

  private rails: Shape[] = []
  private waterways: Shape[] = []

  /** Road edges bucketed by class. */
  private roads: Shape[][] = ROAD_WIDTH.map(() => [])

  constructor(data: MapData) {
    // Areas
    for (const a of data.areas) {
      const g = Float64Array.from(a.g)

      const shape: Shape = {
        g,
        box: bbox(g),
        k: a.k,
      }

      if (a.k === AREA_BUILDING) {
        this.buildings.push(shape)
      } else if (a.k === AREA_WATER) {
        this.water.push(shape)
      } else if (a.k === AREA_GREEN) {
        this.green.push(shape)
      }
    }

    // Railways
    for (const r of data.rails) {
      const g = Float64Array.from(r)

      this.rails.push({
        g,
        box: bbox(g),
        k: 0,
      })
    }

    // Waterways
    for (const r of data.waterways) {
      const g = Float64Array.from(r)

      this.waterways.push({
        g,
        box: bbox(g),
        k: 0,
      })
    }

    // Roads
    for (const e of data.edges) {
      const g = Float64Array.from(e.g)

      this.roads[e.k].push({
        g,
        box: bbox(g),
        k: e.k,
        name: e.n,
      })
    }
  }

  draw(ctx: CanvasRenderingContext2D, v: Bounds, zoom: number) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])

    // Background areas
    this.fillAreas(ctx, this.green, v, COLORS.green)
    this.fillAreas(ctx, this.water, v, COLORS.water)

    // Waterways
    this.drawWaterways(ctx, v, zoom)

    // Railways
    this.drawRailways(ctx, v, zoom)

    // Buildings
    if (zoom > 0.9) {
      this.fillAreas(
        ctx,
        this.buildings,
        v,
        COLORS.building,
        COLORS.buildingEdge,
        zoom,
      )
    }

    // Roads
    //
    // Draw ALL casings first, then ALL road surfaces.
    // This makes intersections look continuous rather than cut off.
    this.strokeRoads(ctx, v, zoom, true)
    this.strokeRoads(ctx, v, zoom, false)
    this.drawRoadCenterLines(ctx, v, zoom)

    if (zoom > 1.6) this.drawLabels(ctx, v, zoom)

    // Always leave canvas in a predictable state.
    ctx.setLineDash([])
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
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

  /**
   * Waterways are deliberately different from railways.
   */
  private drawWaterways(
    ctx: CanvasRenderingContext2D,
    v: Bounds,
    zoom: number,
  ) {
    ctx.strokeStyle = '#285b7c'
    ctx.lineWidth = Math.max(1.5 / zoom, 2)
    ctx.setLineDash([])

    for (const waterway of this.waterways) {
      if (!visible(waterway.box, v)) continue

      ctx.beginPath()
      trace(ctx, waterway.g)
      ctx.stroke()
    }
  }

  /**
   * Draw railway tracks.
   *
   * Each railway gets:
   *   1. sleepers underneath
   *   2. two parallel rails
   *
   * This makes railways visually distinct from roads.
   */
  private drawRailways(
    ctx: CanvasRenderingContext2D,
    v: Bounds,
    zoom: number,
  ) {
    for (const rail of this.rails) {
      if (!visible(rail.box, v)) continue

      this.drawRailway(ctx, rail.g, zoom)
    }

    ctx.setLineDash([])
  }

  private drawRoadCenterLines(
    ctx: CanvasRenderingContext2D,
    v: Bounds,
    zoom: number,
  ) {
    ctx.save()
  
    ctx.lineCap = 'butt'
  
    // Outer dashed line
    ctx.strokeStyle = '#d6d6d6'
    ctx.lineWidth = Math.max(10 / zoom, 10)
  
    ctx.setLineDash([
      10 / zoom,
      10 / zoom,
    ])
  
    for (let k = 0; k <= 2; k++) {
      for (const r of this.roads[k]) {
        if (!visible(r.box, v)) continue
  
        ctx.beginPath()
        trace(ctx, r.g)
        ctx.stroke()
      }
    }
  
    // Inner grey line
    ctx.strokeStyle = '#777'
    ctx.lineWidth = Math.max(10 / zoom, 8)
  
    for (let k = 0; k <= 2; k++) {
      for (const r of this.roads[k]) {
        if (!visible(r.box, v)) continue
  
        ctx.beginPath()
        trace(ctx, r.g)
        ctx.stroke()
      }
    }
  
    ctx.setLineDash([])
    ctx.restore()
  }

  private drawRailway(
    ctx: CanvasRenderingContext2D,
    g: Float64Array,
    zoom: number,
  ) {
    if (g.length < 4) return

    /*
     * Draw sleepers.
     *
     * We walk along each segment and place a short perpendicular line.
     */
    ctx.strokeStyle = COLORS.railLight
    ctx.lineWidth = Math.max(1 / zoom, 1)
    ctx.lineCap = 'butt'

    const sleeperSpacing = 5 / zoom
    const sleeperHalfWidth = 5 / zoom

    let distanceSinceSleeper = 0

    for (let i = 0; i < g.length - 2; i += 2) {
      const x1 = g[i]
      const y1 = g[i + 1]

      const x2 = g[i + 2]
      const y2 = g[i + 3]

      const dx = x2 - x1
      const dy = y2 - y1

      const length = Math.hypot(dx, dy)

      if (length === 0) continue

      const nx = -dy / length
      const ny = dx / length

      let travelled = 0

      while (distanceSinceSleeper + (length - travelled) >= sleeperSpacing) {
        const remaining = sleeperSpacing - distanceSinceSleeper

        travelled += remaining

        if (travelled > length) break

        const t = travelled / length

        const x = x1 + dx * t
        const y = y1 + dy * t

        ctx.beginPath()
        ctx.moveTo(
          x - nx * sleeperHalfWidth,
          y - ny * sleeperHalfWidth,
        )
        ctx.lineTo(
          x + nx * sleeperHalfWidth,
          y + ny * sleeperHalfWidth,
        )
        ctx.stroke()

        distanceSinceSleeper = 0
      }

      distanceSinceSleeper += length - travelled
    }

    /*
     * Finally draw the two actual rails.
     */
    ctx.strokeStyle = COLORS.rail
    ctx.lineWidth = Math.max(1 / zoom, 1)
    ctx.lineCap = 'round'

    const railOffset = 2.5 / zoom

    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath()

      for (let i = 0; i < g.length - 2; i += 2) {
        const x1 = g[i]
        const y1 = g[i + 1]

        const x2 = g[i + 2]
        const y2 = g[i + 3]

        const dx = x2 - x1
        const dy = y2 - y1

        const length = Math.hypot(dx, dy)

        if (length === 0) continue

        const nx = -dy / length
        const ny = dx / length

        const ox = nx * railOffset * side
        const oy = ny * railOffset * side

        if (i === 0) {
          ctx.moveTo(x1 + ox, y1 + oy)
        }

        ctx.lineTo(x2 + ox, y2 + oy)
      }

      ctx.stroke()
    }
  }

  /**
   * Roads are rendered in two passes:
   *
   *   pass 1 = white casing
   *   pass 2 = grey road surface
   *
   * This prevents intersections from looking like the roads have been
   * physically cut apart.
   */
  private strokeRoads(
    ctx: CanvasRenderingContext2D,
    v: Bounds,
    zoom: number,
    casing: boolean,
  ) {
    ctx.setLineDash([])
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let k = this.roads.length - 1; k >= 0; k--) {
      const width = Math.max(
        ROAD_WIDTH[k],
        3 / zoom,
      )

      ctx.lineWidth = casing
        ? width + Math.max(2, 2 / zoom)
        : width

      ctx.strokeStyle = casing
        ? COLORS.roadCasing
        : COLORS.road

      ctx.beginPath()

      let any = false

      for (const r of this.roads[k]) {
        if (!visible(r.box, v)) continue

        ctx.beginPath()
        trace(ctx, r.g)
        ctx.stroke()
      }

      if (any) {
        ctx.stroke()
      }
    }
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    v: Bounds,
    zoom: number,
  ) {
    ctx.setLineDash([])

    ctx.fillStyle = COLORS.label
    ctx.font = `${Math.round(11 / zoom)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const seen = new Set<string>()

    for (let k = 0; k <= 5; k++) {
      for (const r of this.roads[k]) {
        if (
          !r.name ||
          !visible(r.box, v) ||
          seen.has(r.name)
        ) {
          continue
        }

        const mid = (r.g.length >> 2) * 2

        const ax = r.g[mid]
        const ay = r.g[mid + 1]

        const bx = r.g[mid + 2] ?? r.g[0]
        const by = r.g[mid + 3] ?? r.g[1]

        let angle = Math.atan2(
          by - ay,
          bx - ax,
        )

        if (
          angle > Math.PI / 2 ||
          angle < -Math.PI / 2
        ) {
          angle += Math.PI
        }

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

function trace(
  ctx: CanvasRenderingContext2D,
  g: Float64Array,
) {
  if (g.length < 2) return

  ctx.moveTo(g[0], g[1])

  for (let i = 2; i < g.length; i += 2) {
    ctx.lineTo(g[i], g[i + 1])
  }
}

export function render(
  ctx: CanvasRenderingContext2D,
  game: Game,
  layer: MapLayer,
) {
  const {
    width,
    height,
    zoom,
    camera,
    dpr,
    viewAngle,
  } = game

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0,
  )

  ctx.fillStyle = COLORS.land

  ctx.fillRect(
    0,
    0,
    width,
    height,
  )

  /*
   * Everything below this point is in world space.
   *
   * The rotation happens around the centre of
   * the screen, so the snake/map rotate together.
   */
  ctx.translate(
    width / 2,
    height / 2,
  )

  ctx.rotate(viewAngle)

  ctx.scale(
    zoom,
    zoom,
  )

  ctx.translate(
    -camera.x,
    -camera.y,
  )

  /*
   * Because the viewport is rotated, its world-space
   * bounding box is larger than width/zoom by height/zoom.
   *
   * Calculate the exact axis-aligned extents needed
   * to cover the rotated rectangle.
   */
  const halfW =
    width / 2 / zoom

  const halfH =
    height / 2 / zoom

  const cos =
    Math.abs(
      Math.cos(viewAngle),
    )

  const sin =
    Math.abs(
      Math.sin(viewAngle),
    )

  const extentX =
    halfW * cos +
    halfH * sin

  const extentY =
    halfW * sin +
    halfH * cos

  const pad = 40

  const bounds: Bounds = {
    minX:
      camera.x -
      extentX -
      pad,

    minY:
      camera.y -
      extentY -
      pad,

    maxX:
      camera.x +
      extentX +
      pad,

    maxY:
      camera.y +
      extentY +
      pad,
  }

  layer.draw(
    ctx,
    bounds,
    zoom,
  )

  drawFood(
    ctx,
    game,
    bounds,
  )

  drawSnake(
    ctx,
    game.snake,
    zoom,
  )
}

function drawFood(
  ctx: CanvasRenderingContext2D,
  game: Game,
  b: Bounds,
) {
  game.food.forEachInBounds(
    b.minX,
    b.minY,
    b.maxX,
    b.maxY,
    (f) => {
      ctx.fillStyle = `hsl(${f.hue} 85% 62%)`

      ctx.beginPath()

      ctx.arc(
        f.x,
        f.y,
        f.radius,
        0,
        Math.PI * 2,
      )

      ctx.fill()
    },
  )
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
  const projected =
    snake.getProjectedPath(500)

  if (projected.length > 1) {
    ctx.save()

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()

    ctx.moveTo(
      projected[0].x,
      projected[0].y,
    )

    for (
      let i = 1;
      i < projected.length;
      i++
    ) {
      ctx.lineTo(
        projected[i].x,
        projected[i].y,
      )
    }

    ctx.strokeStyle =
      'rgba(235, 64, 52)'

    ctx.lineWidth = 5 / zoom

    ctx.setLineDash([
      7 / zoom,
      7 / zoom,
    ])

    ctx.stroke()

    ctx.setLineDash([])

    ctx.restore()
  }

  // Snake body.
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()

  ctx.moveTo(
    pts[0].x,
    pts[0].y,
  )

  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(
      pts[i].x,
      pts[i].y,
    )
  }

  ctx.strokeStyle =
    snake.boosting
      ? '#ffd166'
      : '#2f81f7'

  ctx.lineWidth = r * 2
  ctx.stroke()

  ctx.strokeStyle =
    snake.boosting
      ? '#fff3c4'
      : '#7cc4ff'

  ctx.lineWidth = r * 0.9
  ctx.stroke()

  // Eyes.
  const angle = Math.atan2(
    snake.heading.y,
    snake.heading.x,
  )

  for (const side of [-1, 1]) {
    const a =
      angle +
      side * 0.6

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
      ex +
        Math.cos(angle) *
          r *
          0.12,

      ey +
        Math.sin(angle) *
          r *
          0.12,

      r * 0.16,

      0,
      Math.PI * 2,
    )

    ctx.fill()
  }
}