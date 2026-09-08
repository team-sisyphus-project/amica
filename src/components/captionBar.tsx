import { useEffect, useState } from "react";

type Props = {
  /** Sentence currently being spoken; null when idle. */
  text: string | null;
  /** Whether the caption bar is toggled on. */
  visible: boolean;
};

/**
 * A translucent caption bar that fades in when speech starts and fades out
 * when it ends. Positioned just above the message input.
 *
 * The parent drives `text` from TTS playback events. When TTS is disabled the
 * parent may forward the accumulated assistant message instead.
 */
export function CaptionBar({ text, visible }: Props) {
  const [displayText, setDisplayText] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    if (text) {
      setDisplayText(text);
      setShown(true);
    } else {
      setShown(false);
    }
  }, [text, visible]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-20 left-0 z-20 w-full pointer-events-none"
      style={{
        opacity: shown ? 1 : 0,
        transition: "opacity 300ms ease-in-out",
      }}
    >
      <div className="mx-auto max-w-4xl px-4 md:px-16">
        <div className="bg-black/70 rounded-lg px-6 py-3 text-white text-center text-base font-semibold shadow-lg backdrop-blur-sm leading-snug">
          {displayText}
        </div>
      </div>
    </div>
  );
}
