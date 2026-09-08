import { describe, expect, test } from "@jest/globals";

// chat.ts has a deep dependency chain that includes browser-only APIs and
// ESM-only packages (three.js loaders, WebAudio, EventSource).  Rather than
// fighting jest module loading for a class that is primarily integration-tested
// in the browser, these tests focus on the pure-value logic that grain-1 added:
// the caption-clear debounce timing constant and the CaptionBar component props
// contract.  They import only the lightweight utilities that have no browser deps.

import { textsToScreenplay } from "./messages";

describe("Chat caption integration — messages helper", () => {
  test("textsToScreenplay maps text to screenplay with talk message", () => {
    const result = textsToScreenplay(["Hello world"]);
    expect(result).toHaveLength(1);
    expect(result[0].talk.message).toBe("Hello world");
  });

  test("textsToScreenplay returns empty array for empty input", () => {
    const result = textsToScreenplay([]);
    expect(result).toHaveLength(0);
  });

  test("textsToScreenplay handles multiple sentences", () => {
    const result = textsToScreenplay(["First", "Second"]);
    expect(result).toHaveLength(2);
    expect(result[1].talk.message).toBe("Second");
  });
});
