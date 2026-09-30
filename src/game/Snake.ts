import type {
  Link,
  RoadNetwork,
} from './RoadNetwork'
import type { Point } from './types'

const SEGMENT_SPACING = 4.5
const BASE_SPEED = 52
const BOOST_SPEED = 88
const FREE_BOOST_SPEED = 250
const BOOST_COST = 9
const MIN_SEGMENTS = 10

/** Segments near the head are exempt from self-collision. */
const NECK = 14

const STRAIGHT_ANGLE = Math.PI * 0.2 // 36 degrees

export type TurnDirection = -1 | 0 | 1

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
  freeBoosting = false
  alive = true
  cause?: DeathCause
  segments: Point[] = []

  nextJunction: Point | null = null

  private link: Link
  private dist = 0
  private trail: Point[]

  /**
   * The player's requested direction for the next junction.
   *
   * -1 = left
   *  0 = straight
   *  1 = right
   */
  private pendingTurn: TurnDirection | null = null

  constructor(
    private net: RoadNetwork,
    startEdge: number,
  ) {
    const edge = net.edges[startEdge]

    const aLinks =
      net.links[edge.a]

    const bLinks =
      net.links[edge.b]

    /*
     * Prefer starting toward a junction rather than
     * immediately heading toward a dead end.
     */
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

    this.trail = [
      { ...this.head },
    ]

    this.resample()

    this.nextJunction =
      this.net.vertexPoint(
        this.net.endVertex(
          this.link,
        ),
      )
  }

  setTurn(
    direction: TurnDirection,
  ) {
    this.pendingTurn = direction
  }

  get radius(): number {
    return (
      2.6 +
      Math.sqrt(
        this.segmentCount,
      ) * 0.35
    )
  }

  get speed(): number {
    if (this.freeBoosting) {
      return FREE_BOOST_SPEED
    }
  
    if (this.boosting) {
      return BOOST_SPEED
    }
  
    return BASE_SPEED
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
      !this.freeBoosting &&
      this.segmentCount > MIN_SEGMENTS
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
   * Move forward along the road network.
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

      if (remaining < room) {
        this.dist += remaining
        return
      }

      remaining -= room

      const next =
        this.chooseNext()

      if (!next) {
        this.dist = edge.length
        this.kill('dead-end')
        return
      }

      this.link = next
      this.dist = 0

      /*
       * We have passed the junction.
       * The turn command is deliberately one-shot,
       * so chooseNext() has already consumed it.
       */
    }
  }

  /**
   * Choose which road to take at the next junction.
   */
  private chooseNext():
  | Link
  | null {
  const vertex =
    this.net.endVertex(
      this.link,
    )

  const candidates =
    this.getLegalLinks(vertex)

  if (candidates.length === 0) {
    return null
  }

  const turn =
    this.pendingTurn

  /*
   * A left/right command stays pending until
   * we actually reach a junction where that
   * direction is available.
   */
  if (
    turn !== null &&
    turn !== 0 &&
    !this.hasTurnOption(
      candidates,
      turn,
    )
  ) {
    return this.selectLink(
      candidates,
      0,
    )
  }

  const selected =
    this.selectLink(
      candidates,
      turn ?? 0,
    )

  /*
   * The command has now been used.
   */
  this.pendingTurn = null

  return selected
}

  /**
   * Get all roads leaving the junction except
   * the road we just came from in reverse.
   */
  private getLegalLinks(
    vertex: number,
  ): Link[] {
    return this.net.links[
      vertex
    ].filter(
      (candidate) =>
        !(
          candidate.edge ===
            this.link.edge &&
          candidate.dir ===
            -this.link.dir
        ),
    )
  }

  private hasTurnOption(
    candidates: Link[],
    turn: TurnDirection,
  ): boolean {
    if (turn === 0) {
      return true
    }
  
    const forward =
      this.net.arrivalHeading(
        this.link,
      )
  
    return candidates.some(
      (candidate) => {
        const outgoing =
          this.net.exitHeading(
            candidate,
          )
  
        const cross =
          forward.x * outgoing.y -
          forward.y * outgoing.x
  
        const dot =
          forward.x * outgoing.x +
          forward.y * outgoing.y
  
        const angle =
          Math.atan2(
            cross,
            dot,
          )
  
        return turn < 0
          ? angle < -STRAIGHT_ANGLE
          : angle > STRAIGHT_ANGLE
      },
    )
  }

  /**
   * Pick the road that best matches the requested
   * left / straight / right direction.
   *
   * World coordinates use screen-style Y-down
   * coordinates, so negative angles are left.
   */
  private selectLink(
    candidates: Link[],
    turn: TurnDirection,
  ): Link {
    const forward =
      this.net.arrivalHeading(
        this.link,
      )

    const scored = candidates.map(
      (candidate) => {
        const outgoing =
          this.net.exitHeading(
            candidate,
          )

        const cross =
          forward.x * outgoing.y -
          forward.y * outgoing.x

        const dot =
          forward.x * outgoing.x +
          forward.y * outgoing.y

        const angle =
          Math.atan2(
            cross,
            dot,
          )

        return {
          link: candidate,
          angle,
        }
      },
    )

    /*
     * Straight:
     * choose the road closest to our current heading.
     */
    if (turn === 0) {
      return scored.reduce(
        (best, current) =>
          Math.abs(current.angle) <
          Math.abs(best.angle)
            ? current
            : best,
      ).link
    }

    /*
     * Left/right:
     * first look for an actual turn in the
     * requested direction.
     */
    const sideCandidates =
      scored.filter((item) =>
        turn < 0
          ? item.angle <
            -STRAIGHT_ANGLE
          : item.angle >
            STRAIGHT_ANGLE,
      )

    if (sideCandidates.length > 0) {
      const desired =
        turn < 0
          ? -Math.PI / 2
          : Math.PI / 2

      return sideCandidates.reduce(
        (best, current) =>
          Math.abs(
            current.angle -
              desired,
          ) <
          Math.abs(
            best.angle -
              desired,
          )
            ? current
            : best,
      ).link
    }

    /*
     * No road in the requested direction.
     * Prefer straight instead of making an
     * unexpected turn.
     */
    const straightCandidates =
      scored.filter(
        (item) =>
          Math.abs(item.angle) <=
          STRAIGHT_ANGLE,
      )

    if (
      straightCandidates.length > 0
    ) {
      return straightCandidates.reduce(
        (best, current) =>
          Math.abs(current.angle) <
          Math.abs(best.angle)
            ? current
            : best,
      ).link
    }

    /*
     * No straight road either.
     * Take the closest available option
     * to the requested direction.
     */
    const desired =
      turn < 0
        ? -Math.PI / 2
        : Math.PI / 2

    return scored.reduce(
      (best, current) =>
        Math.abs(
          current.angle -
            desired,
        ) <
        Math.abs(
          best.angle -
            desired,
        )
          ? current
          : best,
    ).link
  }

  /**
   * Project the route the snake will actually take.
   *
   * This does NOT perform pathfinding.
   * It simply follows the same junction-selection
   * rules used by the real snake.
   */
  getProjectedPath(
    maxDistance = 500,
  ): Point[] {
    const path: Point[] = [
      { ...this.head },
    ]
  
    let link = {
      ...this.link,
    }
  
    let dist = this.dist
    let travelled = 0
  
    /*
     * Keep the player's requested direction alive
     * until a junction actually offers that turn.
     */
    let turn =
      this.pendingTurn ?? 0
  
    let guard = 0
  
    while (
      travelled < maxDistance &&
      guard++ < 32
    ) {
      const edge =
        this.net.edges[
          link.edge
        ]
  
      const remaining =
        edge.length - dist
  
      const take =
        Math.min(
          remaining,
          maxDistance - travelled,
        )
  
      this.net.appendPath(
        path,
        link,
        dist,
        dist + take,
      )
  
      travelled += take
      dist += take
  
      if (take < remaining) {
        break
      }
  
      const vertex =
        this.net.endVertex(
          link,
        )
  
      const candidates =
        this.net.links[
          vertex
        ].filter(
          (candidate) =>
            !(
              candidate.edge ===
                link.edge &&
              candidate.dir ===
                -link.dir
            ),
        )
  
      if (candidates.length === 0) {
        break
      }
  
      /*
       * For LEFT / RIGHT, only consume the command
       * if this junction actually has a turn in
       * that direction.
       */
      let selected: Link | null = null
  
      if (turn !== 0) {
        const hasRequestedTurn =
          this.hasTurnOptionFrom(
            candidates,
            link,
            turn,
          )
  
        if (hasRequestedTurn) {
          selected =
            this.selectLinkFrom(
              candidates,
              link,
              turn,
            )
  
          // The requested turn has now been used.
          turn = 0
        } else {
          /*
           * No requested turn here.
           * Continue straight, but KEEP the command.
           */
          selected =
            this.selectLinkFrom(
              candidates,
              link,
              0,
            )
        }
      } else {
        selected =
          this.selectLinkFrom(
            candidates,
            link,
            0,
          )
      }
  
      if (!selected) {
        break
      }
  
      link = selected
      dist = 0
    }
  
    return path
  }

  private hasTurnOptionFrom(
    candidates: Link[],
    incoming: Link,
    turn: TurnDirection,
  ): boolean {
    if (turn === 0) {
      return true
    }
  
    const forward =
      this.net.arrivalHeading(
        incoming,
      )
  
    return candidates.some(
      (candidate) => {
        const outgoing =
          this.net.exitHeading(
            candidate,
          )
  
        const cross =
          forward.x * outgoing.y -
          forward.y * outgoing.x
  
        const dot =
          forward.x * outgoing.x +
          forward.y * outgoing.y
  
        const angle =
          Math.atan2(
            cross,
            dot,
          )
  
        return turn < 0
          ? angle < -STRAIGHT_ANGLE
          : angle > STRAIGHT_ANGLE
      },
    )
  }

  /**
   * Same junction-selection logic as selectLink(),
   * but works with a simulated link so that the
   * projection doesn't mutate the real snake.
   */
  private selectLinkFrom(
    candidates: Link[],
    incoming: Link,
    turn: TurnDirection,
  ): Link | null {
    const forward =
      this.net.arrivalHeading(
        incoming,
      )

    const scored = candidates.map(
      (candidate) => {
        const outgoing =
          this.net.exitHeading(
            candidate,
          )

        const cross =
          forward.x * outgoing.y -
          forward.y * outgoing.x

        const dot =
          forward.x * outgoing.x +
          forward.y * outgoing.y

        return {
          link: candidate,
          angle: Math.atan2(
            cross,
            dot,
          ),
        }
      },
    )

    if (scored.length === 0) {
      return null
    }

    if (turn === 0) {
      return scored.reduce(
        (best, current) =>
          Math.abs(current.angle) <
          Math.abs(best.angle)
            ? current
            : best,
      ).link
    }

    const sideCandidates =
      scored.filter((item) =>
        turn < 0
          ? item.angle <
            -STRAIGHT_ANGLE
          : item.angle >
            STRAIGHT_ANGLE,
      )

    if (sideCandidates.length > 0) {
      const desired =
        turn < 0
          ? -Math.PI / 2
          : Math.PI / 2

      return sideCandidates.reduce(
        (best, current) =>
          Math.abs(
            current.angle -
              desired,
          ) <
          Math.abs(
            best.angle -
              desired,
          )
            ? current
            : best,
      ).link
    }

    const straightCandidates =
      scored.filter(
        (item) =>
          Math.abs(item.angle) <=
          STRAIGHT_ANGLE,
      )

    if (
      straightCandidates.length > 0
    ) {
      return straightCandidates.reduce(
        (best, current) =>
          Math.abs(current.angle) <
          Math.abs(best.angle)
            ? current
            : best,
      ).link
    }

    const desired =
      turn < 0
        ? -Math.PI / 2
        : Math.PI / 2

    return scored.reduce(
      (best, current) =>
        Math.abs(
          current.angle -
            desired,
        ) <
        Math.abs(
          best.angle -
            desired,
        )
          ? current
          : best,
    ).link
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