import Phaser from 'phaser';
import { sound } from './audio';
import { gameAssetNames } from './assets';
import { applyUpgrade, baseStats, experienceNeeded, getUpgrade, upgrades, type Stats, type UpgradeId } from './upgrades';
import { perkDefinitions, type PerkKind } from './perks';
import { DEFAULT_LEVEL_ID, getLevel, type LevelDefinition, type LevelId } from './levels';
import { decorations, obstacles } from './world';
import type { GameCallbacks, GameMode, GameSnapshot, HudState } from './game';

interface Bridge {
  callbacks: GameCallbacks;
  scene: ArenaScene | null;
}

const START_CENTER = 770;
const TAU = Math.PI * 2;

function stageAt(level: LevelDefinition, index: number) {
  return level.stages[index] ?? level.stages[0]!;
}

type EnemyKind = 'gnaw' | 'shell' | 'spitter';
type EnemyState = 'pursue' | 'windup' | 'charge' | 'recover';
type DirectionalFrame = 0 | 1 | 2 | 3 | 4;

class ArenaScene extends Phaser.Scene {
  static bridge: Bridge | null = null;
  private bridge!: Bridge;
  private callbacks!: GameCallbacks;
  private mode: GameMode = 'ready';
  private qaMode = false;
  private runDuration = 600;
  private timeScale = 1;
  private xpScale = 1;
  private inputX = 0;
  private inputY = 0;
  private keys = new Set<string>();
  private elapsed = 0;
  private stage = 0;
  private level = 1;
  private levelDefinition = getLevel(DEFAULT_LEVEL_ID);
  private levelId: LevelId = DEFAULT_LEVEL_ID;
  private xp = 0;
  private xpNeeded = experienceNeeded(1);
  private pendingLevels = 0;
  private kills = 0;
  private spitterSpawns = 0;
  private nextEntityId = 1;
  private facing = 0;
  private attackTimer = 0;
  private footstepTimer = 0;
  private spawnTimer = 0.4;
  private projectileCooldown = 0;
  private pulseCooldown = 0;
  private volleyTimer = 0;
  private shieldTimer = 0;
  private surgeTimer = 0;
  private healTimer = 0;
  private magnetTimer = 0;
  private healPulseTimer = 0;
  private nextSurge = 60;
  private dangerActive = false;
  private hudTimer = 0;
  private zoom = 1;
  private player!: Phaser.Physics.Arcade.Image;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private projectileGroup!: Phaser.Physics.Arcade.Group;
  private enemyProjectileGroup!: Phaser.Physics.Arcade.Group;
  private xpGroup!: Phaser.Physics.Arcade.Group;
  private perkGroup!: Phaser.Physics.Arcade.Group;
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
    this.levelId = DEFAULT_LEVEL_ID;
    this.levelDefinition = getLevel(this.levelId);
    this.runDuration = this.levelDefinition.duration;
    this.timeScale = this.qaMode ? 4 : 1;
    this.xpScale = this.qaMode ? 50 : 1;
    this.physics.world.setBounds(-1000000, -1000000, 2000000, 2000000);
    this.cameras.main.setBackgroundColor('#b7cf69');
    this.cameras.main.setRoundPixels(true);
    this.createTerrain(this.levelDefinition);
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

  startRun(levelId: LevelId = this.levelId): void {
    this.selectLevel(levelId);
    this.reset();
    this.handleResize();
    this.mode = 'running';
    this.scene.resume();
    this.callbacks.onMode(this.mode);
    this.emitHud();
    sound.play('start');
    this.callbacks.onToast(`${this.levelDefinition.name} · the garden wakes`);
  }

  selectLevel(levelId: LevelId): void {
    if (this.levelId === levelId) return;
    this.levelId = levelId;
    this.levelDefinition = getLevel(levelId);
    this.runDuration = this.levelDefinition.duration;
    if (this.terrain) this.rebuildTerrain();
  }

  returnToMenu(): void {
    this.reset();
    this.mode = 'ready';
    this.scene.pause();
    this.callbacks.onMode('ready');
  }

  pauseRun(): void {
    if (this.mode !== 'running') return;
    this.mode = 'paused';
    this.setInput(0, 0);
    this.scene.pause();
    this.callbacks.onMode(this.mode);
    sound.play('pause');
    this.emitHud();
  }

  resumeRun(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'running';
    this.scene.resume();
    this.callbacks.onMode(this.mode);
    sound.play('resume');
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
    sound.play('ui');
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
      stage: this.stage,
      stageName: stageAt(this.levelDefinition, this.stage).name,
      levelId: this.levelDefinition.id,
      levelName: this.levelDefinition.name,
      health: this.getHealth(),
      playerX: this.player?.x ?? START_CENTER,
      playerY: this.player?.y ?? START_CENTER,
      xp: this.xp,
      kills: this.kills,
      enemies: this.enemyGroup?.getLength() ?? 0,
      projectiles: this.projectileGroup?.getLength() ?? 0,
      perkLabel: this.getPerkStatus().label,
      perkSeconds: this.getPerkStatus().seconds,
      perks: this.perkGroup?.getLength() ?? 0,
      spitters: this.enemyGroup?.getChildren().filter((child) => (child as Phaser.Physics.Arcade.Image).getData('kind') === 'spitter').length ?? 0,
      spitterSpawns: this.spitterSpawns,
      enemyProjectiles: this.enemyProjectileGroup?.getLength() ?? 0,
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
    this.stage = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = experienceNeeded(1);
    this.pendingLevels = 0;
    this.kills = 0;
    this.spitterSpawns = 0;
    this.nextEntityId = 1;
    this.stats = { ...baseStats };
    this.upgradeRanks.clear();
    this.spawnTimer = 0.4;
    this.footstepTimer = 0;
    this.projectileCooldown = 0;
    this.pulseCooldown = 0;
    this.volleyTimer = 0;
    this.shieldTimer = 0;
    this.surgeTimer = 0;
    this.healTimer = 0;
    this.healPulseTimer = 0;
    this.magnetTimer = 0;
    this.xpScale = this.qaMode ? 50 : this.levelDefinition.xpScale;
    this.nextSurge = this.qaMode ? 10 : Math.max(45, 60 / this.levelDefinition.spawnRateScale);
    this.dangerActive = false;
    this.setInput(0, 0);
    this.keys.clear();
    this.enemyGroup?.clear(true, true);
    this.projectileGroup?.clear(true, true);
    this.enemyProjectileGroup?.clear(true, true);
    this.xpGroup?.clear(true, true);
    this.perkGroup?.clear(true, true);
    if (this.player) {
      this.player.setPosition(START_CENTER, START_CENTER);
      this.player.setTexture('hero-0');
      this.player.setData('health', this.stats.maxHealth);
      this.player.setData('invulnerable', 0);
      this.player.setVelocity(0, 0);
    }
    this.callbacks.onDanger(false);
  }

  private rebuildTerrain(): void {
    this.terrain.destroy();
    this.textures.remove('lumen-terrain-pattern');
    this.createTerrain(this.levelDefinition);
    this.handleResize();
  }

  private createTerrain(level: LevelDefinition = this.levelDefinition): void {
    const terrainSize = 2240;
    const centerX = 770;
    const centerY = 770;
    const canvas = document.createElement('canvas');
    canvas.width = terrainSize;
    canvas.height = terrainSize;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.fillStyle = level.theme.grass;
    context.fillRect(0, 0, terrainSize, terrainSize);

    const drawTexture = (asset: string, x: number, y: number, size: number, alpha: number, rotation = 0): void => {
      const image = this.textures.get(asset).getSourceImage() as HTMLImageElement;
      const sourceInset = 8;
      const sourceWidth = Math.max(1, image.width - sourceInset * 2);
      const sourceHeight = Math.max(1, image.height - sourceInset * 2);
      context.save();
      context.globalAlpha = alpha;
      context.translate(x + size / 2, y + size / 2);
      context.rotate(rotation);
      context.drawImage(image, sourceInset, sourceInset, sourceWidth, sourceHeight, -size / 2, -size / 2, size, size);
      context.restore();
    };

    const drawBlob = (asset: string, x: number, y: number, size: number, alpha: number, rotation = 0): void => {
      context.save();
      context.beginPath();
      context.ellipse(x + size / 2, y + size / 2, size * 0.5, size * 0.4, rotation, 0, TAU);
      context.clip();
      drawTexture(asset, x, y, size, alpha, rotation);
      context.restore();
    };

    const groundMarks = level.theme.groundMark;
    const groundShade = level.theme.groundShade;
    for (let index = 0; index < 420; index += 1) {
      const x = (index * 83 + 31) % terrainSize;
      const y = (index * 149 + 17) % terrainSize;
      const variation = (index * 17 + (index % 5) * 31) % 29;
      context.fillStyle = variation < 6 ? groundMarks : groundShade;
      if (variation < 6) context.fillRect(Math.round(x), Math.round(y), 3, 2);
      else if (variation > 20) context.fillRect(Math.round(x), Math.round(y), 2, 4);
    }

    const drawForest = (x: number, y: number, radiusX: number, radiusY: number, seed: number): void => {
      context.save();
      context.fillStyle = level.theme.forest;
      context.globalAlpha = 0.52;
      context.beginPath();
      for (let index = 0; index < 18; index += 1) {
        const angle = (index / 18) * TAU;
        const wobble = 1 + Math.sin(index * 4.7 + seed) * 0.1;
        const pointX = x + Math.cos(angle) * radiusX * wobble;
        const pointY = y + Math.sin(angle) * radiusY * wobble;
        if (index === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      }
      context.closePath();
      context.fill();
      context.restore();
    };

    drawForest(280, 290, 330, 250, 2);
    drawForest(1960, 420, 310, 270, 7);
    drawForest(1930, 1880, 360, 300, 11);
    drawForest(300, 1900, 300, 280, 17);
    drawForest(1540, 960, 260, 220, 23);
    drawBlob('terrain-grass-dark', 140, 150, 170, 0.24, -0.18);
    drawBlob('terrain-grass-dark', 1810, 280, 160, 0.24, 0.2);
    drawBlob('terrain-grass-dark', 1780, 1770, 180, 0.24, -0.12);
    drawBlob('terrain-grass-dark', 160, 1790, 170, 0.24, 0.16);
    drawBlob('terrain-grass', 410, 300, 260, 0.18, -0.22);
    drawBlob('terrain-grass', 1020, 300, 250, 0.16, 0.2);
    drawBlob('terrain-grass', 400, 1120, 270, 0.16, 0.18);
    drawBlob('terrain-grass', 1040, 1120, 250, 0.18, -0.16);
    drawBlob('terrain-grass', 760, 500, 180, 0.14, 0.12);
    drawBlob('terrain-grass', 780, 1040, 190, 0.14, -0.1);

    const drawRoad = (width: number, color: string): void => {
      context.save();
      context.strokeStyle = color;
      context.lineWidth = width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(130, 1940);
      context.quadraticCurveTo(470, 1450, centerX, centerY);
      context.quadraticCurveTo(1080, 270, 2090, 320);
      context.moveTo(centerX, centerY);
      context.quadraticCurveTo(620, 430, 250, 180);
      context.moveTo(centerX, centerY);
      context.quadraticCurveTo(1220, 1120, 2020, 1960);
      context.stroke();
      context.restore();
    };
    drawRoad(78, level.theme.roadEdge);
    drawRoad(58, level.theme.road);

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(1420, -40);
    context.bezierCurveTo(1280, 360, 1540, 620, 1370, 950);
    context.bezierCurveTo(1210, 1270, 1470, 1550, 1360, 1840);
    context.bezierCurveTo(1280, 2020, 1390, 2140, 1330, 2280);
    context.strokeStyle = level.theme.sand;
    context.lineWidth = 124;
    context.stroke();
    context.strokeStyle = level.theme.water;
    context.lineWidth = 92;
    context.stroke();
    context.strokeStyle = level.theme.waterHighlight;
    context.lineWidth = 58;
    context.stroke();
    context.strokeStyle = 'rgba(203, 238, 199, 0.45)';
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(1390, 0);
    context.bezierCurveTo(1250, 360, 1510, 620, 1340, 950);
    context.bezierCurveTo(1180, 1270, 1440, 1550, 1330, 1840);
    context.bezierCurveTo(1250, 2020, 1360, 2140, 1300, 2280);
    context.stroke();
    context.restore();

    drawBlob('terrain-flowers', 540, 570, 84, 0.46, -0.2);
    drawBlob('terrain-flowers', 950, 580, 92, 0.5, 0.12);
    drawBlob('terrain-flowers', 620, 1020, 88, 0.42, 0.2);
    drawBlob('terrain-flowers', 1020, 1060, 78, 0.4, -0.16);
    drawBlob('terrain-flowers', 360, 900, 76, 0.34, 0.1);
    drawBlob('terrain-flowers', 1220, 260, 84, 0.34, -0.2);
    drawBlob('terrain-flowers', 1120, 1420, 88, 0.36, 0.18);

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
    this.enemyProjectileGroup = this.physics.add.group();
    this.xpGroup = this.physics.add.group();
    this.perkGroup = this.physics.add.group();
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
    this.physics.add.overlap(this.player, this.perkGroup, (_player, perk) => this.collectPerk(perk as Phaser.Physics.Arcade.Image));
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
    this.updateStage();
    this.updatePlayer(delta);
    this.updateSpawning(delta);
    this.updateEnemies(delta);
    this.updateAttacks(delta);
    this.updateProjectiles(delta);
    this.updateEnemyProjectiles(delta);
    this.updateXp(delta);
    this.updatePerks(delta);
    this.updatePowerTimers(delta);
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
    const moveSpeed = this.stats.moveSpeed * (this.surgeTimer > 0 ? 1.28 : 1);
    const targetX = this.inputX * moveSpeed;
    const targetY = this.inputY * moveSpeed;
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, targetX, 1 - Math.exp(-delta * 13));
    body.velocity.y = Phaser.Math.Linear(body.velocity.y, targetY, 1 - Math.exp(-delta * 13));
    const invulnerable = Math.max(0, Number(this.player.getData('invulnerable')) - delta);
    this.player.setData('invulnerable', invulnerable);
    this.attackTimer = Math.max(0, this.attackTimer - delta);
    this.footstepTimer = Math.max(0, this.footstepTimer - delta);
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > 32 && this.footstepTimer <= 0) {
      sound.play('walk');
      this.footstepTimer = this.qaMode ? 0.18 : 0.34;
    }
    if (speed > 32) {
      const targetFacing = Math.atan2(body.velocity.y, body.velocity.x);
      const difference = Math.atan2(Math.sin(targetFacing - this.facing), Math.cos(targetFacing - this.facing));
      if (Math.abs(difference) > 0.35) this.facing = targetFacing;
    }
    this.player.setTexture(this.heroTexture());
    this.player.setFlipX(Math.cos(this.facing) < -0.2);
  }

  private updateStage(): void {
    const stageDuration = this.runDuration / Math.max(1, this.levelDefinition.stages.length - 1);
    const nextStage = Math.min(this.levelDefinition.stages.length - 1, Math.floor(this.elapsed / stageDuration));
    if (nextStage === this.stage) return;
    this.stage = nextStage;
    const stage = stageAt(this.levelDefinition, this.stage);
    this.callbacks.onToast(`${stage.name} · ${stage.description}`);
    sound.play('upgrade');
  }

  private updateSpawning(delta: number): void {
    if (this.elapsed >= this.nextSurge) {
      this.nextSurge += Math.max(45, 60 / this.levelDefinition.spawnRateScale);
      const burst = this.qaMode ? 3 : Math.min(22, Math.floor((7 + this.elapsed / 100) * this.levelDefinition.difficulty));
      for (let index = 0; index < burst; index += 1) this.spawnEnemy();
      if (this.elapsed >= 60) this.spawnEnemy('spitter');
    }
    this.spawnTimer -= delta;
    const baseInterval = this.qaMode ? 0.42 : Math.max(0.16, 0.68 - this.elapsed * 0.00075);
    const interval = baseInterval / this.levelDefinition.spawnRateScale;
    const cap = this.qaMode ? 30 : Math.min(220, Math.floor((42 + this.elapsed * 0.28) * this.levelDefinition.enemyCapScale));
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      if (this.enemyGroup.getLength() < cap) this.spawnEnemy();
    }
  }

  private spawnEnemy(forcedKind?: EnemyKind): void {
    const difficulty = this.levelDefinition.difficulty;
    const spitterChance = this.qaMode ? (this.elapsed >= 60 ? 0.08 : 0) : Phaser.Math.Clamp((this.elapsed - 60) / 1500 * difficulty, 0, 0.24);
    const kind: EnemyKind = forcedKind ?? (Math.random() < spitterChance
      ? 'spitter'
      : Math.random() < (this.qaMode ? 0.28 : Phaser.Math.Clamp(0.16 + this.elapsed * 0.00072, 0.16, 0.4) * Math.min(1, difficulty))
        ? 'shell'
        : 'gnaw');
    if (kind === 'spitter') this.spitterSpawns += 1;
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
    const healthScale = (1 + intensity * (kind === 'shell' ? 0.38 : kind === 'spitter' ? 0.32 : 0.18)) * difficulty;
    const maxHealth = (kind === 'shell' ? 82 : kind === 'spitter' ? 48 : 20) * healthScale;
    const speedScale = Math.sqrt(difficulty);
    const speed = (kind === 'shell'
      ? Math.min(70, 40 + intensity * 2.8)
      : kind === 'spitter'
        ? Math.min(78, 48 + intensity * 2.2)
        : Math.min(166, 88 + intensity * 5.4)) * speedScale;
    const enemy = this.enemyGroup.create(x, y, kind === 'gnaw' ? 'enemy-shadow-0' : 'enemy-golem-0') as Phaser.Physics.Arcade.Image;
    const size = kind === 'shell' ? 72 : kind === 'spitter' ? 54 : 30;
    enemy.setDisplaySize(size, kind === 'shell' ? 60 : kind === 'spitter' ? 54 : 30).setDepth(10);
    enemy.setData('id', this.nextEntityId++);
    enemy.setData('kind', kind);
    enemy.setData('health', maxHealth);
    enemy.setData('maxHealth', maxHealth);
    enemy.setData('speed', speed);
    enemy.setData('damage', kind === 'shell' ? 16 : kind === 'spitter' ? 10 : 8);
    enemy.setData('xp', kind === 'shell' ? 6 : kind === 'spitter' ? 5 : 2);
    enemy.setData('shotTimer', 1.2 + Math.random() * 1.6);
    enemy.setData('age', Math.random() * 8);
    enemy.setData('phase', Math.random() * TAU);
    enemy.setData('state', 'pursue');
    enemy.setData('stateTimer', 1.5 + Math.random() * 2);
    enemy.setData('chargeX', 0);
    enemy.setData('chargeY', 0);
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    body.setCircle(kind === 'shell' ? 28 : kind === 'spitter' ? 20 : 12);
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
      if (kind === 'spitter') {
        const baseX = dx / distance;
        const baseY = dy / distance;
        const radial = distance < 230 ? -1 : distance > 350 ? 1 : 0;
        const strafe = Math.sin(age * 1.8 + Number(enemy.getData('phase'))) * 0.42;
        moveX = baseX * radial - baseY * strafe;
        moveY = baseY * radial + baseX * strafe;
        let shotTimer = Number(enemy.getData('shotTimer')) - delta;
        if (shotTimer <= 0 && distance < 600) {
          this.fireEnemyProjectile(enemy);
          shotTimer = Math.max(1.7, 3.4 - this.elapsed / 900);
        }
        enemy.setData('shotTimer', shotTimer);
      } else if (kind === 'gnaw') {
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
      if (kind === 'spitter') {
        enemy.setTexture('enemy-golem-0');
        enemy.setTint(0x65f4db);
      } else {
        if (kind === 'shell') enemy.setTexture('enemy-golem-0');
        else enemy.setTexture('enemy-shadow-0');
        enemy.setTint(0xffffff);
      }
      enemy.setFlipX(dx < 0);
    }
  }

  private fireEnemyProjectile(enemy: Phaser.Physics.Arcade.Image): void {
    const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
    const projectile = this.enemyProjectileGroup.create(enemy.x, enemy.y, 'projectile') as Phaser.Physics.Arcade.Image;
    projectile.setDisplaySize(18, 18).setDepth(18).setTint(0xff5e73);
    projectile.setData('life', 3.2);
    projectile.setData('damage', 12);
    const body = projectile.body as Phaser.Physics.Arcade.Body;
    body.setCircle(8);
    body.setVelocity(Math.cos(angle) * 340, Math.sin(angle) * 340);
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
    const count = this.stats.projectileCount + (this.volleyTimer > 0 ? 2 : 0);
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
    sound.play('shoot');
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
    sound.play('pulse');
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

  private updateEnemyProjectiles(delta: number): void {
    for (const child of this.enemyProjectileGroup.getChildren()) {
      const projectile = child as Phaser.Physics.Arcade.Image;
      const life = Number(projectile.getData('life')) - delta;
      projectile.setData('life', life);
      if (life <= 0 || Phaser.Math.Distance.Between(projectile.x, projectile.y, this.player.x, this.player.y) > 18) {
        if (life <= 0) projectile.destroy();
        continue;
      }
      const damage = Number(projectile.getData('damage'));
      const sourceX = projectile.x;
      const sourceY = projectile.y;
      projectile.destroy();
      this.damagePlayer(damage, sourceX, sourceY);
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
    sound.play('hit');
    if (health > 0) return;
    enemy.destroy();
    this.kills += 1;
    sound.play('kill');
    const dropCount = enemy.getData('kind') === 'shell' ? 2 : 1;
    for (let index = 0; index < dropCount; index += 1) this.spawnXp(enemy.x, enemy.y, Number(enemy.getData('xp')) / dropCount);
    if (Math.random() < (this.qaMode ? 0.2 : 0.12) && this.perkGroup.getLength() < 3) this.spawnPerk(enemy.x, enemy.y);
  }

  private damagePlayer(amount: number, sourceX: number, sourceY: number): void {
    if (this.player.getData('invulnerable') > 0) return;
    if (this.shieldTimer > 0) {
      this.spawnImpact(this.player.x, this.player.y, 56, '#65f4db');
      sound.play('pulse');
      return;
    }
    const health = this.getHealth() - amount;
    this.player.setData('health', health);
    this.player.setData('invulnerable', 0.68);
    const direction = new Phaser.Math.Vector2(this.player.x - sourceX, this.player.y - sourceY).normalize().scale(190);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.velocity.add(direction);
    this.spawnImpact(this.player.x, this.player.y, 48, '#ff4d69');
    this.spawnDamageText(this.player.x, this.player.y - 24, amount, '#ff6b7d');
    sound.play('hurt');
    this.cameras.main.shake(90, 0.004);
    if (health <= 0) this.finish(false);
  }

  private handleContact(enemy: Phaser.Physics.Arcade.Image): void {
    const amount = Number(enemy.getData('damage')) * (enemy.getData('state') === 'charge' ? 1.35 : 1);
    this.damagePlayer(amount, enemy.x, enemy.y);
  }

  private collectXp(drop: Phaser.Physics.Arcade.Image): void {
    const value = Number(drop.getData('value')) || 1;
    drop.destroy();
    sound.play('xp');
    this.xp += value * this.xpScale;
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
    body.setCircle(9);
    body.setVelocity(Math.cos(angle) * 38, Math.sin(angle) * 38);
  }

  private updateXp(delta: number): void {
    for (const child of this.xpGroup.getChildren()) {
      const drop = child as Phaser.Physics.Arcade.Image;
      const body = drop.body as Phaser.Physics.Arcade.Body;
      const dx = this.player.x - drop.x;
      const dy = this.player.y - drop.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      if (distance < 26) {
        this.collectXp(drop);
        continue;
      }
      const magnetized = distance < this.stats.pickupRadius * (this.magnetTimer > 0 ? 2.2 : 1);
      if (magnetized) {
        const pull = this.magnetTimer > 0 ? 1240 : 860;
        body.velocity.x += dx / distance * pull * delta;
        body.velocity.y += dy / distance * pull * delta;
      }
      const drag = Math.exp(-delta * (magnetized ? 2.2 : 5.2));
      body.velocity.x *= drag;
      body.velocity.y *= drag;
      drop.setRotation(drop.rotation + delta * 2);
    }
    if (this.pendingLevels > 0 && this.mode === 'running') this.openUpgrade();
  }

  private spawnPerk(x: number, y: number): void {
    const kinds: PerkKind[] = ['volley', 'shield', 'surge', 'heal', 'magnet'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)] ?? 'volley';
    const perk = this.perkGroup.create(x, y, 'xp-coin') as Phaser.Physics.Arcade.Image;
    perk.setDisplaySize(24, 24).setDepth(14).setTint(perkDefinitions[kind].color);
    perk.setData('kind', kind);
    perk.setData('age', Math.random() * TAU);
    const angle = Math.random() * TAU;
    const body = perk.body as Phaser.Physics.Arcade.Body;
    body.setCircle(12);
    body.setVelocity(Math.cos(angle) * 54, Math.sin(angle) * 54);
  }

  private updatePerks(delta: number): void {
    for (const child of this.perkGroup.getChildren()) {
      const perk = child as Phaser.Physics.Arcade.Image;
      const body = perk.body as Phaser.Physics.Arcade.Body;
      const dx = this.player.x - perk.x;
      const dy = this.player.y - perk.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      if (distance < 30) {
        this.collectPerk(perk);
        continue;
      }
      const pickupRadius = this.stats.pickupRadius * (this.surgeTimer > 0 ? 1.25 : 1) * (this.magnetTimer > 0 ? 2.2 : 1);
      const magnetized = distance < pickupRadius;
      if (magnetized) {
        const pull = this.magnetTimer > 0 ? 1200 : 760;
        body.velocity.x += dx / distance * pull * delta;
        body.velocity.y += dy / distance * pull * delta;
      }
      const drag = Math.exp(-delta * (magnetized ? 2.4 : 5.6));
      body.velocity.x *= drag;
      body.velocity.y *= drag;
      perk.setRotation(perk.rotation + delta * 3);
    }
  }

  private collectPerk(perk: Phaser.Physics.Arcade.Image): void {
    const kind = perk.getData('kind') as PerkKind;
    if (!perkDefinitions[kind]) return;
    perk.destroy();
    if (kind === 'volley') this.volleyTimer = 18;
    if (kind === 'shield') this.shieldTimer = 8;
    if (kind === 'surge') this.surgeTimer = 12;
    if (kind === 'heal') {
      this.healTimer = 15;
      this.healPulseTimer = 0;
    }
    if (kind === 'magnet') this.magnetTimer = 12;
    this.callbacks.onToast(`${perkDefinitions[kind].name} · ${perkDefinitions[kind].description}`);
    sound.play('upgrade');
  }

  private updatePowerTimers(delta: number): void {
    this.volleyTimer = Math.max(0, this.volleyTimer - delta);
    this.shieldTimer = Math.max(0, this.shieldTimer - delta);
    this.surgeTimer = Math.max(0, this.surgeTimer - delta);
    if (this.healTimer > 0) {
      this.healPulseTimer -= delta;
      if (this.healPulseTimer <= 0) {
        const currentHealth = this.getHealth();
        const healed = Math.min(2.5, this.stats.maxHealth - currentHealth);
        if (healed > 0) {
          this.player.setData('health', currentHealth + healed);
          this.spawnImpact(this.player.x, this.player.y, 34, '#ff8fa3');
          this.spawnDamageText(this.player.x, this.player.y - 28, Math.round(healed), '#b7ffcb');
        }
        this.healPulseTimer = 0.5;
      }
    }
    this.healTimer = Math.max(0, this.healTimer - delta);
    this.magnetTimer = Math.max(0, this.magnetTimer - delta);
  }

  private getPerkStatus(): { label: string; seconds: number } {
    const active: string[] = [];
    if (this.volleyTimer > 0) active.push(`VOLLEY ${Math.ceil(this.volleyTimer)}S`);
    if (this.shieldTimer > 0) active.push(`SHIELD ${Math.ceil(this.shieldTimer)}S`);
    if (this.surgeTimer > 0) active.push(`SURGE ${Math.ceil(this.surgeTimer)}S`);
    if (this.healTimer > 0) active.push(`RENEWAL ${Math.ceil(this.healTimer)}S`);
    if (this.magnetTimer > 0) active.push(`MAGNET ${Math.ceil(this.magnetTimer)}S`);
    return { label: active.join(' · '), seconds: Math.max(this.volleyTimer, this.shieldTimer, this.surgeTimer, this.healTimer, this.magnetTimer) };
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
    sound.play('upgrade');
    this.scene.pause();
  }

  private finish(victory: boolean): void {
    if (this.mode === 'gameover' || this.mode === 'victory') return;
    this.mode = victory ? 'victory' : 'gameover';
    this.setInput(0, 0);
    this.scene.pause();
    this.callbacks.onMode(this.mode);
    sound.play(victory ? 'victory' : 'defeat');
    this.callbacks.onEnd(victory, this.getHud());
    this.callbacks.onDanger(false);
  }

  private getHealth(): number {
    return Number(this.player?.getData('health') ?? this.stats.maxHealth);
  }

  private getHud(): HudState {
    const perkStatus = this.getPerkStatus();
    return {
      health: Math.ceil(this.getHealth()),
      maxHealth: Math.round(this.stats.maxHealth),
      level: this.level,
      xp: this.xp,
      xpNeeded: this.xpNeeded,
      elapsed: this.elapsed,
      remaining: Math.max(0, this.runDuration - this.elapsed),
      kills: this.kills,
      stage: this.stage,
      stageName: stageAt(this.levelDefinition, this.stage).name,
      stageDescription: stageAt(this.levelDefinition, this.stage).description,
      levelId: this.levelDefinition.id,
      levelName: this.levelDefinition.name,
      perkLabel: perkStatus.label,
      perkSeconds: perkStatus.seconds,
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
  private levelId: LevelId = DEFAULT_LEVEL_ID;

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

  start(levelId: LevelId = this.levelId): void {
    this.levelId = levelId;
    this.scene?.startRun(levelId);
  }

  selectLevel(levelId: LevelId): void {
    this.levelId = levelId;
    this.scene?.selectLevel(levelId);
  }

  restart(levelId: LevelId = this.levelId): void {
    this.levelId = levelId;
    this.scene?.startRun(levelId);
  }

  returnToMenu(): void {
    this.scene?.returnToMenu();
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
      mode: 'ready', elapsed: 0, level: 1, health: 100, playerX: START_CENTER, playerY: START_CENTER, xp: 0, kills: 0, enemies: 0, projectiles: 0, upgradeRanks: {}, assetsReady: false, qa: new URLSearchParams(window.location.search).get('qa') === '1', levelId: this.levelId, levelName: getLevel(this.levelId).name,
    };
  }

  debugVictory(): void {
    this.scene?.debugVictory();
  }

  debugDefeat(): void {
    this.scene?.debugDefeat();
  }
}
