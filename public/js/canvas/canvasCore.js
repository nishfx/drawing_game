/* public/js/canvas/canvasCore.js */
// Holds core canvas references, player ID, drawing state, and socket ref.

import { clearOverlay } from './overlayManager.js';
import { setCursorStyle } from './overlayManager.js';

// --- Core References ---
let canvas = null;
let context = null;
let overlayCanvas = null; // Set by overlayManager.initOverlay
let overlayCtx = null;    // Set by overlayManager.initOverlay

// --- State ---
let myPlayerId = null;
let drawingEnabled = false;
let isDrawing = false; // Is the mouse button currently down/touch active for drawing
let isMouseOverCanvas = false; // Is the cursor currently inside the canvas bounds

// --- Communication ---
let emitDrawCallback = null; // Function provided by client to emit draw events
let socketRef = null; // Reference to the main socket instance (for undo)

// --- Constants ---
export const CANVAS_BACKGROUND_COLOR = "#FFFFFF";

// --- Initialization ---
export function initCore(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error("Canvas element not found:", canvasId);
        return false;
    }
    context = canvas.getContext('2d', { willReadFrequently: true }); // willReadFrequently needed for fill tool
    if (!context) {
        console.error("Failed to get 2D context");
        return false;
    }

    // Set initial canvas styles
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = 'round';
    context.lineCap = 'round';

    return true; // Core canvas setup successful
}

// --- Getters ---
export function getCanvas() { return canvas; }
export function getContext() { return context; }
export function getOverlayCanvas() { return overlayCanvas; }
export function getOverlayCtx() { return overlayCtx; }
export function getPlayerId() { return myPlayerId; }
export function isDrawingEnabled() { return drawingEnabled; }
export function getIsDrawing() { return isDrawing; }
export function getIsMouseOverCanvas() { return isMouseOverCanvas; }
export function getEmitCallback() { return emitDrawCallback; }
export function getSocketRef() { return socketRef; }

// --- Setters ---
export function setOverlayCanvas(oc) { overlayCanvas = oc; }
export function setOverlayCtx(octx) { overlayCtx = octx; }
export function setPlayerId(playerId) { myPlayerId = playerId; }
export function setEmitCallback(callback) { emitDrawCallback = callback; }
export function setSocketRef(socket) { socketRef = socket; }
export function setIsDrawing(state) { isDrawing = state; }
export function setIsMouseOverCanvas(state) { isMouseOverCanvas = state; }

// --- State Changers ---
export function enableDrawing() {
    if (!canvas) return;
    drawingEnabled = true;
    console.log("Drawing enabled (Core)");
    setCursorStyle(); // Update cursor style
    // If mouse is already over canvas, show preview immediately (handled by overlayManager)
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false; // Ensure drawing stops if disabled mid-stroke
    clearOverlay(); // Remove cursor preview
    if (canvas) canvas.style.cursor = 'not-allowed'; // Show 'not-allowed' cursor inside canvas
    console.log("Drawing disabled (Core)");
}