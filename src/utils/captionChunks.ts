import { Screenplay } from "@/features/chat/messages";
import { processResponse } from "./processResponse";

/**
 * One caption line: a single sentence of the reply, paired with the exact TTS
 * chunk (Screenplay) that speaks it. `index` is the playback position, so a
 * caption view can advance through the reply in step with the audio.
 */
export type CaptionChunk = {
  index: number;
  /** Sentence to display. Tag markup (e.g. `[happy]`) is stripped. */
  text: string;
  /** The TTS chunk this sentence is spoken as. */
  screenplay: Screenplay;
};

export type ReplyCaptions = {
  chunks: CaptionChunk[];
  /**
   * Trailing text that never closed a sentence. `processResponse` only emits a
   * sentence once it sees a terminator, so this tail is never sent to TTS and
   * therefore has no chunk to sync against.
   */
  remainder: string;
};

// Safety valve: the feed loop advances one character per iteration, so this
// only trips on absurdly long replies.
const MAX_REPLY_LENGTH = 100_000;

/**
 * Split a reply into the same sentences the TTS pipeline speaks, and pair each
 * one with its TTS chunk.
 *
 * `processResponse` is the project's sentence splitter, but it is written for a
 * token stream: its sentence pattern is greedy, so handing it a whole reply at
 * once swallows everything up to the last terminator as a single "sentence".
 * Replaying the reply one character at a time is what reproduces the chunk
 * boundaries the streaming path actually produces.
 *
 * Cost is linear in reply length per call, so quadratic overall; replies are
 * short enough (a few thousand characters at most) for that to stay negligible.
 */
export function splitReplyIntoCaptionChunks(reply: string): ReplyCaptions {
  const chunks: CaptionChunk[] = [];

  if (!reply) {
    return { chunks, remainder: "" };
  }

  const source = reply.slice(0, MAX_REPLY_LENGTH);

  // Screenplays handed to the callback, in the order processResponse emits them.
  const emitted: Screenplay[] = [];

  let sentences: string[] = [];
  let aiTextLog = "";
  let receivedMessage = "";
  let tag = "";
  let isThinking = false;
  let rolePlay = "";

  for (const char of source) {
    receivedMessage += char;
    receivedMessage = receivedMessage.trimStart();
    if (receivedMessage === "") {
      continue;
    }

    const emittedBefore = emitted.length;

    const proc = processResponse({
      sentences,
      aiTextLog,
      receivedMessage,
      tag,
      isThinking,
      rolePlay,
      callback: (aiTalks: Screenplay[]) => {
        if (aiTalks[0]) {
          emitted.push(aiTalks[0]);
        }
        return false;
      },
    });

    sentences = proc.sentences;
    aiTextLog = proc.aiTextLog;
    receivedMessage = proc.receivedMessage;
    tag = proc.tag;
    isThinking = proc.isThinking;
    rolePlay = proc.rolePlay;

    if (emitted.length === emittedBefore) {
      continue;
    }

    // Reasoning output goes to the thought bubble, never to TTS, so it gets no
    // caption.
    if (isThinking) {
      continue;
    }

    const screenplay = emitted[emitted.length - 1];
    const text = screenplay.talk.message.trim();
    if (text === "") {
      continue;
    }

    chunks.push({ index: chunks.length, text, screenplay });
  }

  return { chunks, remainder: receivedMessage };
}

/**
 * Locate the caption for a TTS chunk that is about to be spoken.
 *
 * Matches on the chunk itself first, falling back to sentence text so captions
 * still resolve when the screenplay was built by a separate split of the same
 * reply. The search starts at `fromIndex` so repeated sentences resolve in
 * playback order rather than always snapping back to the first occurrence.
 *
 * Returns -1 when the chunk belongs to a different reply.
 */
export function findCaptionChunkIndex(
  chunks: CaptionChunk[],
  screenplay: Screenplay,
  fromIndex = 0,
): number {
  const start = Math.max(0, fromIndex);

  for (let i = start; i < chunks.length; i++) {
    if (chunks[i].screenplay === screenplay) {
      return i;
    }
  }

  const text = screenplay.talk.message.trim();
  if (text === "") {
    return -1;
  }

  for (let i = start; i < chunks.length; i++) {
    if (chunks[i].text === text) {
      return i;
    }
  }

  return -1;
}
