import type {
  BattleConfirmation,
  UploadedBattle,
  UploadedHero,
  UploadedTeam,
} from '../types/battleUpload';

const emptyHero = (): UploadedHero => ({
  name: '',
  skills: ['', '', ''],
});

const emptyTeam = (): UploadedTeam => [
  emptyHero(),
  emptyHero(),
  emptyHero(),
];

export function emptyBattleConfirmation(): BattleConfirmation {
  return {
    '1': emptyTeam(),
    '2': emptyTeam(),
    winner: '',
  };
}

/** Deep clone so later manual edits can never mutate parsed JSON state. */
export function battleToConfirmation(
  battle: UploadedBattle
): BattleConfirmation {
  const copyTeam = (team: UploadedTeam): UploadedTeam =>
    team.map((hero) => ({
      name: hero.name,
      skills: [...hero.skills] as [string, string, string],
    })) as UploadedTeam;
  return {
    '1': copyTeam(battle['1']),
    '2': copyTeam(battle['2']),
    winner: battle.winner,
  };
}
