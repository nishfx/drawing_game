/* public/js/canvas/undoManager.js */
// Handles the undo functionality.

import { getPlayerId, getSocketRef } from './canvasCore.js';
import { getMyDrawHistory, getFullDrawHistory, removeCommands, redrawCanvasFromHistory } from './historyManager.js';

export function undoLastAction() {
    const myPlayerId = getPlayerId();
    const socket = getSocketRef();
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
    // IMPORTANT: Modify the array returned by getMyDrawHistory directly
    // This assumes getMyDrawHistory returns a reference or we need a setter
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
    let idsToRemoveFromFull = [];
    if (strokeIdToUndo) {
        // If it was part of a stroke, find all commands with that stroke ID
        fullDrawHistory.forEach(cmd => {
            if (cmd.strokeId === strokeIdToUndo && cmd.playerId === myPlayerId) {
                idsToRemoveFromFull.push(cmd.cmdId);
            }
        });
        console.log(`Undo will remove ${idsToRemoveFromFull.length} commands for stroke ${strokeIdToUndo}.`);
    } else {
        // If it was a single command (fill, shape, text), just remove that one ID
        idsToRemoveFromFull.push(cmdIdToUndo);
        console.log(`Undo will remove single command ${cmdIdToUndo}.`);
    }

    // Remove the identified commands from the full history
    if (idsToRemoveFromFull.length > 0) {
        // Use the historyManager's remove function which handles redraw
        removeCommands(idsToRemoveFromFull, null, myPlayerId);

        // Ask the server to remove these commands for other players
        if (socket && socket.connected) {
            // Send either the strokeId (if available) or the list of cmdIds
            const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdIds: idsToRemoveFromFull };
            socket.emit('undo last draw', undoData);
            console.log("Sent undo request to server:", undoData);
        } else {
            console.error("Cannot send undo request: No socket connected.");
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