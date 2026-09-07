import { describe, expect, test } from "@jest/globals";
import { Screenplay } from "../src/features/chat/messages";
import {
  CaptionChunk,
  findCaptionChunkIndex,
  splitReplyIntoCaptionChunks,
} from "../src/utils/captionChunks";

describe("splitReplyIntoCaptionChunks", () => {
  test("splits a reply into one caption per sentence, in playback order", () => {
    const { chunks, remainder } = splitReplyIntoCaptionChunks(
      "Hello there. How are you? I am fine!",
    );

    expect(chunks.map((c) => c.text)).toEqual([
      "Hello there.",
      "How are you?",
      "I am fine!",
    ]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(remainder).toBe("");
  });

  test("pairs each sentence with the TTS chunk that speaks it", () => {
    const { chunks } = splitReplyIntoCaptionChunks("First one. Second one.");

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.screenplay.talk.message.trim()).toBe(chunk.text);
      expect(chunk.screenplay.talk.style).toBe("talk");
    }
  });

  test("carries the emotion tag onto the TTS chunk but not into the caption", () => {
    const { chunks } = splitReplyIntoCaptionChunks(
      "[happy] Good news. It worked.",
    );

    expect(chunks.map((c) => c.text)).toEqual(["Good news.", "It worked."]);
    expect(chunks.map((c) => c.screenplay.expression)).toEqual([
      "happy",
      "happy",
    ]);
  });

  test("keeps role play direction out of the captions", () => {
    const { chunks } = splitReplyIntoCaptionChunks(
      "*smiling nervously* I guess so.",
    );

    expect(chunks.map((c) => c.text)).toEqual(["I guess so."]);
  });

  test("gives reasoning output no caption because it is never spoken", () => {
    const { chunks } = splitReplyIntoCaptionChunks(
      "<think>They asked about the weather.</think>It is sunny today.",
    );

    expect(chunks.map((c) => c.text)).toEqual(["It is sunny today."]);
  });

  test("splits long clauses on commas, like the TTS pipeline does", () => {
    const { chunks } = splitReplyIntoCaptionChunks(
      "Well I suppose that depends, but I am not sure.",
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join(" ")).toBe(
      "Well I suppose that depends, but I am not sure.",
    );
  });

  test("returns trailing text with no terminator as remainder, uncaptioned", () => {
    const { chunks, remainder } = splitReplyIntoCaptionChunks(
      "Done here. and then",
    );

    expect(chunks.map((c) => c.text)).toEqual(["Done here."]);
    expect(remainder).toBe("and then");
  });

  test("produces no captions for empty or whitespace-only replies", () => {
    expect(splitReplyIntoCaptionChunks("")).toEqual({
      chunks: [],
      remainder: "",
    });
    expect(splitReplyIntoCaptionChunks("   ").chunks).toEqual([]);
  });

  test("breaks on line ends and never emits an empty caption", () => {
    const { chunks } = splitReplyIntoCaptionChunks(
      "First line.\n\nSecond line.\n",
    );

    expect(chunks.map((c) => c.text)).toEqual(["First line.", "Second line."]);
  });

  test("captions cover every spoken sentence of the reply", () => {
    const reply = "Sure thing. Let me check that for you! Ready?";
    const { chunks, remainder } = splitReplyIntoCaptionChunks(reply);

    expect(chunks.map((c) => c.text).join(" ")).toBe(reply);
    expect(remainder).toBe("");
  });
});

describe("findCaptionChunkIndex", () => {
  const buildChunks = (): CaptionChunk[] =>
    splitReplyIntoCaptionChunks("One here. Two here. One here.").chunks;

  test("finds the caption for the exact TTS chunk being spoken", () => {
    const chunks = buildChunks();

    expect(findCaptionChunkIndex(chunks, chunks[1].screenplay)).toBe(1);
  });

  test("falls back to sentence text when the chunk came from another split", () => {
    const chunks = buildChunks();
    const reSplit = buildChunks();

    expect(findCaptionChunkIndex(chunks, reSplit[1].screenplay)).toBe(1);
  });

  test("resolves repeated sentences in playback order", () => {
    const chunks = buildChunks();
    const reSplit = buildChunks();

    expect(findCaptionChunkIndex(chunks, reSplit[0].screenplay)).toBe(0);
    expect(findCaptionChunkIndex(chunks, reSplit[2].screenplay, 1)).toBe(2);
  });

  test("returns -1 for a chunk from a different reply", () => {
    const chunks = buildChunks();
    const stranger: Screenplay = {
      expression: "neutral",
      talk: { style: "talk", message: "Something else entirely." },
      text: "Something else entirely.",
    };

    expect(findCaptionChunkIndex(chunks, stranger)).toBe(-1);
  });
});
