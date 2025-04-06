/* public/js/canvas/historyManager.js */

import { getContext, getCanvas, getPlayerId, CANVAS_BACKGROUND_COLOR, getEmitCallback, clearOverlay } from './canvasCore.js';
import { executeCommand } from './drawingExecutor.js';
import { generateCommandId } from './canvasUtils.js';

// Keep these to inspect
let _myDrawHistory = [];
let _fullDrawHistory = [];
const MAX_HISTORY = 500;

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
        console.warn("[addCommandToHistory] Invalid command:", command);
        return;
    }

    // ★ DEBUG LOG
    console.log(`[HISTORY] ADD cmdId=${command.cmdId}, strokeId=${command.strokeId}, type=${command.type}, player=${command.playerId}`);

    _fullDrawHistory.push(command);
    if (_fullDrawHistory.length > MAX_HISTORY) {
        _fullDrawHistory.shift();
    }

    if (command.playerId === myPlayerId && command.type !== 'clear') {
        _myDrawHistory.push(command);
        if (_myDrawHistory.length > MAX_HISTORY) {
            _myDrawHistory.shift();
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
    const popped = _myDrawHistory.pop();
    // ★ DEBUG LOG
    console.log(`[HISTORY] popLastMyCommand => cmdId=${popped?.cmdId}, strokeId=${popped?.strokeId}, type=${popped?.type}`);
    return popped;
}

/**
 * Loads a complete history of drawing commands (e.g., from the server)
 * and redraws the entire canvas based on this history.
 * @param {Array<Object>} commands - An array of drawing command objects.
 */
export function loadAndDrawHistory(commands) {
    const ctx = getContext();
    const canvas = getCanvas();
    if (!ctx || !canvas) return;
    console.log(`[HISTORY] Loading ${commands.length} commands from server...`);

    clearHistory();
    ctx.fillStyle = CANVAS_BACKGROUND_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    _fullDrawHistory = commands.map(cmd => ({ ...cmd }));
    const myId = getPlayerId();
    _myDrawHistory = _fullDrawHistory
      .filter(c => c.playerId === myId && c.type !== 'clear')
      .map(x => ({...x}));

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
        console.warn("[removeCommands] called without ownerPlayerId, skipping.");
        return;
    }
    let removedCount = 0;

    // ★ DEBUG LOG
    console.log(`[HISTORY] removeCommands stroke=${strokeIdToRemove}, cmdIds=${idsToRemove}, owner=${ownerPlayerId}`);

    if (strokeIdToRemove) {
        _fullDrawHistory = _fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId) {
                removedCount++;
                return false;
            }
            return true;
        });
        _myDrawHistory = _myDrawHistory.filter(cmd => !(cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId));
    } else if (idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        _fullDrawHistory = _fullDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId) {
                removedCount++;
                return false;
            }
            return true;
        });
        _myDrawHistory = _myDrawHistory.filter(cmd => !(idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId));
    }

    if (removedCount > 0) {
        redrawCanvasFromHistory();
        console.log(`[HISTORY] removeCommands => removed ${removedCount} commands, now redrawn.`);
    } else {
        console.log("[HISTORY] removeCommands => no matching commands found to remove.");
    }
}


/**
 * Clears the canvas and redraws all commands currently stored in `_fullDrawHistory`.
 */
export function redrawCanvasFromHistory() {
    const ctx = getContext();
    const canvas = getCanvas();
    if (!ctx || !canvas) return;

    console.log(`[HISTORY] Redraw from ${_fullDrawHistory.length} commands...`);
    ctx.save();
    ctx.fillStyle = CANVAS_BACKGROUND_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    [..._fullDrawHistory].forEach(cmd => {
        try {
            executeCommand(cmd, ctx);
        } catch (err) {
            console.error("[HISTORY] Error redrawing command:", cmd, err);
        }
    });
    ctx.restore();
    console.log("[HISTORY] ...done redraw.");
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