import Phaser from 'phaser';
import { gameAssetNames } from './assets';
import { applyUpgrade, baseStats, experienceNeeded, getUpgrade, upgrades, type Stats, type UpgradeId } from './upgrades';
import { decorations, obstacles } from './world';
import type { GameCallbacks, GameMode, GameSnapshot, HudState } from './game';

interface Bridge {
  callbacks: GameCallbacks;
  scene: ArenaScene | null;
}

const START_CENTER = 770;
const TAU = Math.PI * 2;

type EnemyKind = 'gnaw' | 'shell';
type EnemyState = 'pursue' | 'windup' | 'charge' | 'recover';
type DirectionalFrame = 0 | 1 | 2 | 3 | 4;

class ArenaScene extends Phaser.Scene {
  static bridge: Bridge | null = null;
  private bridge!: Bridge;
  private callbacks!: GameCallbacks;
  private mode: GameMode = 'ready';
  private qaMode = false;
  private runDuration = 300;
  private timeScale = 1;
  private xpScale = 1;
  private inputX = 0;
  private inputY = 0;
  private keys = new Set<string>();
  private elapsed = 0;
  private level = 1;
  private xp = 0;
  private xpNeeded = experienceNeeded(1);
  private pendingLevels = 0;
  private kills = 0;
  private nextEntityId = 1;
  private facing = 0;
  private attackTimer = 0;
  private spawnTimer = 0.4;
  private projectileCooldown = 0;
  private pulseCooldown = 0;
  private nextSurge = 60;
  private dangerActive = false;
  private hudTimer = 0;
  private zoom = 1;
  private player!: Phaser.Physics.Arcade.Image;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private projectileGroup!: Phaser.Physics.Arcade.Group;
  private xpGroup!: Phaser.Physics.Arcade.Group;
  private obstacleGroup!: Phaser.Physics.Arcade.StaticGroup;
  private telegraph!: Phaser.GameObjects.Graphics;
  private terrain!: Phaser.GameObjects.TileSprite;
  private stats: Stats = { ...baseStats };
  private upgradeRanks = new Map<UpgradeId, number>();
  private visualTime = 0;

  constructor() {
    super('Arena');
  }

  preload(): void {
    for (const name of gameAssetNames) this.load.image(name, `/assets/game/${name}.png`);
  }

  create(): void {
    this.bridge = ArenaScene.bridge ?? this.registry.get('bridge') as Bridge;
    if (!this.bridge) throw new Error('Lumenwake Phaser bridge was not initialized.');
    this.callbacks = this.bridge.callbacks;
    this.qaMode = new URLSearchParams(window.location.search).get('qa') === '1';
    this.runDuration = 300;
    this.timeScale = this.qaMode ? 4 : 1;
    this.xpScale = this.qaMode ? 50 : 1;
    this.physics.world.setBounds(-1000000, -1000000, 2000000, 2000000);
    this.cameras.main.setBackgroundColor('#b7cf69');
    this.cameras.main.setRoundPixels(true);
    this.createTerrain();
    this.createDecorations();
    this.createObstacles();
    this.createGroups();
    this.createPlayer();
    this.createColliders();
    this.telegraph = this.add.graphics().setDepth(9).setVisible(false);
    this.handleResize();
    this.scale.on('resize', this.handleResize, this);
    this.bridge.scene = this;
    this.reset();
    this.callbacks.onMode('ready');
  }

  update(_time: number, delta: number): void {
    const realDelta = Math.min(0.034, Math.max(0, delta / 1000));
    this.visualTime += realDelta;
    if (this.mode === 'running') this.updateGame(realDelta * this.timeScale);
    this.updateTerrainPosition();
    this.updateTelegraphs();
  }

  startRun(): void {
    this.reset();
    this.handleResize();
    this.mode = 'running';
    this.scene.resume();
    this.callbacks.onMode(this.mode);
    this.emitHud();
    this.callbacks.onToast('The garden wakes');
  }

  pauseRun(): void {
    if (this.mode !== 'running') return;
    this.mode = 'paused';
    this.setInput(0, 0);
    this.scene.pause();
    this.callbacks.onMode(this.mode);
    this.emitHud();
  }

  resumeRun(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'running';
    this.scene.resume();
    this.callbacks.onMode(this.mode);
  }

  setInput(x: number, y: number): void {
    this.inputX = x;
    this.inputY = y;
  }

  setKey(code: string, pressed: boolean): void {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const up = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const down = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    const x = Number(right) - Number(left);
    const y = Number(down) - Number(up);
    if (x !== 0 || y !== 0) this.setInput(x, y);
  }

  chooseUpgrade(id: UpgradeId): void {
    if (this.mode !== 'upgrade') return;
    if ((this.upgradeRanks.get(id) ?? 0) >= getUpgrade(id).maxRank) return;
    applyUpgrade(this.stats, id);
    this.upgradeRanks.set(id, (this.upgradeRanks.get(id) ?? 0) + 1);
    if (id === 'vigor') this.player.setData('health', Math.min(this.stats.maxHealth, this.getHealth() + 30));
    this.pendingLevels = Math.max(0, this.pendingLevels - 1);
    if (this.pendingLevels > 0) {
      this.openUpgrade();
      return;
    }
    this.mode = 'running';
    this.scene.resume();
    this.callbacks.onMode(this.mode);
    this.emitHud();
  }

  snapshot(): GameSnapshot {
    return {
      mode: this.mode,
      elapsed: this.elapsed,
      level: this.level,
      health: this.getHealth(),
      playerX: this.player?.x ?? START_CENTER,
      playerY: this.player?.y ?? START_CENTER,
      xp: this.xp,
      kills: this.kills,
      enemies: this.enemyGroup?.getLength() ?? 0,
      projectiles: this.projectileGroup?.getLength() ?? 0,
      upgradeRanks: Object.fromEntries(this.upgradeRanks),
      assetsReady: gameAssetNames.every((name) => this.textures.exists(name)),
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
    this.player.setData('health', 0);
    this.finish(false);
  }

  resize(): void {
    this.handleResize();
  }

  destroyScene(): void {
    this.scale.off('resize', this.handleResize, this);
  }

  private reset(): void {
    this.elapsed = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = experienceNeeded(1);
    this.pendingLevels = 0;
    this.kills = 0;
    this.nextEntityId = 1;
    this.stats = { ...baseStats };
    this.upgradeRanks.clear();
    this.spawnTimer = 0.4;
    this.projectileCooldown = 0;
    this.pulseCooldown = 0;
    this.nextSurge = this.qaMode ? 10 : 60;
    this.dangerActive = false;
    this.setInput(0, 0);
    this.keys.clear();
    this.enemyGroup?.clear(true, true);
    this.projectileGroup?.clear(true, true);
    this.xpGroup?.clear(true, true);
    if (this.player) {
      this.player.setPosition(START_CENTER, START_CENTER);
      this.player.setTexture('hero-0');
      this.player.setData('health', this.stats.maxHealth);
      this.player.setData('invulnerable', 0);
      this.player.setVelocity(0, 0);
    }
    this.callbacks.onDanger(false);
  }

  private createTerrain(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1120;
    canvas.height = 1120;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#b9a865';
    context.fillRect(0, 0, 1120, 1120);
    const terrainFor = (column: number, row: number): string => {
      if (row >= 5 && column <= 2) return 'terrain-dirt';
      if (row <= 2 && column <= 2) return 'terrain-flowers';
      return 'terrain-grass';
    };
    const tileAssets = Array.from({ length: 64 }, (_, index) => terrainFor(index % 8, Math.floor(index / 8)));
    tileAssets.forEach((asset, index) => {
      const image = this.textures.get(asset).getSourceImage() as CanvasImageSource;
      const x = (index % 8) * 140;
      const y = Math.floor(index / 8) * 140;
      context.drawImage(image, x + 4, y + 4, 132, 132);
    });
    this.textures.addCanvas('lumen-terrain-pattern', canvas);
    this.terrain = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'lumen-terrain-pattern').setOrigin(0).setScrollFactor(0).setDepth(-100);
  }

  private createDecorations(): void {
    for (const decoration of decorations) {
      this.add.image(decoration.x, decoration.y, decoration.asset).setDisplaySize(decoration.size, decoration.size).setDepth(1);
    }
  }

  private createObstacles(): void {
    this.obstacleGroup = this.physics.add.staticGroup();
    for (const obstacle of obstacles) {
      const image = this.obstacleGroup.create(obstacle.x, obstacle.y, obstacle.asset) as Phaser.Physics.Arcade.Image;
      image.setDisplaySize(obstacle.size, obstacle.size).setDepth(4);
      image.refreshBody();
    }
  }

  private createGroups(): void {
    this.enemyGroup = this.physics.add.group();
    this.projectileGroup = this.physics.add.group();
    this.xpGroup = this.physics.add.group();
  }

  private createPlayer(): void {
    this.player = this.physics.add.image(START_CENTER, START_CENTER, 'hero-0').setDepth(20);
    this.player.setDisplaySize(44, 52);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(20, 24, true);
    body.setOffset(2, 2);
    this.player.setData('health', this.stats.maxHealth);
    this.player.setData('invulnerable', 0);
    this.player.setDepth(20);
  }

  private createColliders(): void {
    this.physics.add.collider(this.player, this.obstacleGroup);
    this.physics.add.collider(this.enemyGroup, this.obstacleGroup);
    this.physics.add.overlap(this.player, this.enemyGroup, (_player, enemy) => this.handleContact(enemy as Phaser.Physics.Arcade.Image));
    this.physics.add.overlap(this.player, this.xpGroup, (_player, drop) => this.collectXp(drop as Phaser.Physics.Arcade.Image));
  }

  private handleResize(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.zoom = Phaser.Math.Clamp(Math.min(width, height) / 760, 0.62, 1);
    this.cameras.main.setZoom(this.zoom);
    if (this.terrain) this.terrain.setSize(width / this.zoom, height / this.zoom);
    if (this.player) this.cameras.main.centerOn(this.player.x, this.player.y);
  }

  private updateGame(delta: number): void {
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
    this.updateDanger();
    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.emitHud();
    }
    this.cameras.main.centerOn(this.player.x, this.player.y);
  }

  private updatePlayer(delta: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const targetX = this.inputX * this.stats.moveSpeed;
    const targetY = this.inputY * this.stats.moveSpeed;
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, targetX, 1 - Math.exp(-delta * 13));
    body.velocity.y = Phaser.Math.Linear(body.velocity.y, targetY, 1 - Math.exp(-delta * 13));
    const invulnerable = Math.max(0, Number(this.player.getData('invulnerable')) - delta);
    this.player.setData('invulnerable', invulnerable);
    this.attackTimer = Math.max(0, this.attackTimer - delta);
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > 32) {
      const targetFacing = Math.atan2(body.velocity.y, body.velocity.x);
      const difference = Math.atan2(Math.sin(targetFacing - this.facing), Math.cos(targetFacing - this.facing));
      if (Math.abs(difference) > 0.35) this.facing = targetFacing;
    }
    this.player.setTexture(this.heroTexture());
    this.player.setFlipX(Math.cos(this.facing) < -0.2);
  }

  private updateSpawning(delta: number): void {
    if (this.elapsed >= this.nextSurge) {
      this.nextSurge += 60;
      const burst = this.qaMode ? 3 : Math.min(14, 7 + Math.floor(this.elapsed / 90));
      for (let index = 0; index < burst; index += 1) this.spawnEnemy();
      this.callbacks.onToast(`Garden surge · minute ${Math.floor(this.nextSurge / 60)}`);
    }
    this.spawnTimer -= delta;
    const interval = this.qaMode ? 0.42 : Math.max(0.22, 0.72 - this.elapsed * 0.00125);
    const cap = this.qaMode ? 30 : Math.min(145, 45 + Math.floor(this.elapsed * 0.34));
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      if (this.enemyGroup.getLength() < cap) this.spawnEnemy();
    }
  }

  private spawnEnemy(): void {
    const kind: EnemyKind = Math.random() < (this.qaMode ? 0.28 : Phaser.Math.Clamp(0.16 + this.elapsed * 0.00085, 0.16, 0.43)) ? 'shell' : 'gnaw';
    const side = Phaser.Math.Between(0, 3);
    const view = this.cameras.main.worldView;
    const margin = 44;
    let x: number;
    let y: number;
    if (side === 0) {
      x = view.left - margin;
      y = Phaser.Math.Between(view.top, view.bottom);
    } else if (side === 1) {
      x = view.right + margin;
      y = Phaser.Math.Between(view.top, view.bottom);
    } else if (side === 2) {
      x = Phaser.Math.Between(view.left, view.right);
      y = view.top - margin;
    } else {
      x = Phaser.Math.Between(view.left, view.right);
      y = view.bottom + margin;
    }
    const intensity = this.elapsed / 100;
    const healthScale = 1 + intensity * (kind === 'shell' ? 0.82 : 0.46);
    const maxHealth = (kind === 'shell' ? 82 : 20) * healthScale;
    const speed = kind === 'shell' ? Math.min(64, 40 + intensity * 2.8) : Math.min(154, 88 + intensity * 5.4);
    const enemy = this.enemyGroup.create(x, y, kind === 'shell' ? 'enemy-golem-0' : 'enemy-shadow-0') as Phaser.Physics.Arcade.Image;
    const size = kind === 'shell' ? 72 : 30;
    enemy.setDisplaySize(size, kind === 'shell' ? 60 : 30).setDepth(10);
    enemy.setData('id', this.nextEntityId++);
    enemy.setData('kind', kind);
    enemy.setData('health', maxHealth);
    enemy.setData('maxHealth', maxHealth);
    enemy.setData('speed', speed);
    enemy.setData('damage', kind === 'shell' ? 16 : 8);
    enemy.setData('xp', kind === 'shell' ? 6 : 2);
    enemy.setData('age', Math.random() * 8);
    enemy.setData('phase', Math.random() * TAU);
    enemy.setData('state', 'pursue');
    enemy.setData('stateTimer', 1.5 + Math.random() * 2);
    enemy.setData('chargeX', 0);
    enemy.setData('chargeY', 0);
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    body.setCircle(kind === 'shell' ? 28 : 12);
    body.setImmovable(false);
  }

  private updateEnemies(delta: number): void {
    for (const child of this.enemyGroup.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Image;
      const body = enemy.body as Phaser.Physics.Arcade.Body;
      const kind = enemy.getData('kind') as EnemyKind;
      const age = Number(enemy.getData('age')) + delta;
      enemy.setData('age', age);
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      let moveX = dx / distance;
      let moveY = dy / distance;
      if (kind === 'gnaw') {
        const weave = Math.sin(age * 8 + Number(enemy.getData('phase'))) * 0.24;
        moveX -= moveY * weave;
        moveY += moveX * weave;
      } else {
        let state = enemy.getData('state') as EnemyState;
        let timer = Number(enemy.getData('stateTimer')) - delta;
        if (state === 'windup') {
          moveX = 0;
          moveY = 0;
          if (timer <= 0) {
            state = 'charge';
            timer = 0.7;
          }
        } else if (state === 'charge') {
          moveX = Number(enemy.getData('chargeX'));
          moveY = Number(enemy.getData('chargeY'));
          if (timer <= 0) {
            state = 'recover';
            timer = 0.8;
          }
        } else if (state === 'recover') {
          moveX = 0;
          moveY = 0;
          if (timer <= 0) {
            state = 'pursue';
            timer = 1.4 + Math.random() * 1.4;
          }
        } else if (distance < 245 && timer <= 0) {
          state = 'windup';
          timer = 0.72;
          enemy.setData('chargeX', moveX);
          enemy.setData('chargeY', moveY);
        }
        enemy.setData('state', state);
        enemy.setData('stateTimer', timer);
      }
      const speed = Number(enemy.getData('speed')) * (enemy.getData('state') === 'charge' ? 3.8 : 1);
      body.velocity.set(moveX * speed, moveY * speed);
      if (kind === 'shell') enemy.setTexture('enemy-golem-0');
      else enemy.setTexture('enemy-shadow-0');
      enemy.setFlipX(dx < 0);
      enemy.setTint(0xffffff);
    }
  }

  private updateAttacks(delta: number): void {
    this.projectileCooldown = Math.max(0, this.projectileCooldown - delta);
    this.pulseCooldown = Math.max(0, this.pulseCooldown - delta);
    const target = this.nearestEnemy();
    if (!target) return;
    if (this.projectileCooldown <= 0) this.fireDarts(target);
    if (this.pulseCooldown <= 0 && Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y) <= this.stats.pulseRange) this.firePulse();
  }

  private nearestEnemy(): Phaser.Physics.Arcade.Image | null {
    let nearest: Phaser.Physics.Arcade.Image | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const child of this.enemyGroup.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Image;
      const next = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (next < distance) {
        nearest = enemy;
        distance = next;
      }
    }
    return nearest;
  }

  private fireDarts(target: Phaser.Physics.Arcade.Image): void {
    const angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    const count = this.stats.projectileCount;
    for (let index = 0; index < count; index += 1) {
      const offset = index - (count - 1) / 2;
      const direction = angle + offset * 0.12;
      const projectile = this.projectileGroup.create(this.player.x, this.player.y, 'projectile') as Phaser.Physics.Arcade.Image;
      projectile.setDisplaySize(16, 16).setDepth(18);
      projectile.setData('life', this.stats.projectileRange / this.stats.projectileSpeed);
      projectile.setData('damage', this.stats.projectileDamage * (1 + (count - 1) * 0.08));
      const body = projectile.body as Phaser.Physics.Arcade.Body;
      body.setCircle(8);
      body.setVelocity(Math.cos(direction) * this.stats.projectileSpeed, Math.sin(direction) * this.stats.projectileSpeed);
    }
    this.attackTimer = 0.18;
    this.projectileCooldown = this.stats.projectileRate;
  }

  private firePulse(): void {
    const wave = this.add.circle(this.player.x, this.player.y, 18, 0x65f4db, 0.16).setStrokeStyle(4, 0xffffff, 0.9).setDepth(15);
    this.tweens.add({ targets: wave, scaleX: this.stats.pulseRange / 18, scaleY: this.stats.pulseRange / 18, alpha: 0, duration: 420, onComplete: () => wave.destroy() });
    for (const child of this.enemyGroup.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Image;
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (distance <= this.stats.pulseRange) this.damageEnemy(enemy, this.stats.pulseDamage);
    }
    this.pulseCooldown = this.stats.pulseRate;
  }

  private updateProjectiles(delta: number): void {
    for (const child of this.projectileGroup.getChildren()) {
      const projectile = child as Phaser.Physics.Arcade.Image;
      const life = Number(projectile.getData('life')) - delta;
      projectile.setData('life', life);
      if (life <= 0) {
        projectile.destroy();
        continue;
      }
      for (const enemyChild of this.enemyGroup.getChildren()) {
        const enemy = enemyChild as Phaser.Physics.Arcade.Image;
        if (Phaser.Math.Distance.Between(projectile.x, projectile.y, enemy.x, enemy.y) > 18) continue;
        this.damageEnemy(enemy, Number(projectile.getData('damage')));
        projectile.destroy();
        break;
      }
    }
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Image, damage: number): void {
    if (!enemy.active) return;
    const health = Number(enemy.getData('health')) - damage;
    enemy.setData('health', health);
    enemy.setTint(0xffffff);
    this.time.delayedCall(90, () => enemy.setTint(0xffffff));
    this.spawnImpact(enemy.x, enemy.y, enemy.getData('kind') === 'shell' ? 62 : 44);
    this.spawnDamageText(enemy.x, enemy.y, damage, '#fff8d7');
    if (health > 0) return;
    enemy.destroy();
    this.kills += 1;
    const dropCount = enemy.getData('kind') === 'shell' ? 2 : 1;
    for (let index = 0; index < dropCount; index += 1) this.spawnXp(enemy.x, enemy.y, Number(enemy.getData('xp')) / dropCount);
  }

  private handleContact(enemy: Phaser.Physics.Arcade.Image): void {
    if (this.player.getData('invulnerable') > 0) return;
    const amount = Number(enemy.getData('damage')) * (enemy.getData('state') === 'charge' ? 1.35 : 1);
    const health = this.getHealth() - amount;
    this.player.setData('health', health);
    this.player.setData('invulnerable', 0.68);
    const direction = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize().scale(190);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.velocity.add(direction);
    this.spawnImpact(this.player.x, this.player.y, 48, '#ff4d69');
    this.spawnDamageText(this.player.x, this.player.y - 24, amount, '#ff6b7d');
    this.cameras.main.shake(90, 0.004);
    if (health <= 0) this.finish(false);
  }

  private collectXp(drop: Phaser.Physics.Arcade.Image): void {
    drop.destroy();
    this.xp += 1 * this.xpScale;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level += 1;
      this.xpNeeded = experienceNeeded(this.level);
      this.pendingLevels += 1;
    }
  }

  private spawnXp(x: number, y: number, value: number): void {
    const drop = this.xpGroup.create(x, y, 'xp-coin') as Phaser.Physics.Arcade.Image;
    drop.setDisplaySize(14, 14).setDepth(12);
    drop.setData('value', value);
    drop.setData('age', Math.random() * TAU);
    const angle = Math.random() * TAU;
    const body = drop.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(angle) * 38, Math.sin(angle) * 38);
  }

  private updateXp(delta: number): void {
    for (const child of this.xpGroup.getChildren()) {
      const drop = child as Phaser.Physics.Arcade.Image;
      const body = drop.body as Phaser.Physics.Arcade.Body;
      const dx = this.player.x - drop.x;
      const dy = this.player.y - drop.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      if (distance < this.stats.pickupRadius) {
        body.velocity.x += dx / distance * 460 * delta;
        body.velocity.y += dy / distance * 460 * delta;
      }
      body.velocity.x *= Math.exp(-delta * (distance < this.stats.pickupRadius ? 1.8 : 5.2));
      body.velocity.y *= Math.exp(-delta * (distance < this.stats.pickupRadius ? 1.8 : 5.2));
      drop.setRotation(drop.rotation + delta * 2);
    }
    if (this.pendingLevels > 0 && this.mode === 'running') this.openUpgrade();
  }

  private spawnImpact(x: number, y: number, size: number, color?: string): void {
    const impact = this.add.image(x, y, 'impact').setDepth(24).setDisplaySize(size, size);
    if (color) impact.setTint(Phaser.Display.Color.HexStringToColor(color).color);
    this.tweens.add({ targets: impact, scaleX: impact.scaleX * 1.25, scaleY: impact.scaleY * 1.25, alpha: 0, duration: 260, onComplete: () => impact.destroy() });
  }

  private spawnDamageText(x: number, y: number, value: number, color: string): void {
    const text = this.add.text(x, y, String(Math.round(value)), { fontFamily: 'Trebuchet MS', fontSize: '15px', color, fontStyle: 'bold', stroke: '#302b1e', strokeThickness: 4 }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: text, y: y - 24, alpha: 0, duration: 500, onComplete: () => text.destroy() });
  }

  private updateTelegraphs(): void {
    this.telegraph.clear();
    this.telegraph.setVisible(false);
    for (const child of this.enemyGroup.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Image;
      if (enemy.getData('kind') !== 'shell' || enemy.getData('state') !== 'windup') continue;
      this.telegraph.setVisible(true);
      const angle = Math.atan2(Number(enemy.getData('chargeY')), Number(enemy.getData('chargeX')));
      const progress = Phaser.Math.Clamp(1 - Number(enemy.getData('stateTimer')) / 0.72, 0, 1);
      this.telegraph.fillStyle(0xff4d69, 0.16 + progress * 0.2);
      this.telegraph.beginPath();
      this.telegraph.moveTo(enemy.x + Math.cos(angle) * 22, enemy.y + Math.sin(angle) * 22);
      this.telegraph.lineTo(enemy.x + Math.cos(angle) * 210 - Math.sin(angle) * 34, enemy.y + Math.sin(angle) * 210 + Math.cos(angle) * 34);
      this.telegraph.lineTo(enemy.x + Math.cos(angle) * 210 + Math.sin(angle) * 34, enemy.y + Math.sin(angle) * 210 - Math.cos(angle) * 34);
      this.telegraph.closePath();
      this.telegraph.fillPath();
      this.telegraph.lineStyle(2, 0xffa0ae, 0.8);
      this.telegraph.beginPath();
      this.telegraph.moveTo(enemy.x, enemy.y);
      this.telegraph.lineTo(enemy.x + Math.cos(angle) * 210, enemy.y + Math.sin(angle) * 210);
      this.telegraph.strokePath();
    }
  }

  private updateTerrainPosition(): void {
    if (!this.terrain) return;
    this.terrain.tilePositionX = this.cameras.main.scrollX / this.zoom;
    this.terrain.tilePositionY = this.cameras.main.scrollY / this.zoom;
  }

  private openUpgrade(): void {
    this.mode = 'upgrade';
    const available = upgrades.filter((upgrade) => (this.upgradeRanks.get(upgrade.id) ?? 0) < upgrade.maxRank);
    for (let index = available.length - 1; index > 0; index -= 1) {
      const swapIndex = Phaser.Math.Between(0, index);
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
    this.scene.pause();
  }

  private finish(victory: boolean): void {
    if (this.mode === 'gameover' || this.mode === 'victory') return;
    this.mode = victory ? 'victory' : 'gameover';
    this.setInput(0, 0);
    this.scene.pause();
    this.callbacks.onMode(this.mode);
    this.callbacks.onEnd(victory, this.getHud());
    this.callbacks.onDanger(false);
  }

  private getHealth(): number {
    return Number(this.player?.getData('health') ?? this.stats.maxHealth);
  }

  private getHud(): HudState {
    return {
      health: Math.ceil(this.getHealth()),
      maxHealth: Math.round(this.stats.maxHealth),
      level: this.level,
      xp: this.xp,
      xpNeeded: this.xpNeeded,
      elapsed: this.elapsed,
      remaining: Math.max(0, this.runDuration - this.elapsed),
      kills: this.kills,
    };
  }

  private emitHud(): void {
    this.callbacks.onHud(this.getHud());
  }

  private updateDanger(): void {
    const danger = this.getHealth() / this.stats.maxHealth < 0.28 || this.enemyGroup.getChildren().some((child) => {
      const enemy = child as Phaser.Physics.Arcade.Image;
      return enemy.getData('state') === 'windup' && Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) < 300;
    });
    if (danger !== this.dangerActive) {
      this.dangerActive = danger;
      this.callbacks.onDanger(danger);
    }
  }

  private heroTexture(): string {
    const direction = ((Math.round(this.facing / (Math.PI / 4)) % 8) + 8) % 8;
    const idle: DirectionalFrame[] = [0, 1, 0, 3, 3, 4, 4, 4];
    if (this.player.getData('invulnerable') > 0) return `hero-${idle[direction]}`;
    return `hero-${idle[direction]}`;
  }
}

export class PhaserGame {
  private readonly game: Phaser.Game;
  private scene: ArenaScene | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    ArenaScene.bridge = { callbacks, scene: null };
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      canvas,
      parent: canvas.parentElement ?? undefined,
      backgroundColor: '#b7cf69',
      physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
      render: { pixelArt: true, antialias: false, roundPixels: true },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: '100%', height: '100%' },
      scene: [ArenaScene],
    });
    game.events.once(Phaser.Core.Events.READY, () => {
      this.scene = game.scene.getScene('Arena') as ArenaScene;
    });
    this.game = game;
  }

  start(): void {
    this.scene?.startRun();
  }

  restart(): void {
    this.scene?.startRun();
  }

  pause(): void {
    this.scene?.pauseRun();
  }

  resume(): void {
    this.scene?.resumeRun();
  }

  togglePause(): void {
    if (this.scene?.snapshot().mode === 'running') this.pause();
    if (this.scene?.snapshot().mode === 'paused') this.resume();
  }

  setKey(code: string, pressed: boolean): void {
    this.scene?.setKey(code, pressed);
  }

  setInput(x: number, y: number): void {
    this.scene?.setInput(x, y);
  }

  chooseUpgrade(id: UpgradeId): void {
    this.scene?.chooseUpgrade(id);
  }

  resize(): void {
    this.scene?.resize();
  }

  destroy(): void {
    this.scene?.destroyScene();
    this.game.destroy(true);
  }

  snapshot(): GameSnapshot {
    return this.scene?.snapshot() ?? {
      mode: 'ready', elapsed: 0, level: 1, health: 100, playerX: START_CENTER, playerY: START_CENTER, xp: 0, kills: 0, enemies: 0, projectiles: 0, upgradeRanks: {}, assetsReady: false, qa: new URLSearchParams(window.location.search).get('qa') === '1',
    };
  }

  debugVictory(): void {
    this.scene?.debugVictory();
  }

  debugDefeat(): void {
    this.scene?.debugDefeat();
  }
}
