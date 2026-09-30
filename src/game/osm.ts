import type { MapData } from './types'

export type CityMap = {
  id: string
  name: string
  file: string
}

const MAP_BASE = '/citysnake/maps/'

export const CITY_MAPS: CityMap[] = [
  {
    id: 'crewe',
    name: 'Crewe',
    file: `${MAP_BASE}crewe.json`,
  },
  {
    id: 'chester',
    name: 'Chester',
    file: `${MAP_BASE}chester.json`,
  },
  {
    id: 'norwich',
    name: 'Norwich',
    file: `${MAP_BASE}norwich.json`,
  },
  {
    id: 'manchester',
    name: 'Manchester',
    file: `${MAP_BASE}manchester.json`,
  },
  {
    id: 'preston',
    name: 'Preston',
    file: `${MAP_BASE}preston.json`,
  },
]

export async function loadBundledMap(
  city: CityMap,
  onProgress?: (message: string) => void,
): Promise<MapData> {
  onProgress?.(`Loading ${city.name}…`)

  const response = await fetch(city.file)

  if (!response.ok) {
    throw new Error(
      `Could not load ${city.name} map (${response.status})`,
    )
  }

  onProgress?.('Reading map data…')

  const data = (await response.json()) as MapData

  if (!data.vertices?.length || !data.edges?.length) {
    throw new Error(`${city.name} map is empty`)
  }

  onProgress?.(`${city.name} map ready`)

  return data
}