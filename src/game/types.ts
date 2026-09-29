export type Point = { x: number; y: number }

/** Baked OSM payload from scripts/fetch-osm.mjs. Units are metres from the map centre. */
export type MapData = {
  center: { lat: number; lon: number }
  radius: number
  /** Flat [x, y, x, y, ...] junction coordinates. */
  vertices: number[]
  edges: { a: number; b: number; g: number[]; k: number; n?: string }[]
  areas: { k: number; g: number[] }[]
  rails: number[][]
  waterways: number[][]
}

export const AREA_BUILDING = 0
export const AREA_GREEN = 1
export const AREA_WATER = 2
