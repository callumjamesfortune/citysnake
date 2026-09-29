import { useEffect, useRef, useState } from 'react'
import { Game, type GameState } from '../game/Game'
import { loadMapData, searchPlaces, type Place } from '../game/osm'
import { MapLayer, render } from '../game/renderer'
import type { MapData } from '../game/types'

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [game, setGame] = useState<Game>()
  const [error, setError] = useState<string>()

  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [selectedPlace, setSelectedPlace] = useState<Place>()
  const [searching, setSearching] = useState(false)
  const [loadingMap, setLoadingMap] = useState(false)

  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingMessage, setLoadingMessage] = useState('')

  const [loadedMap, setLoadedMap] = useState<MapData>()

  const [hud, setHud] = useState<GameState>({
    score: 0,
    length: 18,
    alive: true,
  })

  // Search for towns
  useEffect(() => {
    if (query.trim().length < 2) {
      setPlaces([])
      return
    }

    const controller = new AbortController()

    const timer = window.setTimeout(async () => {
      try {
        setSearching(true)

        const results = await searchPlaces(query, controller.signal)
        setPlaces(results)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error(e)
        }
      } finally {
        setSearching(false)
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

const startGame = async () => {
  if (!selectedPlace) return

  try {
    setError(undefined)
    setLoadedMap(undefined)
    setLoadingMap(true)
    setLoadingProgress(0)
    setLoadingMessage('Starting…')

    const data = await loadMapData(
      selectedPlace,
      1200,
      (message) => {
        console.log(message)
        setLoadingMessage(message)

        const lower = message.toLowerCase()

        if (lower.includes('checking')) {
          setLoadingProgress(5)
        } else if (lower.includes('saved')) {
          setLoadingProgress(100)
        } else if (lower.includes('downloading')) {
          setLoadingProgress(35)
        } else if (lower.includes('building')) {
          setLoadingProgress(70)
        } else if (lower.includes('saving')) {
          setLoadingProgress(90)
        } else if (lower.includes('ready')) {
          setLoadingProgress(100)
        }
      },
    )

    setLoadingProgress(100)
    setLoadingMessage('Map ready!')
    setLoadedMap(data)
  } catch (e) {
    console.error('Map loading failed:', e)
    setError((e as Error).message)
  } finally {
    setLoadingMap(false)
  }
}

  // Game loop
  useEffect(() => {
    if (!game) return

    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const layer = new MapLayer(game.data)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      game.dpr = dpr
      game.width = window.innerWidth
      game.height = window.innerHeight

      canvas.width = game.width * dpr
      canvas.height = game.height * dpr

      canvas.style.width = `${game.width}px`
      canvas.style.height = `${game.height}px`
    }

    resize()
    window.addEventListener('resize', resize)

    const aim = (clientX: number, clientY: number) =>
      game.setPointer(
        clientX - game.width / 2,
        clientY - game.height / 2,
      )

    const onPointerMove = (e: PointerEvent) =>
      aim(e.clientX, e.clientY)

    const onPointerDown = (e: PointerEvent) => {
      aim(e.clientX, e.clientY)
      game.setBoost(true)
    }

    const onPointerUp = () => game.setBoost(false)

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        game.setBoost(e.type === 'keydown')
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      game.zoomBias = Math.max(
        0.4,
        Math.min(
          2.5,
          game.zoomBias * (e.deltaY > 0 ? 0.9 : 1.1),
        ),
      )
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    let raf = 0
    let last = performance.now()
    let hudTimer = 0

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      game.update(dt)
      render(ctx, game, layer)

      hudTimer += dt

      if (hudTimer > 0.1) {
        hudTimer = 0
        setHud(game.state)
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)

      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)

      canvas.removeEventListener('wheel', onWheel)
    }
  }, [game])

  // Start screen
  if (!game) {
    return (
      <div className="overlay">
        <div className="start-screen">
          <h1>Snake Roads</h1>

          <p>Choose a town to play in</p>

          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedPlace(undefined)
              setError(undefined)
            }}
            placeholder="Search for a town..."
            autoFocus
          />

          {searching && <p>Searching…</p>}

          {places.length > 0 && (
            <div className="place-list">
              {places.map((place, index) => (
                <button
                  key={`${place.lat}-${place.lon}-${index}`}
                  className={
                    selectedPlace === place ? 'selected' : ''
                  }
                  onClick={() => {
                    setSelectedPlace(place)
                    setQuery(place.name)
                    setPlaces([])
                  }}
                >
                  {place.name}
                </button>
              ))}
            </div>
          )}

          {selectedPlace && (
            <button
              className="play-button"
              onClick={startGame}
              disabled={loadingMap}
            >
              {loadingMap
                ? 'Loading map…'
                : `Play in ${selectedPlace.name}`}
            </button>
          )}

          {loadingMap && (
  <div className="loading-box">
    <div className="progress-track">
      <div
        className="progress-bar"
        style={{ width: `${loadingProgress}%` }}
      />
    </div>

    <div className="loading-percent">
      {loadingProgress}%
    </div>

    <p>{loadingMessage}</p>
  </div>

  
)}

{loadedMap && !loadingMap && (
  <div className="map-ready">
    <p>✓ {selectedPlace?.name} is ready to play</p>

    <button
      className="play-button"
      onClick={() => {
        setGame(new Game(loadedMap))
        setLoadedMap(undefined)
      }}
    >
      Play
    </button>
  </div>
)}

          {error && (
            <p className="error">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  // Game over
  return (
    <>
      <canvas ref={canvasRef} />

      <div className="hud">
        Score <b>{hud.score}</b>
        <br />

        Length <b>{hud.length}</b>
        <br />

        {hud.road && (
          <>
            <span style={{ opacity: 0.85 }}>
              {hud.road}
            </span>
            <br />
          </>
        )}

        <span style={{ opacity: 0.65 }}>
          steer: aim with mouse · boost: hold click / space · zoom: wheel
        </span>
      </div>

      {!hud.alive && (
        <div className="overlay">
          <div>
            <h2>
              {hud.cause === 'dead-end'
                ? 'Dead end'
                : 'You crashed into yourself'}
            </h2>

            <p>Score {hud.score}</p>

            <button
              onClick={() => {
                game.reset()
                setHud(game.state)
              }}
            >
              Play again
            </button>
          </div>
        </div>
      )}
    </>
  )
}
