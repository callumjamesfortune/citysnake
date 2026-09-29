import type { Link, RoadNetwork } from './RoadNetwork'
import type { Point } from './types'

const SEGMENT_SPACING = 4.5
const BASE_SPEED = 52
const BOOST_SPEED = 88
const BOOST_COST = 9
const MIN_SEGMENTS = 10
/** Segments near the head are exempt from self-collision so tight corners are survivable. */
const NECK = 14

export type DeathCause = 'self' | 'dead-end'

export class Snake {
  head: Point
  heading: Point = { x: 1, y: 0 }
  segmentCount = 18
  boosting = false
  alive = true
  cause?: DeathCause
  segments: Point[] = []
  /** Player aim, set each frame; decides which road is taken at the next junction. */
  desired: Point = { x: 1, y: 0 }
  nextJunction: Point | null = null

  private link: Link
  private dist = 0
  private trail: Point[]

constructor(
  private net: RoadNetwork,
  startEdge: number,
) {
  const edge = net.edges[startEdge]

  const aLinks = net.links[edge.a]
  const bLinks = net.links[edge.b]

  // If one end is a junction and the other is a dead end,
  // start at the dead-end end and travel toward the junction.
  if (aLinks.length > 1 && bLinks.length <= 1) {
    this.link = { edge: startEdge, dir: -1 }
  } else if (bLinks.length > 1 && aLinks.length <= 1) {
    this.link = { edge: startEdge, dir: 1 }
  } else {
    // Both ends are usable junctions, so start at A and travel to B.
    this.link = { edge: startEdge, dir: 1 }
  }

  const s = net.sample(
    startEdge,
    this.link.dir === 1 ? 0 : edge.length,
  )

  this.head = { x: s.x, y: s.y }

  this.heading =
    this.link.dir === 1
      ? { x: s.hx, y: s.hy }
      : { x: -s.hx, y: -s.hy }

  this.trail = [{ ...this.head }]
  this.resample()
}

  get radius(): number {
    return 2.6 + Math.sqrt(this.segmentCount) * 0.35
  }

  get speed(): number {
    return this.boosting && this.segmentCount > MIN_SEGMENTS ? BOOST_SPEED : BASE_SPEED
  }

  get currentRoad(): string | undefined {
    return this.net.edges[this.link.edge].name
  }

  grow(amount = 1) {
    this.segmentCount += amount
  }

  update(dt: number) {
    if (!this.alive) return

    if (this.boosting && this.segmentCount > MIN_SEGMENTS) {
      this.segmentCount = Math.max(MIN_SEGMENTS, this.segmentCount - BOOST_COST * dt)
    }

    this.advance(this.speed * dt)

    const s = this.sampleHead()
    this.head = { x: s.x, y: s.y }
    this.heading = { x: s.hx, y: s.hy }

    this.trail.unshift({ ...this.head })
    this.trimTrail()
    this.resample()

    this.nextJunction = this.net.vertexPoint(this.net.endVertex(this.link))

    if (this.alive && this.hitsSelf()) this.kill('self')
  }

  private kill(cause: DeathCause) {
    this.alive = false
    this.cause = cause
  }

  private sampleHead() {
    const e = this.net.edges[this.link.edge]
    const s = this.net.sample(this.link.edge, this.link.dir === 1 ? this.dist : e.length - this.dist)
    return this.link.dir === 1 ? s : { x: s.x, y: s.y, hx: -s.hx, hy: -s.hy }
  }

  /** Move forward, hopping onto the best-aligned road at each junction crossed. */
  private advance(distance: number) {
    let remaining = distance
    let guard = 0
    while (guard++ < 32) {
      const room = this.net.edges[this.link.edge].length - this.dist
      if (remaining < room) {
        this.dist += remaining
        return
      }
      remaining -= room
      const next = this.chooseNext()
      if (!next) {
        this.dist = this.net.edges[this.link.edge].length
        this.kill('dead-end')
        return
      }
      this.link = next
      this.dist = 0
    }
  }

  /** Null means the only way on is back the way we came, i.e. a dead end. */
private chooseNext(): Link | null {
  return this.chooseNextFor(this.link, this.heading)
}

  private get trailLength(): number {
    return this.segmentCount * SEGMENT_SPACING + SEGMENT_SPACING
  }

  private trimTrail() {
    let dist = 0
    for (let i = 1; i < this.trail.length; i++) {
      dist += Math.hypot(this.trail[i].x - this.trail[i - 1].x, this.trail[i].y - this.trail[i - 1].y)
      if (dist > this.trailLength) {
        this.trail.length = i + 1
        return
      }
    }
  }

  private resample() {
    const out: Point[] = [{ ...this.head }]
    let target = SEGMENT_SPACING
    let travelled = 0

    for (let i = 1; i < this.trail.length && out.length <= this.segmentCount; i++) {
      const a = this.trail[i - 1]
      const b = this.trail[i]
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      if (seg === 0) continue
      while (travelled + seg >= target && out.length <= this.segmentCount) {
        const t = (target - travelled) / seg
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        target += SEGMENT_SPACING
      }
      travelled += seg
    }
    this.segments = out
  }

  /**
 * Predict the route the snake will take based on the current aim.
 * Returns real road geometry rather than a straight line to the cursor.
 */
getProjectedPath(maxDistance = 180): Point[] {
  const path: Point[] = [{ ...this.head }]

  let link = { ...this.link }
  let dist = this.dist
  let travelled = 0
  let heading = { ...this.heading }

  // Prevent pathological OSM graphs from producing an enormous prediction.
  let guard = 0

  while (travelled < maxDistance && guard++ < 20) {
    const edge = this.net.edges[link.edge]

    // Distance remaining on the current road.
    const remaining = edge.length - dist
    const take = Math.min(remaining, maxDistance - travelled)

    this.net.appendPath(
      path,
      link,
      dist,
      dist + take,
    )

    travelled += take
    dist += take

    // We haven't reached a junction yet.
    if (take < remaining) break

    // We've reached the end of this road.
    const next = this.chooseNextFor(link, heading)

    // No road to continue onto = dead end.
    if (!next) break

    heading = this.net.exitHeading(next)
    link = next
    dist = 0
  }

  return path
}

/**
 * Same decision rule used by the snake, but operates on a hypothetical
 * link/heading so the projection doesn't alter the real snake.
 */
private chooseNextFor(
  current: Link,
  heading: Point,
): Link | null {
  const vertex = this.net.endVertex(current)
  const options = this.net.links[vertex]
  const cameFrom = current.edge

  let best: Link | null = null
  let bestScore = -Infinity

  for (const link of options) {
    if (link.edge === cameFrom) continue

    const h = this.net.exitHeading(link)

    const score =
      h.x * this.desired.x +
      h.y * this.desired.y +
      (h.x * heading.x + h.y * heading.y) * 0.35

    if (score > bestScore) {
      bestScore = score
      best = link
    }
  }

  return best
}

  private hitsSelf(): boolean {
    const r = this.radius * 0.85
    for (let i = NECK; i < this.segments.length; i++) {
      const s = this.segments[i]
      if ((s.x - this.head.x) ** 2 + (s.y - this.head.y) ** 2 < r * r) return true
    }
    return false
  }
}
