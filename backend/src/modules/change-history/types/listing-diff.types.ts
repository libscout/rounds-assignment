import type { ChangeKind } from './change-kind.enum';
import type { ChangedFields } from './changed-fields.types';
export interface ListingDiff {
  kind: ChangeKind;
  changedFields: ChangedFields;
}
