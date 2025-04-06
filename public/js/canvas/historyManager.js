/* public/js/canvas/historyManager.js */
// Manages the drawing history (local and full) and redraw operations.

// Import clearOverlay from canvasCore now
import { getContext, getCanvas, getPlayerId, CANVAS_BACKGROUND_COLOR, getEmitCallback, clearOverlay } from './canvasCore.js';
import { executeCommand } from './drawingExecutor.js';
// import { updateCursorPreview } from './overlayManager.js'; // Not needed directly here
import { generateCommandId } from './canvasUtils.js'; // Import ID generator

// --- History State ---
let myDrawHistory = []; // Stores command objects initiated by the local user for undo
let fullDrawHistory = []; // Stores all command objects from all users for redraw
const MAX_HISTORY = 500; // Limit history size

// --- Functions ---

export function getMyDrawHistory() {
    return myDrawHistory;
}

export function getFullDrawHistory() {
    return fullDrawHistory;
}

export function clearHistory() {
    myDrawHistory = [];
    fullDrawHistory = [];
    console.log("Local drawing history cleared.");
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

    // Populate local history arrays
    fullDrawHistory = commands.map(cmd => ({ ...cmd })); // Deep copy commands
    myDrawHistory = fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear') // Filter my non-clear commands
        .map(x => ({ ...x })); // Deep copy

    // Redraw everything
    redrawCanvasFromHistory();
}

/**
 * Removes specific drawing commands from the local history arrays based on
 * command IDs or a stroke ID, but only if they belong to the specified ownerPlayerId.
 * After removal, it triggers a full canvas redraw.
 * @param {Array<string>} [idsToRemove=[]] - An array of command IDs to remove.
 * @param {string|null} [strokeIdToRemove=null] - A stroke ID; all commands with this ID will be removed.
 * @param {string|null} ownerPlayerId - The ID of the player whose commands should be removed. Crucial to prevent removing others' work.
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    if (!ownerPlayerId) {
        console.warn("removeCommands called without ownerPlayerId. Skipping removal.");
        return;
    }
    let removedCount = 0;
    const initialFullLength = fullDrawHistory.length;
    const initialMyLength = myDrawHistory.length;

    if (strokeIdToRemove) {
        // Filter based on strokeId and ownerPlayerId
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId) {
                removedCount++;
                return false; // Exclude this command
            }
            return true; // Keep this command
        });
        myDrawHistory = myDrawHistory.filter(cmd => {
            return !(cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId);
        });
        console.log(`Removed ${removedCount} commands for stroke=${strokeIdToRemove} from player=${ownerPlayerId}.`);

    } else if (idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        // Filter based on command ID set and ownerPlayerId
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId) {
                removedCount++;
                return false; // Exclude this command
            }
            return true; // Keep this command
        });
        myDrawHistory = myDrawHistory.filter(cmd => {
            return !(idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId);
        });
        console.log(`Removed ${removedCount} commands by cmdId(s) from player=${ownerPlayerId}.`);
    }

    // If any commands were actually removed, redraw the canvas
    if (removedCount > 0) {
        console.log(`History lengths changed: Full ${initialFullLength}->${fullDrawHistory.length}, My ${initialMyLength}->${myDrawHistory.length}. Redrawing.`);
        redrawCanvasFromHistory();
    } else {
        console.warn(`No commands found to remove for stroke=${strokeIdToRemove}, cmdIds=${idsToRemove.length}, owner=${ownerPlayerId}.`);
    }
}

/**
 * Clears the canvas and redraws all commands currently stored in `fullDrawHistory`.
 */
export function redrawCanvasFromHistory() {
    const context = getContext();
    const canvas = getCanvas();
    if (!context || !canvas) return;
    console.log(`Redrawing canvas from ${fullDrawHistory.length} commands.`);

    // Save current context state
    context.save();

    // Clear canvas with background color
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay(); // Also clear the overlay

    // Execute each command in the history
    fullDrawHistory.forEach(cmd => {
        try {
            executeCommand(cmd, context);
        } catch (error) {
            console.error("Error redrawing command:", cmd, error);
            // Optionally remove the faulty command from history here
        }
    });

    // Restore context state
    context.restore();

    console.log("Canvas redraw complete.");
    // Restore cursor preview if mouse is still over canvas (handled by overlayManager)
    // updateCursorPreviewIfNeeded(); // Let overlayManager handle this based on state
}

/**
 * Adds a completed drawing command to the local history arrays.
 * @param {Object} command - The command object to add.
 */
export function addCommandToLocalHistory(command) {
    const myPlayerId = getPlayerId();
    // Add to the full history (used for redraws)
    fullDrawHistory.push(command);
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift(); // Prune oldest if history exceeds max size
    }

    // If it's a command initiated by the local player and not 'clear',
    // add it to the separate history used for the undo function.
    if (command.playerId === myPlayerId && command.type !== 'clear') {
        myDrawHistory.push(command);
        if (myDrawHistory.length > MAX_HISTORY) {
            myDrawHistory.shift(); // Prune oldest undoable command
        }
    }
}

/**
 * Adds a command received from another player to the history and draws it.
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
        fullDrawHistory.forEach(cmd => {
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
    fullDrawHistory.push({ ...data }); // Store a copy
    // Prune history if it exceeds the maximum size
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift(); // Remove the oldest command
    }

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
    fullDrawHistory.forEach(cmd => {
        if (cmd.playerId === myPlayerId) {
            myCmdIds.push(cmd.cmdId);
        }
    });

    // If any commands were found, remove them locally and redraw
    if (myCmdIds.length > 0) {
        removeCommands(myCmdIds, null, myPlayerId); // Remove by IDs, specify owner
        console.log("Locally removed all my drawing commands. Redrawing canvas...");
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