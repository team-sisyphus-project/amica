/**
 * Caption playback integration test.
 *
 * Exercises the caption-advancement protocol used by Chat.processSpeakJobs:
 *   - Each speak job updates the caption to the current sentence immediately
 *     before audio starts, so caption and voice are never more than one job
 *     apart in the queue.
 *   - A 400 ms timer clears the caption after the speak queue drains; an
 *     arriving sentence cancels the pending clear so the bar never blanks
 *     mid-reply.
 *
 * The test harness re-implements that small state machine (< 10 lines from
 * processSpeakJobs) in a synchronous/timer-controlled form so we can drive
 * three replies of different lengths without importing the full Chat class.
 */

import { describe, expect, test, beforeEach, afterEach, jest } from "@jest/globals";
import {
  CaptionChunk,
  splitReplyIntoCaptionChunks,
} from "../src/utils/captionChunks";

// ---------------------------------------------------------------------------
// Minimal caption-player that mirrors Chat.processSpeakJobs caption logic
// ---------------------------------------------------------------------------

const CAPTION_CLEAR_DELAY_MS = 400;

/**
 * Shared state for the caption clear timer, equivalent to `this.captionClearTimer`
 * in Chat.  Passing the same ref across multiple `simulateCaptionPlayback` calls
 * lets the second reply cancel the pending clear from the first reply, exactly
 * as the shared instance field does in production.
 */
type ClearTimerRef = { current: ReturnType<typeof setTimeout> | null };

function makeClearTimerRef(): ClearTimerRef {
  return { current: null };
}

/**
 * Play a list of caption chunks through the speak queue (no audio — simulates
 * the null-audioBuffer path in processSpeakJobs) and advance `setCaptionText`
 * for each sentence.  A 400 ms clear timer is scheduled after the queue drains.
 *
 * `ref` holds the active timer handle so back-to-back calls can cancel each
 * other's pending clears — the same behaviour as `this.captionClearTimer`.
 */
function simulateCaptionPlayback(
  chunks: CaptionChunk[],
  setCaptionText: (text: string | null) => void,
  ref: ClearTimerRef,
): void {
  for (const chunk of chunks) {
    // Cancel any pending clear (a new sentence arrived before the 400 ms gap).
    if (ref.current !== null) {
      clearTimeout(ref.current);
      ref.current = null;
    }
    // Advance caption to the current sentence (same as in processSpeakJobs).
    setCaptionText(chunk.text);
    // In production, `await viewer.model.speak(audio, screenplay)` runs here.
    // With null audioBuffer the if-block is skipped entirely, so nothing waits.
  }

  // Schedule caption clear after the last sentence — mirrors the timer that
  // processSpeakJobs arms whenever the do-while drains the speak queue.
  ref.current = setTimeout(() => {
    setCaptionText(null);
    ref.current = null;
  }, CAPTION_CLEAR_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("caption playback over three replies of different length", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The three replies used throughout: short (1 sentence), medium (2), long (3).
  const SHORT = "Okay, sure.";
  const MEDIUM = "Let me think about that. I will get back to you.";
  const LONG =
    "First, consider the context. Second, weigh the options carefully. Third, commit to a direction.";

  test("splits each reply into the expected number of caption chunks", () => {
    expect(splitReplyIntoCaptionChunks(SHORT).chunks).toHaveLength(1);
    expect(splitReplyIntoCaptionChunks(MEDIUM).chunks).toHaveLength(2);
    expect(splitReplyIntoCaptionChunks(LONG).chunks).toHaveLength(3);
  });

  test("captions advance sentence-by-sentence for the short reply", () => {
    const { chunks } = splitReplyIntoCaptionChunks(SHORT);
    const updates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    simulateCaptionPlayback(chunks, (t) => updates.push(t), ref);

    // One caption update per sentence, no null yet (clear timer is pending).
    expect(updates).toEqual(chunks.map((c) => c.text));
  });

  test("caption clears after the short reply ends (400 ms timer fires)", () => {
    const { chunks } = splitReplyIntoCaptionChunks(SHORT);
    const updates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    simulateCaptionPlayback(chunks, (t) => updates.push(t), ref);
    // Advance past the clear timer.
    jest.advanceTimersByTime(CAPTION_CLEAR_DELAY_MS);

    expect(updates[updates.length - 1]).toBeNull();
  });

  test("captions advance sentence-by-sentence for the medium reply (2 sentences)", () => {
    const { chunks } = splitReplyIntoCaptionChunks(MEDIUM);
    const updates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    simulateCaptionPlayback(chunks, (t) => updates.push(t), ref);

    expect(updates).toEqual(chunks.map((c) => c.text));
    expect(updates).toHaveLength(2);
  });

  test("caption clears after the medium reply ends", () => {
    const { chunks } = splitReplyIntoCaptionChunks(MEDIUM);
    const updates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    simulateCaptionPlayback(chunks, (t) => updates.push(t), ref);
    jest.advanceTimersByTime(CAPTION_CLEAR_DELAY_MS);

    expect(updates[updates.length - 1]).toBeNull();
  });

  test("captions advance sentence-by-sentence for the long reply (3 sentences)", () => {
    const { chunks } = splitReplyIntoCaptionChunks(LONG);
    const updates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    simulateCaptionPlayback(chunks, (t) => updates.push(t), ref);

    expect(updates).toEqual(chunks.map((c) => c.text));
    expect(updates).toHaveLength(3);
  });

  test("caption clears after the long reply ends", () => {
    const { chunks } = splitReplyIntoCaptionChunks(LONG);
    const updates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    simulateCaptionPlayback(chunks, (t) => updates.push(t), ref);
    jest.advanceTimersByTime(CAPTION_CLEAR_DELAY_MS);

    expect(updates[updates.length - 1]).toBeNull();
  });

  test("pending clear is cancelled when the next sentence arrives", () => {
    // Simulate playing two replies back-to-back with only a tiny gap, so the
    // 400 ms clear from the first reply would fire mid-second-reply if the
    // cancellation logic were missing.
    const { chunks: chunks1 } = splitReplyIntoCaptionChunks(SHORT);
    const { chunks: chunks2 } = splitReplyIntoCaptionChunks(MEDIUM);
    const updates: (string | null)[] = [];
    // Shared ref — this is what makes the second reply able to cancel the
    // pending clear from the first, the same way this.captionClearTimer works.
    const ref = makeClearTimerRef();

    // Play first reply — arms the 400 ms clear timer.
    simulateCaptionPlayback(chunks1, (t) => updates.push(t), ref);

    // Advance only 200 ms (clear timer has not fired yet).
    jest.advanceTimersByTime(200);

    // Start the second reply before the clear fires — must cancel the timer.
    simulateCaptionPlayback(chunks2, (t) => updates.push(t), ref);

    // Advance another 200 ms (would have been enough to fire the first clear).
    jest.advanceTimersByTime(200);

    // Caption should still show the last sentence of reply 2, not null.
    expect(updates[updates.length - 1]).toBe(chunks2[chunks2.length - 1].text);

    // Now let the second reply's clear timer fire.
    jest.advanceTimersByTime(CAPTION_CLEAR_DELAY_MS);
    expect(updates[updates.length - 1]).toBeNull();
  });

  test("plays all three replies sequentially, each clearing between turns", () => {
    const replies = [SHORT, MEDIUM, LONG];
    const allUpdates: (string | null)[] = [];
    const ref = makeClearTimerRef();

    for (const reply of replies) {
      const { chunks } = splitReplyIntoCaptionChunks(reply);
      simulateCaptionPlayback(chunks, (t) => allUpdates.push(t), ref);
      // Simulate a pause between replies — let each clear timer fire.
      jest.advanceTimersByTime(CAPTION_CLEAR_DELAY_MS + 50);
    }

    // Each reply should have produced: sentence1 ... sentenceN null
    // Total null entries = number of replies (one clear per reply).
    const nullPositions = allUpdates
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t === null)
      .map(({ i }) => i);

    expect(nullPositions).toHaveLength(3);

    // Each null immediately follows the last sentence of its reply.
    // Reply 1: indices [0, null_at_1]; Reply 2: [2, 3, null_at_4]; Reply 3: [5,6,7,null_at_8]
    // The sentences before each null must match the reply's chunks.
    const groups: (string | null)[][] = [];
    let prev = 0;
    for (const pos of nullPositions) {
      groups.push(allUpdates.slice(prev, pos + 1));
      prev = pos + 1;
    }

    // Group 0 → SHORT; Group 1 → MEDIUM; Group 2 → LONG
    for (let i = 0; i < replies.length; i++) {
      const { chunks } = splitReplyIntoCaptionChunks(replies[i]);
      const expected = [...chunks.map((c) => c.text), null];
      expect(groups[i]).toEqual(expected);
    }
  });
});
