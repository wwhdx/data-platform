/** 重复率 = skippedDuplicate / fetched（dedup 命中已有 source+externalId） */
export function duplicateRatio(fetched: number, skippedDuplicate: number): number {
  if (fetched <= 0) return 0;
  return skippedDuplicate / fetched;
}

export function isDuplicateScan(opts: {
  fetched: number;
  inserted: number;
  skippedDuplicate: number;
  minFetched: number;
  ratioThreshold: number;
}): boolean {
  return (
    opts.fetched >= opts.minFetched &&
    opts.inserted === 0 &&
    duplicateRatio(opts.fetched, opts.skippedDuplicate) >= opts.ratioThreshold
  );
}

/** 本批是否「全重复」（0 新入库且跳过数 = 批大小） */
export function isFullDuplicateBatch(
  batchSize: number,
  insertedInBatch: number,
  skippedInBatch: number,
): boolean {
  return batchSize > 0 && insertedInBatch === 0 && skippedInBatch === batchSize;
}

export function nextConsecutiveDupBatches(
  prev: number,
  batchSize: number,
  insertedInBatch: number,
  skippedInBatch: number,
): number {
  return isFullDuplicateBatch(batchSize, insertedInBatch, skippedInBatch)
    ? prev + 1
    : 0;
}
