import type { GameAssetName, GameAssets } from './assets';

const TILE_SIZE = 140;
const PATTERN_SIZE = TILE_SIZE * 4;

type TerrainAsset = Extract<GameAssetName, `terrain-${string}`>;
type ObstacleAsset = Extract<GameAssetName, `building-${string}` | `prop-${string}`>;

export interface Obstacle {
  asset: ObstacleAsset;
  x: number;
  y: number;
  radius: number;
  size: number;
  shadowX: number;
  shadowY: number;
}

export interface PointPosition {
  x: number;
  y: number;
}

interface TerrainTile {
  asset: TerrainAsset;
  x: number;
  y: number;
  flipX: boolean;
  rotation: number;
  tint: string;
}

export const obstacles: Obstacle[] = [
  { asset: 'building-house', x: 210, y: 210, radius: 52, size: 112, shadowX: 8, shadowY: 10 },
  { asset: 'building-tower', x: 1190, y: 210, radius: 48, size: 100, shadowX: 8, shadowY: 10 },
  { asset: 'building-well', x: 1190, y: 1190, radius: 46, size: 96, shadowX: 8, shadowY: 10 },
  { asset: 'building-shrine', x: 350, y: 1190, radius: 58, size: 122, shadowX: 9, shadowY: 11 },
  { asset: 'prop-rock', x: 630, y: 350, radius: 19, size: 42, shadowX: 4, shadowY: 6 },
  { asset: 'prop-mushrooms', x: 910, y: 910, radius: 18, size: 40, shadowX: 4, shadowY: 6 },
  { asset: 'prop-flowers', x: 350, y: 910, radius: 16, size: 34, shadowX: 3, shadowY: 5 },
];

export const decorations: Array<{ asset: ObstacleAsset; x: number; y: number; size: number }> = [
  { asset: 'prop-bush', x: 350, y: 350, size: 34 },
  { asset: 'prop-flowers', x: 490, y: 350, size: 36 },
  { asset: 'prop-rock', x: 770, y: 350, size: 38 },
  { asset: 'prop-mushrooms', x: 1050, y: 350, size: 38 },
  { asset: 'prop-ground-flowers', x: 350, y: 630, size: 38 },
  { asset: 'prop-bush', x: 490, y: 630, size: 34 },
  { asset: 'prop-flowers', x: 630, y: 630, size: 36 },
  { asset: 'prop-ground-flowers', x: 770, y: 630, size: 38 },
  { asset: 'prop-rock', x: 1050, y: 630, size: 38 },
  { asset: 'prop-bush', x: 490, y: 770, size: 34 },
  { asset: 'prop-flowers', x: 630, y: 770, size: 36 },
  { asset: 'prop-mushrooms', x: 770, y: 770, size: 38 },
];

const terrainTiles: TerrainTile[] = [];

function terrainFor(column: number, row: number): TerrainAsset {
  const index = row * 4 + column;
  const terrainAssets: TerrainAsset[] = [
    'terrain-grass',
    'terrain-flowers',
    'terrain-grass',
    'terrain-dirt',
  ];
  return terrainAssets[index] ?? 'terrain-grass';
}

for (let row = 0; row < 4; row += 1) {
  for (let column = 0; column < 4; column += 1) {
    terrainTiles.push({
      asset: terrainFor(column, row),
      x: column * TILE_SIZE,
      y: row * TILE_SIZE,
      flipX: (column * 7 + row * 11) % 5 === 0,
      rotation: (column + row * 3) % 9 === 0 ? Math.PI : 0,
      tint: (column * 13 + row * 5) % 4 === 0 ? 'rgba(255,244,182,0.08)' : 'rgba(50,70,25,0.025)',
    });
  }
}

export function resolveObstacleCollision(position: PointPosition, radius: number): boolean {
  let hit = false;
  for (const obstacle of obstacles) {
    const dx = position.x - obstacle.x;
    const dy = position.y - obstacle.y;
    const minimum = radius + obstacle.radius;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= minimum * minimum) continue;
    const distance = Math.max(0.001, Math.sqrt(distanceSquared));
    position.x = obstacle.x + dx / distance * minimum;
    position.y = obstacle.y + dy / distance * minimum;
    hit = true;
  }
  return hit;
}

export class WorldRenderer {
  private terrainPattern: CanvasPattern | null = null;
  private readonly assets: GameAssets;

  constructor(assets: GameAssets) {
    this.assets = assets;
  }

  rebuild(context: CanvasRenderingContext2D): void {
    const terrain = document.createElement('canvas');
    terrain.width = PATTERN_SIZE;
    terrain.height = PATTERN_SIZE;
    const terrainContext = terrain.getContext('2d');
    if (!terrainContext) return;
    terrainContext.imageSmoothingEnabled = false;
    terrainContext.fillStyle = '#d7b96c';
    terrainContext.fillRect(0, 0, PATTERN_SIZE, PATTERN_SIZE);
    for (const tile of terrainTiles) {
      const image = this.assets.get(tile.asset);
      if (!image) continue;
      terrainContext.save();
      terrainContext.translate(tile.x + TILE_SIZE / 2, tile.y + TILE_SIZE / 2);
      terrainContext.rotate(tile.rotation);
      terrainContext.scale(tile.flipX ? -1 : 1, 1);
      terrainContext.drawImage(image, -TILE_SIZE / 2 - 3, -TILE_SIZE / 2 - 3, TILE_SIZE + 6, TILE_SIZE + 6);
      terrainContext.fillStyle = tile.tint;
      terrainContext.fillRect(-TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
      terrainContext.restore();
    }
    this.terrainPattern = context.createPattern(terrain, 'repeat');
  }

  drawTerrain(context: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number): void {
    if (!this.terrainPattern) {
      context.fillStyle = '#d7b96c';
      context.fillRect(left, top, right - left, bottom - top);
      return;
    }
    context.fillStyle = this.terrainPattern;
    context.fillRect(left, top, right - left, bottom - top);
  }

  drawDecorations(context: CanvasRenderingContext2D): void {
    for (const decoration of decorations) {
      const image = this.assets.get(decoration.asset);
      if (!image) continue;
      context.drawImage(image, decoration.x - decoration.size / 2, decoration.y - decoration.size / 2, decoration.size, decoration.size);
    }
  }

  drawObstacles(context: CanvasRenderingContext2D): void {
    for (const obstacle of [...obstacles].sort((first, second) => first.y - second.y)) {
      const image = this.assets.get(obstacle.asset);
      if (!image) continue;
      context.save();
      context.fillStyle = 'rgba(49,41,26,0.2)';
      context.beginPath();
      context.ellipse(obstacle.x + obstacle.shadowX, obstacle.y + obstacle.shadowY, obstacle.size * 0.37, obstacle.size * 0.14, 0, 0, Math.PI * 2);
      context.fill();
      context.drawImage(image, obstacle.x - obstacle.size / 2, obstacle.y - obstacle.size / 2, obstacle.size, obstacle.size);
      context.restore();
    }
  }
}
