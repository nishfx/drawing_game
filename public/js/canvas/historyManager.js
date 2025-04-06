/* public/js/canvas/historyManager.js */
// Manages the drawing history (local and full) and redraw operations.

import { getContext, getCanvas, getPlayerId, CANVAS_BACKGROUND_COLOR, getEmitCallback, clearOverlay } from './canvasCore.js';
import { executeCommand } from './drawingExecutor.js';
import { generateCommandId } from './canvasUtils.js';

// --- History State (Internal) ---
let _myDrawHistory = []; // Stores command objects initiated by the local user for undo
let _fullDrawHistory = []; // Stores all command objects from all users for redraw
const MAX_HISTORY = 500; // Limit history size

// --- Functions ---

// Getter for debugging or specific needs (use cautiously)
export function getFullDrawHistory_DEBUG() {
    return _fullDrawHistory;
}
export function getMyDrawHistory_DEBUG() {
    return _myDrawHistory;
}


export function clearHistory() {
    _myDrawHistory = [];
    _fullDrawHistory = [];
    console.log("Local drawing history cleared.");
}

/**
 * Adds a completed drawing command to the appropriate history arrays.
 * @param {Object} command - The command object to add.
 */
export function addCommandToHistory(command) {
    const myPlayerId = getPlayerId();
    if (!command || !command.playerId || !command.cmdId) {
        console.warn("[addCommandToHistory] Invalid command object:", command);
        return;
    }

    // Add to the full history (used for redraws)
    _fullDrawHistory.push(command);
    if (_fullDrawHistory.length > MAX_HISTORY) {
        _fullDrawHistory.shift(); // Prune oldest if history exceeds max size
    }

    // If it's a command initiated by the local player and not 'clear',
    // add it to the separate history used for the undo function.
    if (command.playerId === myPlayerId && command.type !== 'clear') {
        _myDrawHistory.push(command);
        if (_myDrawHistory.length > MAX_HISTORY) {
            _myDrawHistory.shift(); // Prune oldest undoable command
        }
    }
}

/**
 * Removes and returns the last command added by the local player for undo purposes.
 * Returns null if the history is empty.
 * @returns {Object|null} The last command object or null.
 */
export function popLastMyCommand() {
    if (_myDrawHistory.length === 0) {
        return null;
    }
    return _myDrawHistory.pop(); // Modify the internal array
}

/**
 * Loads a complete history of drawing commands (e.g., from the server)
 * and redraws the entire canvas based on this history.
 * @param {Array<Object>} commands - An array of drawing command objects.
 */
export function loadAndDrawHistory(commands) {
    const context = getContext();
    const canvas = getCanvas();
    const myPlayerId = getPlayerId();
    if (!context || !canvas) return;
    console.log(`Loading ${commands.length} commands from history.`);

    // Clear existing history and canvas content
    clearHistory();
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    // Populate internal history arrays directly
    _fullDrawHistory = commands.map(cmd => ({ ...cmd })); // Deep copy commands
    _myDrawHistory = _fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear') // Filter my non-clear commands
        .map(x => ({ ...x })); // Deep copy

    // Redraw everything
    redrawCanvasFromHistory();
}

/**
 * Removes specific drawing commands from the internal history arrays based on
 * command IDs or a stroke ID, but only if they belong to the specified ownerPlayerId.
 * After removal, it triggers a full canvas redraw.
 * @param {Array<string>} [idsToRemove=[]] - An array of command IDs to remove.
 * @param {string|null} [strokeIdToRemove=null] - A stroke ID; all commands with this ID will be removed.
 * @param {string|null} ownerPlayerId - The ID of the player whose commands should be removed. Crucial to prevent removing others' work.
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    if (!ownerPlayerId) {
        console.warn("[removeCommands] Called without ownerPlayerId. Skipping removal.");
        return;
    }
    let removedCount = 0;
    const initialFullLength = _fullDrawHistory.length;
    const initialMyLength = _myDrawHistory.length;

    console.log(`[removeCommands] Before - Full: ${initialFullLength}, My: ${initialMyLength}, StrokeID: ${strokeIdToRemove}, CmdIDs: ${idsToRemove?.join(',')}, Owner: ${ownerPlayerId}`);

    let newFullHistory, newMyHistory;

    if (strokeIdToRemove) {
        // Filter based on strokeId and ownerPlayerId
        newFullHistory = _fullDrawHistory.filter(cmd => {
            const shouldRemove = cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId;
            if (shouldRemove) removedCount++;
            return !shouldRemove; // Keep if NOT removing
        });
        // Also filter myDrawHistory based on the same strokeId
        newMyHistory = _myDrawHistory.filter(cmd => {
            return !(cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId);
        });
        console.log(`[removeCommands] Filtered by strokeId=${strokeIdToRemove}. Matched: ${removedCount}`);

    } else if (idsToRemove && idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        // Filter based on command ID set and ownerPlayerId
        newFullHistory = _fullDrawHistory.filter(cmd => {
            const shouldRemove = idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId;
            if (shouldRemove) removedCount++;
            return !shouldRemove; // Keep if NOT removing
        });
         // Also filter myDrawHistory based on the same cmdIds
        newMyHistory = _myDrawHistory.filter(cmd => {
             return !(idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId);
        });
        console.log(`[removeCommands] Filtered by cmdIds=${idsToRemove.join(',')}. Matched: ${removedCount}`);

    } else {
        // No valid criteria provided, don't modify history
        console.warn("[removeCommands] No strokeId or cmdIds provided for removal.");
        newFullHistory = _fullDrawHistory; // Keep original reference
        newMyHistory = _myDrawHistory;   // Keep original reference
    }

    // --- Assign the new arrays back to the module's state variables ---
    _fullDrawHistory = newFullHistory;
    _myDrawHistory = newMyHistory;
    // ---

    console.log(`[removeCommands] After - Full: ${_fullDrawHistory.length}, My: ${_myDrawHistory.length}`);

    // If any commands were actually removed, redraw the canvas
    if (removedCount > 0) {
        console.log(`[removeCommands] Redrawing canvas after removing ${removedCount} commands.`);
        redrawCanvasFromHistory();
    } else {
        console.warn(`[removeCommands] No commands found to remove for stroke=${strokeIdToRemove}, cmdIds=${idsToRemove?.join(',')}, owner=${ownerPlayerId}. No redraw.`);
    }
}


/**
 * Clears the canvas and redraws all commands currently stored in `_fullDrawHistory`.
 */
export function redrawCanvasFromHistory() { // Make exportable if needed elsewhere, otherwise keep internal
    const context = getContext();
    const canvas = getCanvas();
    if (!context || !canvas) return;
    console.log(`[redrawCanvasFromHistory] Redrawing canvas from ${_fullDrawHistory.length} commands.`); // Added logging context

    // Save current context state
    context.save();

    // Clear canvas with background color
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay(); // Also clear the overlay

    // Execute each command in the history
    // Use a temporary copy in case history is modified during iteration (less likely here)
    const historyToDraw = [..._fullDrawHistory];
     historyToDraw.forEach(cmd => {
        try {
            executeCommand(cmd, context);
        } catch (error) {
            console.error("[redrawCanvasFromHistory] Error redrawing command:", cmd, error);
            // Optionally remove the faulty command from history here
        }
    });

    // Restore context state
    context.restore();

    console.log("[redrawCanvasFromHistory] Canvas redraw complete.");
    // Restore cursor preview if mouse is still over canvas (handled by overlayManager)
    // updateCursorPreviewIfNeeded(); // Let overlayManager handle this based on state
}


/**
 * Adds a command received from an external source (another player) to the history and draws it.
 * Skips the command if it originated from the local player.
 * @param {Object} data - The drawing command object received from the server.
 */
export function drawExternalCommand(data) {
    const myPlayerId = getPlayerId();
    const context = getContext();
    // Skip if the command is from the local player (already drawn) or invalid
    if (!data || !data.cmdId || !data.playerId) {
        console.warn("Invalid external command received:", data);
        return;
    }
    if (data.playerId === myPlayerId) {
        // console.log("Skipping own external command:", data.cmdId);
        return;
    }

    // Handle 'clear' command from others by removing their history
    if (data.type === 'clear') {
        console.log(`Received 'clear' command from player ${data.playerId}. Removing their history.`);
        const theirCmdIds = [];
        _fullDrawHistory.forEach(cmd => { // Use internal history
            if (cmd.playerId === data.playerId) {
                theirCmdIds.push(cmd.cmdId);
            }
        });
        if (theirCmdIds.length > 0) {
            removeCommands(theirCmdIds, null, data.playerId); // Remove their commands
            // Redraw is handled within removeCommands
        }
        return; // Don't add the 'clear' command itself to history
    }

    // Add the valid external command to the full history
    addCommandToHistory(data); // Use the controlled add function

    // Execute the command on the main canvas context
    try {
        executeCommand(data, context);
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}


/**
 * Clears the canvas of the current player's drawings and optionally emits event.
 * @param {boolean} [emitEvent=true] - Whether to emit a 'clear' event to the server.
 */
export function clearCanvas(emitEvent = true) {
    const context = getContext();
    const canvas = getCanvas();
    const myPlayerId = getPlayerId();
    const emitCallback = getEmitCallback();

    if (!context || !canvas) return;

    // Find all command IDs belonging to the current player
    const myCmdIds = [];
    _fullDrawHistory.forEach(cmd => { // Use internal history
        if (cmd.playerId === myPlayerId) {
            myCmdIds.push(cmd.cmdId);
        }
    });

    // If any commands were found, remove them locally and redraw
    if (myCmdIds.length > 0) {
        removeCommands(myCmdIds, null, myPlayerId); // Remove by IDs, specify owner
        console.log("Locally removed all my drawing commands."); // Message adjusted
        // Redraw is handled within removeCommands
    } else {
        console.log("No local drawing commands to clear.");
    }

    // Emit a 'clear' event to the server if requested and possible
    if (emitEvent && emitCallback && myPlayerId) {
        const cmdId = generateCommandId();
        const command = { cmdId, type: 'clear', playerId: myPlayerId }; // Include playerId
        emitCallback(command);
        console.log("Emitted 'clear' command to server.");
    }
}