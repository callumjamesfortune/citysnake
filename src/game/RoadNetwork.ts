import type { MapData, Point } from './types'

export type Edge = {
  a: number
  b: number
  /** Flat polyline [x, y, ...] running from vertex a to vertex b. */
  g: Float64Array
  /** Cumulative distance from a for each polyline point. */
  cum: Float64Array
  length: number
  kind: number
  name?: string
}

export type Link = { edge: number; dir: 1 | -1 }

export type Sample = { x: number; y: number; hx: number; hy: number }

/**
 * Junction graph built from OSM ways. Everything the snake does is expressed as
 * "which edge, which direction, how far along" rather than free x/y motion.
 */
export class RoadNetwork {
  readonly edges: Edge[]
  readonly vertices: Float64Array
  /** Outgoing links per vertex; dir 1 means travel a -> b. */
  readonly links: Link[][]
  readonly totalLength: number

  constructor(data: MapData) {
    this.vertices = Float64Array.from(data.vertices)
    this.links = Array.from({ length: data.vertices.length / 2 }, () => [] as Link[])

    let total = 0
    this.edges = data.edges.map((e, i) => {
      const g = Float64Array.from(e.g)
      const cum = new Float64Array(g.length / 2)
      for (let p = 1; p < cum.length; p++) {
        cum[p] = cum[p - 1] + Math.hypot(g[p * 2] - g[p * 2 - 2], g[p * 2 + 1] - g[p * 2 - 1])
      }
      const length = cum[cum.length - 1]
      total += length
      this.links[e.a].push({ edge: i, dir: 1 })
      this.links[e.b].push({ edge: i, dir: -1 })
      return { a: e.a, b: e.b, g, cum, length, kind: e.k, name: e.n }
    })
    this.totalLength = total
  }

  vertexPoint(v: number): Point {
    return { x: this.vertices[v * 2], y: this.vertices[v * 2 + 1] }
  }

  /** Position and unit heading at `dist` metres from vertex a of the edge. */
  sample(edgeIndex: number, dist: number): Sample {
    const e = this.edges[edgeIndex]
    const d = Math.max(0, Math.min(e.length, dist))
    const { cum, g } = e

    let lo = 0
    let hi = cum.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= d) lo = mid
      else hi = mid
    }

    const segLen = cum[hi] - cum[lo] || 1
    const t = (d - cum[lo]) / segLen
    const ax = g[lo * 2]
    const ay = g[lo * 2 + 1]
    const bx = g[hi * 2]
    const by = g[hi * 2 + 1]
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      hx: (bx - ax) / segLen,
      hy: (by - ay) / segLen,
    }
  }

  /** Unit heading when leaving a junction along the given link. */
  exitHeading(link: Link): Point {
    const e = this.edges[link.edge]
    const s = this.sample(link.edge, link.dir === 1 ? 0.5 : e.length - 0.5)
    return link.dir === 1 ? { x: s.hx, y: s.hy } : { x: -s.hx, y: -s.hy }
  }

  /** Unit heading when arriving at the far junction of the given link. */
  arrivalHeading(link: Link): Point {
    const e = this.edges[link.edge]
    const s = this.sample(link.edge, link.dir === 1 ? e.length - 0.5 : 0.5)
    return link.dir === 1 ? { x: s.hx, y: s.hy } : { x: -s.hx, y: -s.hy }
  }

  /** Appends the polyline of a link between two distances along its travel direction. */
  appendPath(out: Point[], link: Link, from: number, to: number) {
    const e = this.edges[link.edge]
    const native = (d: number) => (link.dir === 1 ? d : e.length - d)
    const a = this.sample(link.edge, native(from))
    out.push({ x: a.x, y: a.y })

    const lo = Math.min(native(from), native(to))
    const hi = Math.max(native(from), native(to))
    if (link.dir === 1) {
      for (let p = 0; p < e.cum.length; p++) {
        if (e.cum[p] > lo && e.cum[p] < hi) out.push({ x: e.g[p * 2], y: e.g[p * 2 + 1] })
      }
    } else {
      for (let p = e.cum.length - 1; p >= 0; p--) {
        if (e.cum[p] > lo && e.cum[p] < hi) out.push({ x: e.g[p * 2], y: e.g[p * 2 + 1] })
      }
    }

    const b = this.sample(link.edge, native(to))
    out.push({ x: b.x, y: b.y })
  }

  endVertex(link: Link): number {
    const e = this.edges[link.edge]
    return link.dir === 1 ? e.b : e.a
  }

  startVertex(link: Link): number {
    const e = this.edges[link.edge]
    return link.dir === 1 ? e.a : e.b
  }

  /** Edge whose polyline passes closest to the given point. */
  nearestEdge(x: number, y: number): number {
    let best = 0
    let bestDist = Infinity
    this.edges.forEach((e, i) => {
      for (let p = 0; p < e.g.length; p += 2) {
        const d = (e.g[p] - x) ** 2 + (e.g[p + 1] - y) ** 2
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
    })
    return best
  }
}
