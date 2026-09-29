import type {
  Link,
  RoadNetwork,
  RoadTarget,
} from './RoadNetwork'
import type { Point } from './types'

const SEGMENT_SPACING = 4.5
const BASE_SPEED = 52
const BOOST_SPEED = 88
const BOOST_COST = 9
const MIN_SEGMENTS = 10

/** Segments near the head are exempt from self-collision. */
const NECK = 14

export type DeathCause =
  | 'self'
  | 'dead-end'

export class Snake {
  head: Point
  heading: Point = {
    x: 1,
    y: 0,
  }

  segmentCount = 18
  boosting = false
  alive = true
  cause?: DeathCause
  segments: Point[] = []

  /** World-space position of the cursor. */
  cursor: Point = {
    x: 0,
    y: 0,
  }

  nextJunction: Point | null = null

  private link: Link
  private dist = 0
  private trail: Point[]

  private target: RoadTarget | null = null
  private route: Link[] = []

  constructor(
    private net: RoadNetwork,
    startEdge: number,
  ) {
    const edge =
      net.edges[startEdge]

    const aLinks =
      net.links[edge.a]

    const bLinks =
      net.links[edge.b]

    if (
      aLinks.length > 1 &&
      bLinks.length <= 1
    ) {
      this.link = {
        edge: startEdge,
        dir: -1,
      }
    } else if (
      bLinks.length > 1 &&
      aLinks.length <= 1
    ) {
      this.link = {
        edge: startEdge,
        dir: 1,
      }
    } else {
      this.link = {
        edge: startEdge,
        dir: 1,
      }
    }

    const s = net.sample(
      startEdge,
      this.link.dir === 1
        ? 0
        : edge.length,
    )

    this.head = {
      x: s.x,
      y: s.y,
    }

    this.heading =
      this.link.dir === 1
        ? {
            x: s.hx,
            y: s.hy,
          }
        : {
            x: -s.hx,
            y: -s.hy,
          }

    this.cursor = {
      ...this.head,
    }

    this.trail = [
      { ...this.head },
    ]

    this.resample()
  }

  setCursor(point: Point) {
    this.cursor = {
      ...point,
    }

    this.updateRoute()
  }

  get radius(): number {
    return (
      2.6 +
      Math.sqrt(
        this.segmentCount,
      ) *
        0.35
    )
  }

  get speed(): number {
    return this.boosting &&
      this.segmentCount >
        MIN_SEGMENTS
      ? BOOST_SPEED
      : BASE_SPEED
  }

  get currentRoad():
    | string
    | undefined {
    return this.net.edges[
      this.link.edge
    ].name
  }

  grow(amount = 1) {
    this.segmentCount += amount
  }

  update(dt: number) {
    if (!this.alive) return

    if (
      this.boosting &&
      this.segmentCount >
        MIN_SEGMENTS
    ) {
      this.segmentCount =
        Math.max(
          MIN_SEGMENTS,
          this.segmentCount -
            BOOST_COST * dt,
        )
    }

    this.advance(
      this.speed * dt,
    )

    const s =
      this.sampleHead()

    this.head = {
      x: s.x,
      y: s.y,
    }

    this.heading = {
      x: s.hx,
      y: s.hy,
    }

    this.trail.unshift({
      ...this.head,
    })

    this.trimTrail()
    this.resample()

    this.nextJunction =
      this.net.vertexPoint(
        this.net.endVertex(
          this.link,
        ),
      )

    if (
      this.alive &&
      this.hitsSelf()
    ) {
      this.kill('self')
    }
  }

  private kill(
    cause: DeathCause,
  ) {
    this.alive = false
    this.cause = cause
  }

  private sampleHead() {
    const e =
      this.net.edges[
        this.link.edge
      ]

    const s =
      this.net.sample(
        this.link.edge,
        this.link.dir === 1
          ? this.dist
          : e.length -
              this.dist,
      )

    return this.link.dir === 1
      ? s
      : {
          x: s.x,
          y: s.y,
          hx: -s.hx,
          hy: -s.hy,
        }
  }

  /**
   * Move forward along the current route.
   */
  private advance(
    distance: number,
  ) {
    let remaining = distance
    let guard = 0

    while (
      remaining > 0 &&
      guard++ < 32
    ) {
      const edge =
        this.net.edges[
          this.link.edge
        ]

      const room =
        edge.length -
        this.dist

      if (
        remaining < room
      ) {
        this.dist += remaining
        return
      }

      remaining -= room

      const next =
        this.chooseNext()

      if (!next) {
        this.dist =
          edge.length

        this.kill(
          'dead-end',
        )

        return
      }

      this.link = next
      this.dist = 0

      /*
       * We've consumed the first link
       * in the cached route.
       */
      if (
        this.route.length > 0 &&
        this.sameLink(
          this.route[0],
          next,
        )
      ) {
        this.route.shift()
      }

      /*
       * Recalculate because the snake has
       * moved to a new junction.
       */
      this.updateRoute()
    }
  }

  private chooseNext():
    | Link
    | null {
    if (
      this.route.length > 0
    ) {
      return this.route[0]
    }

    /*
     * If the cursor is on the current
     * road ahead of us, continue forward.
     */
    const target = this.target

    if (
      target &&
      target.edge ===
        this.link.edge
    ) {
      const targetDist =
        this.link.dir === 1
          ? target.dist
          : this.net.edges[
              this.link.edge
            ].length -
            target.dist

      if (
        targetDist >
        this.dist
      ) {
        return null
      }
    }

    return null
  }

  /**
   * Find the nearest road point to the cursor
   * and calculate the shortest graph route to it.
   */
  private updateRoute() {
    const target =
      this.net.nearestRoadPoint(
        this.cursor.x,
        this.cursor.y,
      )

    this.target = target

    if (!target) {
      this.route = []
      return
    }

    const currentEdge =
      this.net.edges[
        this.link.edge
      ]

    /*
     * If target is ahead on the current road,
     * no junction routing is needed.
     */
    if (
      target.edge ===
      this.link.edge
    ) {
      const targetDist =
        this.link.dir === 1
          ? target.dist
          : currentEdge.length -
            target.dist

      if (
        targetDist >= this.dist
      ) {
        this.route = []
        return
      }
    }

    const startVertex =
      this.net.endVertex(
        this.link,
      )

    let bestRoute:
      | {
          route: Link[]
          cost: number
        }
      | null = null

    /*
     * The target road can be approached
     * from either end.
     */
    const targetEdge =
      this.net.edges[
        target.edge
      ]

    const approaches = [
      {
        vertex: targetEdge.a,
        targetCost: target.dist,
      },
      {
        vertex: targetEdge.b,
        targetCost:
          targetEdge.length -
          target.dist,
      },
    ]

    for (
      const approach of approaches
    ) {
      const route =
        this.net.shortestPath(
          startVertex,
          approach.vertex,
        )

      if (!route) continue

      const currentRemaining =
        currentEdge.length -
        this.dist

      const cost =
        currentRemaining +
        route.reduce(
          (sum, link) =>
            sum +
            this.net.edges[
              link.edge
            ].length,
          0,
        ) +
        approach.targetCost

      if (
        !bestRoute ||
        cost <
          bestRoute.cost
      ) {
        bestRoute = {
          route,
          cost,
        }
      }
    }

    this.route =
      bestRoute?.route ?? []
  }

  /**
   * Project the exact route the snake is
   * currently going to take.
   */
  getProjectedPath(
    maxDistance = 180,
  ): Point[] {
    const path: Point[] = [
      { ...this.head },
    ]

    let link = {
      ...this.link,
    }

    let dist = this.dist
    let travelled = 0
    let route = [
      ...this.route,
    ]

    const target = this.target

    let guard = 0

    while (
      travelled <
        maxDistance &&
      guard++ < 32
    ) {
      const edge =
        this.net.edges[
          link.edge
        ]

      /*
       * If we're on the target edge,
       * stop at the target point.
       */
      if (
        target &&
        link.edge ===
          target.edge
      ) {
        const targetDist =
          link.dir === 1
            ? target.dist
            : edge.length -
              target.dist

        if (
          targetDist >= dist
        ) {
          const take =
            Math.min(
              targetDist -
                dist,
              maxDistance -
                travelled,
            )

          this.net.appendPath(
            path,
            link,
            dist,
            dist + take,
          )

          break
        }
      }

      const remaining =
        edge.length -
        dist

      const take =
        Math.min(
          remaining,
          maxDistance -
            travelled,
        )

      this.net.appendPath(
        path,
        link,
        dist,
        dist + take,
      )

      travelled += take
      dist += take

      if (
        take < remaining
      ) {
        break
      }

      if (
        route.length === 0
      ) {
        break
      }

      link = route[0]
      route = route.slice(1)
      dist = 0
    }

    return path
  }

  private sameLink(
    a: Link,
    b: Link,
  ): boolean {
    return (
      a.edge === b.edge &&
      a.dir === b.dir
    )
  }

  private get trailLength(): number {
    return (
      this.segmentCount *
        SEGMENT_SPACING +
      SEGMENT_SPACING
    )
  }

  private trimTrail() {
    let dist = 0

    for (
      let i = 1;
      i < this.trail.length;
      i++
    ) {
      dist += Math.hypot(
        this.trail[i].x -
          this.trail[i - 1].x,
        this.trail[i].y -
          this.trail[i - 1].y,
      )

      if (
        dist >
        this.trailLength
      ) {
        this.trail.length =
          i + 1
        return
      }
    }
  }

  private resample() {
    const out: Point[] = [
      { ...this.head },
    ]

    let target =
      SEGMENT_SPACING

    let travelled = 0

    for (
      let i = 1;
      i < this.trail.length &&
      out.length <=
        this.segmentCount;
      i++
    ) {
      const a =
        this.trail[i - 1]

      const b =
        this.trail[i]

      const seg = Math.hypot(
        b.x - a.x,
        b.y - a.y,
      )

      if (seg === 0) continue

      while (
        travelled + seg >=
          target &&
        out.length <=
          this.segmentCount
      ) {
        const t =
          (target -
            travelled) /
          seg

        out.push({
          x:
            a.x +
            (b.x - a.x) * t,
          y:
            a.y +
            (b.y - a.y) * t,
        })

        target +=
          SEGMENT_SPACING
      }

      travelled += seg
    }

    this.segments = out
  }

  private hitsSelf(): boolean {
    const r =
      this.radius * 0.85

    for (
      let i = NECK;
      i < this.segments.length;
      i++
    ) {
      const s =
        this.segments[i]

      if (
        (s.x -
          this.head.x) **
            2 +
          (s.y -
            this.head.y) **
            2 <
          r * r
      ) {
        return true
      }
    }

    return false
  }
}