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

// For shape drawing
let shapeStartX = null;
let shapeStartY = null;

// For storing your own commands (so you can undo)
let myDrawHistory = [];
// For storing *all* commands (including other players); used for redraw
let fullDrawHistory = [];
const MAX_HISTORY = 500;

let emitDrawCallback = null;

// ------------------------------------------------
// Initialization
// ------------------------------------------------
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

    // Mouse events
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseenter', handleMouseEnter);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Touch events
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

// ------------------------------------------------
// Clearing and Exporting
// ------------------------------------------------
export function clearCanvas(emitEvent = true) {
    if (!context || !canvas) return;

    // Remove only *my* commands from local history
    const myCmdIds = [];
    fullDrawHistory.forEach(cmd => {
        if (cmd.playerId === myPlayerId) {
            myCmdIds.push(cmd.cmdId);
        }
    });

    if (myCmdIds.length > 0) {
        removeCommands(myCmdIds, null, myPlayerId);
    }
    console.log("Locally removed all my lines (clear). Redrawing...");
    redrawCanvasFromHistory();

    if (emitEvent && emitDrawCallback && myPlayerId) {
        const cmdId = generateCommandId();
        const command = { cmdId, type: 'clear' };
        emitDrawCallback(command);
    }
}

export function getDrawingDataURL() {
    if (!canvas) return null;
    try {
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Error getting canvas data URL:", e);
        return null;
    }
}

// ------------------------------------------------
// Tool Settings
// ------------------------------------------------
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
    if (isMouseOverCanvas &&
       (currentTool === 'pencil' || currentTool === 'eraser' ||
        currentTool === 'fill'   || currentTool === 'rectangle' ||
        currentTool === 'ellipse')) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5;
    if (context) context.lineWidth = currentLineWidth;
    if (overlayCtx) overlayCtx.lineWidth = currentLineWidth;
    console.log("Line width set to:", currentLineWidth);
    if (isMouseOverCanvas &&
       (currentTool === 'pencil' || currentTool === 'eraser' ||
        currentTool === 'fill'   || currentTool === 'rectangle' ||
        currentTool === 'ellipse')) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

// ------------------------------------------------
// History & Redraw
// ------------------------------------------------
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
        myDrawHistory.push(fullCommand);
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
        .map(x => ({ ...x }));

    redrawCanvasFromHistory();
}

export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    let removedCount = 0;

    if (strokeIdToRemove) {
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove &&
                (!ownerPlayerId || cmd.playerId === ownerPlayerId)) {
                removedCount++;
                return false;
            }
            return true;
        });
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
            if (idSet.has(cmd.cmdId) &&
                (!ownerPlayerId || cmd.playerId === ownerPlayerId)) {
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
        console.warn(`No commands found to remove for stroke=${strokeIdToRemove}, player=${ownerPlayerId}`);
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

    // Restore
    context.strokeStyle = originalStroke;
    context.fillStyle = originalFill;
    context.lineWidth = originalWidth;
    context.globalCompositeOperation = originalComposite;
    context.lineCap = originalCap;
    context.lineJoin = originalJoin;

    console.log("Canvas redraw complete.");
    if (isMouseOverCanvas) updateCursorPreview(currentMouseX, currentMouseY);
}

function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) return;

    ctx.strokeStyle = cmd.color || currentStrokeStyle;
    ctx.lineWidth = cmd.size || currentLineWidth;
    ctx.fillStyle = cmd.color || currentStrokeStyle;

    switch (cmd.type) {
        case 'line':
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
            const cx = (cmd.x0 + cmd.x1) / 2;
            const cy = (cmd.y0 + cmd.y1) / 2;
            const rx = Math.abs(cmd.x1 - cmd.x0) / 2;
            const ry = Math.abs(cmd.y1 - cmd.y0) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.closePath();
            break;
        }

        case 'fill':
            ctx.globalCompositeOperation = 'source-over';
            floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
            break;

        case 'text': {
            ctx.globalCompositeOperation = 'source-over';
            const fontSize = (cmd.size || 5) * 4; // basic scaling
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(cmd.text, cmd.x, cmd.y);
            break;
        }

        case 'clear':
            // Server removes the actual commands from history, so nothing to do here
            break;

        default:
            console.warn("Unknown command type during redraw:", cmd.type);
    }
}

// Called for an incoming command from the server (someone else’s stroke)
export function drawExternalCommand(data) {
    if (!context || !data || !data.cmdId || !data.playerId) {
        console.warn("Invalid external command:", data);
        return;
    }
    if (data.type === 'clear') {
        // Another player's "clear" => server will handle removal
        return;
    }
    addCommandToHistory(data, data.playerId);

    try {
        context.save();
        if (data.type === 'line') {
            context.beginPath();
            context.globalCompositeOperation = data.tool === 'eraser' ? 'destination-out' : 'source-over';
            context.moveTo(data.x0, data.y0);
            context.lineTo(data.x1, data.y1);
            context.stroke();
            context.closePath();
            context.globalCompositeOperation = 'source-over';
        } else {
            executeCommand(data, context);
        }
        context.restore();
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

// ------------------------------------------------
// Undo
// ------------------------------------------------
export function undoLastAction(socket) {
    if (!myPlayerId) {
        console.warn("Cannot undo: Player ID not set.");
        return;
    }
    if (myDrawHistory.length === 0) {
        console.log("Nothing in local history to undo.");
        return;
    }
    // Last command *we* did
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

    // Remove from local myDrawHistory
    if (strokeIdToUndo) {
        // Remove everything that shares that strokeId
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToUndo);
    } else {
        // Single-command undo
        myDrawHistory.pop();
    }

    // Tell the server
    if (socket && socket.connected) {
        const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdId: cmdIdToUndo };
        socket.emit('undo last draw', undoData);
    } else {
        console.error("Cannot emit undo, no socket. Doing local redraw only.");
        redrawCanvasFromHistory();
    }
}

// ------------------------------------------------
// Drawing Logic / Mouse & Touch
// ------------------------------------------------
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
            cursorStyle = 'crosshair'; // or an eraser icon if desired
            break;
        case 'fill':
            cursorStyle = 'copy';
            break;
        case 'text':
            cursorStyle = 'text';
            break;
        default:
            cursorStyle = 'crosshair';
            break;
    }
    canvas.style.cursor = cursorStyle;
}

function setCursorStyle() {
    if (!canvas) return;

    const showingPreview = isMouseOverCanvas && !isDrawing && (
        currentTool === 'pencil' ||
        currentTool === 'eraser' ||
        currentTool === 'fill'   ||
        currentTool === 'rectangle' ||
        currentTool === 'ellipse'
    );

    if (currentTool === 'text') {
        canvas.style.cursor = drawingEnabled ? 'text' : 'not-allowed';
        return;
    }

    if (showingPreview || isDrawing) {
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
    } else if (
        currentTool === 'pencil' ||
        currentTool === 'eraser' ||
        currentTool === 'fill'   ||
        currentTool === 'rectangle' ||
        currentTool === 'ellipse'
    ) {
        drawCursorPreview(x, y);
    } else {
        clearOverlay();
    }
    setCursorStyle();
}

// ------------------------------------------------
// Mouse Events
// ------------------------------------------------
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

    const { x, y } = getEventCoords(e);
    isMouseOverCanvas = true;
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

    // Tools
    if (currentTool === 'pencil' || currentTool === 'eraser') {
        currentStrokeId = generateStrokeId();
        context.globalCompositeOperation = (currentTool === 'eraser') ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(startX, startY);
    }
    else if (currentTool === 'text') {
        // Single-step text command
        currentStrokeId = generateStrokeId();
        const userText = prompt("Enter text:");
        if (userText && userText.trim().length > 0) {
            const cmdId = generateCommandId();
            const command = {
                cmdId,
                strokeId: currentStrokeId,
                type: 'text',
                x, y,
                text: userText.trim(),
                color: currentStrokeStyle,
                size: currentLineWidth // We interpret it as a font-size factor
            };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
        // End text operation immediately
        isDrawing = false;
        currentStrokeId = null;
        return;
    }
    else if (currentTool === 'fill') {
        // We'll do fill on mouseUp (or we could do it here). We'll generate strokeId there.
    }
    else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        // Prepare for shape
        currentStrokeId = generateStrokeId();
        shapeStartX = x;
        shapeStartY = y;
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

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        drawLocalSegment(lastX, lastY, x, y);
        emitDrawSegment(lastX, lastY, x, y);
        lastX = x;
        lastY = y;
    }
    else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        // Preview shape in overlay
        clearOverlay();
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;
        overlayCtx.globalCompositeOperation = 'source-over';

        const x0 = shapeStartX;
        const y0 = shapeStartY;
        const x1 = x;
        const y1 = y;

        overlayCtx.beginPath();
        if (currentTool === 'rectangle') {
            const rx = Math.min(x0, x1);
            const ry = Math.min(y0, y1);
            const rw = Math.abs(x1 - x0);
            const rh = Math.abs(y1 - y0);
            overlayCtx.rect(rx, ry, rw, rh);
        } else {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            const rx = Math.abs(x1 - x0) / 2;
            const ry = Math.abs(y1 - y0) / 2;
            overlayCtx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        }
        overlayCtx.stroke();
        overlayCtx.closePath();
    }
}

function handleMouseUp(e) {
    const wasDrawing = isDrawing;
    const x = currentMouseX;
    const y = currentMouseY;

    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false;
        currentStrokeId = null;
        return;
    }

    // Pencil/Eraser finalization
    if ((currentTool === 'pencil' || currentTool === 'eraser') && wasDrawing) {
        // If no movement, force a tiny line
        if (x === lastX && y === lastY) {
            drawLocalSegment(x, y, x + 0.01, y + 0.01);
            emitDrawSegment(x, y, x + 0.01, y + 0.01);
        } else if (x !== lastX || y !== lastY) {
            drawLocalSegment(lastX, lastY, x, y);
            emitDrawSegment(lastX, lastY, x, y);
        }
        context.closePath();
    }
    // Fill: do single-step fill
    else if (currentTool === 'fill' && wasDrawing) {
        const strokeId = generateStrokeId();
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId,
            type: 'fill',
            x, y,
            color: currentStrokeStyle
        };
        executeCommand(command, context);
        addCommandToHistory(command, myPlayerId);
        if (emitDrawCallback) emitDrawCallback(command);
    }
    // Rectangle or Ellipse: one command
    else if ((currentTool === 'rectangle' || currentTool === 'ellipse') && wasDrawing) {
        clearOverlay(); // Remove preview
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId: currentStrokeId,
            type: currentTool === 'rectangle' ? 'rect' : 'ellipse',
            x0: shapeStartX,
            y0: shapeStartY,
            x1: x,
            y1: y,
            color: currentStrokeStyle,
            size: currentLineWidth
        };
        executeCommand(command, context);
        addCommandToHistory(command, myPlayerId);
        if (emitDrawCallback) emitDrawCallback(command);
    }

    // Reset
    isDrawing = false;
    currentStrokeId = null;
    shapeStartX = null;
    shapeStartY = null;
    startX = null;
    startY = null;

    if (isMouseOverCanvas) {
        updateCursorPreview(x, y);
    } else {
        setCursorStyle();
    }
}

// ------------------------------------------------
// Touch Events
// ------------------------------------------------
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
        handleMouseUp.call({ isDrawing: wasDrawing, currentTool }, pseudoEvent);
    } else {
        isDrawing = false;
        currentStrokeId = null;
        if (context) context.closePath();
        clearOverlay();
    }
    isMouseOverCanvas = false;
    setCursorStyle();
}

// ------------------------------------------------
// Low-level "send segment" for pencil/eraser
// ------------------------------------------------
function emitDrawSegment(x0, y0, x1, y1) {
    if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;
    const cmdId = generateCommandId();
    const command = {
        cmdId,
        strokeId: currentStrokeId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool, // 'pencil' or 'eraser'
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
