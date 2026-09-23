export const gameAssetNames = [
  'hero-0',
  'hero-1',
  'hero-2',
  'hero-3',
  'hero-4',
  'enemy-shadow-0',
  'enemy-shadow-1',
  'enemy-shadow-2',
  'enemy-shadow-3',
  'enemy-golem-0',
  'enemy-golem-1',
  'enemy-golem-2',
  'enemy-golem-3',
  'projectile',
  'impact',
  'xp-coin',
  'terrain-grass',
  'terrain-grass-dark',
  'terrain-flowers',
  'terrain-dirt',
  'terrain-sand',
  'terrain-stone',
  'terrain-water',
  'prop-bush',
  'prop-flowers',
  'prop-rock',
  'prop-mushrooms',
  'prop-ground-flowers',
  'building-house',
  'building-tower',
  'building-fence',
  'building-well',
  'building-shrine',
] as const;

export type GameAssetName = typeof gameAssetNames[number];

export class GameAssets {
  private readonly images = new Map<GameAssetName, HTMLImageElement>();
  private readonly onReady: () => void;
  private pending = gameAssetNames.length;
  private ready = false;

  constructor(onReady: () => void) {
    this.onReady = onReady;
    for (const name of gameAssetNames) {
      const image = new Image();
      image.decoding = 'async';
      image.addEventListener('load', () => {
        this.images.set(name, image);
        this.resolveOne();
      }, { once: true });
      image.addEventListener('error', () => this.resolveOne(), { once: true });
      image.src = `/assets/game/${name}.png`;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  get(name: GameAssetName): HTMLImageElement | undefined {
    return this.images.get(name);
  }

  private resolveOne(): void {
    this.pending -= 1;
    if (this.pending > 0) return;
    this.ready = true;
    this.onReady();
    window.dispatchEvent(new Event('lumenwake-assets-ready'));
  }
}
