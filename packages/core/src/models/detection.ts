/** A single detection/rewrite event recorded in detection_history.json. */
export interface DetectionHistoryEntry {
  readonly sectionNumber: string;
  readonly timestamp: string;
  readonly provider: string;
  readonly score: number;
  readonly action: "detect" | "rewrite";
  readonly attempt: number;
}

/** Aggregated detection statistics for a paper. */
export interface DetectionStats {
  readonly totalDetections: number;
  readonly totalRewrites: number;
  readonly avgOriginalScore: number;
  readonly avgFinalScore: number;
  readonly avgScoreReduction: number;
  readonly passRate: number;
  readonly sectionBreakdown: ReadonlyArray<{
    readonly sectionNumber: string;
    readonly originalScore: number;
    readonly finalScore: number;
    readonly rewriteAttempts: number;
  }>;
}
