export interface TokenItem<T> {
  id: string;
  tokens: number;
  payload: T;
}

export function groupByTokenBudget<T>(items: TokenItem<T>[], budget: number): TokenItem<T>[][] {
  const batches: TokenItem<T>[][] = [];
  let current: TokenItem<T>[] = [];
  let total = 0;

  for (const item of items) {
    if (item.tokens > budget) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
        total = 0;
      }
      batches.push([item]);
      continue;
    }

    if (total + item.tokens > budget && current.length > 0) {
      batches.push(current);
      current = [];
      total = 0;
    }

    current.push(item);
    total += item.tokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}
