/* public/js/canvas/overlayManager.js */
// Manages the overlay canvas for cursor previews and shape drawing.

import { getCanvas, getOverlayCanvas, setOverlayCanvas, getOverlayCtx, setOverlayCtx, isDrawingEnabled, getIsDrawing, getIsMouseOverCanvas } from './canvasCore.js';
import { getCurrentTool, getCurrentColor, getCurrentLineWidth } from './toolManager.js';

// --- Initialization ---
/**
 * Creates and initializes the overlay canvas.
 * Called by canvasManager.initCanvas.
 * @returns {boolean} True if successful, false otherwise.
 */
export function initOverlay() {
    const canvas = getCanvas();
    if (!canvas) return false;

    const parent = canvas.parentNode;
    if (!parent) {
        console.error("Canvas must have a parent node for overlay positioning.");
        return false;
    }

    // Create overlay canvas
    const overlay = document.createElement('canvas');
    overlay.width = canvas.width; // Match internal resolution
    overlay.height = canvas.height;
    overlay.style.position = 'absolute'; // Position relative to nearest positioned ancestor
    overlay.style.pointerEvents = 'none'; // Allow clicks to pass through
    overlay.style.zIndex = '10'; // Ensure it's visually on top
    overlay.id = `${canvas.id}-overlay`;

    // Insert overlay *before* the main canvas
    parent.insertBefore(overlay, canvas);
    const overlayContext = overlay.getContext('2d');

    if (!overlayContext) {
        console.error("Failed to get overlay 2D context");
        return false;
    }

    setOverlayCanvas(overlay);
    setOverlayCtx(overlayContext);

    // Ensure parent has relative positioning (CSS should handle this)
    if (getComputedStyle(parent).position === 'static') {
        console.warn(`Canvas parent node for #${canvas.id} should have position:relative for overlay.`);
    }

    // Set initial overlay styles
    overlayContext.lineJoin = 'round';
    overlayContext.lineCap = 'round';

    // Initial sync using the dedicated function, wrapped in rAF
    requestAnimationFrame(resyncOverlayPosition);

    console.log("Overlay Canvas Initialized.");
    return true;
}

// -------------------------------------------------------------------
// Overlay Position Synchronization
// -------------------------------------------------------------------
/**
 * Recalculates and applies the correct position and size for the overlay canvas
 * to ensure it perfectly matches the main canvas's position and dimensions.
 */
export function resyncOverlayPosition() {
    const canvas = getCanvas();
    const overlayCanvas = getOverlayCanvas();
    if (!canvas || !overlayCanvas) return;
    const parent = canvas.parentNode;
    if (!parent) return;

    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    // Update overlay internal dimensions if canvas dimensions changed
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
        console.log("Overlay internal dimensions resynced.");
    }

    // Calculate offset within the parent
    const newTop = canvasRect.top - parentRect.top;
    const newLeft = canvasRect.left - parentRect.left;
    const newWidth = canvasRect.width;
    const newHeight = canvasRect.height;

    // Apply styles only if changed
    let changed = false;
    if (overlayCanvas.style.top !== `${newTop}px`) {
        overlayCanvas.style.top = `${newTop}px`; changed = true;
    }
    if (overlayCanvas.style.left !== `${newLeft}px`) {
        overlayCanvas.style.left = `${newLeft}px`; changed = true;
    }
    if (overlayCanvas.style.width !== `${newWidth}px`) {
        overlayCanvas.style.width = `${newWidth}px`; changed = true;
    }
    if (overlayCanvas.style.height !== `${newHeight}px`) {
        overlayCanvas.style.height = `${newHeight}px`; changed = true;
    }
    // if (changed) console.log(`Overlay resynced: T:${newTop.toFixed(1)} L:${newLeft.toFixed(1)} W:${newWidth.toFixed(1)} H:${newHeight.toFixed(1)}`);
}

// -------------------------------------------------------------------
// Cursor and Overlay Management
// -------------------------------------------------------------------
/** Sets the CSS cursor style for the main canvas element. */
export function setCursorStyle() {
    const canvas = getCanvas();
    if (!canvas) return;
    if (!isDrawingEnabled()) {
        canvas.style.cursor = 'not-allowed';
    } else if (getIsMouseOverCanvas()) {
        // Hide system cursor when custom preview is active
        canvas.style.cursor = 'none';
    } else {
        // Show default cursor when outside
        canvas.style.cursor = 'default';
    }
}

/** Clears the entire overlay canvas. */
export function clearOverlay() {
    const overlayCtx = getOverlayCtx();
    const overlayCanvas = getOverlayCanvas();
    const canvas = getCanvas();
    if (!overlayCtx || !overlayCanvas || !canvas) return;
    // Ensure overlay dimensions match canvas
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
    }
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

/** Draws the circular cursor preview on the overlay canvas. */
function drawCursorPreview(x, y) {
    const overlayCtx = getOverlayCtx();
    if (!overlayCtx || !isDrawingEnabled() || getIsDrawing()) {
        // Don't draw preview if drawing disabled or actively drawing
        clearOverlay();
        return;
    }
    clearOverlay(); // Clear previous frame

    overlayCtx.beginPath();
    const currentLineWidth = getCurrentLineWidth();
    const radius = Math.max(1, currentLineWidth / 2);
    const currentTool = getCurrentTool();
    const previewColor = (currentTool === 'eraser') ? '#888888' : getCurrentColor();

    // Draw circle outline
    overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    overlayCtx.strokeStyle = previewColor;
    overlayCtx.lineWidth = 1; // Thin line for preview outline
    overlayCtx.stroke();
}

/** Updates the cursor preview position and style. */
export function updateCursorPreview(x, y) {
    // Only draw preview if mouse is over canvas, drawing enabled, and not actively drawing
    if (getIsMouseOverCanvas() && isDrawingEnabled() && !getIsDrawing()) {
        drawCursorPreview(x, y);
    } else {
        clearOverlay(); // Clear preview otherwise
    }
    setCursorStyle(); // Ensure CSS cursor style is correct
}