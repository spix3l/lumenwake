export type UpgradeId = 'edge' | 'cadence' | 'reach' | 'bloom' | 'wing' | 'vigor' | 'lure' | 'split' | 'impact';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  description: string;
  maxRank: number;
}

export interface Stats {
  projectileDamage: number;
  projectileRate: number;
  projectileRange: number;
  projectileCount: number;
  projectileSpeed: number;
  knockback: number;
  pulseDamage: number;
  pulseRate: number;
  pulseRange: number;
  moveSpeed: number;
  pickupRadius: number;
  maxHealth: number;
}

export const upgrades: Upgrade[] = [
  { id: 'edge', name: 'Bright Edge', description: 'Darts strike 22% harder.', maxRank: 5 },
  { id: 'cadence', name: 'Quick Pulse', description: 'Both attacks recover 15% faster.', maxRank: 5 },
  { id: 'reach', name: 'Long Thread', description: 'Dart speed and range grow 18%.', maxRank: 4 },
  { id: 'bloom', name: 'Moonbloom', description: 'Your close pulse covers a wider ring.', maxRank: 4 },
  { id: 'wing', name: 'Thin Wings', description: 'Move 11% faster through the dark.', maxRank: 4 },
  { id: 'vigor', name: 'Ember Heart', description: 'Gain 22 maximum health and mend 30.', maxRank: 5 },
  { id: 'lure', name: 'Lantern Pull', description: 'XP motes drift toward you from farther away.', maxRank: 4 },
  { id: 'split', name: 'Forked Flight', description: 'Fire one more dart, with a small power boost.', maxRank: 4 },
  { id: 'impact', name: 'Heavy Pollen', description: 'Attacks shove enemies back 45% harder.', maxRank: 3 },
];

export const baseStats: Stats = {
  projectileDamage: 13,
  projectileRate: 0.72,
  projectileRange: 380,
  projectileCount: 1,
  projectileSpeed: 500,
  knockback: 110,
  pulseDamage: 9,
  pulseRate: 2.7,
  pulseRange: 112,
  moveSpeed: 194,
  pickupRadius: 76,
  maxHealth: 100,
};

export function applyUpgrade(stats: Stats, id: UpgradeId): void {
  if (id === 'edge') stats.projectileDamage *= 1.22;
  if (id === 'cadence') {
    stats.projectileRate *= 0.85;
    stats.pulseRate *= 0.85;
  }
  if (id === 'reach') {
    stats.projectileRange *= 1.18;
    stats.projectileSpeed *= 1.12;
  }
  if (id === 'bloom') stats.pulseRange *= 1.2;
  if (id === 'wing') stats.moveSpeed *= 1.11;
  if (id === 'vigor') stats.maxHealth += 22;
  if (id === 'lure') stats.pickupRadius *= 1.28;
  if (id === 'split') {
    stats.projectileCount += 1;
    stats.projectileDamage *= 1.05;
  }
  if (id === 'impact') stats.knockback *= 1.45;
}

export function getUpgrade(id: UpgradeId): Upgrade {
  const upgrade = upgrades.find((item) => item.id === id);
  if (!upgrade) throw new Error(`Unknown upgrade: ${id}`);
  return upgrade;
}

export function experienceNeeded(level: number): number {
  return Math.floor(5 + level * 3.6 + Math.pow(level, 1.28));
}
