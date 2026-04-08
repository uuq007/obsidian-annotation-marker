export interface AnnotationToolbarView {
  anchorEl: HTMLElement;
  markerGroupEl: HTMLElement;
  actionGroupEl: HTMLElement;
  panelStackEl: HTMLElement;
  position: (anchorX: number, anchorY: number) => void;
}

export interface AnnotationToolbarOptions {
  markerLayout?: "single-row-scroll" | "wrap";
}

export function renderAnnotationToolbar(menuEl: HTMLElement, options: AnnotationToolbarOptions = {}): AnnotationToolbarView {
  menuEl.dataset.markerLayout = options.markerLayout ?? "single-row-scroll";
  const contentEl = menuEl.createDiv({ cls: "annotation-menu-scrollable-content annotation-toolbar-content" });
  const anchorEl = contentEl.createDiv({ cls: "annotation-toolbar-anchor" });
  const primaryEl = anchorEl.createDiv({ cls: "annotation-toolbar-primary annotation-toolbar-primary-single-row" });
  const markerGroupEl = primaryEl.createDiv({ cls: "annotation-toolbar-group annotation-toolbar-group-markers" });
  primaryEl.createDiv({ cls: "annotation-toolbar-divider" });
  const actionGroupEl = primaryEl.createDiv({ cls: "annotation-toolbar-group annotation-toolbar-group-actions" });
  const panelStackEl = contentEl.createDiv({ cls: "annotation-toolbar-panel-stack" });

  bindHorizontalWheelScroll(markerGroupEl);

  return {
    anchorEl,
    markerGroupEl,
    actionGroupEl,
    panelStackEl,
    position: (anchorX: number, anchorY: number) => {
      positionAnchoredToolbar({
        menuEl,
        anchorEl,
        anchorX,
        anchorY,
      });
    },
  };
}

interface ToolbarPositionOptions {
  menuEl: HTMLElement;
  anchorEl?: HTMLElement | null;
  anchorX: number;
  anchorY: number;
  viewportPadding?: number;
  offset?: number;
  fallbackMenuHeight?: number;
  fallbackAnchorHeight?: number;
}

function positionAnchoredToolbar(options: ToolbarPositionOptions): void {
  const {
    menuEl,
    anchorEl,
    anchorX,
    anchorY,
    viewportPadding = 10,
    offset = 2,
    fallbackMenuHeight = 220,
    fallbackAnchorHeight = 72,
  } = options;

  const menuWidth = menuEl.offsetWidth || 320;
  const menuHeight = menuEl.offsetHeight || fallbackMenuHeight;
  const anchorHeight = anchorEl?.offsetHeight || fallbackAnchorHeight;
  const expandedHeight = Math.max(0, menuHeight - anchorHeight);

  let menuX = anchorX - Math.round(menuWidth / 2);
  let toolbarTop = anchorY - Math.round(anchorHeight / 2);
  let placement: "above" | "below" = "below";

  if (menuX + menuWidth > window.innerWidth - viewportPadding) {
    menuX = window.innerWidth - menuWidth - viewportPadding;
  }
  menuX = Math.max(viewportPadding, menuX);

  toolbarTop = Math.max(
    viewportPadding,
    Math.min(window.innerHeight - anchorHeight - viewportPadding, toolbarTop)
  );

  const toolbarBottom = toolbarTop + anchorHeight;
  const spaceBelow = window.innerHeight - toolbarBottom - viewportPadding;
  const spaceAbove = toolbarTop - viewportPadding;

  if (expandedHeight > 0) {
    if (spaceBelow >= expandedHeight + offset) {
      placement = "above";
    } else if (spaceAbove >= expandedHeight + offset) {
      placement = "below";
    } else if (spaceBelow >= spaceAbove) {
      placement = "above";
    } else {
      placement = "below";
    }
  }

  let menuY = placement === "above" ? toolbarTop : toolbarTop - expandedHeight;
  if (placement === "above" && menuY + menuHeight > window.innerHeight - viewportPadding) {
    menuY = Math.max(viewportPadding, window.innerHeight - viewportPadding - menuHeight);
  }
  if (placement === "below" && menuY < viewportPadding) {
    menuY = viewportPadding;
  }

  menuEl.dataset.placement = placement;
  menuEl.style.left = `${menuX}px`;
  menuEl.style.top = `${menuY}px`;
}

function bindHorizontalWheelScroll(container: HTMLElement): void {
  container.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) && e.deltaX === 0) {
        return;
      }
      container.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
      e.preventDefault();
    },
    { passive: false }
  );
}
