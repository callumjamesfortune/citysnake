import { useEffect, useRef, useState } from 'react'
import { Game, type GameState } from '../game/Game'
import {
  CITY_MAPS,
  loadBundledMap,
  type CityMap,
} from '../game/osm'
import { MapLayer, render } from '../game/renderer'
import type { MapData } from '../game/types'

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [game, setGame] = useState<Game>()
  const [error, setError] = useState<string>()

  const [selectedCity, setSelectedCity] =
    useState<CityMap>(CITY_MAPS[0])

  const [loadingMap, setLoadingMap] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingMessage, setLoadingMessage] = useState('')

  const [loadedMap, setLoadedMap] =
    useState<MapData>()

  const [hud, setHud] = useState<GameState>({
    score: 0,
    length: 18,
    alive: true,
  })

  const startGame = async () => {
    try {
      setError(undefined)
      setLoadedMap(undefined)

      setLoadingMap(true)
      setLoadingProgress(0)
      setLoadingMessage(
        `Loading ${selectedCity.name}…`,
      )

      const data = await loadBundledMap(
        selectedCity,
        (message) => {
          console.log(message)
          setLoadingMessage(message)

          const lower =
            message.toLowerCase()

          if (lower.includes('loading')) {
            setLoadingProgress(20)
          } else if (
            lower.includes('reading')
          ) {
            setLoadingProgress(70)
          } else if (
            lower.includes('ready')
          ) {
            setLoadingProgress(100)
          }
        },
      )

      setLoadingProgress(100)
      setLoadingMessage('Map ready!')
      setLoadedMap(data)
    } catch (e) {
      console.error(
        'Map loading failed:',
        e,
      )

      setError(
        e instanceof Error
          ? e.message
          : 'Could not load map',
      )
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
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        2,
      )

      game.dpr = dpr
      game.width = window.innerWidth
      game.height = window.innerHeight

      canvas.width =
        game.width * dpr

      canvas.height =
        game.height * dpr

      canvas.style.width =
        `${game.width}px`

      canvas.style.height =
        `${game.height}px`
    }

    resize()

    window.addEventListener(
      'resize',
      resize,
    )

    const onKey = (
      e: KeyboardEvent,
    ) => {
      /*
       * Prevent the browser from scrolling
       * when using the arrow keys or space.
       */
      if (
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'ArrowUp' ||
        e.code === 'Space'
      ) {
        e.preventDefault()
      }

      /*
       * Ignore key-repeat for steering.
       * Each press is one steering command.
       */
      if (
        e.type === 'keydown' &&
        !e.repeat
      ) {
        switch (e.code) {
          case 'ArrowLeft':
          case 'KeyA':
            game.setTurn(-1)
            break

          case 'ArrowUp':
          case 'KeyW':
            game.setTurn(0)
            break

          case 'ArrowRight':
          case 'KeyD':
            game.setTurn(1)
            break
        }
      }

      /*
 * Space = normal boost (uses length)
 * F = free boost (does not use length)
 */
if (e.code === 'Space') {
  game.setBoost(
    e.type === 'keydown',
    false,
  )
}

if (e.code === 'KeyF') {
  game.setBoost(
    e.type === 'keydown',
    true,
  )
}
    }

    const onWheel = (
      e: WheelEvent,
    ) => {
      e.preventDefault()

      game.zoomBias =
        Math.max(
          0.4,
          Math.min(
            2.5,
            game.zoomBias *
              (e.deltaY > 0
                ? 0.9
                : 1.1),
          ),
        )
    }

    const onBlur = () => {
      game.setBoost(false)
    }

    window.addEventListener(
      'keydown',
      onKey,
    )

    window.addEventListener(
      'keyup',
      onKey,
    )

    window.addEventListener(
      'blur',
      onBlur,
    )

    canvas.addEventListener(
      'wheel',
      onWheel,
      { passive: false },
    )

    let raf = 0
    let last = performance.now()
    let hudTimer = 0

    const frame = (
      now: number,
    ) => {
      const dt = Math.min(
        (now - last) / 1000,
        0.05,
      )

      last = now

      game.update(dt)

      render(
        ctx,
        game,
        layer,
      )

      hudTimer += dt

      if (hudTimer > 0.1) {
        hudTimer = 0
        setHud(game.state)
      }

      raf =
        requestAnimationFrame(
          frame,
        )
    }

    raf =
      requestAnimationFrame(
        frame,
      )

    return () => {
      cancelAnimationFrame(raf)

      window.removeEventListener(
        'resize',
        resize,
      )

      window.removeEventListener(
        'keydown',
        onKey,
      )

      window.removeEventListener(
        'keyup',
        onKey,
      )

      window.removeEventListener(
        'blur',
        onBlur,
      )

      canvas.removeEventListener(
        'wheel',
        onWheel,
      )
    }
  }, [game])

  // Start screen
  if (!game) {
    return (
      <div className="overlay">
        <div className="start-screen">
          <h1>CitySnake</h1>

          <p>
            Choose a city to play
          </p>

          <div className="city-list">
            {CITY_MAPS.map((city) => (
              <button
                key={city.id}
                className={
                  selectedCity.id === city.id
                    ? 'city-button selected'
                    : 'city-button'
                }
                onClick={() => {
                  setSelectedCity(city)
                  setLoadedMap(undefined)
                  setError(undefined)
                }}
                disabled={loadingMap}
              >
                {city.name}
              </button>
            ))}
          </div>

          <button
            className="play-button"
            onClick={startGame}
            disabled={loadingMap}
          >
            {loadingMap
              ? 'Loading map…'
              : `Play in ${selectedCity.name}`}
          </button>

          {loadingMap && (
            <div className="loading-box">
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{
                    width: `${loadingProgress}%`,
                  }}
                />
              </div>

              <div className="loading-percent">
                {loadingProgress}%
              </div>

              <p>{loadingMessage}</p>
            </div>
          )}

          {loadedMap &&
            !loadingMap && (
              <div className="map-ready">
                <p>
                  ✓ {selectedCity.name}{' '}
                  is ready to play
                </p>

                <button
                  className="play-button"
                  onClick={() => {
                    setGame(
                      new Game(loadedMap),
                    )

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
            <span
              style={{
                opacity: 0.85,
              }}
            >
              {hud.road}
            </span>
            <br />
          </>
        )}

        <span
          style={{
            opacity: 0.65,
          }}
        >
          steer: WASD / arrows · boost:
          space · zoom: wheel
        </span>
      </div>

      {!hud.alive && (
        <div className="overlay">
          <div className="dead-screen">
            <h2>
              {hud.cause === 'dead-end'
                ? 'Dead end'
                : 'You crashed into yourself'}
            </h2>

            <p>
              Score {hud.score}
            </p>

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