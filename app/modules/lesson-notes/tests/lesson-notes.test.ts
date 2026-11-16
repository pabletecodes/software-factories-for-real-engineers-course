import { describe, it, expect } from "vitest";
import { noteDraftStatus } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("noteDraftStatus", () => {
  it("cannot save an empty box when there is no note", () => {
    expect(noteDraftStatus("", null)).toEqual({
      length: 0,
      maxLength: MAX_NOTE_LENGTH,
      tooLong: false,
      empty: true,
      unsaved: false,
      canSave: false,
    });
  });

  it("treats whitespace as empty", () => {
    const status = noteDraftStatus("   \n ", null);
    expect(status.empty).toBe(true);
    expect(status.canSave).toBe(false);
  });

  it("ignores whitespace the save would trim away", () => {
    const status = noteDraftStatus("same  \n", "same");
    expect(status.unsaved).toBe(false);
    expect(status.canSave).toBe(false);
  });

  it("can save new text", () => {
    const status = noteDraftStatus("Generics are functions for types", null);
    expect(status.length).toBe(32);
    expect(status.unsaved).toBe(true);
    expect(status.canSave).toBe(true);
  });

  it("has nothing to save when the box matches the saved note", () => {
    const status = noteDraftStatus("same", "same");
    expect(status.unsaved).toBe(false);
    expect(status.canSave).toBe(false);
  });

  it("can save an edit to the saved note", () => {
    const status = noteDraftStatus("same, edited", "same");
    expect(status.unsaved).toBe(true);
    expect(status.canSave).toBe(true);
  });

  it("allows exactly the limit", () => {
    const status = noteDraftStatus("a".repeat(MAX_NOTE_LENGTH), null);
    expect(status.tooLong).toBe(false);
    expect(status.canSave).toBe(true);
  });

  it("refuses one character over the limit", () => {
    const status = noteDraftStatus("a".repeat(MAX_NOTE_LENGTH + 1), null);
    expect(status.tooLong).toBe(true);
    expect(status.canSave).toBe(false);
  });
});
