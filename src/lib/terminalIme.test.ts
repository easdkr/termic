import { describe, expect, it } from "vitest";
import { committedImeText, isImeKeyboardEvent, terminalKeyData } from "./terminalIme";

function keyEvent(init: Partial<KeyboardEvent> & { keyCode?: number; which?: number }) {
  return init as KeyboardEvent;
}

describe("terminal IME helpers", () => {
  const term = { modes: { applicationCursorKeysMode: false } } as any;

  it("detects legacy IME composition key events", () => {
    expect(isImeKeyboardEvent(keyEvent({ key: "Process" }))).toBe(true);
    expect(isImeKeyboardEvent(keyEvent({ key: "a", keyCode: 229 }))).toBe(true);
    expect(isImeKeyboardEvent(keyEvent({ key: "a", which: 229 }))).toBe(true);
  });

  it("does not treat normal key events as IME composition", () => {
    expect(isImeKeyboardEvent(keyEvent({ key: "a" }))).toBe(false);
    expect(isImeKeyboardEvent(keyEvent({ key: "Enter" }))).toBe(false);
  });

  it("extracts committed IME text from textarea value when available", () => {
    expect(committedImeText("prompt ", "prompt 한글", "한")).toBe("한글");
  });

  it("falls back to compositionend data when textarea diff is empty", () => {
    expect(committedImeText("prompt ", "prompt ", "한")).toBe("한");
  });

  it("maps terminal editing shortcuts that xterm previously handled", () => {
    expect(terminalKeyData(keyEvent({ key: "Backspace", metaKey: true }), term)).toBe("\x15");
    expect(terminalKeyData(keyEvent({ key: "Backspace", altKey: true }), term)).toBe("\x17");
    expect(terminalKeyData(keyEvent({ key: "ArrowLeft", metaKey: true }), term)).toBe("\x01");
    expect(terminalKeyData(keyEvent({ key: "c", ctrlKey: true }), term)).toBe("\x03");
  });
});
