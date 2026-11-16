export type NoteDraftStatus = {
  length: number;
  maxLength: number;
  tooLong: boolean;
  empty: boolean;
  unsaved: boolean;
  canSave: boolean;
};

export function describeDraft(
  draft: string,
  savedBody: string | null,
  maxLength: number
): NoteDraftStatus {
  // saveNote trims the body before it checks the limit and stores it, so
  // whitespace at either end is neither counted nor a change.
  const kept = draft.trim();
  const length = kept.length;
  const tooLong = length > maxLength;
  const empty = length === 0;
  const unsaved = kept !== (savedBody ?? "");
  return {
    length,
    maxLength,
    tooLong,
    empty,
    unsaved,
    canSave: unsaved && !empty && !tooLong,
  };
}
