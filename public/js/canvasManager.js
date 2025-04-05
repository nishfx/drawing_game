// public/js/canvasManager.js
import { floodFill, getPixelColor } from './drawing/fillUtil.js';

let canvas = null;
let context = null;
let overlayCanvas = null;
let overlayCtx = null;

let isDrawing = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0;
let currentMouseY = 0;
let isMouseOverCanvas = false;
let drawingEnabled = false;
let myPlayerId = null;

let currentTool = 'pencil';
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;
const CANVAS_BACKGROUND_COLOR = "#FFFFFF";

let currentStrokeId = null;

let myDrawHistory = [];
let fullDrawHistory = [];
const MAX_HISTORY = 500;

let emitDrawCallback = null;

// -------------------------------------

export function initCanvas(canvasId, drawEventEmitter) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error("Canvas element not found:", canvasId);
        return false;
    }
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
        console.error("Failed to get 2D context");
        return false;
    }

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = canvas.offsetTop + 'px';
    overlayCanvas.style.left = canvas.offsetLeft + 'px';
    overlayCanvas.style.width = canvas.clientWidth + 'px';
    overlayCanvas.style.height = canvas.clientHeight + 'px';
    overlayCanvas.style.pointerEvents = 'none';
    canvas.parentNode.insertBefore(overlayCanvas, canvas);
    overlayCtx = overlayCanvas.getContext('2d');

    emitDrawCallback = drawEventEmitter;

    // Fill background
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    overlayCtx.strokeStyle = currentStrokeStyle;
    overlayCtx.lineWidth = currentLineWidth;
    overlayCtx.lineJoin = 'round';
    overlayCtx.lineCap = 'round';

    // Event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseenter', handleMouseEnter);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    console.log(`Canvas "${canvasId}" initialized`);
    clearHistory();
    disableDrawing();
    return true;
}

export function setPlayerId(playerId) {
    myPlayerId = playerId;
    console.log("CanvasManager Player ID set to:", myPlayerId);
}

export function enableDrawing() {
    if (!canvas) return;
    drawingEnabled = true;
    console.log("Drawing enabled");
    setCursorStyle();
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false;
    currentStrokeId = null;
    clearOverlay();
    canvas.style.cursor = 'not-allowed';
    console.log("Drawing disabled");
}

/**
 * Removes only *my* lines from the local history, then emits “clear” so
 * the server knows to remove my lines from everyone’s display.
 */
export function clearCanvas(emitEvent = true) {
    if (!context || !canvas) return;

    // Remove only my commands from local history
    const myCmdIds = [];
    fullDrawHistory.forEach(cmd => {
        if (cmd.playerId === myPlayerId) {
            myCmdIds.push(cmd.cmdId);
        }
    });
    if (myCmdIds.length > 0) {
        removeCommands(myCmdIds, null, myPlayerId); // <-- CHANGED (adding myPlayerId)
    }

    console.log("Locally removed all my lines (clear). Redrawing...");
    redrawCanvasFromHistory();

    // Let server know
    if (emitEvent && emitDrawCallback && myPlayerId) {
        const cmdId = generateCommandId();
        const command = { cmdId, type: 'clear' };
        emitDrawCallback(command);
    }
}

/**
 * Return PNG data URL of entire canvas
 */
export function getDrawingDataURL() {
    if (!canvas) return null;
    try {
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Error getting canvas data URL:", e);
        return null;
    }
}

// ------------------ TOOL SETTINGS -------------------

export function setTool(toolName) {
    currentTool = toolName;
    console.log("Tool set to:", currentTool);
    if (context && currentTool !== 'eraser') {
        context.globalCompositeOperation = 'source-over';
    }
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    } else {
        setCursorStyle();
        clearOverlay();
    }
}

export function setColor(color) {
    currentStrokeStyle = color;
    if (context) context.strokeStyle = currentStrokeStyle;
    if (overlayCtx) overlayCtx.strokeStyle = currentStrokeStyle;
    console.log("Color set to:", currentStrokeStyle);
    if (isMouseOverCanvas && (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'fill')) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5;
    if (context) context.lineWidth = currentLineWidth;
    if (overlayCtx) overlayCtx.lineWidth = currentLineWidth;
    console.log("Line width set to:", currentLineWidth);
    if (isMouseOverCanvas && (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'fill')) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

// -------------- HISTORY & REDRAW --------------------
function generateCommandId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}
function generateStrokeId() {
    return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

function addCommandToHistory(command, playerId) {
    const fullCommand = { ...command, playerId };
    fullDrawHistory.push(fullCommand);
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift();
    }
    if (playerId === myPlayerId && command.type !== 'clear') {
        myDrawHistory.push(command);
        if (myDrawHistory.length > MAX_HISTORY) {
            myDrawHistory.shift();
        }
    }
}

function clearHistory() {
    myDrawHistory = [];
    fullDrawHistory = [];
}

export function loadAndDrawHistory(commands) {
    console.log(`Loading ${commands.length} commands from history.`);
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearHistory();
    fullDrawHistory = commands.map(cmd => ({ ...cmd }));

    myDrawHistory = fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear')
        .map(({ playerId, ...rest }) => rest);

    redrawCanvasFromHistory();
}

/**
 * ***CHANGED***: Now we accept an optional `ownerPlayerId`.
 * We remove only those commands that match the given cmdId/strokeId **AND** match the `ownerPlayerId`.
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) { // <-- CHANGED
    let removedCount = 0;

    if (strokeIdToRemove) {
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            // Remove only if the strokeId matches, AND if playerId matches (when provided)
            if (
                cmd.strokeId === strokeIdToRemove &&
                (!ownerPlayerId || cmd.playerId === ownerPlayerId)
            ) {
                removedCount++;
                return false;
            }
            return true;
        });
        // Also remove from myDrawHistory if it's my stroke
        myDrawHistory = myDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId) {
                return false;
            }
            return true;
        });
        console.log(`Removed ${removedCount} commands for stroke ${strokeIdToRemove} of player ${ownerPlayerId}.`);
    } else if (idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (
                idSet.has(cmd.cmdId) &&
                (!ownerPlayerId || cmd.playerId === ownerPlayerId)
            ) {
                removedCount++;
                return false;
            }
            return true;
        });
        myDrawHistory = myDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId) {
                return false;
            }
            return true;
        });
        console.log(`Removed ${removedCount} commands by ID(s) from player ${ownerPlayerId}.`);
    }

    if (removedCount > 0) {
        redrawCanvasFromHistory();
    } else {
        console.warn(`No commands found for removal by player=${ownerPlayerId}, stroke=${strokeIdToRemove}, IDs=${idsToRemove.join(', ')}`);
    }
}

function redrawCanvasFromHistory() {
    if (!context || !canvas) return;
    console.log(`Redrawing canvas from ${fullDrawHistory.length} commands.`);
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    const originalStroke = context.strokeStyle;
    const originalFill = context.fillStyle;
    const originalWidth = context.lineWidth;
    const originalComposite = context.globalCompositeOperation;
    const originalCap = context.lineCap;
    const originalJoin = context.lineJoin;

    fullDrawHistory.forEach(cmd => {
        try {
            executeCommand(cmd, context);
        } catch (error) {
            console.error("Error redrawing command:", cmd, error);
        }
    });

    context.strokeStyle = originalStroke;
    context.fillStyle = originalFill;
    context.lineWidth = originalWidth;
    context.globalCompositeOperation = originalComposite;
    context.lineCap = originalCap;
    context.lineJoin = originalJoin;

    console.log("Canvas redraw complete.");
    if (isMouseOverCanvas) updateCursorPreview(currentMouseX, currentMouseY);
}

/**
 * Executes a single command on the given context.
 * Called from redrawCanvasFromHistory & in drawExternalCommand fallback.
 */
function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) return;

    ctx.strokeStyle = cmd.color || currentStrokeStyle;
    ctx.lineWidth = cmd.size || currentLineWidth;
    ctx.fillStyle = cmd.color || currentStrokeStyle;

    switch (cmd.type) {
        case 'line':
            // For local "line" commands, we typically do context.beginPath in handleMouseDown.
            // But for replays, let's be sure to do it here:
            ctx.globalCompositeOperation = cmd.tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.beginPath();
            ctx.moveTo(cmd.x0, cmd.y0);
            ctx.lineTo(cmd.x1, cmd.y1);
            ctx.stroke();
            ctx.closePath();
            ctx.globalCompositeOperation = 'source-over';
            break;

        case 'rect': {
            ctx.globalCompositeOperation = 'source-over';
            const x = Math.min(cmd.x0, cmd.x1);
            const y = Math.min(cmd.y0, cmd.y1);
            const w = Math.abs(cmd.x1 - cmd.x0);
            const h = Math.abs(cmd.y1 - cmd.y0);
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.stroke();
            ctx.closePath();
            break;
        }
        case 'ellipse': {
            ctx.globalCompositeOperation = 'source-over';
            ctx.beginPath();
            ctx.ellipse(cmd.cx, cmd.cy, cmd.rx, cmd.ry, 0, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.closePath();
            break;
        }
        case 'fill':
            ctx.globalCompositeOperation = 'source-over';
            floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
            break;
        case 'clear':
            // We do nothing here, the actual commands are removed from history
            break;
        default:
            console.warn("Unknown command type during redraw:", cmd.type);
    }
}

/**
 * ***CHANGED***: We do a fresh path each time we draw an external line,
 * so that local and remote strokes don’t get merged if multiple players draw at once.
 */
export function drawExternalCommand(data) {
    if (!context || !data || !data.cmdId || !data.playerId) {
        console.warn("Invalid external command:", data);
        return;
    }

    if (data.type === 'clear') {
        // Another player's "clear" => server will soon send 'lobby commands removed'
        return;
    }

    // FIRST, add it to local history
    addCommandToHistory(data, data.playerId);

    try {
        // *** We do a short save/restore + fresh path so it won’t connect to local strokes ***
        context.save();
        if (data.type === 'line') {
            context.beginPath();
            context.globalCompositeOperation = data.tool === 'eraser' ? 'destination-out' : 'source-over';
            context.moveTo(data.x0, data.y0);
            context.lineTo(data.x1, data.y1);
            context.stroke();
            context.closePath();
            // reset
            context.globalCompositeOperation = 'source-over';
        } else {
            // For shapes/fill, we rely on executeCommand
            executeCommand(data, context);
        }
        context.restore();
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

/**
 * Undo your last stroke. Only affects your lines.
 */
export function undoLastAction(socket) {
    if (!myPlayerId) {
        console.warn("Cannot undo: Player ID not set.");
        return;
    }
    if (myDrawHistory.length === 0) {
        console.log("Nothing in local history to undo.");
        return;
    }

    const lastMyCommand = myDrawHistory[myDrawHistory.length - 1];
    if (!lastMyCommand || !lastMyCommand.cmdId) {
        console.error("Invalid command for undo:", lastMyCommand);
        myDrawHistory.pop();
        redrawCanvasFromHistory();
        return;
    }

    const strokeIdToUndo = lastMyCommand.strokeId;
    const cmdIdToUndo = lastMyCommand.cmdId;

    console.log(`Requesting undo for stroke=${strokeIdToUndo} or cmd=${cmdIdToUndo}`);

    // Remove locally
    if (strokeIdToUndo) {
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToUndo);
    } else {
        myDrawHistory.pop();
    }

    // Also tell server
    if (socket && socket.connected) {
        const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdId: cmdIdToUndo };
        socket.emit('undo last draw', undoData);
    } else {
        console.error("Cannot emit undo, no socket. Doing local redraw only.");
        redrawCanvasFromHistory();
    }
}

// ---------------------------------------------------
// Internal drawing logic / event helpers
// ---------------------------------------------------
function getEventCoords(e) {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        e.preventDefault();
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const xRel = clientX - rect.left;
    const yRel = clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = xRel * scaleX;
    const canvasY = yRel * scaleY;
    return { x: canvasX, y: canvasY };
}

function setCursorForTool(tool) {
    if (!canvas) return;
    let cursorStyle = 'crosshair';
    switch (tool) {
        case 'eraser':
            cursorStyle = `url('data:image/svg+xml;utf8,<svg...') 10 10, auto`;
            break;
        case 'fill':
            cursorStyle = 'copy';
            break;
        default:
            cursorStyle = 'crosshair';
            break;
    }
    canvas.style.cursor = cursorStyle;
}

function setCursorStyle() {
    if (!canvas) return;
    const showPreview = isMouseOverCanvas && !isDrawing && (
        currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'fill'
    );

    if (showPreview || isDrawing) {
        canvas.style.cursor = 'none';
    } else if (!drawingEnabled) {
        canvas.style.cursor = 'not-allowed';
    } else {
        setCursorForTool(currentTool);
    }
}

function clearOverlay() {
    if (!overlayCtx || !overlayCanvas) return;
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
    }
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawCursorPreview(x, y) {
    if (!overlayCtx || !drawingEnabled || isDrawing) {
        clearOverlay();
        return;
    }
    clearOverlay();
    const radius = currentLineWidth / 2;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2);
    overlayCtx.strokeStyle = (currentTool === 'eraser') ? '#555555' : currentStrokeStyle;
    overlayCtx.lineWidth = 1;
    overlayCtx.stroke();
    overlayCtx.closePath();

    overlayCtx.lineWidth = currentLineWidth;
    overlayCtx.strokeStyle = currentStrokeStyle;
}

function updateCursorPreview(x, y) {
    if (!isMouseOverCanvas || isDrawing) {
        clearOverlay();
    } else if (currentTool === 'pencil' || currentTool === 'eraser' || currentTool === 'fill') {
        drawCursorPreview(x, y);
    } else {
        clearOverlay();
    }
    setCursorStyle();
}

// --------------- Event Handlers ---------------
function handleMouseEnter(e) {
    isMouseOverCanvas = true;
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;
    updateCursorPreview(x, y);
}

function handleMouseLeave(e) {
    isMouseOverCanvas = false;
    clearOverlay();
    setCursorStyle();
}

function handleMouseDown(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled || !myPlayerId) return;

    isMouseOverCanvas = true;
    const { x, y } = getEventCoords(e);
    isDrawing = true;
    startX = x;
    startY = y;
    lastX = x;
    lastY = y;
    currentMouseX = x;
    currentMouseY = y;

    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.fillStyle = currentStrokeStyle;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    clearOverlay();
    setCursorStyle();

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        currentStrokeId = generateStrokeId();
        context.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(startX, startY);
    } else if (currentTool === 'fill') {
        isDrawing = false;
        currentStrokeId = null;
    }
}

function handleMouseMove(e) {
    if (!drawingEnabled || !myPlayerId) return;
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;

    if (!isDrawing) {
        updateCursorPreview(x, y);
        return;
    }

    switch (currentTool) {
        case 'pencil':
        case 'eraser':
            drawLocalSegment(lastX, lastY, x, y);
            emitDrawSegment(lastX, lastY, x, y);
            lastX = x;
            lastY = y;
            break;
    }
}

function handleMouseUp(e) {
    const wasDrawing = isDrawing;
    const toolUsed = currentTool;

    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false;
        currentStrokeId = null;
        return;
    }

    const x = currentMouseX;
    const y = currentMouseY;

    if (toolUsed === 'fill') {
        if (!wasDrawing && startX !== null && startY !== null && e.target === canvas) {
            const cmdId = generateCommandId();
            const command = { cmdId, type: 'fill', x, y, color: currentStrokeStyle };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (toolUsed === 'pencil' || toolUsed === 'eraser') {
        if (wasDrawing) {
            if (x === lastX && y === lastY) {
                // single click => dot
                drawLocalSegment(x, y, x + 0.01, y + 0.01);
                emitDrawSegment(x, y, x + 0.01, y + 0.01);
            } else {
                if (x !== lastX || y !== lastY) {
                    drawLocalSegment(lastX, lastY, x, y);
                    emitDrawSegment(lastX, lastY, x, y);
                }
            }
            context.closePath();
        }
    }

    isDrawing = false;
    currentStrokeId = null;
    startX = null;
    startY = null;

    if (isMouseOverCanvas) {
        updateCursorPreview(x, y);
    } else {
        setCursorStyle();
    }
}

// Touch
function handleTouchStart(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled) return;
    if (e.touches.length > 0) {
        isMouseOverCanvas = true;
        handleMouseDown(e);
    }
}

function handleTouchMove(e) {
    if (!drawingEnabled) return;
    if (e.touches.length > 0) {
        handleMouseMove(e);
    }
}

function handleTouchEnd(e) {
    const wasDrawing = isDrawing;
    const toolUsed = currentTool;

    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false;
        currentStrokeId = null;
        return;
    }

    if (e.changedTouches.length > 0) {
        const pseudoEvent = {
            clientX: e.changedTouches[0].clientX,
            clientY: e.changedTouches[0].clientY,
            preventDefault: () => {}
        };
        getEventCoords(pseudoEvent);
        handleMouseUp.call({ isDrawing: wasDrawing, currentTool: toolUsed }, pseudoEvent);
    } else {
        isDrawing = false;
        currentStrokeId = null;
        if (context) context.closePath();
        clearOverlay();
    }
    isMouseOverCanvas = false;
    setCursorStyle();
}

function emitDrawSegment(x0, y0, x1, y1) {
    if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;
    const cmdId = generateCommandId();
    const command = {
        cmdId, strokeId: currentStrokeId, type: 'line',
        x0, y0, x1, y1,
        tool: currentTool,
        color: currentTool === 'eraser' ? null : currentStrokeStyle,
        size: currentLineWidth
    };
    addCommandToHistory(command, myPlayerId);
    emitDrawCallback(command);
}

function drawLocalSegment(x0, y0, x1, y1) {
    if (!context) return;
    context.lineTo(x1, y1);
    context.stroke();
}
