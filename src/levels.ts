export type LevelId = 'rootway' | 'moonwell' | 'blackroot';

export interface LevelTheme {
  grass: string;
  forest: string;
  road: string;
  roadEdge: string;
  water: string;
  waterHighlight: string;
  sand: string;
  groundMark: string;
  groundShade: string;
}

export interface LevelStage {
  name: string;
  description: string;
}

export interface LevelDefinition {
  id: LevelId;
  name: string;
  eyebrow: string;
  description: string;
  duration: number;
  difficulty: number;
  spawnRateScale: number;
  enemyCapScale: number;
  xpScale: number;
  stages: LevelStage[];
  theme: LevelTheme;
}

export const DEFAULT_LEVEL_ID: LevelId = 'rootway';

export const levels: LevelDefinition[] = [
  {
    id: 'rootway',
    name: 'Rootway',
    eyebrow: 'THE FIRST LIGHT',
    description: 'A gentle opening through the waking garden. Learn the rhythm before the roots notice you.',
    duration: 300,
    difficulty: 1,
    spawnRateScale: 1,
    enemyCapScale: 1,
    xpScale: 1,
    stages: [
      { name: 'Rootway', description: 'The garden opens its eyes.' },
      { name: 'Moonwell', description: 'The water remembers your name.' },
      { name: 'Briarwind', description: 'The hedges begin to lean in.' },
      { name: 'Hollow Crown', description: 'Something old wakes beneath the roots.' },
      { name: 'Dawn Edge', description: 'Hold the light until sunrise.' },
    ],
    theme: {
      grass: '#789f4d',
      forest: '#32672f',
      road: '#c2a266',
      roadEdge: '#9b824f',
      water: '#4d9bb4',
      waterHighlight: '#65c6c6',
      sand: '#d0b879',
      groundMark: 'rgba(228, 214, 121, 0.2)',
      groundShade: 'rgba(35, 81, 37, 0.2)',
    },
  },
  {
    id: 'moonwell',
    name: 'Moonwell',
    eyebrow: 'THE DEEP WATER',
    description: 'Cross a longer night beside the old well, where the dark gathers faster and the stream carries strange lights.',
    duration: 420,
    difficulty: 1.22,
    spawnRateScale: 1.16,
    enemyCapScale: 1.18,
    xpScale: 0.9,
    stages: [
      { name: 'Moonwell', description: 'The water remembers your name.' },
      { name: 'Briarwind', description: 'The hedges begin to lean in.' },
      { name: 'Emberfen', description: 'The marsh glows beneath the rain.' },
      { name: 'Glass Orchard', description: 'Every branch remembers a blade.' },
      { name: 'Dawn Edge', description: 'Hold the light until sunrise.' },
    ],
    theme: {
      grass: '#6f9c5b',
      forest: '#28584b',
      road: '#b6a06a',
      roadEdge: '#827454',
      water: '#3b90ae',
      waterHighlight: '#75d3d2',
      sand: '#c4b986',
      groundMark: 'rgba(201, 226, 168, 0.22)',
      groundShade: 'rgba(30, 76, 67, 0.2)',
    },
  },
  {
    id: 'blackroot',
    name: 'Blackroot Gate',
    eyebrow: 'THE LAST GARDEN',
    description: 'A long, relentless run beneath the old roots. Every path is watched, and the dawn is far away.',
    duration: 600,
    difficulty: 1.5,
    spawnRateScale: 1.34,
    enemyCapScale: 1.42,
    xpScale: 0.78,
    stages: [
      { name: 'Blackroot Gate', description: 'The old roots open one eye.' },
      { name: 'Starling Marsh', description: 'The dark begins to answer back.' },
      { name: 'The Long Dark', description: 'Only your spark keeps the dawn.' },
      { name: 'Dawn Edge', description: 'Hold the light until sunrise.' },
    ],
    theme: {
      grass: '#5d8245',
      forest: '#203f36',
      road: '#a48b5d',
      roadEdge: '#6d5940',
      water: '#2d7480',
      waterHighlight: '#61b6b2',
      sand: '#aa9a6f',
      groundMark: 'rgba(210, 204, 125, 0.18)',
      groundShade: 'rgba(22, 57, 48, 0.24)',
    },
  },
];

export function getLevel(levelId: LevelId): LevelDefinition {
  return levels.find((level) => level.id === levelId) ?? levels[0]!;
}
