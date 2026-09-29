import { FoodField } from './Food'
import { RoadNetwork } from './RoadNetwork'
import { Snake, type DeathCause } from './Snake'
import type { MapData, Point } from './types'

export type GameState = {
  score: number
  length: number
  alive: boolean
  road?: string
  cause?: DeathCause
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
  private startEdge: number
  private pointer: Point = { x: 0, y: -1 }

private findStartEdge(): number {
  const nearest = this.net.nearestEdge(0, 0)

  let best = nearest
  let bestScore = Infinity

  for (let i = 0; i < this.net.edges.length; i++) {
    const edge = this.net.edges[i]

    // Avoid tiny OSM fragments.
    if (edge.length < 30) continue

    const aDegree = this.net.links[edge.a].length
    const bDegree = this.net.links[edge.b].length

    // We want a road that connects to something at both ends.
    // This guarantees the snake isn't forced into a dead end
    // immediately after spawning.
    if (aDegree < 2 || bDegree < 2) continue

    // Find the closest point on this road to the map centre.
    let distance = Infinity

    for (let p = 0; p < edge.g.length; p += 2) {
      const dx = edge.g[p]
      const dy = edge.g[p + 1]
      distance = Math.min(distance, dx * dx + dy * dy)
    }

    if (distance < bestScore) {
      bestScore = distance
      best = i
    }
  }

  return best
}

  constructor(readonly data: MapData) {
    this.net = new RoadNetwork(data)
    this.startEdge = this.net.nearestEdge(0, 0)
    this.startEdge = this.findStartEdge()
    this.food = new FoodField(this.net)
    this.snake = new Snake(this.net, this.startEdge)
        this.camera = { ...this.snake.head }
  }

  reset() {
    this.food = new FoodField(this.net)
    this.snake = new Snake(this.net, this.startEdge)
    this.camera = { ...this.snake.head }
    this.score = 0
  }

  setPointer(dx: number, dy: number) {
    this.pointer = { x: dx, y: dy }
  }

  setBoost(on: boolean) {
    this.snake.boosting = on
  }

  /** Screen pixels per metre. */
  get zoom(): number {
    const base = 2.2 / (1 + this.snake.segmentCount / 600)
    return Math.max(0.6, Math.min(5, base * this.zoomBias))
  }

  update(dt: number) {
    const { snake } = this
    if (!snake.alive) return

    const len = Math.hypot(this.pointer.x, this.pointer.y)
    if (len > 4) {
      snake.desired = { x: this.pointer.x / len, y: this.pointer.y / len }
    }

    snake.update(dt)

    for (const f of this.food.consume(snake.head.x, snake.head.y, snake.radius + 1.5)) {
      snake.grow(1)
      this.score += Math.round(f.radius * 5)
    }

    const follow = Math.min(1, dt * 5)
    this.camera.x += (snake.head.x - this.camera.x) * follow
    this.camera.y += (snake.head.y - this.camera.y) * follow
  }

  get state(): GameState {
    return {
      score: this.score,
      length: Math.round(this.snake.segmentCount),
      alive: this.snake.alive,
      road: this.snake.currentRoad,
      cause: this.snake.cause,
    }
  }
}
