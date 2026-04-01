import type { AssignmentConfig } from '../types';

export const DEFAULT_ASSIGNMENT_CONFIG: AssignmentConfig = {
  mode: 'global',
  topKCandidates: 5,
  maxCandidateDistance: 3.0,
  minTemplateIoU: 0.05,
  minPlacementRecall: 0.34,
  confidenceWeight: 1.0,
  iouWeight: 2.4,
  precisionWeight: 1.1,
  recallWeight: 1.3,
  sizeWeight: 0.8,
  spanWeight: 1.2,
  pinCountWeight: 0.6,
  distanceWeight: 0.25,
  invalidCellPenalty: 1.0,
  enableOpenSpacePruning: true,
  timeoutMs: 2500,
  uncertainScoreThreshold: 0.3,
  uncertainDistanceThreshold: 0.7,
  unmatchedPenalty: -0.2,
  requireManualForUncertain: true,
};
