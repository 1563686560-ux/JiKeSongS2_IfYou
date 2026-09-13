export type Gender = 'boy' | 'girl'

export type Location = 'girlDorm' | 'boyDorm' | 'teachingBuilding' | 'playground'

export type Point = {
  x: number
  y: number
}

export type RouteName =
  | 'girlDormToTeachingBuilding'
  | 'girlDormToPlayground'
  | 'boyDormToTeachingBuilding'
  | 'boyDormToPlayground'
  | 'teachingBuildingToGirlDorm'
  | 'teachingBuildingToBoyDorm'
  | 'teachingBuildingToPlayground'
  | 'playgroundToTeachingBuilding'
  | 'playgroundToGirlDorm'
  | 'playgroundToBoyDorm'

export type SpriteDirection = 'up' | 'down' | 'left' | 'right'

export type SpriteFrame = 1 | 2

export type Route = {
  name: RouteName
  from: Location
  to: Location
  points: Point[]
}

export type PlayerState = {
  position: Point
  direction: SpriteDirection
  frame: SpriteFrame
  moving: boolean
  completed: boolean
}

export type SpriteSheet = Record<SpriteDirection, readonly string[]>

export const MAP_SIZE = {
  width: 1344,
  height: 768,
} as const

export const MAP_ASSET = 'map_campus_base.png'

export const LOCATIONS: Record<Location, Point> = {
  girlDorm: { x: 0.19, y: 0.265 },
  boyDorm: { x: 0.19, y: 0.565 },
  teachingBuilding: { x: 0.5, y: 0.285 },
  playground: { x: 0.8, y: 0.4 },
}

export const WALKABLE_GUIDES = {
  verticalRoad: { x: 0.5, yStart: 0.1, yEnd: 0.95 },
  horizontalRoad: { y: 0.52, xStart: 0.05, xEnd: 0.95 },
} as const

export const SPRITES: Record<Gender, SpriteSheet> = {
  boy: {
    up: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向上_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向上_行走第2帧.png',
    ],
    down: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向下_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向下_行走第2帧.png',
    ],
    left: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向左_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向左_行走第2帧.png',
    ],
    right: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向右_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/boy/向右_行走第2帧.png',
    ],
  },
  girl: {
    up: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向上_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向上_行走第2帧.png',
    ],
    down: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向下_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向下_行走第2帧.png',
    ],
    left: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向左_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向左_行走第2帧.png',
    ],
    right: [
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向右_行走第1帧.png',
      'reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选/player_move/girl/向右_行走第2帧.png',
    ],
  },
}

const HUB: Point = { x: 0.5, y: 0.52 }
const PLAYGROUND_CONNECTION: Point = { x: 0.8, y: 0.52 }

const createRoadPath = (from: Location, to: Location): Point[] => {
  const start = LOCATIONS[from]
  const end = LOCATIONS[to]

  if (from === to) {
    return [start]
  }

  if (from === 'girlDorm' || from === 'boyDorm') {
    const startRoad: Point = { x: start.x, y: HUB.y }
    if (to === 'teachingBuilding') {
      return [start, startRoad, HUB, end]
    }
    if (to === 'playground') {
      return [start, startRoad, PLAYGROUND_CONNECTION, end]
    }
  }

  if (to === 'girlDorm' || to === 'boyDorm') {
    const endRoad: Point = { x: end.x, y: HUB.y }
    if (from === 'teachingBuilding') {
      return [start, HUB, endRoad, end]
    }
    if (from === 'playground') {
      return [start, PLAYGROUND_CONNECTION, HUB, endRoad, end]
    }
  }

  if (from === 'teachingBuilding' && to === 'playground') {
    return [start, HUB, PLAYGROUND_CONNECTION, end]
  }

  if (from === 'playground' && to === 'teachingBuilding') {
    return [start, PLAYGROUND_CONNECTION, HUB, end]
  }

  return [start, end]
}

const routePairs: readonly [RouteName, Location, Location][] = [
  ['girlDormToTeachingBuilding', 'girlDorm', 'teachingBuilding'],
  ['girlDormToPlayground', 'girlDorm', 'playground'],
  ['boyDormToTeachingBuilding', 'boyDorm', 'teachingBuilding'],
  ['boyDormToPlayground', 'boyDorm', 'playground'],
  ['teachingBuildingToGirlDorm', 'teachingBuilding', 'girlDorm'],
  ['teachingBuildingToBoyDorm', 'teachingBuilding', 'boyDorm'],
  ['teachingBuildingToPlayground', 'teachingBuilding', 'playground'],
  ['playgroundToTeachingBuilding', 'playground', 'teachingBuilding'],
  ['playgroundToGirlDorm', 'playground', 'girlDorm'],
  ['playgroundToBoyDorm', 'playground', 'boyDorm'],
]

export const ROUTES: Record<RouteName, Route> = Object.fromEntries(
  routePairs.map(([name, from, to]) => [
    name,
    {
      name,
      from,
      to,
      points: createRoadPath(from, to),
    },
  ]),
) as Record<RouteName, Route>

export const getRoute = (name: RouteName): Route => ROUTES[name]

export const getSpriteSheet = (gender: Gender): SpriteSheet => SPRITES[gender]

export const percentToPixel = (point: Point, width = MAP_SIZE.width, height = MAP_SIZE.height): Point => ({
  x: point.x * width,
  y: point.y * height,
})

export const pixelToPercent = (point: Point, width = MAP_SIZE.width, height = MAP_SIZE.height): Point => ({
  x: point.x / width,
  y: point.y / height,
})

export const getInitialPlayerState = (route: Route): PlayerState => ({
  position: route.points[0],
  direction: 'down',
  frame: 1,
  moving: false,
  completed: route.points.length <= 1,
})

export class MapCharacterMover {
  private route: Route
  private state: PlayerState
  private segmentIndex = 0
  private segmentProgress = 0
  private lastFrameTime = 0
  private lastAnimationFrameTime = 0
  private animationFrameId: number | null = null
  private readonly speed: number
  private readonly frameInterval: number
  private readonly onUpdate: (state: PlayerState) => void
  private readonly onComplete?: () => void

  constructor(options: {
    route: Route
    speed?: number
    frameInterval?: number
    onUpdate: (state: PlayerState) => void
    onComplete?: () => void
  }) {
    this.route = options.route
    this.speed = options.speed ?? 0.22
    this.frameInterval = options.frameInterval ?? 140
    this.onUpdate = options.onUpdate
    this.onComplete = options.onComplete
    this.state = getInitialPlayerState(this.route)
  }

  start(): void {
    this.stop()
    this.state = {
      ...getInitialPlayerState(this.route),
      moving: this.route.points.length > 1,
    }
    this.segmentIndex = 0
    this.segmentProgress = 0
    this.lastFrameTime = 0
    this.lastAnimationFrameTime = 0
    this.onUpdate(this.state)
    if (!this.state.moving) {
      this.onComplete?.()
      return
    }
    this.animationFrameId = requestAnimationFrame(this.tick)
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.state = { ...this.state, moving: false }
  }

  setRoute(route: Route): void {
    this.stop()
    this.route = route
    this.state = getInitialPlayerState(route)
    this.segmentIndex = 0
    this.segmentProgress = 0
    this.onUpdate(this.state)
  }

  getState(): PlayerState {
    return this.state
  }

  private readonly tick = (time: number): void => {
    if (!this.state.moving) {
      return
    }

    const previousTime = this.lastFrameTime || time
    const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05)
    this.lastFrameTime = time
    this.advance(deltaSeconds)

    if (time - this.lastAnimationFrameTime >= this.frameInterval) {
      this.lastAnimationFrameTime = time
      this.state = {
        ...this.state,
        frame: this.state.frame === 1 ? 2 : 1,
      }
    }

    this.onUpdate(this.state)

    if (this.state.moving) {
      this.animationFrameId = requestAnimationFrame(this.tick)
    } else {
      this.animationFrameId = null
      this.onComplete?.()
    }
  }

  private advance(deltaSeconds: number): void {
    let remaining = this.speed * deltaSeconds

    while (remaining > 0 && this.segmentIndex < this.route.points.length - 1) {
      const current = this.route.points[this.segmentIndex]
      const next = this.route.points[this.segmentIndex + 1]
      const distance = Math.hypot(next.x - current.x, next.y - current.y)
      const segmentRemaining = distance * (1 - this.segmentProgress)

      if (remaining < segmentRemaining) {
        this.segmentProgress += remaining / distance
        remaining = 0
      } else {
        remaining -= segmentRemaining
        this.segmentIndex += 1
        this.segmentProgress = 0
      }

      const from = this.route.points[this.segmentIndex]
      const to = this.route.points[Math.min(this.segmentIndex + 1, this.route.points.length - 1)]
      this.updatePosition(from, to)

      if (this.segmentIndex >= this.route.points.length - 1) {
        break
      }
    }

    if (this.segmentIndex >= this.route.points.length - 1) {
      this.state = {
        ...this.state,
        position: this.route.points[this.route.points.length - 1],
        moving: false,
        completed: true,
      }
    }
  }

  private updatePosition(from: Point, to: Point): void {
    const x = from.x + (to.x - from.x) * this.segmentProgress
    const y = from.y + (to.y - from.y) * this.segmentProgress
    const direction = getDirection(from, to)
    this.state = {
      ...this.state,
      position: { x, y },
      direction,
    }
  }
}

export const getDirection = (from: Point, to: Point): SpriteDirection => {
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }

  return dy >= 0 ? 'down' : 'up'
}

export const getSpriteUrl = (
  gender: Gender,
  direction: SpriteDirection,
  frame: SpriteFrame,
  assetBasePath = '',
): string => `${assetBasePath.replace(/\/$/, '')}/${SPRITES[gender][direction][frame - 1]}`

export const validateRoutes = (): string[] => {
  const errors: string[] = []
  const expected: RouteName[] = [
    'girlDormToTeachingBuilding',
    'girlDormToPlayground',
    'boyDormToTeachingBuilding',
    'boyDormToPlayground',
    'teachingBuildingToGirlDorm',
    'teachingBuildingToBoyDorm',
    'teachingBuildingToPlayground',
    'playgroundToTeachingBuilding',
    'playgroundToGirlDorm',
    'playgroundToBoyDorm',
  ]

  for (const name of expected) {
    const route = ROUTES[name]
    if (!route || route.points.length < 2) {
      errors.push(`${name}: route is incomplete`)
    }
    for (const point of route?.points ?? []) {
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
        errors.push(`${name}: point is outside map bounds`)
      }
    }
  }

  return errors
}
