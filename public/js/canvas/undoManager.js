/* public/js/canvas/undoManager.js */
// Handles the undo functionality.

import { getPlayerId } from './canvasCore.js';
// Import specific history functions needed
import { popLastMyCommand, removeCommands, redrawCanvasFromHistory, getFullDrawHistory_DEBUG } from './historyManager.js';

// Accept socket as an argument
export function undoLastAction(socket) {
    const myPlayerId = getPlayerId();
    const lastMyCommand = popLastMyCommand();
    if (!lastMyCommand) {
        console.log("[UNDO] No commands in local history to undo.");
        return;
    }

    if (!lastMyCommand.cmdId) {
        console.error("[UNDO] Invalid command popped:", lastMyCommand);
        redrawCanvasFromHistory();
        return;
    }

    const strokeIdToUndo = lastMyCommand.strokeId;
    const cmdIdToUndo = lastMyCommand.cmdId;

    // ★ DEBUG LOG
    console.log(`[UNDO] lastMyCommand => type=${lastMyCommand.type}, strokeId=${strokeIdToUndo}, cmdId=${cmdIdToUndo}`);

    let idsToRemove = [];
    let strokeIdToRemove = null;
    let undoDataForServer = {};

    if (strokeIdToUndo) {
        strokeIdToRemove = strokeIdToUndo;
        undoDataForServer = { strokeId: strokeIdToUndo };
        const fullHist = getFullDrawHistory_DEBUG();
        const matching = fullHist.filter(cmd => cmd.strokeId === strokeIdToUndo && cmd.playerId === myPlayerId);
        console.log(`[UNDO] Attempt removing strokeId=${strokeIdToUndo} => ${matching.length} matches in full history.`);
    } else {
        idsToRemove.push(cmdIdToUndo);
        undoDataForServer = { cmdIds: [cmdIdToUndo] };
        console.log(`[UNDO] Attempt removing single cmdId=${cmdIdToUndo}.`);
    }

    removeCommands(idsToRemove, strokeIdToRemove, myPlayerId);

    if (socket && socket.connected) {
        socket.emit('undo last draw', undoDataForServer);
        console.log("[UNDO] Sent request to server =>", undoDataForServer);
    } else {
        console.error("[UNDO] No socket or not connected, cannot sync with server.");
    }
}