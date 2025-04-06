/* public/js/canvas/undoManager.js */
// Handles the undo functionality.

import { getPlayerId } from './canvasCore.js';
// Import specific history functions needed
import { popLastMyCommand, removeCommands, redrawCanvasFromHistory, getFullDrawHistory_DEBUG } from './historyManager.js';

// Accept socket as an argument
export function undoLastAction(socket) {
    const myPlayerId = getPlayerId();

    // Get the most recent command added by the local player
    const lastMyCommand = popLastMyCommand(); // Use the controlled pop function

    if (!lastMyCommand) {
        console.log("Nothing in local history to undo.");
        return;
    }

    if (!lastMyCommand.cmdId) { // Basic validation
        console.error("Invalid command popped during undo:", lastMyCommand);
        redrawCanvasFromHistory(); // Attempt to redraw to potentially fix state
        return;
    }

    const strokeIdToUndo = lastMyCommand.strokeId;
    const cmdIdToUndo = lastMyCommand.cmdId; // Only used if strokeId is null

    console.log(`Initiating undo for stroke=${strokeIdToUndo} or cmd=${cmdIdToUndo}.`);

    // Determine what to remove from the *full* history and what to send to server
    let idsToRemoveLocally = [];
    let strokeIdToRemoveLocally = null;
    let undoDataForServer = {};

    if (strokeIdToUndo) {
        // If it was part of a stroke, we remove by strokeId locally and tell server the strokeId
        strokeIdToRemoveLocally = strokeIdToUndo;
        undoDataForServer = { strokeId: strokeIdToUndo };
        // We don't need to collect individual IDs for local removal when using strokeId
        // But let's log how many *might* be removed for debugging:
        const fullHistory = getFullDrawHistory_DEBUG(); // Use debug getter
        const matchingCmds = fullHistory.filter(cmd => cmd.strokeId === strokeIdToUndo && cmd.playerId === myPlayerId);
        console.log(`[undoManager] Will attempt to remove strokeId ${strokeIdToUndo}. Found ${matchingCmds.length} potential matching commands in full history.`);

    } else {
        // If it was a single command (fill, shape, text), remove by cmdId locally and tell server the cmdId
        idsToRemoveLocally.push(cmdIdToUndo);
        undoDataForServer = { cmdIds: [cmdIdToUndo] }; // Send specific ID
        console.log(`[undoManager] Will attempt to remove single command ${cmdIdToUndo}.`);
    }

    // Perform the local removal using historyManager's removeCommands
    // This function also handles the redraw
    removeCommands(
        idsToRemoveLocally,      // Pass cmdIds ONLY if no strokeId
        strokeIdToRemoveLocally, // Pass the strokeId if it exists
        myPlayerId
    );

    // Ask the server to remove these commands for other players
    if (socket && socket.connected) {
        socket.emit('undo last draw', undoDataForServer);
        console.log("Sent undo request to server:", undoDataForServer);
    } else {
        console.error("Cannot send undo request: No socket or socket not connected.");
        // Note: Local state is already updated. If server fails, clients might desync.
        // Could potentially try re-adding the command locally, but that's complex.
    }
}