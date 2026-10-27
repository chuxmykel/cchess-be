// Glickman's "Example of the Glicko-2 system": https://www.glicko.net/glicko/glicko2.pdf
//
// |--------------------------------------------------------------------------|
// | Paper            | Here                                                  |
// | ---------------- | ----------------------------------------------------- |
// | μ, φ             | scaledRating, scaledDeviation                         |
// | g(φ)             | opponentWeight                                        |
// | v                | outcomeVariance                                       |
// | Σ g(φⱼ)(sⱼ − E)  | performanceVsExpectation                              |
// | Δ                | estimatedImprovement                                  |
// | σ′               | newVolatility (solved by solveNewVolatility)          |
// | a, f(x)          | startingLogVariance, volatilityObjective(candidate)   |
// | A, B, C          | bracketStart, bracketEnd, estimate                    |
// | f(A), f(B), f(C) | objectiveAtStart, objectiveAtEnd, objectiveAtEstimate |
// | k                | stepsBelow                                            |
// | φ*, φ′, μ′       | deviationBeforeGames, newScaledDeviation,             |
// |                  | newScaledRating                                       |
// | τ                | volatilityConstraint, VOLATILITY_CONSTRAINT           |
// |__________________________________________________________________________|

import { STARTING_DEVIATION } from '../users/entities/rating.entity.js';

export interface Glicko2Rating {
  rating: number;
  deviation: number;
  volatility: number;
}

export type GameScore = 1 | 0.5 | 0;

export interface Glicko2Result {
  opponent: Glicko2Rating;
  score: GameScore;
}

export interface Glicko2Options {
  volatilityConstraint: number;
  elapsedRatingPeriods?: number;
  minDeviation?: number;
  maxDeviation?: number;
}

export const VOLATILITY_CONSTRAINT = 0.5;
export const RATING_PERIOD_DAYS = 5;
export const MIN_DEVIATION = 45;

const GLICKO2_SCALE = 173.7178;
const RATING_SCALE_CENTER = 1500;
const CONVERGENCE_TOLERANCE = 0.000001;
const DAY_MS = 24 * 60 * 60 * 1000;

function toGlicko2Scale({ rating, deviation }: Glicko2Rating) {
  return {
    scaledRating: (rating - RATING_SCALE_CENTER) / GLICKO2_SCALE,
    scaledDeviation: deviation / GLICKO2_SCALE,
  };
}

function opponentWeight(opponentScaledDeviation: number): number {
  return (
    1 / Math.sqrt(1 + (3 * opponentScaledDeviation ** 2) / (Math.PI * Math.PI))
  );
}

function expectedScore(
  scaledRating: number,
  opponentScaledRating: number,
  opponentScaledDeviation: number,
): number {
  return (
    1 /
    (1 +
      Math.exp(
        -opponentWeight(opponentScaledDeviation) *
          (scaledRating - opponentScaledRating),
      ))
  );
}

function solveNewVolatility(
  volatility: number,
  scaledDeviation: number,
  outcomeVariance: number,
  estimatedImprovement: number,
  volatilityConstraint: number,
): number {
  const startingLogVariance = Math.log(volatility ** 2);
  const deviationAndOutcomeVariance = scaledDeviation ** 2 + outcomeVariance;
  const volatilityObjective = (candidate: number) =>
    (Math.exp(candidate) *
      (estimatedImprovement ** 2 -
        deviationAndOutcomeVariance -
        Math.exp(candidate))) /
      (2 * (deviationAndOutcomeVariance + Math.exp(candidate)) ** 2) -
    (candidate - startingLogVariance) / volatilityConstraint ** 2;

  let bracketStart = startingLogVariance;
  let bracketEnd: number;
  if (estimatedImprovement ** 2 > deviationAndOutcomeVariance) {
    bracketEnd = Math.log(
      estimatedImprovement ** 2 - deviationAndOutcomeVariance,
    );
  } else {
    let stepsBelow = 1;
    while (
      volatilityObjective(
        startingLogVariance - stepsBelow * volatilityConstraint,
      ) < 0
    ) {
      stepsBelow += 1;
    }
    bracketEnd = startingLogVariance - stepsBelow * volatilityConstraint;
  }

  let objectiveAtStart = volatilityObjective(bracketStart);
  let objectiveAtEnd = volatilityObjective(bracketEnd);
  while (Math.abs(bracketEnd - bracketStart) > CONVERGENCE_TOLERANCE) {
    const estimate =
      bracketStart +
      ((bracketStart - bracketEnd) * objectiveAtStart) /
        (objectiveAtEnd - objectiveAtStart);
    const objectiveAtEstimate = volatilityObjective(estimate);
    if (objectiveAtEstimate * objectiveAtEnd <= 0) {
      bracketStart = bracketEnd;
      objectiveAtStart = objectiveAtEnd;
    } else {
      objectiveAtStart /= 2;
    }
    bracketEnd = estimate;
    objectiveAtEnd = objectiveAtEstimate;
  }
  return Math.exp(bracketStart / 2);
}

export function updateRating(
  player: Glicko2Rating,
  results: Glicko2Result[],
  {
    volatilityConstraint,
    elapsedRatingPeriods = 1,
    minDeviation = 0,
    maxDeviation = Infinity,
  }: Glicko2Options,
): Glicko2Rating {
  const { scaledRating, scaledDeviation } = toGlicko2Scale(player);
  const maxScaledDeviation = maxDeviation / GLICKO2_SCALE;
  const deviationBeforeGames = (volatility: number) =>
    Math.min(
      Math.sqrt(scaledDeviation ** 2 + elapsedRatingPeriods * volatility ** 2),
      maxScaledDeviation,
    );

  if (results.length === 0) {
    return {
      rating: player.rating,
      deviation: deviationBeforeGames(player.volatility) * GLICKO2_SCALE,
      volatility: player.volatility,
    };
  }

  const games = results.map(({ opponent, score }) => {
    const opponentScaled = toGlicko2Scale(opponent);
    return {
      weight: opponentWeight(opponentScaled.scaledDeviation),
      expected: expectedScore(
        scaledRating,
        opponentScaled.scaledRating,
        opponentScaled.scaledDeviation,
      ),
      score,
    };
  });

  const outcomeVariance =
    1 /
    games.reduce(
      (sum, { weight, expected }) =>
        sum + weight ** 2 * expected * (1 - expected),
      0,
    );
  const performanceVsExpectation = games.reduce(
    (sum, { weight, expected, score }) => sum + weight * (score - expected),
    0,
  );
  const estimatedImprovement = outcomeVariance * performanceVsExpectation;

  const newVolatility = solveNewVolatility(
    player.volatility,
    scaledDeviation,
    outcomeVariance,
    estimatedImprovement,
    volatilityConstraint,
  );
  const scaledDeviationBeforeGames = deviationBeforeGames(newVolatility);
  const newScaledDeviation =
    1 / Math.sqrt(1 / scaledDeviationBeforeGames ** 2 + 1 / outcomeVariance);
  const newScaledRating =
    scaledRating + newScaledDeviation ** 2 * performanceVsExpectation;

  return {
    rating: newScaledRating * GLICKO2_SCALE + RATING_SCALE_CENTER,
    deviation: Math.max(newScaledDeviation * GLICKO2_SCALE, minDeviation),
    volatility: newVolatility,
  };
}

export function ratingPeriodsBetween(
  lastRatedAt: Date | null,
  now: Date,
): number {
  if (!lastRatedAt) return 1;
  return (
    (now.getTime() - lastRatedAt.getTime()) / (RATING_PERIOD_DAYS * DAY_MS)
  );
}

export function rateGame(
  player: Glicko2Rating,
  opponent: Glicko2Rating,
  score: GameScore,
  elapsedRatingPeriods: number,
): Glicko2Rating {
  return updateRating(player, [{ opponent, score }], {
    volatilityConstraint: VOLATILITY_CONSTRAINT,
    elapsedRatingPeriods,
    minDeviation: MIN_DEVIATION,
    maxDeviation: STARTING_DEVIATION,
  });
}
