export type PerkKind = 'volley' | 'shield' | 'surge' | 'heal' | 'magnet';

export interface PerkDefinition {
  name: string;
  description: string;
  color: number;
}

export const perkDefinitions: Record<PerkKind, PerkDefinition> = {
  volley: { name: 'Volley', description: 'Fire a three-dart volley for 18 seconds.', color: 0x65f4db },
  shield: { name: 'Shield', description: 'Block all damage for 8 seconds.', color: 0xd9ff5b },
  surge: { name: 'Surge', description: 'Move and gather faster for 12 seconds.', color: 0xffad5b },
  heal: { name: 'Renewal', description: 'Regenerate 5 health per second for 15 seconds.', color: 0xff8fa3 },
  magnet: { name: 'Magnet', description: 'Pull light and boons from twice as far for 12 seconds.', color: 0xa6a1ff },
};
