/* public/js/canvas/historyManager.js */

import { getContext, getCanvas, getPlayerId, CANVAS_BACKGROUND_COLOR, getEmitCallback, clearOverlay } from './canvasCore.js';
import { executeCommand } from './drawingExecutor.js';
import { generateCommandId } from './canvasUtils.js';

let _myDrawHistory = [];
let _fullDrawHistory = [];
const MAX_HISTORY = 500; // Adjust as needed

// --- GETTERS (debug) ---
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
 * Adds a completed command to the histories.
 */
export function addCommandToHistory(command) {
    const myPlayerId = getPlayerId();
    if (!command || !command.playerId || !command.cmdId) {
        console.warn("[addCommandToHistory] Invalid command:", command);
        return;
    }

    // [DEBUG ADDED]
    console.log(`[HISTORY] ADD cmdId=${command.cmdId}, strokeId=${command.strokeId}, type=${command.type}, player=${command.playerId}`);

    _fullDrawHistory.push(command);
    if (_fullDrawHistory.length > MAX_HISTORY) {
        const removed = _fullDrawHistory.shift();
        console.warn(`[HISTORY] _fullDrawHistory exceeded ${MAX_HISTORY}, SHIFTED out cmdId=${removed?.cmdId}, strokeId=${removed?.strokeId}, type=${removed?.type}`);
    }

    if (command.playerId === myPlayerId && command.type !== 'clear') {
        _myDrawHistory.push(command);
        if (_myDrawHistory.length > MAX_HISTORY) {
            const removedLocal = _myDrawHistory.shift();
            console.warn(`[HISTORY] _myDrawHistory exceeded ${MAX_HISTORY}, SHIFTED out cmdId=${removedLocal?.cmdId}, strokeId=${removedLocal?.strokeId}, type=${removedLocal?.type}`);
        }
    }

    // [DEBUG ADDED] Log current lengths
    console.log(`[DEBUG] _fullDrawHistory.size=${_fullDrawHistory.length}, _myDrawHistory.size=${_myDrawHistory.length}`);
}

/**
 * Removes and returns the last command added by the local player.
 */
export function popLastMyCommand() {
    if (_myDrawHistory.length === 0) {
        return null;
    }
    const popped = _myDrawHistory.pop();
    console.log(`[HISTORY] popLastMyCommand => cmdId=${popped?.cmdId}, strokeId=${popped?.strokeId}, type=${popped?.type}`);
    return popped;
}

/**
 * Loads a complete history of commands (e.g., from server) and redraws.
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
 * Removes specific commands from internal history by cmdIds or strokeId (if owner matches).
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    if (!ownerPlayerId) {
        console.warn("[removeCommands] called without ownerPlayerId, skipping.");
        return;
    }
    let removedCount = 0;

    console.log(`[HISTORY] removeCommands stroke=${strokeIdToRemove}, cmdIds=[${idsToRemove}], owner=${ownerPlayerId}`);

    if (strokeIdToRemove) {
        _fullDrawHistory = _fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId) {
                // [DEBUG ADDED]
                console.log(`[HISTORY] REMOVING (stroke match) cmdId=${cmd.cmdId}, strokeId=${cmd.strokeId}, type=${cmd.type}`);
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
                // [DEBUG ADDED]
                console.log(`[HISTORY] REMOVING (cmdId match) cmdId=${cmd.cmdId}, strokeId=${cmd.strokeId}, type=${cmd.type}`);
                removedCount++;
                return false;
            }
            return true;
        });
        _myDrawHistory = _myDrawHistory.filter(cmd => !(idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId));
    }

    if (removedCount > 0) {
        redrawCanvasFromHistory();
        console.log(`[HISTORY] removeCommands => removed ${removedCount} commands, now redrawn with _fullDrawHistory.size=${_fullDrawHistory.length}`);
    } else {
        console.log("[HISTORY] removeCommands => no matching commands found to remove.");
    }
}

/**
 * Clears and redraws all commands from _fullDrawHistory onto the canvas.
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

    for (let cmd of _fullDrawHistory) {
        try {
            // [DEBUG ADDED]
            console.log(`[HISTORY] Replaying cmdId=${cmd.cmdId}, strokeId=${cmd.strokeId}, type=${cmd.type}`);
            executeCommand(cmd, ctx);
        } catch (err) {
            console.error("[HISTORY] Error redrawing command:", cmd, err);
        }
    }
    ctx.restore();
    console.log("[HISTORY] ...done redraw.");
}

/**
 * Adds a command from an external source to full history and draws it.
 */
export function drawExternalCommand(data) {
    const myPlayerId = getPlayerId();
    const context = getContext();
    if (!data || !data.cmdId || !data.playerId) {
        console.warn("Invalid external command received:", data);
        return;
    }
    if (data.playerId === myPlayerId) {
        return;
    }

    // Handle 'clear' command from others
    if (data.type === 'clear') {
        console.log(`Received 'clear' command from player ${data.playerId}. Removing their history.`);
        const theirCmdIds = [];
        _fullDrawHistory.forEach(cmd => {
            if (cmd.playerId === data.playerId) {
                theirCmdIds.push(cmd.cmdId);
            }
        });
        if (theirCmdIds.length > 0) {
            removeCommands(theirCmdIds, null, data.playerId);
        }
        return;
    }

    addCommandToHistory(data);

    try {
        executeCommand(data, context);
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

/**
 * Clears the canvas of the current player's drawings, optionally emitting event.
 */
export function clearCanvas(emitEvent = true) {
    const context = getContext();
    const canvas = getCanvas();
    const myPlayerId = getPlayerId();
    const emitCallback = getEmitCallback();

    if (!context || !canvas) return;

    const myCmdIds = [];
    _fullDrawHistory.forEach(cmd => {
        if (cmd.playerId === myPlayerId) {
            myCmdIds.push(cmd.cmdId);
        }
    });

    if (myCmdIds.length > 0) {
        removeCommands(myCmdIds, null, myPlayerId);
        console.log("Locally removed all my drawing commands.");
    } else {
        console.log("No local drawing commands to clear.");
    }

    if (emitEvent && emitCallback && myPlayerId) {
        const cmdId = generateCommandId();
        const command = { cmdId, type: 'clear', playerId: myPlayerId };
        emitCallback(command);
        console.log("Emitted 'clear' command to server.");
    }
}
