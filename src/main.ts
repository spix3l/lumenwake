import './style.css';
import { sound } from './audio';
import { DEFAULT_LEVEL_ID, levels, type LevelId } from './levels';
import { PhaserGame } from './phaser-game';
import type { GameMode, GameSnapshot, HudState } from './game';
import type { Upgrade, UpgradeId } from './upgrades';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __LUMENWAKE__?: {
      snapshot: () => GameSnapshot;
      debugVictory: () => void;
      debugDefeat: () => void;
    };
  }
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element: ${id}`);
  return node as T;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

const body = document.body;
const canvas = element<HTMLCanvasElement>('game-canvas');
const loadingScreen = element<HTMLElement>('loading-screen');
const startScreen = element<HTMLElement>('start-screen');
const settingsScreen = element<HTMLElement>('settings-screen');
const pauseScreen = element<HTMLElement>('pause-screen');
const upgradeScreen = element<HTMLElement>('upgrade-screen');
const endScreen = element<HTMLElement>('end-screen');
const fatalScreen = element<HTMLElement>('fatal-screen');
const hud = element<HTMLElement>('hud');
const perkStatus = element<HTMLElement>('perk-status');
const xpReadout = element<HTMLElement>('xp-readout');
const joystick = element<HTMLElement>('joystick');
const joystickKnob = element<HTMLElement>('joystick-knob');
const toast = element<HTMLElement>('toast');
const stageBanner = element<HTMLElement>('stage-banner');
const stageBannerKicker = element<HTMLElement>('stage-banner-kicker');
const stageBannerTitle = element<HTMLElement>('stage-banner-title');
const stageBannerCopy = element<HTMLElement>('stage-banner-copy');
const startButton = element<HTMLButtonElement>('start-button');
const installButton = element<HTMLButtonElement>('install-button');
const installStatus = element<HTMLElement>('install-status');
const pauseButton = element<HTMLButtonElement>('pause-button');
const resumeButton = element<HTMLButtonElement>('resume-button');
const pauseRestartButton = element<HTMLButtonElement>('pause-restart-button');
const restartButton = element<HTMLButtonElement>('restart-button');
const upgradeOptions = element<HTMLElement>('upgrade-options');
const healthFill = element<HTMLElement>('health-fill');
const healthText = element<HTMLElement>('health-text');
const xpFill = element<HTMLElement>('xp-fill');
const xpLabel = element<HTMLElement>('xp-label');
const xpLevelText = element<HTMLElement>('xp-level-text');
const timeText = element<HTMLElement>('time-text');
const stageLabel = element<HTMLElement>('stage-label');
const levelText = element<HTMLElement>('level-text');
const pauseTime = element<HTMLElement>('pause-time');
const pauseLevel = element<HTMLElement>('pause-level');
const pauseKills = element<HTMLElement>('pause-kills');
const endTitle = element<HTMLElement>('end-title');
const endMessage = element<HTMLElement>('end-message');
const endPanel = endScreen.querySelector<HTMLElement>('.end-panel');
const endEyebrow = element<HTMLElement>('end-eyebrow');
const endTime = element<HTMLElement>('end-time');
const endLevel = element<HTMLElement>('end-level');
const endKills = element<HTMLElement>('end-kills');
const endMenuButton = element<HTMLButtonElement>('end-menu-button');
const levelOptions = element<HTMLDivElement>('level-options');
const levelTitle = element<HTMLElement>('level-picker-title');
const levelDescription = element<HTMLElement>('level-description');
const startButtonLabel = element<HTMLElement>('start-button-label');
const settingsButton = element<HTMLButtonElement>('settings-button');
const gameAudioToggle = element<HTMLButtonElement>('game-audio-toggle');
const effectsAudioToggle = element<HTMLButtonElement>('effects-audio-toggle');
const gameAudioState = element<HTMLElement>('game-audio-state');
const effectsAudioState = element<HTMLElement>('effects-audio-state');
const gameVolume = element<HTMLInputElement>('game-volume');
const effectsVolume = element<HTMLInputElement>('effects-volume');
const gameVolumeValue = element<HTMLOutputElement>('game-volume-value');
const effectsVolumeValue = element<HTMLOutputElement>('effects-volume-value');
const settingsBackButton = element<HTMLButtonElement>('settings-back-button');
const pauseMenuButton = element<HTMLButtonElement>('pause-menu-button');

let currentMode: GameMode = 'ready';
let selectedLevelId: LevelId = DEFAULT_LEVEL_ID;
let settingsOpen = false;
let currentChoices: Upgrade[] = [];
let toastTimer = 0;
let stageBannerTimer = 0;
let lastStage = -1;
let deferredInstall: BeforeInstallPromptEvent | null = null;
let activePointer: number | null = null;
let pointerOriginX = 0;
let pointerOriginY = 0;

function showScreen(screen: HTMLElement, visible: boolean): void {
  screen.hidden = !visible;
  screen.classList.toggle('is-visible', visible);
}

function setMode(mode: GameMode): void {
  currentMode = mode;
  body.dataset.mode = mode;
  if (mode !== 'running' && mode !== 'paused') perkStatus.hidden = true;
  if (mode === 'ready' || mode === 'victory') sound.setMusic('menu');
  else if (mode === 'gameover') sound.setMusic('ambient');
  else {
    sound.setMusic('gameplay');
    if (mode === 'paused' || mode === 'upgrade') sound.pauseMusic();
  }
  showScreen(loadingScreen, false);
  showScreen(settingsScreen, false);
  showScreen(startScreen, mode === 'ready' && !settingsOpen);
  showScreen(pauseScreen, mode === 'paused');
  showScreen(upgradeScreen, mode === 'upgrade');
  showScreen(endScreen, mode === 'gameover' || mode === 'victory');
  showScreen(fatalScreen, false);
  hud.hidden = !['running', 'paused', 'gameover', 'victory'].includes(mode);
  xpReadout.hidden = !['running', 'paused'].includes(mode);
  joystick.hidden = !body.classList.contains('touch-mode');
  if (mode === 'running') window.setTimeout(() => canvas.focus({ preventScroll: true }), 0);
}

function updateHud(hudState: HudState): void {
  const healthRatio = clamp(hudState.health / hudState.maxHealth, 0, 1);
  const xpRatio = clamp(hudState.xp / hudState.xpNeeded, 0, 1);
  healthFill.style.transform = `scaleX(${healthRatio})`;
  healthText.textContent = `${hudState.health} / ${hudState.maxHealth}`;
  body.dataset.lowHealth = healthRatio < 0.28 ? 'true' : 'false';
  xpFill.style.transform = `scaleX(${xpRatio})`;
  xpLabel.textContent = `GROWTH ${Math.round(xpRatio * 100)}%`;
  xpLevelText.textContent = `LV ${hudState.level}`;
  timeText.textContent = formatTime(hudState.remaining);
  levelText.textContent = String(hudState.level);
  stageLabel.textContent = `STAGE ${(hudState.stage ?? 0) + 1}`;
  perkStatus.hidden = !hudState.perkLabel || (hudState.perkSeconds ?? 0) <= 0;
  if (!perkStatus.hidden) perkStatus.textContent = hudState.perkLabel ?? '';
  showStageBanner(hudState);
  pauseTime.textContent = formatTime(hudState.elapsed);
  pauseLevel.textContent = String(hudState.level);
  pauseKills.textContent = String(hudState.kills);
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!toast.classList.contains('is-visible')) toast.hidden = true;
    }, 180);
  }, 1700);
}

function showStageBanner(hudState: HudState): void {
  const stage = hudState.stage ?? 0;
  if (stage === lastStage) return;
  lastStage = stage;
  stageBannerKicker.textContent = `STAGE ${String(stage + 1).padStart(2, '0')}`;
  stageBannerTitle.textContent = hudState.stageName ?? 'Rootway';
  stageBannerCopy.textContent = hudState.stageDescription ?? 'The garden opens its eyes.';
  stageBanner.hidden = false;
  requestAnimationFrame(() => stageBanner.classList.add('is-visible'));
  window.clearTimeout(stageBannerTimer);
  stageBannerTimer = window.setTimeout(() => {
    stageBanner.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!stageBanner.classList.contains('is-visible')) stageBanner.hidden = true;
    }, 180);
  }, 2300);
}

function renderLevelOptions(): void {
  const selectedLevel = levels.find((level) => level.id === selectedLevelId) ?? levels[0]!;
  levelTitle.textContent = selectedLevel.name;
  levelDescription.textContent = selectedLevel.description;
  startButtonLabel.textContent = `Enter ${selectedLevel.name}`;
  levelOptions.replaceChildren();
  for (const level of levels) {
    const button = document.createElement('button');
    button.className = 'level-option';
    button.type = 'button';
    button.dataset.levelId = level.id;
    button.classList.toggle('is-selected', level.id === selectedLevelId);
    button.setAttribute('aria-pressed', String(level.id === selectedLevelId));
    const name = document.createElement('strong');
    name.textContent = level.name;
    const meta = document.createElement('span');
    meta.textContent = `${Math.round(level.duration / 60)} min · ${level.difficulty < 1.1 ? 'gentle' : level.difficulty < 1.35 ? 'hungry' : 'relentless'}`;
    const description = document.createElement('small');
    description.textContent = level.eyebrow;
    button.append(name, meta, description);
    button.addEventListener('click', () => {
      selectedLevelId = level.id;
      game.selectLevel(level.id);
      renderLevelOptions();
      sound.play('ui');
    });
    levelOptions.append(button);
  }
}

function updateAudioSettings(): void {
  const settings = sound.getSettings();
  gameAudioToggle.setAttribute('aria-pressed', String(settings.gameEnabled));
  effectsAudioToggle.setAttribute('aria-pressed', String(settings.effectsEnabled));
  gameAudioState.textContent = settings.gameEnabled ? 'On' : 'Off';
  effectsAudioState.textContent = settings.effectsEnabled ? 'On' : 'Off';
  gameVolume.value = String(Math.round(settings.gameVolume * 100));
  effectsVolume.value = String(Math.round(settings.effectsVolume * 100));
  gameVolumeValue.value = `${Math.round(settings.gameVolume * 100)}%`;
  effectsVolumeValue.value = `${Math.round(settings.effectsVolume * 100)}%`;
}

function openSettings(): void {
  settingsOpen = true;
  showScreen(startScreen, false);
  showScreen(settingsScreen, true);
  updateAudioSettings();
  sound.play('ui');
}

function closeSettings(): void {
  settingsOpen = false;
  showScreen(settingsScreen, false);
  showScreen(startScreen, currentMode === 'ready');
  sound.play('ui');
}

function renderUpgradeChoices(choices: Upgrade[], level: number): void {
  currentChoices = choices;
  element<HTMLElement>('upgrade-level').textContent = `Level ${level} reached · choose with 1, 2, or 3`;
  upgradeOptions.replaceChildren();
  choices.forEach((upgrade, index) => {
    const rank = game.snapshot().upgradeRanks[upgrade.id] ?? 0;
    const card = document.createElement('button');
    card.className = 'upgrade-card';
    card.type = 'button';
    card.dataset.upgradeId = upgrade.id;
    card.setAttribute('aria-label', `${upgrade.name}. ${upgrade.description}`);
    const sigil = document.createElement('span');
    sigil.className = 'upgrade-sigil';
    sigil.setAttribute('aria-hidden', 'true');
    const sigilText = document.createElement('span');
    sigilText.textContent = String(index + 1).padStart(2, '0');
    sigil.append(sigilText);
    const name = document.createElement('h3');
    name.textContent = upgrade.name;
    const description = document.createElement('p');
    description.textContent = upgrade.description;
    const rankLabel = document.createElement('span');
    rankLabel.className = 'upgrade-rank';
    rankLabel.textContent = `LV ${Math.min(rank, upgrade.maxRank)} → ${Math.min(rank + 1, upgrade.maxRank)}`;
    card.append(sigil, name, description, rankLabel);
    upgradeOptions.append(card);
  });
}

function endRun(victory: boolean, hudState: HudState): void {
  endPanel?.classList.toggle('is-loss', !victory);
  endTitle.textContent = victory ? 'Dawn secured' : 'The dark prevailed';
  endMessage.textContent = victory
    ? 'The last spark held until sunrise. The garden remembers your name.'
    : 'The garden went quiet, but another spark can wake it again.';
  endEyebrow.innerHTML = victory
    ? '<span></span> SUNRISE REACHED'
    : '<span></span> THE SPARK WENT OUT';
  endTime.textContent = formatTime(hudState.elapsed);
  endLevel.textContent = String(hudState.level);
  endKills.textContent = String(hudState.kills);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const game = new PhaserGame(canvas, {
  onMode: setMode,
  onHud: updateHud,
  onDanger: (danger) => {
    body.dataset.danger = danger ? 'true' : 'false';
  },
  onUpgrade: renderUpgradeChoices,
  onEnd: endRun,
  onToast: showToast,
});

function resetJoystick(): void {
  activePointer = null;
  joystick.classList.remove('is-active');
  joystickKnob.style.transform = 'translate(0, 0)';
  game.setInput(0, 0);
}

function updatePointer(event: PointerEvent): void {
  const dx = event.clientX - pointerOriginX;
  const dy = event.clientY - pointerOriginY;
  const distance = Math.hypot(dx, dy);
  const maximum = 42;
  const scale = distance > maximum ? maximum / distance : 1;
  const knobX = dx * scale;
  const knobY = dy * scale;
  joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;
  game.setInput(distance < 7 ? 0 : knobX / maximum, distance < 7 ? 0 : knobY / maximum);
}

canvas.addEventListener('pointerdown', (event) => {
  if (currentMode !== 'running' || activePointer !== null) return;
  if (event.pointerType === 'touch' || event.pointerType === 'pen') body.classList.add('touch-mode');
  activePointer = event.pointerId;
  pointerOriginX = event.clientX;
  pointerOriginY = event.clientY;
  const half = 56;
  const x = clamp(event.clientX, half, window.innerWidth - half);
  const y = clamp(event.clientY, half, window.innerHeight - half);
  joystick.style.setProperty('--joy-x', `${x}px`);
  joystick.style.setProperty('--joy-y', `${y}px`);
  joystick.hidden = false;
  joystick.classList.add('is-active');
  if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
  updatePointer(event);
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointer) return;
  updatePointer(event);
  event.preventDefault();
});

canvas.addEventListener('pointerup', (event) => {
  if (event.pointerId !== activePointer) return;
  resetJoystick();
});

canvas.addEventListener('pointercancel', resetJoystick);
canvas.addEventListener('lostpointercapture', resetJoystick);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('keydown', (event) => {
  const movementKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code);
  if (movementKey) {
    event.preventDefault();
    game.setKey(event.code, true);
  }
  if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
    event.preventDefault();
    game.togglePause();
  }
  if (currentMode === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
    const index = Number(event.code.slice(-1)) - 1;
    const choice = currentChoices[index];
    if (choice) game.chooseUpgrade(choice.id);
  }
  if (currentMode === 'ready' && event.code === 'Enter' && document.activeElement === canvas) {
    sound.unlock();
    game.start(selectedLevelId);
  }
});

window.addEventListener('keyup', (event) => {
  game.setKey(event.code, false);
});

window.addEventListener('blur', () => game.pause());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

startButton.addEventListener('click', () => {
  sound.unlock();
  game.start(selectedLevelId);
});
settingsButton.addEventListener('click', openSettings);
settingsBackButton.addEventListener('click', closeSettings);
pauseButton.addEventListener('click', () => game.pause());
resumeButton.addEventListener('click', () => game.resume());
pauseRestartButton.addEventListener('click', () => {
  lastStage = -1;
  game.restart(selectedLevelId);
});
restartButton.addEventListener('click', () => {
  lastStage = -1;
  game.restart(selectedLevelId);
});
endMenuButton.addEventListener('click', () => {
  lastStage = -1;
  stageBanner.hidden = true;
  stageBanner.classList.remove('is-visible');
  resetJoystick();
  game.returnToMenu();
});
pauseMenuButton.addEventListener('click', () => {
  lastStage = -1;
  stageBanner.hidden = true;
  stageBanner.classList.remove('is-visible');
  resetJoystick();
  game.returnToMenu();
});
gameAudioToggle.addEventListener('click', () => {
  const enabled = sound.toggleGameEnabled();
  if (enabled) sound.unlock();
  updateAudioSettings();
  sound.play('ui');
});
effectsAudioToggle.addEventListener('click', () => {
  const enabled = sound.toggleEffectsEnabled();
  if (enabled) sound.unlock();
  updateAudioSettings();
  sound.play('ui');
});
gameVolume.addEventListener('input', () => {
  sound.setGameVolume(Number(gameVolume.value) / 100);
  updateAudioSettings();
});
effectsVolume.addEventListener('input', () => {
  sound.setEffectsVolume(Number(effectsVolume.value) / 100);
  updateAudioSettings();
});
element<HTMLButtonElement>('reload-button').addEventListener('click', () => window.location.reload());

upgradeOptions.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-upgrade-id]') : null;
  const id = target?.dataset.upgradeId as UpgradeId | undefined;
  if (id) game.chooseUpgrade(id);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event as BeforeInstallPromptEvent;
  installButton.textContent = 'Install game';
  installStatus.textContent = 'Lumenwake is ready to install.';
});

installButton.addEventListener('click', async () => {
  sound.unlock();
  sound.play('ui');
  if (!deferredInstall) {
    installStatus.textContent = 'Use your browser menu, then choose Add to Home Screen or Install app.';
    return;
  }
  installButton.disabled = true;
  await deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  installStatus.textContent = choice.outcome === 'accepted' ? 'Lumenwake installed. Play on.' : 'Install dismissed.';
  deferredInstall = null;
  installButton.disabled = false;
});

const resizeObserver = new ResizeObserver(() => game.resize());
resizeObserver.observe(canvas);
game.resize();
renderLevelOptions();
updateAudioSettings();
setMode('ready');

if (game.snapshot().qa) {
  window.__LUMENWAKE__ = {
    snapshot: () => game.snapshot(),
    debugVictory: () => game.debugVictory(),
    debugDefeat: () => game.debugDefeat(),
  };
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(() => {
      if (!deferredInstall) installStatus.textContent = 'Offline play is ready after this first visit.';
    }).catch(() => {
      installStatus.textContent = 'Offline mode is unavailable in this browser session.';
    });
  });
}
