import type { MarkerSelectionState } from "./markerSelection";
import type { MarkerSelectionOption } from "./markerSelection";

export interface RenderMarkerButtonsOptions {
  container: HTMLElement;
  selection: MarkerSelectionState;
  onMarkerClick: (markerId: string) => void | Promise<void>;
  getButtonTitle?: (args: { markerName: string; disabled: boolean; markerId: string }) => string;
  isButtonDisabled?: (args: { disabled: boolean; markerId: string }) => boolean;
}

export interface RenderMarkerButtonOptions {
  container: HTMLElement;
  option: MarkerSelectionOption;
  selectedMarkerId: string | null;
  onClick: (markerId: string) => void | Promise<void>;
  getButtonTitle?: (args: { markerName: string; disabled: boolean; markerId: string }) => string;
  isButtonDisabled?: (args: { disabled: boolean; markerId: string }) => boolean;
}

export function renderMarkerButton(options: RenderMarkerButtonOptions): HTMLButtonElement {
  const {
    container,
    option,
    selectedMarkerId,
    onClick,
    getButtonTitle = ({ markerName, disabled }) => (disabled ? `${markerName}（已删除）` : markerName),
    isButtonDisabled = ({ disabled }) => disabled,
  } = options;
  const { marker, disabled } = option;

  const button = container.createEl("button", {
    cls: `annotation-color-dot marker-preset-${marker.preset}`,
    attr: {
      type: "button",
      title: getButtonTitle({ markerName: marker.name, disabled, markerId: marker.id }),
      "data-marker-id": marker.id,
    },
  });
  button.style.setProperty("--marker-preview-color", marker.color);
  button.setText("Aa");
  if (marker.id === selectedMarkerId) {
    button.addClass("active");
  }

  button.disabled = isButtonDisabled({ disabled, markerId: marker.id });
  button.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (button.disabled) return;
    await onClick(marker.id);
  });

  return button;
}

export function renderMarkerButtons(options: RenderMarkerButtonsOptions): void {
  const {
    container,
    selection,
    onMarkerClick,
    getButtonTitle = ({ markerName, disabled }) => (disabled ? `${markerName}（已删除）` : markerName),
    isButtonDisabled = ({ disabled }) => disabled,
  } = options;

  selection.options.forEach((option) => {
    renderMarkerButton({
      container,
      option,
      selectedMarkerId: selection.selectedMarkerId,
      onClick: onMarkerClick,
      getButtonTitle,
      isButtonDisabled,
    });
  });
}
