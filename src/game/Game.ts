import { FoodField } from './Food'
import { RoadNetwork } from './RoadNetwork'
import {
  Snake,
  type DeathCause,
  type TurnDirection,
} from './Snake'
import type {
  MapData,
  Point,
} from './types'

export type GameState = {
  score: number
  length: number
  alive: boolean
  road?: string
  cause?: DeathCause
}

function rotationForHeading(
  heading: Point,
): number {
  /*
   * Rotate the world so the snake's heading
   * points straight up on screen.
   */
  return (
    -Math.atan2(
      heading.y,
      heading.x,
    ) -
    Math.PI / 2
  )
}

function angleDelta(
  from: number,
  to: number,
): number {
  let delta = to - from

  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }

  return delta
}

export class Game {
  readonly net: RoadNetwork

  food: FoodField
  snake: Snake
  camera: Point

  score = 0
  zoomBias = 1

  width = 0
  height = 0
  dpr = 1

  /**
   * Current world rotation used by the renderer.
   * The renderer rotates the map around the snake.
   */
  viewAngle = 0

  private startEdge: number

  private findStartEdge(): number {
    const nearest =
      this.net.nearestEdge(
        0,
        0,
      )

    let best = nearest
    let bestScore = Infinity

    for (
      let i = 0;
      i < this.net.edges.length;
      i++
    ) {
      const edge =
        this.net.edges[i]

      if (edge.length < 30) {
        continue
      }

      const aDegree =
        this.net.links[
          edge.a
        ].length

      const bDegree =
        this.net.links[
          edge.b
        ].length

      if (
        aDegree < 2 ||
        bDegree < 2
      ) {
        continue
      }

      let distance = Infinity

      for (
        let p = 0;
        p < edge.g.length;
        p += 2
      ) {
        const dx =
          edge.g[p]

        const dy =
          edge.g[p + 1]

        distance = Math.min(
          distance,
          dx * dx +
            dy * dy,
        )
      }

      if (
        distance < bestScore
      ) {
        bestScore = distance
        best = i
      }
    }

    return best
  }

  constructor(
    readonly data: MapData,
  ) {
    this.net =
      new RoadNetwork(data)

    this.startEdge =
      this.findStartEdge()

    this.food =
      new FoodField(this.net)

    this.snake =
      new Snake(
        this.net,
        this.startEdge,
      )

    this.camera = {
      ...this.snake.head,
    }

    this.viewAngle =
      rotationForHeading(
        this.snake.heading,
      )
  }

  reset() {
    this.food =
      new FoodField(this.net)

    this.snake =
      new Snake(
        this.net,
        this.startEdge,
      )

    this.camera = {
      ...this.snake.head,
    }

    this.score = 0

    this.viewAngle =
      rotationForHeading(
        this.snake.heading,
      )
  }

  setTurn(
    direction: TurnDirection,
  ) {
    this.snake.setTurn(
      direction,
    )
  }

  setBoost(
    on: boolean,
    free = false,
  ) {
    this.snake.boosting = on
    this.snake.freeBoosting =
      on && free
  }

  get zoom(): number {
    const base =
      2.2 /
      (1 +
        this.snake.segmentCount /
          600)

    return Math.max(
      0.6,
      Math.min(
        5,
        base * this.zoomBias,
      ),
    )
  }

  update(dt: number) {
    const { snake } =
      this

    if (!snake.alive) {
      return
    }

    snake.update(dt)

    for (
      const f of this.food.consume(
        snake.head.x,
        snake.head.y,
        snake.radius + 1.5,
      )
    ) {
      snake.grow(1)

      this.score +=
        Math.round(
          f.radius * 5,
        )
    }

    /*
     * Follow the snake smoothly.
     */
    const follow =
      Math.min(
        1,
        dt * 5,
      )

    this.camera.x +=
      (snake.head.x -
        this.camera.x) *
      follow

    this.camera.y +=
      (snake.head.y -
        this.camera.y) *
      follow

    /*
     * Rotate the map so the snake always
     * points toward the top of the screen.
     *
     * Using exponential smoothing means a
     * junction turn doesn't cause a violent
     * instant rotation.
     */
    const desiredAngle =
      rotationForHeading(
        snake.heading,
      )

    const delta =
      angleDelta(
        this.viewAngle,
        desiredAngle,
      )

    const rotationFollow =
      1 -
      Math.exp(
        -dt * 1.5,
      )

    this.viewAngle +=
      delta *
      rotationFollow
  }

  get state(): GameState {
    return {
      score: this.score,
      length: Math.round(
        this.snake.segmentCount,
      ),
      alive:
        this.snake.alive,
      road:
        this.snake.currentRoad,
      cause:
        this.snake.cause,
    }
  }
}