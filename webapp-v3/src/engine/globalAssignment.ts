import { BoardState } from '../board/board';
import { PIECE_CLASS_COUNT, PIECE_LABELS } from '../constants';
import { DEFAULT_ASSIGNMENT_CONFIG } from './mappingConfig';
import type {
  AssignmentConfig,
  AssignmentDiagnostics,
  Detection,
  DetectionCandidateSet,
  MappingResult,
  PieceAssignmentSummary,
  PieceMapping,
  UncertainMatch,
} from '../types';

type CandidateOption = {
  pieceIndex: number;
  detectionIndex: number;
  candidateIndex: number;
  score: number;
};

function isUncertain(option: CandidateOption, set: DetectionCandidateSet, config: AssignmentConfig): boolean {
  const candidate = set.candidates[option.candidateIndex];
  return (
    candidate.score < config.uncertainScoreThreshold ||
    candidate.distanceBoardUnits > config.uncertainDistanceThreshold
  );
}

function buildPieceSummaries(
  candidateSets: DetectionCandidateSet[],
  bestAssignments: Map<number, CandidateOption | null>,
  setByDetection: Map<number, DetectionCandidateSet>,
  config: AssignmentConfig,
): PieceAssignmentSummary[] {
  const pieceKeys = Array.from(new Set(candidateSets.map(s => s.pieceIndex))).sort((a, b) => a - b);

  return pieceKeys.map(pieceIndex => {
    const setsForPiece = candidateSets.filter(s => s.pieceIndex === pieceIndex);
    let bestTop = setsForPiece[0]?.candidates[0] ?? null;
    for (const set of setsForPiece) {
      const head = set.candidates[0];
      if (!head) continue;
      if (!bestTop || head.score > bestTop.score) bestTop = head;
    }

    const selected = bestAssignments.get(pieceIndex) ?? null;
    const selectedSet = selected ? setByDetection.get(selected.detectionIndex) : undefined;
    const selectedCandidate = selected && selectedSet
      ? selectedSet.candidates[selected.candidateIndex] ?? null
      : null;
    const selectedUncertain = selected && selectedSet
      ? isUncertain(selected, selectedSet, config)
      : false;

    return {
      pieceIndex,
      pieceLabel: PIECE_LABELS[pieceIndex] ?? String(pieceIndex),
      candidateCount: setsForPiece.reduce((sum, set) => sum + set.candidates.length, 0),
      topScore: bestTop?.score ?? 0,
      topIou: bestTop?.iou ?? 0,
      topRecall: bestTop?.recall ?? 0,
      topSpanFit: bestTop?.spanFit ?? 0,
      selectedScore: selectedCandidate?.score ?? null,
      selectedRecall: selectedCandidate?.recall ?? null,
      selectedUncertain,
    };
  });
}

function buildBoardFromMappings(mappings: PieceMapping[]): BoardState {
  const board = new BoardState();
  for (const m of mappings) {
    if (m.placement && board.areFree(m.placement.positions)) {
      board.place(m.placement.positions, m.placement.pieceIndex);
    }
  }
  return board;
}

export function optimizeGlobalAssignments(
  detections: Detection[],
  candidateSets: DetectionCandidateSet[],
  config: AssignmentConfig = DEFAULT_ASSIGNMENT_CONFIG,
): MappingResult {
  const pieceDetections = detections
    .map((detection, detectionIndex) => ({ detection, detectionIndex }))
    .filter(({ detection }) => detection.classId < PIECE_CLASS_COUNT);

  const setByDetection = new Map<number, DetectionCandidateSet>();
  const optionsByPiece = new Map<number, CandidateOption[]>();

  for (const set of candidateSets) {
    setByDetection.set(set.detectionIndex, set);
    if (!optionsByPiece.has(set.pieceIndex)) optionsByPiece.set(set.pieceIndex, []);

    const options = optionsByPiece.get(set.pieceIndex)!;
    for (let candidateIndex = 0; candidateIndex < set.candidates.length; candidateIndex++) {
      options.push({
        pieceIndex: set.pieceIndex,
        detectionIndex: set.detectionIndex,
        candidateIndex,
        score: set.candidates[candidateIndex].score,
      });
    }
  }

  for (const options of optionsByPiece.values()) {
    options.sort((a, b) => b.score - a.score);
  }

  const pieces = Array.from(optionsByPiece.keys()).sort((a, b) => {
    return (optionsByPiece.get(a)?.length ?? 0) - (optionsByPiece.get(b)?.length ?? 0);
  });

  if (pieces.length === 0) {
    return {
      mappings: pieceDetections.map(({ detection }) => ({
        detection,
        placement: null,
        pinIndices: [],
        confidence: detection.confidence,
      })),
      boardState: new BoardState(),
      diagnostics: {
        mode: 'global',
        elapsedMs: 0,
        statesExplored: 0,
        branchesPrunedNoFit: 0,
        branchesPrunedOpenSpace: 0,
        timedOut: false,
        usedFallback: false,
        uncertainCount: 0,
        pieceSummaries: [],
        reason: 'No piece candidates to optimize',
      },
      pendingUncertainMappings: null,
    };
  }

  const start = performance.now();
  let timedOut = false;
  let statesExplored = 0;
  let branchesPrunedNoFit = 0;
  let branchesPrunedOpenSpace = 0;
  let bestScore = -Infinity;
  let bestAssignments = new Map<number, CandidateOption | null>();

  const board = new BoardState();
  const usedDetections = new Set<number>();
  const currentAssignments = new Map<number, CandidateOption | null>();

  function getFeasibleOptions(pieceIndex: number): CandidateOption[] {
    const options = optionsByPiece.get(pieceIndex) ?? [];
    const feasible: CandidateOption[] = [];

    for (const option of options) {
      if (usedDetections.has(option.detectionIndex)) {
        branchesPrunedNoFit++;
        continue;
      }

      const set = setByDetection.get(option.detectionIndex);
      if (!set) {
        branchesPrunedNoFit++;
        continue;
      }

      const candidate = set.candidates[option.candidateIndex];
      if (!candidate || candidate.recall < config.minPlacementRecall) {
        branchesPrunedNoFit++;
        continue;
      }

      if (!board.areFree(candidate.placement.positions)) {
        branchesPrunedNoFit++;
        continue;
      }

      feasible.push(option);
    }

    feasible.sort((a, b) => b.score - a.score);
    return feasible;
  }

  function pickNextPiece(remainingPieces: number[]): { pieceIndex: number; feasible: CandidateOption[] } {
    let bestPiece = remainingPieces[0];
    let bestOptions = getFeasibleOptions(bestPiece);

    for (let i = 1; i < remainingPieces.length; i++) {
      const pieceIndex = remainingPieces[i];
      const options = getFeasibleOptions(pieceIndex);
      if (options.length < bestOptions.length) {
        bestPiece = pieceIndex;
        bestOptions = options;
      }
    }

    return { pieceIndex: bestPiece, feasible: bestOptions };
  }

  function search(remainingPieces: number[], score: number): void {
    if (performance.now() - start > config.timeoutMs) {
      timedOut = true;
      return;
    }

    if (remainingPieces.length === 0) {
      statesExplored++;
      if (score > bestScore) {
        bestScore = score;
        bestAssignments = new Map(currentAssignments);
      }
      return;
    }

    const { pieceIndex, feasible } = pickNextPiece(remainingPieces);
    const nextPieces = remainingPieces.filter(p => p !== pieceIndex);

    for (const option of feasible) {
      const set = setByDetection.get(option.detectionIndex);
      if (!set) continue;

      const candidate = set.candidates[option.candidateIndex];
      if (!candidate) continue;

      usedDetections.add(option.detectionIndex);
      board.place(candidate.placement.positions, pieceIndex);

      if (config.enableOpenSpacePruning && !board.checkOpenSpace()) {
        branchesPrunedOpenSpace++;
        board.remove(candidate.placement.positions);
        usedDetections.delete(option.detectionIndex);
        continue;
      }

      currentAssignments.set(pieceIndex, option);
      search(nextPieces, score + option.score);

      currentAssignments.set(pieceIndex, null);
      board.remove(candidate.placement.positions);
      usedDetections.delete(option.detectionIndex);

      if (timedOut) return;
    }

    currentAssignments.set(pieceIndex, null);
    search(nextPieces, score + config.unmatchedPenalty);
  }

  search(pieces, 0);

  const fullMappings: PieceMapping[] = [];
  const safeMappings: PieceMapping[] = [];
  const uncertain: UncertainMatch[] = [];

  for (const { detection, detectionIndex } of pieceDetections) {
    const picked = bestAssignments.get(detection.classId) ?? null;

    if (!picked || picked.detectionIndex !== detectionIndex) {
      const emptyMapping: PieceMapping = {
        detection,
        placement: null,
        pinIndices: [],
        confidence: detection.confidence,
      };
      fullMappings.push(emptyMapping);
      safeMappings.push(emptyMapping);
      continue;
    }

    const set = setByDetection.get(picked.detectionIndex);
    const candidate = set?.candidates[picked.candidateIndex];

    if (!candidate) {
      const emptyMapping: PieceMapping = {
        detection,
        placement: null,
        pinIndices: [],
        confidence: detection.confidence,
      };
      fullMappings.push(emptyMapping);
      safeMappings.push(emptyMapping);
      continue;
    }

    const full: PieceMapping = {
      detection,
      placement: candidate.placement,
      pinIndices: candidate.pinIndices,
      confidence: detection.confidence,
      distanceBoardUnits: candidate.distanceBoardUnits,
    };

    fullMappings.push(full);

    const optionUncertain = isUncertain(picked, set!, config);
    if (optionUncertain && config.requireManualForUncertain) {
      uncertain.push({
        detectionIndex,
        pieceIndex: detection.classId,
        score: candidate.score,
        distanceBoardUnits: candidate.distanceBoardUnits,
      });
      safeMappings.push({
        detection,
        placement: null,
        pinIndices: [],
        confidence: detection.confidence,
        distanceBoardUnits: candidate.distanceBoardUnits,
      });
    } else {
      safeMappings.push(full);
    }
  }

  const elapsedMs = performance.now() - start;
  const pieceSummaries = buildPieceSummaries(candidateSets, bestAssignments, setByDetection, config);

  const diagnostics: AssignmentDiagnostics = {
    mode: 'global',
    elapsedMs,
    statesExplored,
    branchesPrunedNoFit,
    branchesPrunedOpenSpace,
    timedOut,
    usedFallback: false,
    uncertainCount: uncertain.length,
    pieceSummaries,
    reason: timedOut ? 'Global assignment timed out' : undefined,
  };

  return {
    mappings: safeMappings,
    boardState: buildBoardFromMappings(safeMappings),
    diagnostics,
    pendingUncertainMappings: uncertain.length > 0 ? fullMappings : null,
  };
}
