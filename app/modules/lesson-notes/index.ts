import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { describeDraft, type NoteDraftStatus } from "./lib/draft";

export type { NoteDraftStatus };

/**
 * What the note editor shows about the text in the box: its length against
 * the limit, whether it differs from the saved note, and whether Save can run.
 */
export function noteDraftStatus(
  draft: string,
  savedBody: string | null
): NoteDraftStatus {
  return describeDraft(draft, savedBody, MAX_NOTE_LENGTH);
}
