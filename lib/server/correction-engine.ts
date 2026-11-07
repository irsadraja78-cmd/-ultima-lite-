import type { ReferenceScope } from "@/lib/server/reference-scope";

export type VerificationStatus =
  | "correct"
  | "incorrect"
  | "warning"
  | "missing"
  | "anomaly"
  | "unable_to_verify";

export type VerificationItem = {
  referenceRow: number | null;
  gridRow: number | null;
  status: VerificationStatus;
  score: number;
  referenceData: string[];
  gridData: string[];
  reason: string;
};

export type CorrectionReport = {
  status: VerificationStatus;
  referenceRows: number;
  gridRows: number;
  matchedRows: number;
  correct: number;
  incorrect: number;
  warning: number;
  missing: number;
  anomaly: number;
  unableToVerify: number;
  coverage: number;
  items: VerificationItem[];
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[\s,;|:/\\()[\]{}<>+=*_"'`.-]+/)
    .filter(Boolean);
}

function contentTokens(row: string[]): string[] {
  return row.flatMap((cell) => tokens(cell));
}

function tokenSimilarity(a: string, b: string): number {
  const aa = tokens(a);
  const bb = tokens(b);

  if (!aa.length || !bb.length) {
    return 0;
  }

  const setA = new Set(aa);
  const setB = new Set(bb);

  let common = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      common++;
    }
  }

  const union = new Set([...aa, ...bb]).size;

  return union ? common / union : 0;
}

function rowContentSimilarity(
  reference: string[],
  grid: string[],
): number {
  const refTokens = contentTokens(reference);
  const gridTokens = contentTokens(grid);

  if (!refTokens.length || !gridTokens.length) {
    return 0;
  }

  const refSet = new Set(refTokens);
  const gridSet = new Set(gridTokens);

  let common = 0;

  for (const token of refSet) {
    if (gridSet.has(token)) {
      common++;
    }
  }

  const union = new Set([
    ...refTokens,
    ...gridTokens,
  ]).size;

  return union > 0 ? common / union : 0;
}

function cellSimilarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (
    left.includes(right) ||
    right.includes(left)
  ) {
    return 0.92;
  }

  return tokenSimilarity(left, right);
}

function rowSimilarity(
  reference: string[],
  grid: string[],
): number {
  const contentScore =
    rowContentSimilarity(reference, grid);

  if (contentScore >= 0.99) {
    return 1;
  }

  /*
   * When the source and worker use different column layouts,
   * compare the complete row content rather than requiring
   * the same value to exist at the same column position.
   */
  const refCells = reference
    .map(normalize)
    .filter(Boolean);

  const gridCells = grid
    .map(normalize)
    .filter(Boolean);

  if (!refCells.length || !gridCells.length) {
    return contentScore;
  }

  let matched = 0;

  const used = new Set<number>();

  for (const refCell of refCells) {
    let best = 0;
    let bestIndex = -1;

    for (
      let i = 0;
      i < gridCells.length;
      i++
    ) {
      if (used.has(i)) {
        continue;
      }

      const score =
        cellSimilarity(refCell, gridCells[i]);

      if (score > best) {
        best = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched += best;
    }
  }

  const cellScore =
    matched /
    Math.max(refCells.length, gridCells.length);

  /*
   * Content similarity is primary because it works when
   * multiple source columns are combined into one worker cell.
   */
  return Math.max(
    contentScore,
    cellScore * 0.85,
  );
}

function isEmptyRow(row: string[]): boolean {
  return !row.some((cell) => normalize(cell));
}

function looksLikeHeader(row: string[]): boolean {
  const values = row
    .map(normalize)
    .filter(Boolean);

  if (!values.length) {
    return false;
  }

  let textLike = 0;

  for (const value of values) {
    if (
      /[a-zA-Z\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0b00-\u0b7f\u0c00-\u0c7f\u0d00-\u0d7f]/u.test(
        value,
      ) &&
      !/^\d+(?:[.,]\d+)?$/.test(value)
    ) {
      textLike++;
    }
  }

  return (
    textLike === values.length &&
    values.length <= 20
  );
}

function classifyScore(
  score: number,
): VerificationStatus {
  if (score >= 0.85) {
    return "correct";
  }

  if (score >= 0.55) {
    return "warning";
  }

  return "incorrect";
}

export function verifyGridAgainstReference(
  scope: ReferenceScope,
  gridRows: string[][],
): CorrectionReport {
  const referenceRows = scope.records.filter(
    (row) => !isEmptyRow(row),
  );

  const workerRows = gridRows.filter(
    (row) => !isEmptyRow(row),
  );

  if (
    scope.confidence <= 0 ||
    referenceRows.length === 0
  ) {
    return {
      status: "unable_to_verify",
      referenceRows: 0,
      gridRows: workerRows.length,
      matchedRows: 0,
      correct: 0,
      incorrect: 0,
      warning: 0,
      missing: 0,
      anomaly: workerRows.length,
      unableToVerify: 1,
      coverage: 0,
      items: [
        {
          referenceRow: null,
          gridRow: null,
          status: "unable_to_verify",
          score: 0,
          referenceData: [],
          gridData: [],
          reason:
            "The reference document could not provide verifiable structured data.",
        },
      ],
    };
  }

  const usedGridRows = new Set<number>();
  const items: VerificationItem[] = [];

  let correct = 0;
  let incorrect = 0;
  let warning = 0;
  let missing = 0;

  for (
    let referenceIndex = 0;
    referenceIndex < referenceRows.length;
    referenceIndex++
  ) {
    const referenceRow =
      referenceRows[referenceIndex];

    let bestScore = 0;
    let bestGridIndex = -1;

    for (
      let gridIndex = 0;
      gridIndex < workerRows.length;
      gridIndex++
    ) {
      if (usedGridRows.has(gridIndex)) {
        continue;
      }

      const score = rowSimilarity(
        referenceRow,
        workerRows[gridIndex],
      );

      if (score > bestScore) {
        bestScore = score;
        bestGridIndex = gridIndex;
      }
    }

    const referenceHeader =
      referenceIndex === 0 &&
      looksLikeHeader(referenceRow);

    const workerHeader =
      bestGridIndex === 0 &&
      looksLikeHeader(
        workerRows[bestGridIndex] ?? [],
      );

    /*
     * Different header names/layouts are allowed.
     * If both sides clearly look like headers, keep the
     * structural row matched and mark it as a warning
     * when semantic overlap is low.
     */
    if (
      referenceHeader &&
      workerHeader &&
      bestGridIndex >= 0 &&
      bestScore < 0.35
    ) {
      usedGridRows.add(bestGridIndex);
      warning++;

      items.push({
        referenceRow: referenceIndex,
        gridRow: bestGridIndex,
        status: "warning",
        score: Math.round(bestScore * 100) / 100,
        referenceData: referenceRow,
        gridData: workerRows[bestGridIndex],
        reason:
          "The reference and worker-grid header use different labels or structure; data rows can still be verified independently.",
      });

      continue;
    }

    if (
      bestGridIndex < 0 ||
      bestScore < 0.35
    ) {
      missing++;

      items.push({
        referenceRow: referenceIndex,
        gridRow: null,
        status: "missing",
        score:
          Math.round(bestScore * 100) / 100,
        referenceData: referenceRow,
        gridData: [],
        reason:
          "No sufficiently similar worker-grid row was found for this reference row.",
      });

      continue;
    }

    usedGridRows.add(bestGridIndex);

    const status =
      classifyScore(bestScore);

    if (status === "correct") {
      correct++;
    } else if (status === "warning") {
      warning++;
    } else {
      incorrect++;
    }

    items.push({
      referenceRow: referenceIndex,
      gridRow: bestGridIndex,
      status,
      score:
        Math.round(bestScore * 100) / 100,
      referenceData: referenceRow,
      gridData: workerRows[bestGridIndex],
      reason:
        status === "correct"
          ? "Reference and worker-grid row contain strongly consistent data, even when their column layout differs."
          : status === "warning"
            ? "Reference and worker-grid row contain partially consistent data and require review."
            : "Worker-grid row does not sufficiently match the reference row.",
    });
  }

  let anomaly = 0;

  for (
    let gridIndex = 0;
    gridIndex < workerRows.length;
    gridIndex++
  ) {
    if (usedGridRows.has(gridIndex)) {
      continue;
    }

    anomaly++;

    items.push({
      referenceRow: null,
      gridRow: gridIndex,
      status: "anomaly",
      score: 0,
      referenceData: [],
      gridData: workerRows[gridIndex],
      reason:
        "This worker-grid row has no corresponding reference row.",
    });
  }

  const matchedRows =
    correct + incorrect + warning;

  const coverage =
    referenceRows.length > 0
      ? matchedRows / referenceRows.length
      : 0;

  let status: VerificationStatus = "correct";

  if (
    missing > 0 ||
    incorrect > 0 ||
    anomaly > 0
  ) {
    status = "incorrect";
  } else if (warning > 0) {
    status = "warning";
  }

  return {
    status,
    referenceRows: referenceRows.length,
    gridRows: workerRows.length,
    matchedRows,
    correct,
    incorrect,
    warning,
    missing,
    anomaly,
    unableToVerify: 0,
    coverage:
      Math.round(coverage * 100) / 100,
    items,
  };
}
