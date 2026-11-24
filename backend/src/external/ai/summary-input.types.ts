export interface SummaryInput {
  kind: string;
  changedFields: Record<string, { from: string; to: string }>;
}
