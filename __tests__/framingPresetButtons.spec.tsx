import * as React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, jest } from "@jest/globals";

// The buttons read their copy through react-i18next; initialise the app's real
// i18n instance so the test asserts the strings a user actually sees.
import "../src/i18n";

import {
  FramingPresetButtons,
  FramingPresetViewer,
  useFramingPresets,
} from "../src/components/framingPresets";
import { FramingPresetId } from "../src/features/vrmViewer/framingPresets";

// React needs to know these renders are test-driven, otherwise every act() call
// warns about updates outside of act.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Stand-in for the viewer: records the presets asked for, decides whether it
 * can take them, and can announce that the user grabbed the camera.
 */
class StubViewer implements FramingPresetViewer {
  public readonly applied: FramingPresetId[] = [];
  public accepts = true;

  private listeners = new Set<() => void>();

  public applyFramingPreset(preset: FramingPresetId): boolean {
    this.applied.push(preset);
    return this.accepts;
  }

  public onCameraUserInput(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pretend the user dragged, wheeled or pinched the camera. */
  public userMovedCamera(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  public get listenerCount(): number {
    return this.listeners.size;
  }
}

function Toolbar({ viewer }: { viewer: FramingPresetViewer | null }) {
  const { active, select } = useFramingPresets(viewer);
  return <FramingPresetButtons active={active} onSelect={select} />;
}

let container: HTMLDivElement;
let root: Root;

function render(element: React.ReactElement): void {
  act(() => {
    root.render(element);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

function buttonFor(name: string): HTMLButtonElement {
  const found = buttons().find(
    (button) => button.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`no framing button labelled "${name}"`);
  return found;
}

function click(button: HTMLButtonElement): void {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pressedLabels(): string[] {
  return buttons()
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("FramingPresetButtons", () => {
  test("offers three framing buttons, tightest shot first", () => {
    render(<FramingPresetButtons active={null} onSelect={() => {}} />);

    expect(buttons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Face close-up",
      "Upper body",
      "Full body",
    ]);
  });

  test("gives every button a tooltip that names its framing", () => {
    render(<FramingPresetButtons active={null} onSelect={() => {}} />);

    for (const button of buttons()) {
      const tooltip = document.getElementById(
        button.getAttribute("aria-describedby") ?? "",
      );

      expect(tooltip).not.toBeNull();
      expect(tooltip).toHaveAttribute("role", "tooltip");
      expect(tooltip?.textContent).toBe(button.getAttribute("aria-label"));
    }
  });

  test("marks only the active preset as pressed", () => {
    render(<FramingPresetButtons active="upperBody" onSelect={() => {}} />);

    expect(pressedLabels()).toEqual(["Upper body"]);
  });

  test("marks nothing as pressed when no preset is framing the scene", () => {
    render(<FramingPresetButtons active={null} onSelect={() => {}} />);

    expect(pressedLabels()).toEqual([]);
  });

  test("reports which preset was clicked", () => {
    const onSelect = jest.fn();
    render(<FramingPresetButtons active={null} onSelect={onSelect} />);

    click(buttonFor("Full body"));

    expect(onSelect).toHaveBeenCalledWith("fullBody");
  });
});

describe("useFramingPresets", () => {
  test("asks the viewer for the clicked framing and highlights it", () => {
    const viewer = new StubViewer();
    render(<Toolbar viewer={viewer} />);

    click(buttonFor("Face close-up"));

    expect(viewer.applied).toEqual(["face"]);
    expect(pressedLabels()).toEqual(["Face close-up"]);
  });

  test("moves the highlight when another preset is picked", () => {
    const viewer = new StubViewer();
    render(<Toolbar viewer={viewer} />);

    click(buttonFor("Face close-up"));
    click(buttonFor("Full body"));

    expect(viewer.applied).toEqual(["face", "fullBody"]);
    expect(pressedLabels()).toEqual(["Full body"]);
  });

  test("keeps the highlight until the user moves the camera", () => {
    const viewer = new StubViewer();
    render(<Toolbar viewer={viewer} />);
    click(buttonFor("Upper body"));

    expect(pressedLabels()).toEqual(["Upper body"]);

    act(() => {
      viewer.userMovedCamera();
    });

    expect(pressedLabels()).toEqual([]);
  });

  test("does not highlight a framing the viewer could not take", () => {
    const viewer = new StubViewer();
    viewer.accepts = false;
    render(<Toolbar viewer={viewer} />);

    click(buttonFor("Face close-up"));

    expect(viewer.applied).toEqual(["face"]);
    expect(pressedLabels()).toEqual([]);
  });

  test("drops an earlier highlight when a later preset is refused", () => {
    const viewer = new StubViewer();
    render(<Toolbar viewer={viewer} />);
    click(buttonFor("Face close-up"));

    viewer.accepts = false;
    click(buttonFor("Full body"));

    expect(pressedLabels()).toEqual([]);
  });

  test("unsubscribes from the viewer when the toolbar goes away", () => {
    const viewer = new StubViewer();
    render(<Toolbar viewer={viewer} />);

    expect(viewer.listenerCount).toBe(1);

    render(<Toolbar viewer={null} />);

    expect(viewer.listenerCount).toBe(0);
  });

  test("stays inert without a viewer", () => {
    render(<Toolbar viewer={null} />);

    expect(() => click(buttonFor("Face close-up"))).not.toThrow();
    expect(pressedLabels()).toEqual([]);
  });
});
