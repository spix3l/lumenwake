import { GameAssets } from './assets';
import { applyUpgrade, baseStats, experienceNeeded, getUpgrade, upgrades, type Stats, type Upgrade, type UpgradeId } from './upgrades';
import { resolveObstacleCollision, WorldRenderer } from './world';

export type GameMode = 'ready' | 'running' | 'paused' | 'upgrade' | 'gameover' | 'victory';

export interface HudState {
  health: number;
  maxHealth: number;
  level: number;
  xp: number;
  xpNeeded: number;
  elapsed: number;
  remaining: number;
  kills: number;
}

export interface GameCallbacks {
  onMode: (mode: GameMode) => void;
  onHud: (hud: HudState) => void;
  onDanger: (danger: boolean) => void;
  onUpgrade: (choices: Upgrade[], nextLevel: number) => void;
  onEnd: (victory: boolean, hud: HudState) => void;
  onToast: (message: string) => void;
}

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  health: number;
  invulnerable: number;
  hurtX: number;
  hurtY: number;
  facing: number;
}

type EnemyKind = 'gnaw' | 'shell';
type EnemyState = 'pursue' | 'windup' | 'charge' | 'recover';

interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  radius: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  xp: number;
  age: number;
  phase: number;
  hitFlash: number;
  knockX: number;
  knockY: number;
  state: EnemyState;
  stateTimer: number;
  chargeX: number;
  chargeY: number;
  alive: boolean;
}

interface XpDrop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  age: number;
  phase: number;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  value: number;
  color: string;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

interface ImpactEffect {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
}

interface AmbientMark {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
}

export interface GameSnapshot {
  mode: GameMode;
  elapsed: number;
  level: number;
  health: number;
  playerX: number;
  playerY: number;
  xp: number;
  kills: number;
  enemies: number;
  projectiles: number;
  upgradeRanks: Record<string, number>;
  assetsReady: boolean;
  qa: boolean;
}

const RUN_DURATION = 300;
const START_CENTER = 700;
const TAU = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export class LumenwakeGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly callbacks: GameCallbacks;
  private readonly assets: GameAssets;
  private readonly worldRenderer: WorldRenderer;
  private readonly qaMode: boolean;
  private readonly runDuration: number;
  private readonly timeScale: number;
  private readonly xpScale: number;
  private readonly keys = new Set<string>();
  private mode: GameMode = 'ready';
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private zoom = 1;
  private cameraX = START_CENTER;
  private cameraY = START_CENTER;
  private animationFrame = 0;
  private lastTime = 0;
  private visualTime = 0;
  private elapsed = 0;
  private inputX = 0;
  private inputY = 0;
  private player: Player = { x: 0, y: 0, vx: 0, vy: 0, radius: 17, health: 100, invulnerable: 0, hurtX: 0, hurtY: 0, facing: 0 };
  private stats: Stats = { ...baseStats };
  private upgradeRanks = new Map<UpgradeId, number>();
  private level = 1;
  private xp = 0;
  private xpNeeded = experienceNeeded(1);
  private pendingLevels = 0;
  private kills = 0;
  private nextEntityId = 1;
  private enemies: Enemy[] = [];
  private xpDrops: XpDrop[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private shockwaves: Shockwave[] = [];
  private impactEffects: ImpactEffect[] = [];
  private ambientMarks: AmbientMark[] = [];
  private spawnTimer = 0.4;
  private projectileCooldown = 0;
  private pulseCooldown = 0;
  private nextSurge = 60;
  private shake = 0;
  private hurtFlash = 0;
  private hudTimer = 0;
  private dangerActive = false;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is not supported by this browser.');
    this.canvas = canvas;
    this.context = context;
    this.callbacks = callbacks;
    this.assets = new GameAssets(() => this.worldRenderer.rebuild(this.context));
    this.worldRenderer = new WorldRenderer(this.assets);
    this.qaMode = new URLSearchParams(window.location.search).get('qa') === '1';
    this.runDuration = this.qaMode ? 30 : RUN_DURATION;
    this.timeScale = this.qaMode ? 4 : 1;
    this.xpScale = this.qaMode ? 8 : 1;
    this.seedAmbient();
    this.resize();
    this.lastTime = performance.now();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, bounds.width);
    const nextHeight = Math.max(1, bounds.height);
    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.zoom = clamp(Math.min(nextWidth, nextHeight) / 720, 0.52, 1);
    this.canvas.width = Math.round(nextWidth * this.pixelRatio);
    this.canvas.height = Math.round(nextHeight * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.context.imageSmoothingEnabled = false;
    this.updateCamera();
  }

  private updateCamera(): void {
    this.cameraX = this.player.x;
    this.cameraY = this.player.y;
  }

  start(): void {
    this.reset();
    this.mode = 'running';
    this.callbacks.onMode(this.mode);
    this.emitHud();
    this.callbacks.onToast('Survive until dawn');
  }

  restart(): void {
    this.start();
  }

  pause(): void {
    if (this.mode !== 'running') return;
    this.mode = 'paused';
    this.setInput(0, 0);
    this.callbacks.onMode(this.mode);
    this.emitHud();
  }

  resume(): void {
    if (this.mode !== 'paused') return;
    this.lastTime = performance.now();
    this.mode = 'running';
    this.callbacks.onMode(this.mode);
  }

  togglePause(): void {
    if (this.mode === 'running') this.pause();
    if (this.mode === 'paused') this.resume();
  }

  setKey(code: string, pressed: boolean): void {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
    this.updateKeyboardInput();
  }

  setInput(x: number, y: number): void {
    this.inputX = x;
    this.inputY = y;
  }

  chooseUpgrade(id: UpgradeId): void {
    if (this.mode !== 'upgrade') return;
    if ((this.upgradeRanks.get(id) ?? 0) >= getUpgrade(id).maxRank) return;
    applyUpgrade(this.stats, id);
    this.upgradeRanks.set(id, (this.upgradeRanks.get(id) ?? 0) + 1);
    if (id === 'vigor') this.player.health = Math.min(this.stats.maxHealth, this.player.health + 30);
    this.pendingLevels = Math.max(0, this.pendingLevels - 1);
    if (this.pendingLevels > 0) {
      this.openUpgrade();
      return;
    }
    this.mode = 'running';
    this.lastTime = performance.now();
    this.callbacks.onMode(this.mode);
    this.emitHud();
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.keys.clear();
  }

  snapshot(): GameSnapshot {
    return {
      mode: this.mode,
      elapsed: this.elapsed,
      level: this.level,
      health: this.player.health,
      playerX: this.player.x,
      playerY: this.player.y,
      xp: this.xp,
      kills: this.kills,
      enemies: this.enemies.length,
      projectiles: this.projectiles.length,
      upgradeRanks: Object.fromEntries(this.upgradeRanks),
      assetsReady: this.assets.isReady(),
      qa: this.qaMode,
    };
  }

  debugVictory(): void {
    if (!this.qaMode || this.mode === 'ready') return;
    this.elapsed = this.runDuration;
    this.finish(true);
  }

  debugDefeat(): void {
    if (!this.qaMode || this.mode === 'ready') return;
    this.player.health = 0;
    this.finish(false);
  }

  private reset(): void {
    this.elapsed = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = experienceNeeded(1);
    this.pendingLevels = 0;
    this.kills = 0;
    this.stats = { ...baseStats };
    this.upgradeRanks.clear();
    this.player = {
      x: START_CENTER,
      y: START_CENTER,
      vx: 0,
      vy: 0,
      radius: 17,
      health: this.stats.maxHealth,
      invulnerable: 0,
      hurtX: 0,
      hurtY: 0,
      facing: 0,
    };
    this.enemies = [];
    this.xpDrops = [];
    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.shockwaves = [];
    this.impactEffects = [];
    this.spawnTimer = 0.4;
    this.projectileCooldown = 0;
    this.pulseCooldown = 0;
    this.nextSurge = this.qaMode ? 10 : 60;
    this.shake = 0;
    this.hurtFlash = 0;
    this.dangerActive = false;
    this.setInput(0, 0);
    this.callbacks.onDanger(false);
  }

  private readonly frame = (timestamp: number): void => {
    const rawDelta = Math.min(0.034, Math.max(0, (timestamp - this.lastTime) / 1000));
    this.lastTime = timestamp;
    this.visualTime += rawDelta;
    if (this.mode === 'running') this.update(rawDelta * this.timeScale);
    else this.updateEffects(rawDelta * 0.28);
    this.draw();
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    this.elapsed += delta;
    if (this.elapsed >= this.runDuration) {
      this.elapsed = this.runDuration;
      this.finish(true);
      return;
    }

    this.updatePlayer(delta);
    this.updateSpawning(delta);
    this.updateEnemies(delta);
    this.updateAttacks(delta);
    this.updateProjectiles(delta);
    this.updateXp(delta);
    this.updateEffects(delta);
    this.separateEnemies();
    this.enemies = this.enemies.filter((enemy) => enemy.alive);
    this.updateDanger();
    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.emitHud();
    }
  }

  private updatePlayer(delta: number): void {
    const player = this.player;
    player.invulnerable = Math.max(0, player.invulnerable - delta);
    const response = 1 - Math.exp(-delta * 13);
    const targetX = this.inputX * this.stats.moveSpeed;
    const targetY = this.inputY * this.stats.moveSpeed;
    player.vx += (targetX - player.vx) * response;
    player.vy += (targetY - player.vy) * response;
    player.x += (player.vx + player.hurtX) * delta;
    player.y += (player.vy + player.hurtY) * delta;
    player.hurtX *= Math.exp(-delta * 8);
    player.hurtY *= Math.exp(-delta * 8);
    if (Math.hypot(player.vx, player.vy) > 8) player.facing = Math.atan2(player.vy, player.vx);
    resolveObstacleCollision(player, player.radius);
    this.updateCamera();
  }

  private updateKeyboardInput(): void {
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const up = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const down = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    const x = Number(right) - Number(left);
    const y = Number(down) - Number(up);
    if (x !== 0 || y !== 0) this.setInput(x, y);
  }

  private updateSpawning(delta: number): void {
    if (this.elapsed >= this.nextSurge) {
      this.nextSurge += 60;
      const burst = this.qaMode ? 3 : Math.min(14, 7 + Math.floor(this.elapsed / 90));
      for (let index = 0; index < burst; index += 1) this.spawnEnemy();
      this.callbacks.onToast(`Garden surge · minute ${Math.floor(this.nextSurge / 60)}`);
    }

    this.spawnTimer -= delta;
    const spawnInterval = this.qaMode ? 0.42 : Math.max(0.22, 0.72 - this.elapsed * 0.00125);
    const enemyCap = this.qaMode ? 30 : Math.min(145, 45 + Math.floor(this.elapsed * 0.34));
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnInterval;
      if (this.enemies.length < enemyCap) this.spawnEnemy();
    }
  }

  private spawnEnemy(): void {
    const side = Math.floor(Math.random() * 4);
    const margin = 42;
    const visibleWidth = this.width / this.zoom;
    const visibleHeight = this.height / this.zoom;
    const left = this.cameraX - visibleWidth / 2 - margin;
    const right = this.cameraX + visibleWidth / 2 + margin;
    const top = this.cameraY - visibleHeight / 2 - margin;
    const bottom = this.cameraY + visibleHeight / 2 + margin;
    let x: number;
    let y: number;
    if (side === 0) {
      x = left;
      y = top + Math.random() * (bottom - top);
    } else if (side === 1) {
      x = right;
      y = top + Math.random() * (bottom - top);
    } else if (side === 2) {
      x = left + Math.random() * (right - left);
      y = top;
    } else {
      x = left + Math.random() * (right - left);
      y = bottom;
    }

    const shellChance = this.qaMode ? 0.28 : clamp(0.16 + this.elapsed * 0.00085, 0.16, 0.43);
    const kind: EnemyKind = Math.random() < shellChance ? 'shell' : 'gnaw';
    const intensity = this.elapsed / 100;
    const healthScale = 1 + intensity * (kind === 'shell' ? 0.82 : 0.46);
    const maxHealth = (kind === 'shell' ? 82 : 20) * healthScale;
    const speed = kind === 'shell' ? Math.min(64, 40 + intensity * 2.8) : Math.min(154, 88 + intensity * 5.4);
    this.enemies.push({
      id: this.nextEntityId++,
      kind,
      x,
      y,
      radius: kind === 'shell' ? 25 : 11,
      health: maxHealth,
      maxHealth,
      speed,
      damage: kind === 'shell' ? 16 : 8,
      xp: kind === 'shell' ? 6 : 2,
      age: Math.random() * 8,
      phase: Math.random() * TAU,
      hitFlash: 0,
      knockX: 0,
      knockY: 0,
      state: 'pursue',
      stateTimer: 1.5 + Math.random() * 2,
      chargeX: 0,
      chargeY: 0,
      alive: true,
    });
  }

  private updateEnemies(delta: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.age += delta;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta * 5);
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const directionX = dx / distance;
      const directionY = dy / distance;
      let moveX = directionX;
      let moveY = directionY;

      if (enemy.kind === 'gnaw') {
        const weave = Math.sin(enemy.age * 8 + enemy.phase) * 0.24;
        moveX = directionX - directionY * weave;
        moveY = directionY + directionX * weave;
      } else {
        enemy.stateTimer -= delta;
        if (enemy.state === 'windup') {
          moveX = 0;
          moveY = 0;
          if (enemy.stateTimer <= 0) {
            enemy.state = 'charge';
            enemy.stateTimer = 0.7;
            this.spawnParticles(enemy.x, enemy.y, 5, '#ffad5b', 70);
          }
        } else if (enemy.state === 'charge') {
          moveX = enemy.chargeX;
          moveY = enemy.chargeY;
          if (enemy.stateTimer <= 0) {
            enemy.state = 'recover';
            enemy.stateTimer = 0.8;
          }
        } else if (enemy.state === 'recover') {
          moveX = 0;
          moveY = 0;
          if (enemy.stateTimer <= 0) {
            enemy.state = 'pursue';
            enemy.stateTimer = 1.4 + Math.random() * 1.4;
          }
        } else if (distance < 245 && enemy.stateTimer <= 0) {
          enemy.state = 'windup';
          enemy.stateTimer = 0.72;
          enemy.chargeX = directionX;
          enemy.chargeY = directionY;
        }
      }

      const movementScale = enemy.state === 'charge' ? 3.8 : 1;
      enemy.x += (moveX * enemy.speed * movementScale + enemy.knockX) * delta;
      enemy.y += (moveY * enemy.speed * movementScale + enemy.knockY) * delta;
      enemy.knockX *= Math.exp(-delta * 8);
      enemy.knockY *= Math.exp(-delta * 8);
      const obstacleHit = resolveObstacleCollision(enemy, enemy.radius);
      if (obstacleHit && enemy.state === 'charge') {
        enemy.state = 'recover';
        enemy.stateTimer = 0.72;
        enemy.knockX *= 0.2;
        enemy.knockY *= 0.2;
      }

      const contactRadius = enemy.radius + this.player.radius;
      if (distanceSquared(enemy.x, enemy.y, this.player.x, this.player.y) < contactRadius * contactRadius) {
        const chargeBonus = enemy.state === 'charge' ? 1.35 : 1;
        this.damagePlayer(enemy.damage * chargeBonus, directionX, directionY);
      }
    }
  }

  private updateAttacks(delta: number): void {
    this.projectileCooldown = Math.max(0, this.projectileCooldown - delta);
    this.pulseCooldown = Math.max(0, this.pulseCooldown - delta);
    const target = this.nearestEnemy();
    if (!target) return;

    if (this.projectileCooldown <= 0) {
      this.fireDarts(target);
      this.projectileCooldown = this.stats.projectileRate;
    }

    if (this.pulseCooldown <= 0 && distanceSquared(this.player.x, this.player.y, target.x, target.y) <= this.stats.pulseRange ** 2) {
      this.firePulse();
      this.pulseCooldown = this.stats.pulseRate;
    }
  }

  private nearestEnemy(): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const distance = distanceSquared(this.player.x, this.player.y, enemy.x, enemy.y);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private fireDarts(target: Enemy): void {
    const baseAngle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    const count = this.stats.projectileCount;
    const spreadStep = 0.12;
    for (let index = 0; index < count; index += 1) {
      const offset = index - (count - 1) / 2;
      const angle = baseAngle + offset * spreadStep;
      const speed = this.stats.projectileSpeed;
      this.projectiles.push({
        x: this.player.x + Math.cos(angle) * 21,
        y: this.player.y + Math.sin(angle) * 21,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 5 + (this.upgradeRanks.get('edge') ?? 0) * 0.35,
        damage: this.stats.projectileDamage * (1 + (count - 1) * 0.08),
        life: this.stats.projectileRange / speed,
      });
    }
    this.spawnParticles(this.player.x, this.player.y, 2, '#d9ff5b', 50, baseAngle);
  }

  private firePulse(): void {
    const radius = this.stats.pulseRange;
    this.shockwaves.push({ x: this.player.x, y: this.player.y, radius: 20, life: 0.42, maxLife: 0.42, color: '#65f4db', width: 5 });
    this.shake = Math.max(this.shake, 2.5);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius + enemy.radius) continue;
      const angle = Math.atan2(dy, dx);
      this.damageEnemy(enemy, this.stats.pulseDamage, Math.cos(angle), Math.sin(angle), this.stats.knockback * 0.82);
    }
  }

  private updateProjectiles(delta: number): void {
    for (const projectile of this.projectiles) {
      projectile.life -= delta;
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const hitRadius = enemy.radius + projectile.radius;
        if (distanceSquared(projectile.x, projectile.y, enemy.x, enemy.y) <= hitRadius * hitRadius) {
          const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
          this.damageEnemy(enemy, projectile.damage, projectile.vx / speed, projectile.vy / speed, this.stats.knockback);
          projectile.life = 0;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.life > 0);
  }

  private damageEnemy(enemy: Enemy, damage: number, directionX: number, directionY: number, knockback: number): void {
    if (!enemy.alive) return;
    enemy.health -= damage;
    enemy.hitFlash = 0.14;
    enemy.knockX += directionX * knockback;
    enemy.knockY += directionY * knockback;
    const impactLife = enemy.kind === 'shell' ? 0.34 : 0.24;
    this.impactEffects.push({
      x: enemy.x + directionX * enemy.radius * 0.45,
      y: enemy.y + directionY * enemy.radius * 0.45,
      life: impactLife,
      maxLife: impactLife,
      size: enemy.kind === 'shell' ? 76 : 52,
      rotation: Math.atan2(directionY, directionX),
    });
    if (this.impactEffects.length > 60) this.impactEffects.shift();
    this.spawnParticles(enemy.x, enemy.y, 4, enemy.kind === 'shell' ? '#ffad5b' : '#ff5e73', 95, Math.atan2(directionY, directionX));
    this.floatingTexts.push({
      x: enemy.x + (Math.random() - 0.5) * 8,
      y: enemy.y - enemy.radius - 5,
      vy: -24,
      life: 0.48,
      value: Math.round(damage),
      color: '#f1f4d8',
    });
    if (this.floatingTexts.length > 42) this.floatingTexts.shift();
    if (enemy.health > 0) return;

    enemy.alive = false;
    this.kills += 1;
    const dropCount = enemy.kind === 'shell' ? 2 : 1;
    for (let index = 0; index < dropCount; index += 1) {
      const angle = Math.random() * TAU;
      const speed = 28 + Math.random() * 48;
      this.xpDrops.push({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        value: enemy.xp / dropCount,
        age: 0,
        phase: Math.random() * TAU,
      });
    }
    this.spawnParticles(enemy.x, enemy.y, enemy.kind === 'shell' ? 16 : 10, enemy.kind === 'shell' ? '#ffad5b' : '#ff5e73', enemy.kind === 'shell' ? 150 : 110);
  }

  private damagePlayer(amount: number, directionX: number, directionY: number): void {
    if (this.player.invulnerable > 0 || this.mode !== 'running') return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.invulnerable = 0.68;
    this.player.hurtX += directionX * 190;
    this.player.hurtY += directionY * 190;
    this.hurtFlash = 0.24;
    this.shake = 10;
    this.spawnParticles(this.player.x, this.player.y, 12, '#ff5e73', 125);
    this.floatingTexts.push({ x: this.player.x, y: this.player.y - 28, vy: -28, life: 0.62, value: Math.round(amount), color: '#ff5e73' });
    if (this.player.health <= 0) this.finish(false);
  }

  private updateXp(delta: number): void {
    for (const drop of this.xpDrops) {
      drop.age += delta;
      const dx = this.player.x - drop.x;
      const dy = this.player.y - drop.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const magnetized = distance < this.stats.pickupRadius;
      const pull = magnetized ? 460 : 0;
      drop.vx += (dx / distance) * pull * delta;
      drop.vy += (dy / distance) * pull * delta;
      drop.vx *= Math.exp(-delta * (magnetized ? 1.8 : 5.2));
      drop.vy *= Math.exp(-delta * (magnetized ? 1.8 : 5.2));
      drop.x += drop.vx * delta;
      drop.y += drop.vy * delta;
      if (distance < this.player.radius + 8) {
        drop.value = 0;
        this.xp += 1 * this.xpScale;
        this.spawnParticles(drop.x, drop.y, 2, '#ffe28a', 36);
        while (this.xp >= this.xpNeeded) {
          this.xp -= this.xpNeeded;
          this.level += 1;
          this.xpNeeded = experienceNeeded(this.level);
          this.pendingLevels += 1;
        }
      }
    }
    this.xpDrops = this.xpDrops.filter((drop) => drop.value > 0).slice(-240);
    if (this.pendingLevels > 0 && this.mode === 'running') this.openUpgrade();
  }

  private openUpgrade(): void {
    this.mode = 'upgrade';
    const available = upgrades.filter((upgrade) => (this.upgradeRanks.get(upgrade.id) ?? 0) < upgrade.maxRank);
    for (let index = available.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const current = available[index];
      const swap = available[swapIndex];
      if (current && swap) {
        available[index] = swap;
        available[swapIndex] = current;
      }
    }
    this.callbacks.onUpgrade(available.slice(0, 3), this.level);
    this.callbacks.onMode(this.mode);
    this.callbacks.onToast('Choose one mutation');
  }

  private updateEffects(delta: number): void {
    for (const particle of this.particles) {
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.exp(-delta * 2.8);
      particle.vy = particle.vy * Math.exp(-delta * 2.8) + particle.gravity * delta;
    }
    for (const text of this.floatingTexts) {
      text.life -= delta;
      text.y += text.vy * delta;
      text.vy *= Math.exp(-delta * 3.2);
    }
    for (const wave of this.shockwaves) wave.life -= delta;
    for (const impact of this.impactEffects) impact.life -= delta;
    this.particles = this.particles.filter((particle) => particle.life > 0).slice(-300);
    this.floatingTexts = this.floatingTexts.filter((text) => text.life > 0);
    this.shockwaves = this.shockwaves.filter((wave) => wave.life > 0);
    this.impactEffects = this.impactEffects.filter((impact) => impact.life > 0);
    this.shake = Math.max(0, this.shake - delta * 24);
    this.hurtFlash = Math.max(0, this.hurtFlash - delta * 4.2);
  }

  private spawnParticles(x: number, y: number, count: number, color: string, speed: number, direction?: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = direction === undefined ? Math.random() * TAU : direction + (Math.random() - 0.5) * 1.4;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      const life = 0.25 + Math.random() * 0.4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        size: 1.5 + Math.random() * 3.5,
        color,
        gravity: Math.random() * 20,
      });
    }
  }

  private separateEnemies(): void {
    for (let firstIndex = 0; firstIndex < this.enemies.length; firstIndex += 1) {
      const first = this.enemies[firstIndex];
      if (!first?.alive) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < this.enemies.length; secondIndex += 1) {
        const second = this.enemies[secondIndex];
        if (!second?.alive) continue;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const minimum = (first.radius + second.radius) * 0.72;
        const squared = dx * dx + dy * dy;
        if (squared <= 0.001 || squared >= minimum * minimum) continue;
        const distance = Math.sqrt(squared);
        const push = (minimum - distance) * 0.08;
        const x = dx / distance * push;
        const y = dy / distance * push;
        first.x -= x;
        first.y -= y;
        second.x += x;
        second.y += y;
      }
    }
    for (const enemy of this.enemies) {
      resolveObstacleCollision(enemy, enemy.radius);
    }
  }

  private updateDanger(): void {
    const lowHealth = this.player.health / this.stats.maxHealth < 0.28;
    const chargingNear = this.enemies.some((enemy) => enemy.alive && enemy.state === 'windup' && distanceSquared(enemy.x, enemy.y, this.player.x, this.player.y) < 290 ** 2);
    const danger = lowHealth || chargingNear;
    if (danger !== this.dangerActive) {
      this.dangerActive = danger;
      this.callbacks.onDanger(danger);
    }
  }

  private finish(victory: boolean): void {
    if (this.mode === 'gameover' || this.mode === 'victory') return;
    this.mode = victory ? 'victory' : 'gameover';
    this.setInput(0, 0);
    this.callbacks.onMode(this.mode);
    this.callbacks.onEnd(victory, this.getHudState());
    this.callbacks.onDanger(false);
  }

  private emitHud(): void {
    this.callbacks.onHud(this.getHudState());
  }

  private getHudState(): HudState {
    return {
      health: Math.ceil(this.player.health),
      maxHealth: Math.round(this.stats.maxHealth),
      level: this.level,
      xp: this.xp,
      xpNeeded: this.xpNeeded,
      elapsed: this.elapsed,
      remaining: Math.max(0, this.runDuration - this.elapsed),
      kills: this.kills,
    };
  }

  private seedAmbient(): void {
    this.ambientMarks = Array.from({ length: 38 }, (_, index) => ({
      x: ((index * 47) % 101) / 101,
      y: ((index * 71 + 19) % 97) / 97,
      size: 0.7 + (index % 4) * 0.45,
      speed: 0.35 + (index % 5) * 0.08,
      phase: index * 1.713,
    }));
  }

  private draw(): void {
    const context = this.context;
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.imageSmoothingEnabled = false;
    this.drawBackground(context);
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    context.translate(this.width / 2 + shakeX, this.height / 2 + shakeY);
    context.scale(this.zoom, this.zoom);
    context.translate(-this.cameraX, -this.cameraY);
    const visibleWidth = this.width / this.zoom;
    const visibleHeight = this.height / this.zoom;
    this.worldRenderer.drawTerrain(context, this.cameraX - visibleWidth / 2 - 12, this.cameraY - visibleHeight / 2 - 12, this.cameraX + visibleWidth / 2 + 12, this.cameraY + visibleHeight / 2 + 12);
    this.worldRenderer.drawDecorations(context);
    this.worldRenderer.drawObstacles(context);
    this.drawShockwaves(context);
    this.drawXpDrops(context);
    this.drawEnemies(context);
    this.drawProjectiles(context);
    this.drawPlayer(context);
    this.drawImpactEffects(context);
    this.drawParticles(context);
    this.drawFloatingTexts(context);
    context.restore();
    if (this.hurtFlash > 0) {
      context.fillStyle = `rgba(255, 69, 91, ${this.hurtFlash * 0.24})`;
      context.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawBackground(context: CanvasRenderingContext2D): void {
    context.fillStyle = '#b7cf69';
    context.fillRect(0, 0, this.width, this.height);
    const glow = context.createRadialGradient(this.width * 0.5, this.height * 0.48, 20, this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.7);
    glow.addColorStop(0, 'rgba(255,244,176,0.42)');
    glow.addColorStop(0.55, 'rgba(209,224,113,0.15)');
    glow.addColorStop(1, 'rgba(70,83,38,0.22)');
    context.fillStyle = glow;
    context.fillRect(0, 0, this.width, this.height);
    for (const mark of this.ambientMarks) {
      const x = mark.x * this.width + Math.sin(this.visualTime * mark.speed + mark.phase) * 8;
      const y = mark.y * this.height + Math.cos(this.visualTime * mark.speed * 0.8 + mark.phase) * 7;
      context.fillStyle = 'rgba(255,255,224,0.3)';
      context.beginPath();
      context.arc(x, y, mark.size, 0, TAU);
      context.fill();
    }
  }

  private drawShockwaves(context: CanvasRenderingContext2D): void {
    for (const wave of this.shockwaves) {
      const progress = 1 - wave.life / wave.maxLife;
      context.save();
      context.globalAlpha = (1 - progress) * 0.9;
      context.strokeStyle = wave.color;
      context.lineWidth = wave.width * (1 - progress * 0.6);
      context.beginPath();
      context.arc(wave.x, wave.y, wave.radius + progress * 64, 0, TAU);
      context.stroke();
      context.strokeStyle = 'rgba(255,255,235,0.9)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(wave.x, wave.y, wave.radius + progress * 64, 0, TAU);
      context.stroke();
      context.restore();
    }
  }

  private drawXpDrops(context: CanvasRenderingContext2D): void {
    const image = this.assets.get('xp-coin');
    for (const drop of this.xpDrops) {
      const pulse = 0.9 + Math.sin(this.visualTime * 5 + drop.phase) * 0.1;
      const size = (22 + Math.min(5, drop.value) * 0.8) * pulse;
      const bob = Math.sin(this.visualTime * 4 + drop.phase) * 3;
      context.save();
      context.translate(drop.x, drop.y + bob);
      context.fillStyle = 'rgba(255,224,72,0.28)';
      context.beginPath();
      context.ellipse(0, 5, size * 0.5, size * 0.22, 0, 0, TAU);
      context.fill();
      if (image) {
        context.drawImage(image, -size / 2, -size / 2, size, size);
      } else {
        context.fillStyle = '#ffd33d';
        context.beginPath();
        context.ellipse(0, 0, size * 0.36, size * 0.48, 0, 0, TAU);
        context.fill();
      }
      context.restore();
    }
  }

  private drawEnemies(context: CanvasRenderingContext2D): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (enemy.kind === 'shell' && enemy.state === 'windup') this.drawShellTelegraph(context, enemy);
      const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      if (enemy.kind === 'gnaw') this.drawGnaw(context, enemy, angle);
      else this.drawShell(context, enemy, angle);
      if (enemy.health < enemy.maxHealth) this.drawEnemyHealth(context, enemy);
    }
  }

  private drawGnaw(context: CanvasRenderingContext2D, enemy: Enemy, angle: number): void {
    const image = this.assets.get('enemy-shadow-0');
    context.save();
    context.translate(enemy.x, enemy.y);
    context.fillStyle = 'rgba(39,31,45,0.25)';
    context.beginPath();
    context.ellipse(0, 15, 24, 8, 0, 0, TAU);
    context.fill();
    context.rotate(angle);
    if (image) {
      context.drawImage(image, -25, -18, 50, 36);
    } else {
      context.fillStyle = '#6f4a84';
      context.beginPath();
      context.moveTo(22, 0);
      context.lineTo(-15, -16);
      context.lineTo(-6, 0);
      context.lineTo(-15, 16);
      context.closePath();
      context.fill();
    }
    if (enemy.hitFlash > 0) {
      context.fillStyle = `rgba(255,255,255,${enemy.hitFlash * 3})`;
      context.beginPath();
      context.arc(0, 0, 22, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  private drawShell(context: CanvasRenderingContext2D, enemy: Enemy, angle: number): void {
    const image = this.assets.get('enemy-golem-0');
    context.save();
    context.translate(enemy.x, enemy.y);
    context.fillStyle = 'rgba(39,31,45,0.25)';
    context.beginPath();
    context.ellipse(0, 23, 34, 11, 0, 0, TAU);
    context.fill();
    context.rotate(angle);
    if (image) {
      context.drawImage(image, -42, -34, 84, 68);
    } else {
      context.fillStyle = '#d74d45';
      context.beginPath();
      context.ellipse(0, 0, 31, 27, 0, 0, TAU);
      context.fill();
    }
    if (enemy.state === 'charge') {
      context.strokeStyle = '#ff435a';
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, 0, 40 + Math.sin(this.visualTime * 20) * 3, 0, TAU);
      context.stroke();
    }
    if (enemy.hitFlash > 0) {
      context.fillStyle = `rgba(255,255,255,${enemy.hitFlash * 2.2})`;
      context.beginPath();
      context.arc(0, 0, 35, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  private drawShellTelegraph(context: CanvasRenderingContext2D, enemy: Enemy): void {
    const angle = Math.atan2(enemy.chargeY, enemy.chargeX);
    const progress = clamp(1 - enemy.stateTimer / 0.72, 0, 1);
    context.save();
    context.translate(enemy.x, enemy.y);
    context.rotate(angle);
    context.globalAlpha = 0.22 + progress * 0.28;
    context.fillStyle = '#ff5e73';
    context.beginPath();
    context.moveTo(16, 0);
    context.lineTo(210, -38);
    context.lineTo(210, 38);
    context.closePath();
    context.fill();
    context.globalAlpha = 0.8;
    context.strokeStyle = '#ff8d9b';
    context.lineWidth = 2;
    context.setLineDash([8, 8]);
    context.beginPath();
    context.moveTo(18, 0);
    context.lineTo(215, 0);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(0, 0, 29 + progress * 8, 0, TAU);
    context.stroke();
    context.restore();
  }

  private drawEnemyHealth(context: CanvasRenderingContext2D, enemy: Enemy): void {
    const width = enemy.kind === 'shell' ? 42 : 25;
    const x = enemy.x - width / 2;
    const y = enemy.y - enemy.radius - 11;
    context.fillStyle = 'rgba(7, 20, 18, 0.86)';
    context.fillRect(x - 1, y - 1, width + 2, 5);
    context.fillStyle = enemy.kind === 'shell' ? '#ffad5b' : '#ff5e73';
    context.fillRect(x, y, width * clamp(enemy.health / enemy.maxHealth, 0, 1), 3);
  }

  private drawProjectiles(context: CanvasRenderingContext2D): void {
    const image = this.assets.get('projectile');
    context.save();
    context.lineCap = 'round';
    for (const projectile of this.projectiles) {
      const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
      const directionX = projectile.vx / speed;
      const directionY = projectile.vy / speed;
      context.strokeStyle = 'rgba(60,190,255,0.38)';
      context.lineWidth = projectile.radius * 2.2;
      context.beginPath();
      context.moveTo(projectile.x, projectile.y);
      context.lineTo(projectile.x - directionX * 26, projectile.y - directionY * 26);
      context.stroke();
      context.save();
      context.translate(projectile.x, projectile.y);
      context.rotate(Math.atan2(directionY, directionX));
      if (image) context.drawImage(image, -17, -17, 34, 34);
      else {
        context.fillStyle = '#d8f5ff';
        context.strokeStyle = '#268ee8';
        context.lineWidth = 5;
        context.beginPath();
        context.arc(0, 0, 10, 0, TAU);
        context.fill();
        context.stroke();
      }
      context.restore();
    }
    context.restore();
  }

  private drawPlayer(context: CanvasRenderingContext2D): void {
    const player = this.player;
    const image = this.assets.get('hero-0');
    const blink = player.invulnerable > 0 && Math.floor(this.visualTime * 18) % 2 === 0;
    const bob = Math.sin(this.visualTime * 9) * 2;
    context.save();
    context.translate(player.x, player.y);
    context.globalAlpha = blink ? 0.46 : 1;
    context.fillStyle = 'rgba(39,31,45,0.28)';
    context.beginPath();
    context.ellipse(0, 24, 30, 10, 0, 0, TAU);
    context.fill();
    context.strokeStyle = player.invulnerable > 0 ? '#ff3d59' : '#2ee8ff';
    context.lineWidth = player.invulnerable > 0 ? 5 : 3;
    context.beginPath();
    context.ellipse(0, 20, 31 + Math.sin(this.visualTime * 6) * 2, 12, 0, 0, TAU);
    context.stroke();
    context.translate(0, bob);
    context.rotate(player.facing);
    if (image) {
      context.drawImage(image, -35, -39, 70, 78);
    } else {
      context.fillStyle = '#e64c3b';
      context.strokeStyle = '#273544';
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, 0, 22, 0, TAU);
      context.fill();
      context.stroke();
      context.fillStyle = '#51c9f2';
      context.fillRect(-23, -19, 46, 13);
    }
    context.restore();
  }

  private drawImpactEffects(context: CanvasRenderingContext2D): void {
    const image = this.assets.get('impact');
    for (const impact of this.impactEffects) {
      const progress = 1 - impact.life / impact.maxLife;
      const size = impact.size * (0.65 + progress * 0.55);
      context.save();
      context.translate(impact.x, impact.y);
      context.rotate(impact.rotation + progress * 1.4);
      context.globalAlpha = (1 - progress) * 0.9;
      if (image) context.drawImage(image, -size / 2, -size / 2, size, size);
      else {
        context.fillStyle = '#63e4ff';
        context.beginPath();
        for (let point = 0; point < 8; point += 1) {
          const angle = point / 8 * TAU;
          const radius = point % 2 === 0 ? size * 0.5 : size * 0.2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
      }
      context.restore();
    }
  }

  private drawParticles(context: CanvasRenderingContext2D): void {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * (0.45 + particle.life / particle.maxLife * 0.55), 0, TAU);
      context.fill();
    }
    context.restore();
  }

  private drawFloatingTexts(context: CanvasRenderingContext2D): void {
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 15px "Trebuchet MS", sans-serif';
    context.lineJoin = 'round';
    for (const text of this.floatingTexts) {
      context.globalAlpha = clamp(text.life * 2.6, 0, 1);
      context.strokeStyle = 'rgba(43,42,28,0.9)';
      context.lineWidth = 4;
      context.strokeText(String(text.value), text.x, text.y);
      context.fillStyle = text.color;
      context.fillText(String(text.value), text.x, text.y);
    }
    context.restore();
  }
}
