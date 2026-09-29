import type { MapData } from './types'

export type Place = { name: string; lat: number; lon: number }

type OsmWay = {
  nodes: number[]
  geometry?: { lat: number; lon: number }[]
  tags?: Record<string, string>
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]

const DB_NAME = 'snake-roads'
const DB_VERSION = 1
const MAP_STORE = 'maps'

function openMapDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MAP_STORE)) {
        db.createObjectStore(MAP_STORE)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readSavedMap(key: string): Promise<MapData | undefined> {
  try {
    const db = await openMapDB()

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MAP_STORE, 'readonly')
      const request = tx.objectStore(MAP_STORE).get(key)

      request.onsuccess = () => resolve(request.result as MapData | undefined)
      request.onerror = () => reject(request.error)
    })
  } catch {
    // Local storage isn't essential to gameplay.
    return undefined
  }
}

async function saveMap(key: string, data: MapData): Promise<void> {
  try {
    const db = await openMapDB()

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MAP_STORE, 'readwrite')
      tx.objectStore(MAP_STORE).put(data, key)

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (error) {
    console.warn('Could not save map locally:', error)
  }
}

const DRIVABLE =
  '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$'

const KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service']
const R = 6378137

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(query)
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) throw new Error(`Place search failed (${res.status})`)
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[]
  return rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }))
}

/**
 * Downloads OSM geometry around a place and turns it into the game's map
 * format. Results are cached so replaying a city is instant.
 */
export async function loadMapData(
  place: Place,
  radius: number,
  onProgress?: (message: string) => void,
): Promise<MapData> {
  const key = `osm:${place.lat},${place.lon},${radius}`

  onProgress?.('Checking saved map…')

  const saved = await readSavedMap(key)

  if (saved) {
    onProgress?.('Loaded saved map')
    return saved
  }

  onProgress?.('Downloading map data…')

  const response = await overpass(query(place, radius))

  onProgress?.('Building road network…')

  const data = buildMapData(response, place, radius)

  if (data.edges.length < 20) {
    throw new Error('Not enough roads found in this area.')
  }

  onProgress?.('Saving map locally…')

  await saveMap(key, data)

  onProgress?.('Map ready!')

  return data
}

function query(place: Place, radius: number): string {
  const latDelta = (radius / R) * (180 / Math.PI)
  const lonDelta = latDelta / Math.cos((place.lat * Math.PI) / 180)
  const bbox = [
    (place.lat - latDelta).toFixed(6),
    (place.lon - lonDelta).toFixed(6),
    (place.lat + latDelta).toFixed(6),
    (place.lon + lonDelta).toFixed(6),
  ].join(',')

  return `[out:json][timeout:180];
(
  way["highway"~"${DRIVABLE}"](${bbox});
  way["railway"~"^(rail|light_rail)$"](${bbox});
  way["building"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"~"^(river|canal)$"](${bbox});
  way["landuse"~"^(grass|forest|meadow|recreation_ground|allotments|cemetery|farmland|village_green)$"](${bbox});
  way["leisure"~"^(park|garden|pitch|golf_course)$"](${bbox});
);
out body geom;`
}

async function overpass(body: string): Promise<OsmWay[]> {
  let lastError: unknown

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log('Trying Overpass:', url)

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(body),
      })

      const text = await res.text()

      console.log('Overpass response:', {
        url,
        status: res.status,
        contentType: res.headers.get('content-type'),
        preview: text.slice(0, 300),
      })

      if (res.ok) {
        try {
          const json = JSON.parse(text)
          return json.elements as OsmWay[]
        } catch {
          throw new Error(
            `Overpass returned non-JSON data from ${url}:\n${text.slice(0, 500)}`
          )
        }
      }

      lastError = new Error(
        `Map server busy (${res.status}): ${text.slice(0, 300)}`
      )
    } catch (err) {
      console.error('Overpass failed:', url, err)
      lastError = err
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not reach any map server')
}

const round = (n: number) => Math.round(n * 10) / 10

function buildMapData(elements: OsmWay[], center: Place, radius: number): MapData {
  const rad = Math.PI / 180
  const scaleX = rad * R * Math.cos(center.lat * rad)
  /** Local equirectangular projection: 1 unit = 1 metre, +y is south. */
  const project = (p: { lat: number; lon: number }): [number, number] => [
    round((p.lon - center.lon) * scaleX),
    round(-(p.lat - center.lat) * rad * R),
  ]

  const roadWays: { nodes: number[]; pts: [number, number][]; kind: number; name?: string }[] = []
  const areas: MapData['areas'] = []
  const rails: number[][] = []
  const waterways: number[][] = []

  for (const el of elements) {
    if (!el.geometry || el.geometry.length < 2) continue
    const t = el.tags ?? {}
    const pts = el.geometry.map(project)
    const closed = el.nodes[0] === el.nodes[el.nodes.length - 1]

    if (t.highway) roadWays.push({ nodes: el.nodes, pts, kind: roadKind(t.highway), name: t.name })
    else if (t.railway) rails.push(pts.flat())
    else if (t.waterway) waterways.push(pts.flat())
    else if (!closed) continue
    else if (t.building) areas.push({ k: 0, g: pts.flat() })
    else if (t.natural === 'water') areas.push({ k: 2, g: pts.flat() })
    else areas.push({ k: 1, g: pts.flat() })
  }

  return { center, radius, ...buildGraph(roadWays), areas, rails, waterways }
}

function roadKind(highway: string): number {
  const base = highway.replace(/_link$/, '')
  const i = KINDS.indexOf(base === 'unclassified' || base === 'living_street' ? 'residential' : base)
  return i < 0 ? 5 : i
}

/**
 * Splits ways at shared nodes into a junction graph, then keeps only the
 * largest connected component so the snake can never be stranded.
 */
function buildGraph(ways: { nodes: number[]; pts: [number, number][]; kind: number; name?: string }[]) {
  const uses = new Map<number, number>()
  for (const w of ways) for (const n of w.nodes) uses.set(n, (uses.get(n) ?? 0) + 1)

  const vertexIndex = new Map<number, number>()
  const vertices: number[] = []
  const vertexOf = (nodeId: number, pt: [number, number]) => {
    let i = vertexIndex.get(nodeId)
    if (i === undefined) {
      i = vertices.length / 2
      vertices.push(pt[0], pt[1])
      vertexIndex.set(nodeId, i)
    }
    return i
  }

  const rawEdges: MapData['edges'] = []
  for (const w of ways) {
    let start = 0
    for (let i = 1; i < w.nodes.length; i++) {
      if ((uses.get(w.nodes[i]) ?? 0) <= 1 && i !== w.nodes.length - 1) continue
      const a = vertexOf(w.nodes[start], w.pts[start])
      const b = vertexOf(w.nodes[i], w.pts[i])
      const g = w.pts.slice(start, i + 1).flat()
      if (a !== b && geomLength(g) > 0.5) {
        rawEdges.push({ a, b, g, k: w.kind, ...(w.name ? { n: w.name } : {}) })
      }
      start = i
    }
  }

  const adj = new Map<number, number[]>()
  const link = (v: number, i: number) => {
    const list = adj.get(v)
    if (list) list.push(i)
    else adj.set(v, [i])
  }
  rawEdges.forEach((e, i) => {
    link(e.a, i)
    link(e.b, i)
  })

  const comp = new Map<number, number>()
  let best = -1
  let bestSize = 0
  let id = 0
  for (const v of adj.keys()) {
    if (comp.has(v)) continue
    let size = 0
    const stack = [v]
    comp.set(v, id)
    while (stack.length) {
      const cur = stack.pop()!
      size++
      for (const ei of adj.get(cur) ?? []) {
        const other = rawEdges[ei].a === cur ? rawEdges[ei].b : rawEdges[ei].a
        if (!comp.has(other)) {
          comp.set(other, id)
          stack.push(other)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = id
    }
    id++
  }

  const remap = new Map<number, number>()
  const finalVertices: number[] = []
  const edges: MapData['edges'] = []
  const map = (v: number) => {
    let i = remap.get(v)
    if (i === undefined) {
      i = finalVertices.length / 2
      finalVertices.push(vertices[v * 2], vertices[v * 2 + 1])
      remap.set(v, i)
    }
    return i
  }
  for (const e of rawEdges) {
    if (comp.get(e.a) !== best) continue
    edges.push({ ...e, a: map(e.a), b: map(e.b) })
  }

  return { vertices: finalVertices, edges }
}

function geomLength(g: number[]): number {
  let d = 0
  for (let i = 2; i < g.length; i += 2) d += Math.hypot(g[i] - g[i - 2], g[i + 1] - g[i - 1])
  return d
}

// async function readCache(key: string): Promise<MapData | null> {
//   try {
//     const cache = await caches.open('osm-map-data')
//     const hit = await cache.match(key)
//     return hit ? ((await hit.json()) as MapData) : null
//   } catch {
//     return null
//   }
// }

// async function writeCache(key: string, data: MapData): Promise<void> {
//   try {
//     const cache = await caches.open('osm-map-data')
//     await cache.put(key, new Response(JSON.stringify(data)))
//   } catch {
//     // Cache is a nicety; ignore quota or unsupported-context failures.
//   }
// }
