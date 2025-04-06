/* public/js/canvas/toolManager.js */
// Manages the state of the currently selected drawing tool, color, and line width.

import { updateCursorPreview } from './overlayManager.js';
import { getIsMouseOverCanvas } from './canvasCore.js';
// Need access to current mouse coords if we update preview from here
// import { getCurrentMouseCoords } from './eventHandlers.js'; // Or pass coords

// --- Tool State ---
let currentTool = 'pencil';
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;

// --- Getters ---
export function getCurrentTool() { return currentTool; }
export function getCurrentColor() { return currentStrokeStyle; }
export function getCurrentLineWidth() { return currentLineWidth; }

// --- Setters ---
export function setTool(toolName) {
    currentTool = toolName;
    console.log("Tool set to:", currentTool);
    // Update preview if mouse is over canvas
    // We need the current coordinates to update the preview correctly.
    // This suggests either eventHandlers needs to call updateCursorPreview,
    // or toolManager needs access to the current coords.
    // Let's assume eventHandlers calls updateCursorPreview on mouse move.
    // We still need to update the cursor *style* and potentially clear the overlay.
    // import { setCursorStyle, clearOverlay } from './overlayManager.js'; // Avoid circular?
    // setCursorStyle(); // Update cursor based on tool/state
    // if (!getIsMouseOverCanvas()) {
    //     clearOverlay(); // Clear preview if mouse is outside
    // }
    // Simplification: Let the mouse move handler update the preview fully.
    // We just log the change here.
}

export function setColor(color) {
    currentStrokeStyle = color;
    console.log("Color set to:", currentStrokeStyle);
    // Update preview color if mouse is over canvas
    // Again, rely on mouse move handler to call updateCursorPreview
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5; // Ensure number, default 5
    console.log("Line width set to:", currentLineWidth);
    // Update preview size if mouse is over canvas
    // Rely on mouse move handler
}