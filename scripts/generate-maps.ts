import fs from 'node:fs/promises'
import path from 'node:path'

import {
generateMapData,
type Place,
} from './osm-load'

const cities: {
  id: string
  name: string
  lat: number
  lon: number
  radius: number
}[] = [
    {
      id: 'norwich',
      name: 'Norwich',
      lat: 52.6283,
      lon: 1.2996,
      radius: 7000,
    },
    {
      id: 'crewe',
      name: 'Crewe',
      lat: 53.0996,
      lon: -2.4415,
      radius: 8000,
    },
{
    id: 'preston',
    name: 'Preston',
    lat: 53.7594,
    lon: -2.7040,
    radius: 8000,
    },
  {
    id: 'chester',
    name: 'Chester',
    lat: 53.1909,
    lon: -2.8909,
    radius: 6000,
  }
]

const outputDir =
  path.resolve(
    'public/maps',
  )

await fs.mkdir(
  outputDir,
  { recursive: true },
)

for (const city of cities) {
  console.log(
    `\n=== ${city.name} ===`,
  )

  const place: Place = {
    name: city.name,
    lat: city.lat,
    lon: city.lon,
  }

  const map =
    await generateMapData(
      place,
      city.radius,
      (message) => {
        console.log(message)
      },
    )

    const file = JSON.stringify(
        map,
        null,
        2,
      )
      
      await fs.writeFile(
        path.join(
          outputDir,
          `${city.id}.json`,
        ),
        file,
        'utf8',
      )

  console.log(
    `${city.name}: ${map.vertices.length / 2} vertices, ${map.edges.length} edges`,
  )
}