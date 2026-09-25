import { assetUrl } from './paths';

type SoundName = 'ui' | 'start' | 'pause' | 'resume' | 'walk' | 'shoot' | 'pulse' | 'hit' | 'hurt' | 'kill' | 'xp' | 'upgrade' | 'victory' | 'defeat';
type MusicName = 'menu' | 'gameplay' | 'ambient';

export interface AudioSettings {
  gameEnabled: boolean;
  gameVolume: number;
  effectsEnabled: boolean;
  effectsVolume: number;
}

const SFX_FILES: Record<SoundName, string> = {
  ui: assetUrl('assets/audio/effects/ui-click.ogg'),
  start: assetUrl('assets/audio/effects/start-bell.ogg'),
  pause: assetUrl('assets/audio/effects/pause-click.ogg'),
  resume: assetUrl('assets/audio/effects/resume-spring.ogg'),
  walk: assetUrl('assets/audio/effects/walk-step.ogg'),
  shoot: assetUrl('assets/audio/effects/shoot.ogg'),
  pulse: assetUrl('assets/audio/effects/pulse-spell.ogg'),
  hit: assetUrl('assets/audio/effects/hit.ogg'),
  hurt: assetUrl('assets/audio/effects/hurt.ogg'),
  kill: assetUrl('assets/audio/effects/kill.ogg'),
  xp: assetUrl('assets/audio/effects/xp-coin.ogg'),
  upgrade: assetUrl('assets/audio/effects/upgrade-gem.ogg'),
  victory: assetUrl('assets/audio/effects/victory-bell.ogg'),
  defeat: assetUrl('assets/audio/effects/defeat-impact.ogg'),
};

const MUSIC_FILES: Record<MusicName, string> = {
  menu: assetUrl('assets/audio/forest-orchestra.ogg'),
  gameplay: assetUrl('assets/audio/garden-battle.mp3'),
  ambient: assetUrl('assets/audio/forest-ambient.ogg'),
};

const AUDIO_STORAGE_KEY = 'lumenwake-audio';
const LEGACY_MUTE_STORAGE_KEY = 'lumenwake-muted';
const SFX_POOL_SIZE = 3;
const DEFAULT_SETTINGS: AudioSettings = {
  gameEnabled: true,
  gameVolume: 0.12,
  effectsEnabled: true,
  effectsVolume: 0.42,
};

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function readSettings(): AudioSettings {
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        gameEnabled: typeof stored.gameEnabled === 'boolean' ? stored.gameEnabled : DEFAULT_SETTINGS.gameEnabled,
        gameVolume: clampVolume(stored.gameVolume, DEFAULT_SETTINGS.gameVolume),
        effectsEnabled: typeof stored.effectsEnabled === 'boolean' ? stored.effectsEnabled : DEFAULT_SETTINGS.effectsEnabled,
        effectsVolume: clampVolume(stored.effectsVolume, DEFAULT_SETTINGS.effectsVolume),
      };
    }
    if (window.localStorage.getItem(LEGACY_MUTE_STORAGE_KEY) === 'true') {
      return { ...DEFAULT_SETTINGS, gameEnabled: false, effectsEnabled: false };
    }
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS };
}

class SoundManager {
  private settings = readSettings();
  private audioUnlocked = false;
  private currentMusic: MusicName = 'menu';
  private readonly music = new Map<MusicName, HTMLAudioElement>();
  private readonly effects = new Map<SoundName, HTMLAudioElement[]>();
  private readonly effectCursor = new Map<SoundName, number>();

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  setGameEnabled(enabled: boolean): void {
    this.settings.gameEnabled = enabled;
    this.applyMusicVolumes();
    if (!enabled) this.pauseMusic();
    else if (this.audioUnlocked) this.playMusic(this.currentMusic);
    this.saveSettings();
  }

  setGameVolume(volume: number): void {
    this.settings.gameVolume = clampVolume(volume, this.settings.gameVolume);
    this.applyMusicVolumes();
    this.saveSettings();
  }

  toggleGameEnabled(): boolean {
    this.setGameEnabled(!this.settings.gameEnabled);
    return this.settings.gameEnabled;
  }

  setEffectsEnabled(enabled: boolean): void {
    this.settings.effectsEnabled = enabled;
    this.applyEffectVolumes();
    if (!enabled) this.pauseEffects();
    this.saveSettings();
  }

  setEffectsVolume(volume: number): void {
    this.settings.effectsVolume = clampVolume(volume, this.settings.effectsVolume);
    this.applyEffectVolumes();
    this.saveSettings();
  }

  toggleEffectsEnabled(): boolean {
    this.setEffectsEnabled(!this.settings.effectsEnabled);
    return this.settings.effectsEnabled;
  }

  setMusic(name: MusicName): void {
    if (this.currentMusic === name) {
      if (this.audioUnlocked && this.settings.gameEnabled) this.playMusic(name);
      return;
    }
    this.pauseMusic();
    this.currentMusic = name;
    if (this.audioUnlocked && this.settings.gameEnabled) this.playMusic(name);
  }

  pauseMusic(): void {
    this.music.get(this.currentMusic)?.pause();
  }

  unlock(): void {
    this.audioUnlocked = true;
    for (const name of Object.keys(SFX_FILES) as SoundName[]) this.getEffectPool(name);
    if (this.settings.gameEnabled) this.playMusic(this.currentMusic);
  }

  play(name: SoundName): void {
    if (!this.settings.effectsEnabled || !this.audioUnlocked) return;
    const pool = this.getEffectPool(name);
    const index = this.effectCursor.get(name) ?? 0;
    const track = pool[index];
    if (!track) return;
    this.effectCursor.set(name, (index + 1) % pool.length);
    track.currentTime = 0;
    track.volume = this.settings.effectsVolume;
    void track.play().catch(() => undefined);
  }

  private playMusic(name: MusicName): void {
    const track = this.getMusic(name);
    track.volume = this.settings.gameEnabled ? this.settings.gameVolume : 0;
    void track.play().catch(() => undefined);
  }

  private getMusic(name: MusicName): HTMLAudioElement {
    const existing = this.music.get(name);
    if (existing) return existing;
    const track = new Audio(MUSIC_FILES[name]);
    track.loop = true;
    track.preload = 'auto';
    track.volume = this.settings.gameEnabled ? this.settings.gameVolume : 0;
    this.music.set(name, track);
    return track;
  }

  private getEffectPool(name: SoundName): HTMLAudioElement[] {
    const existing = this.effects.get(name);
    if (existing) return existing;
    const pool = Array.from({ length: SFX_POOL_SIZE }, () => {
      const track = new Audio(SFX_FILES[name]);
      track.preload = 'auto';
      track.volume = this.settings.effectsEnabled ? this.settings.effectsVolume : 0;
      return track;
    });
    this.effects.set(name, pool);
    return pool;
  }

  private applyMusicVolumes(): void {
    for (const track of this.music.values()) track.volume = this.settings.gameEnabled ? this.settings.gameVolume : 0;
  }

  private applyEffectVolumes(): void {
    for (const pool of this.effects.values()) {
      for (const track of pool) track.volume = this.settings.effectsEnabled ? this.settings.effectsVolume : 0;
    }
  }

  private pauseEffects(): void {
    for (const pool of this.effects.values()) {
      for (const track of pool) track.pause();
    }
  }

  private saveSettings(): void {
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      return;
    }
  }
}

export const sound = new SoundManager();
