type SoundName = 'ui' | 'start' | 'pause' | 'resume' | 'walk' | 'shoot' | 'pulse' | 'hit' | 'hurt' | 'kill' | 'xp' | 'upgrade' | 'victory' | 'defeat';
type MusicName = 'menu' | 'gameplay' | 'ambient';

const SFX_FILES: Record<SoundName, string> = {
  ui: '/assets/audio/effects/ui-click.ogg',
  start: '/assets/audio/effects/start-bell.ogg',
  pause: '/assets/audio/effects/pause-click.ogg',
  resume: '/assets/audio/effects/resume-spring.ogg',
  walk: '/assets/audio/effects/walk-step.ogg',
  shoot: '/assets/audio/effects/shoot.ogg',
  pulse: '/assets/audio/effects/pulse-spell.ogg',
  hit: '/assets/audio/effects/hit.ogg',
  hurt: '/assets/audio/effects/hurt.ogg',
  kill: '/assets/audio/effects/kill.ogg',
  xp: '/assets/audio/effects/xp-coin.ogg',
  upgrade: '/assets/audio/effects/upgrade-gem.ogg',
  victory: '/assets/audio/effects/victory-bell.ogg',
  defeat: '/assets/audio/effects/defeat-impact.ogg',
};

const MUSIC_FILES: Record<MusicName, string> = {
  menu: '/assets/audio/forest-orchestra.ogg',
  gameplay: '/assets/audio/garden-battle.mp3',
  ambient: '/assets/audio/forest-ambient.ogg',
};

const AUDIO_STORAGE_KEY = 'lumenwake-muted';
const SFX_POOL_SIZE = 3;

function readMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(AUDIO_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

class SoundManager {
  private muted = readMutedPreference();
  private audioUnlocked = false;
  private currentMusic: MusicName = 'menu';
  private readonly music = new Map<MusicName, HTMLAudioElement>();
  private readonly effects = new Map<SoundName, HTMLAudioElement[]>();
  private readonly effectCursor = new Map<SoundName, number>();

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.music.values()) track.volume = muted ? 0 : 0.12;
    for (const pool of this.effects.values()) {
      for (const track of pool) {
        track.volume = muted ? 0 : 0.42;
        if (muted) track.pause();
      }
    }
    if (muted) this.pauseMusic();
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, String(muted));
    } catch {
      return;
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMusic(name: MusicName): void {
    if (this.currentMusic === name) {
      if (this.audioUnlocked && !this.muted) this.playMusic(name);
      return;
    }
    this.pauseMusic();
    this.currentMusic = name;
    if (this.audioUnlocked && !this.muted) this.playMusic(name);
  }

  pauseMusic(): void {
    this.music.get(this.currentMusic)?.pause();
  }

  unlock(): void {
    this.audioUnlocked = true;
    for (const name of Object.keys(SFX_FILES) as SoundName[]) this.getEffectPool(name);
    if (!this.muted) this.playMusic(this.currentMusic);
  }

  play(name: SoundName): void {
    if (this.muted || !this.audioUnlocked) return;
    const pool = this.getEffectPool(name);
    const index = this.effectCursor.get(name) ?? 0;
    const track = pool[index];
    if (!track) return;
    this.effectCursor.set(name, (index + 1) % pool.length);
    track.currentTime = 0;
    track.volume = 0.42;
    void track.play().catch(() => undefined);
  }

  private playMusic(name: MusicName): void {
    const track = this.getMusic(name);
    track.volume = this.muted ? 0 : 0.12;
    void track.play().catch(() => undefined);
  }

  private getMusic(name: MusicName): HTMLAudioElement {
    const existing = this.music.get(name);
    if (existing) return existing;
    const track = new Audio(MUSIC_FILES[name]);
    track.loop = true;
    track.preload = 'auto';
    track.volume = this.muted ? 0 : 0.12;
    this.music.set(name, track);
    return track;
  }

  private getEffectPool(name: SoundName): HTMLAudioElement[] {
    const existing = this.effects.get(name);
    if (existing) return existing;
    const pool = Array.from({ length: SFX_POOL_SIZE }, () => {
      const track = new Audio(SFX_FILES[name]);
      track.preload = 'auto';
      track.volume = this.muted ? 0 : 0.42;
      return track;
    });
    this.effects.set(name, pool);
    return pool;
  }
}

export const sound = new SoundManager();
