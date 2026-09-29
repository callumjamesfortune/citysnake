import { mulberry32 } from './random'
import type { RoadNetwork } from './RoadNetwork'
import type { Point } from './types'

export type Food = Point & { radius: number; hue: number }

const CELL = 60

/**
 * Pellets live on the road network itself, indexed in a uniform grid so eating
 * only tests the handful near the head.
 */
export class FoodField {
  private cells = new Map<string, Food[]>()
  private rnd = mulberry32(99)
  /** Edge index picked with probability proportional to its length. */
  private edgeCdf: Float64Array

  constructor(
    private net: RoadNetwork,
    count = 3000,
  ) {
    this.edgeCdf = new Float64Array(net.edges.length)
    let acc = 0
    net.edges.forEach((e, i) => {
      acc += e.length
      this.edgeCdf[i] = acc
    })
    for (let i = 0; i < count; i++) this.add(this.spawn())
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`
  }

  private add(f: Food) {
    const k = this.key(f.x, f.y)
    const bucket = this.cells.get(k)
    if (bucket) bucket.push(f)
    else this.cells.set(k, [f])
  }

  private spawn(): Food {
    const target = this.rnd() * this.edgeCdf[this.edgeCdf.length - 1]
    let lo = 0
    let hi = this.edgeCdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.edgeCdf[mid] < target) lo = mid + 1
      else hi = mid
    }
    const edge = this.net.edges[lo]
    const s = this.net.sample(lo, this.rnd() * edge.length)
    return { x: s.x, y: s.y, radius: 1.1 + this.rnd() * 1.1, hue: Math.floor(this.rnd() * 360) }
  }

  consume(x: number, y: number, radius: number): Food[] {
    const eaten: Food[] = []
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)

    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        const bucket = this.cells.get(`${i}:${j}`)
        if (!bucket) continue
        for (let n = bucket.length - 1; n >= 0; n--) {
          const f = bucket[n]
          if (Math.hypot(f.x - x, f.y - y) < radius + f.radius) {
            bucket.splice(n, 1)
            eaten.push(f)
            this.add(this.spawn())
          }
        }
      }
    }
    return eaten
  }

  forEachInBounds(minX: number, minY: number, maxX: number, maxY: number, fn: (f: Food) => void) {
    for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
      for (let j = Math.floor(minY / CELL); j <= Math.floor(maxY / CELL); j++) {
        const bucket = this.cells.get(`${i}:${j}`)
        if (bucket) bucket.forEach(fn)
      }
    }
  }
}
