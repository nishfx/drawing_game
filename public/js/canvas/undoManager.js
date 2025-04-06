/* public/js/canvas/undoManager.js */
// Handles the undo functionality.

import { getPlayerId } from './canvasCore.js'; // Removed getSocketRef import
import { getMyDrawHistory, getFullDrawHistory, removeCommands, redrawCanvasFromHistory } from './historyManager.js';

// Accept socket as an argument
export function undoLastAction(socket) {
    const myPlayerId = getPlayerId();
    // const socket = getSocketRef(); // Don't get socket from core anymore
    const myDrawHistory = getMyDrawHistory(); // Get current history state
    const fullDrawHistory = getFullDrawHistory(); // Get current full history

    if (!myPlayerId) {
        console.warn("Cannot undo: Player ID not set.");
        return;
    }
    if (myDrawHistory.length === 0) {
        console.log("Nothing in local history to undo.");
        return;
    }

    // Get the most recent command added by the local player
    const lastMyCommand = myDrawHistory.pop(); // Modify the actual history array

    if (!lastMyCommand || !lastMyCommand.cmdId) {
        console.error("Invalid command found during undo:", lastMyCommand);
        redrawCanvasFromHistory(); // Attempt to redraw to potentially fix state
        return;
    }

    const strokeIdToUndo = lastMyCommand.strokeId;
    const cmdIdToUndo = lastMyCommand.cmdId;

    console.log(`Initiating undo for stroke=${strokeIdToUndo} or cmd=${cmdIdToUndo}.`);

    // Determine what to remove from the *full* history
    let idsToRemoveFromFull = []; // Keep track of specific IDs for server message if needed
    if (strokeIdToUndo) {
        // If it was part of a stroke, find all commands with that stroke ID
        fullDrawHistory.forEach(cmd => {
            if (cmd.strokeId === strokeIdToUndo && cmd.playerId === myPlayerId) {
                idsToRemoveFromFull.push(cmd.cmdId); // Collect IDs for server message
            }
        });
        console.log(`[undoManager] Found ${idsToRemoveFromFull.length} commands matching strokeId ${strokeIdToUndo}.`); // Added log
    } else {
        // If it was a single command (fill, shape, text), just use that one ID
        idsToRemoveFromFull.push(cmdIdToUndo);
        console.log(`[undoManager] Found single command ${cmdIdToUndo}.`); // Added log
    }

    // If there's anything to remove (locally or for server)
    if (idsToRemoveFromFull.length > 0) {
        // Use the historyManager's remove function.
        // Prioritize removing by strokeId if it exists.
        removeCommands(
            strokeIdToUndo ? [] : idsToRemoveFromFull, // Pass cmdIds ONLY if no strokeId
            strokeIdToUndo, // Pass the strokeId if it exists
            myPlayerId
        );

        // Ask the server to remove these commands for other players
        if (socket && socket.connected) {
            // Send either the strokeId (if available) or the list of cmdIds
            const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdIds: idsToRemoveFromFull };
            socket.emit('undo last draw', undoData);
            console.log("Sent undo request to server:", undoData);
        } else {
            console.error("Cannot send undo request: No socket or socket not connected.");
            // Consider adding the command back to myDrawHistory if server fails?
            // For now, local state is already updated.
        }
    } else {
        console.warn("Undo failed: Could not find commands to remove from full history for:", lastMyCommand);
        // Put the command back into myDrawHistory if removal failed?
        myDrawHistory.push(lastMyCommand); // Add it back if nothing was removed
        redrawCanvasFromHistory(); // Redraw anyway to be safe
    }
}