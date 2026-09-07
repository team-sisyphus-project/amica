import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { IconBodyScan, IconFaceId, IconUserScan } from "@tabler/icons-react";

import {
  FRAMING_PRESET_IDS,
  FramingPresetId,
} from "@/features/vrmViewer/framingPresets";

/**
 * The slice of the viewer these buttons need.
 *
 * Declaring it here — rather than importing `Viewer` — keeps the toolbar
 * independent of the 3D stack: the buttons are driven by two questions ("can
 * you take this framing?" and "has the user reframed by hand?"), and anything
 * that can answer them can drive them, including a stub in a test.
 */
export interface FramingPresetViewer {
  /** Ease the camera to `preset`. `false` if the framing is not available yet. */
  applyFramingPreset(preset: FramingPresetId): boolean;
  /** Subscribe to the user reframing by hand. Returns an unsubscribe function. */
  onCameraUserInput(listener: () => void): () => void;
}

/** Copy for one preset. Keys are English so they read as sentences in source. */
interface FramingPresetDescriptor {
  readonly id: FramingPresetId;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

/**
 * The presets as the toolbar shows them: tightest shot first, one shared icon
 * motif — a subject inside framing brackets — so the row reads as three stops
 * on one axis rather than three unrelated actions.
 */
export const FRAMING_PRESETS: readonly FramingPresetDescriptor[] = [
  { id: "face", label: "Face close-up", icon: IconFaceId },
  { id: "upperBody", label: "Upper body", icon: IconUserScan },
  { id: "fullBody", label: "Full body", icon: IconBodyScan },
];

/**
 * Tracks which preset the camera is currently showing.
 *
 * The highlight is a claim about what is on screen, so it only survives while
 * that claim is true: the moment the user drags, wheels or pinches the camera
 * the framing is theirs, not the preset's, and the highlight clears. A preset
 * the viewer refuses — no model measured yet — never lights up.
 */
export function useFramingPresets(viewer: FramingPresetViewer | null | undefined): {
  active: FramingPresetId | null;
  select: (preset: FramingPresetId) => void;
} {
  const [active, setActive] = useState<FramingPresetId | null>(null);

  useEffect(() => {
    if (!viewer) return;
    return viewer.onCameraUserInput(() => setActive(null));
  }, [viewer]);

  const select = useCallback(
    (preset: FramingPresetId) => {
      if (!viewer) return;
      setActive(viewer.applyFramingPreset(preset) ? preset : null);
    },
    [viewer],
  );

  return { active, select };
}

function tooltipId(preset: FramingPresetId): string {
  return `framing-preset-tooltip-${preset}`;
}

/**
 * The three framing buttons, as shown in the main menu column.
 *
 * Presentational: it renders the state it is given and reports clicks. State
 * lives in {@link useFramingPresets}.
 */
export function FramingPresetButtons({
  active,
  onSelect,
  large = false,
}: {
  /** Preset currently framing the scene, or `null` when the user owns the camera. */
  active: FramingPresetId | null;
  onSelect: (preset: FramingPresetId) => void;
  /** Enlarged hit targets, matching the menu's VR-headset sizing. */
  large?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t("Camera framing")}
      className="flex flex-col items-center space-y-3">
      {FRAMING_PRESETS.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        const text = t(label);

        return (
          <div key={id} className="group relative flex flex-row items-center">
            <button
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={isActive}
              aria-label={text}
              aria-describedby={tooltipId(id)}
              className={clsx(
                "rounded-md p-1",
                isActive ? "bg-primary" : "hover:cursor-pointer",
              )}>
              <Icon
                className={clsx(
                  large ? "h-14 w-14" : "h-7 w-7",
                  "text-white",
                  isActive
                    ? "opacity-100"
                    : "opacity-50 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
                aria-hidden="true"
              />
            </button>

            {/* Sits outside the menu column so it never covers its neighbours;
                kept in the DOM as the button's description rather than shown
                only on hover, so it is reachable by keyboard and by a reader. */}
            <span
              id={tooltipId(id)}
              role="tooltip"
              className="pointer-events-none absolute left-full z-10 ml-2 whitespace-nowrap rounded-md bg-slate-800/90 px-2 py-1 text-xs text-white opacity-0 shadow-sm backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Re-exported so callers wire the menu without reaching into the feature. */
export type { FramingPresetId };
export { FRAMING_PRESET_IDS };
