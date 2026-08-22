import { evidenceFor, scoreTeam, type AssignedHero } from './recommendationModel';
import type { UploadedBattle, UploadedTeam } from '../types/battleUpload';
import type { RecommendationData } from '../types/recommendation';

export interface TeamStrength {
  rawScore: number;
  share: number;
  displayPercent: number;
  lowEvidence: boolean;
}

export interface BattleStrengthComparison {
  team1: TeamStrength;
  team2: TeamStrength;
  displayedTie: boolean;
  upset: boolean;
}

/** Match the trainer: slot 0 is positional signature data and is never scored. */
export function assignedTeamForScoring(team: UploadedTeam): AssignedHero[] {
  return team.map((hero) => ({
    name: hero.name,
    skills: hero.skills.slice(1),
  }));
}

const sigmoid = (value: number): number => {
  if (value >= 0) {
    const inverse = Math.exp(-value);
    return 1 / (1 + inverse);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
};

const isLowEvidence = (
  team: AssignedHero[],
  data: RecommendationData
): boolean => {
  const evidence = evidenceFor(team, data.model, data.catalog.relationships);
  return evidence.featureCount === 0 || evidence.minSupport < 10;
};

/**
 * Compare two teams in paired-logistic raw units.
 *
 * `sigmoid(score1 - score2)` is the model-consistent opposing share. Displayed
 * percentages are whole numbers that always sum to 100.
 */
export function compareBattleStrength(
  battle: UploadedBattle,
  data: RecommendationData
): BattleStrengthComparison {
  const assigned1 = assignedTeamForScoring(battle['1']);
  const assigned2 = assignedTeamForScoring(battle['2']);
  const raw1 = scoreTeam(assigned1, data.model, data.catalog.relationships);
  const raw2 = scoreTeam(assigned2, data.model, data.catalog.relationships);
  const share1 = sigmoid(raw1 - raw2);
  const share2 = 1 - share1;
  const display1 = Math.round(share1 * 100);
  const display2 = 100 - display1;
  const displayedTie = display1 === display2;
  const winnerRaw = battle.winner === '1' ? raw1 : raw2;
  const loserRaw = battle.winner === '1' ? raw2 : raw1;

  return {
    team1: {
      rawScore: raw1,
      share: share1,
      displayPercent: display1,
      lowEvidence: isLowEvidence(assigned1, data),
    },
    team2: {
      rawScore: raw2,
      share: share2,
      displayPercent: display2,
      lowEvidence: isLowEvidence(assigned2, data),
    },
    displayedTie,
    upset: !displayedTie && winnerRaw < loserRaw,
  };
}
