/* public/js/canvasManager.js */
// Main Facade for Canvas Operations

import { initCore, getCanvas, getContext, setPlayerId as setCorePlayerId, getPlayerId, setEmitCallback, setSocketRef } from './canvas/canvasCore.js';
import { setTool as setToolState, setColor as setToolColor, setLineWidth as setToolLineWidth } from './canvas/toolManager.js';
import { enableDrawing as enableCoreDrawing, disableDrawing as disableCoreDrawing } from './canvas/canvasCore.js';
import { initOverlay } from './canvas/overlayManager.js';
import { initEventHandlers } from './canvas/eventHandlers.js';
import { loadAndDrawHistory as loadHistory, drawExternalCommand as drawExternal, clearHistory } from './canvas/historyManager.js';
import { clearCanvas as clearHistoryAndEmit } from './canvas/historyManager.js';
import { undoLastAction as undo } from './canvas/undoManager.js';
import { getDrawingDataURL as getDataURL } from './canvas/dataExporter.js';

// ***** ADD THIS IMPORT *****
import { removeCommands as removeHistoryCommands } from './canvas/historyManager.js';
// ****************************

/**
 * Initializes the main canvas, overlay, and event listeners.
 * @param {string} canvasId - The ID of the main canvas element.
 * @param {function|null} drawEventEmitter - Callback function to emit draw events to the server.
 * @param {object|null} socket - The Socket.IO socket instance (needed for undo).
 * @returns {boolean} True if initialization was successful, false otherwise.
 */
export function initCanvas(canvasId, drawEventEmitter, socket = null) {
    if (!initCore(canvasId)) {
        return false;
    }
    // Initialize the overlay canvas AFTER core is initialized
    if (!initOverlay()) {
        return false; // Overlay initialization failed
    }
    setEmitCallback(drawEventEmitter);
    setSocketRef(socket); // Store socket reference (potentially used by undo)
    initEventHandlers(); // Attach mouse/touch listeners
    disableDrawing(); // Start disabled
    clearHistory(); // Reset local history on init
    console.log(`CanvasManager Facade: Canvas "${canvasId}" initialized.`);
    return true;
}

/**
 * Sets the current player's ID for ownership tracking.
 * @param {string} playerId - The unique ID of the player.
 */
export function setPlayerId(playerId) {
    setCorePlayerId(playerId);
    console.log("CanvasManager Facade: Player ID set to:", playerId);
}

/**
 * Enables drawing on the canvas.
 */
export function enableDrawing() {
    enableCoreDrawing();
}

/**
 * Disables drawing on the canvas.
 */
export function disableDrawing() {
    disableCoreDrawing();
}

/**
 * Sets the active drawing tool.
 * @param {string} toolName - Name of the tool ('pencil', 'eraser', 'fill', 'rectangle', 'ellipse', 'text').
 */
export function setTool(toolName) {
    setToolState(toolName);
}

/**
 * Sets the current drawing/fill color.
 * @param {string} color - Hex color string (e.g., '#FF0000').
 */
export function setColor(color) {
    setToolColor(color);
}

/**
 * Sets the current line width or tool size.
 * @param {number|string} width - The desired width/size.
 */
export function setLineWidth(width) {
    setToolLineWidth(width);
}

/**
 * Clears the canvas of the current player's drawings.
 * @param {boolean} [emitEvent=true] - Whether to emit a 'clear' event to the server.
 */
export function clearCanvas(emitEvent = true) {
    clearHistoryAndEmit(emitEvent);
}

/**
 * Gets the current canvas content as a PNG data URL.
 * @returns {string|null} Base64 encoded PNG data URL or null on error.
 */
export function getDrawingDataURL() {
    return getDataURL();
}

/**
 * Loads a complete history of drawing commands and redraws the canvas.
 * @param {Array<Object>} commands - An array of drawing command objects.
 */
export function loadAndDrawHistory(commands) {
    loadHistory(commands);
}

/**
 * Draws a command received from an external source (another player).
 * @param {Object} data - The drawing command object.
 */
export function drawExternalCommand(data) {
    drawExternal(data);
}

/**
 * Undoes the last drawing action performed by the local player.
 * @param {object} socket - The Socket.IO socket instance to emit the undo event.
 */
export function undoLastAction(socket) {
    // Pass the socket explicitly to the core undo function
    undo(socket);
}

/**
 * Removes specific drawing commands from history (e.g., triggered by an undo from the server).
 * @param {Array<string>} [idsToRemove=[]] - Command IDs to remove.
 * @param {string|null} [strokeIdToRemove=null] - Stroke ID to remove.
 * @param {string|null} ownerPlayerId - The ID of the player whose commands should be removed.
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    // *** FIX: Actually remove from local history using the real function ***
    removeHistoryCommands(idsToRemove, strokeIdToRemove, ownerPlayerId);
    // The history manager handles redraw automatically.
}
