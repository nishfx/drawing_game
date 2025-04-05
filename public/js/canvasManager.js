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

// **Declare currentStrokeId here to avoid errors**
let currentStrokeId = null;

// For shape drawing
let shapeStartX = null;
let shapeStartY = null;

// For storing *my* commands (so you can local-undo)
let myDrawHistory = [];

// For storing *all* commands from everyone; used to redraw
let fullDrawHistory = [];

// Reasonable limit
const MAX_HISTORY = 500;

let emitDrawCallback = null;

/**
 * Generators for unique IDs.
 * Use the playerId in them so no cross-player collisions.
 */
function generateStrokeId() {
    return `${myPlayerId}-stroke-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
function generateCommandId() {
    return `${myPlayerId}-cmd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Initialize the canvas and an overlay for cursor previews or shape previews.
 * @param {string} canvasId
 * @param {Function} drawEventEmitter
 * @returns {boolean}
 */
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

    // Create an overlay for shape previews / custom cursor
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width;     // same pixel resolution as main canvas
    overlayCanvas.height = canvas.height;   // ...
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = canvas.offsetTop + 'px';
    overlayCanvas.style.left = canvas.offsetLeft + 'px';
    overlayCanvas.style.width = canvas.clientWidth + 'px';   // same CSS size as main canvas
    overlayCanvas.style.height = canvas.clientHeight + 'px'; // ...
    overlayCanvas.style.pointerEvents = 'none';
    canvas.parentNode.insertBefore(overlayCanvas, canvas);
    overlayCtx = overlayCanvas.getContext('2d');

    emitDrawCallback = drawEventEmitter;

    // Fill background
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = 'round';
    context.lineCap = 'round';

    overlayCtx.lineJoin = 'round';
    overlayCtx.lineCap = 'round';

    // Mouse events
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mouseenter', handleMouseEnter);

    // Touch events
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    // Listen for window resizes, so we can re-sync overlay
    window.addEventListener('resize', () => {
        resyncOverlayPosition();
    });

    console.log(`Canvas "${canvasId}" initialized`);
    clearHistory();
    disableDrawing();
    return true;
}

/**
 * Adjust the overlay canvas to keep it exactly covering the main canvas’s displayed size.
 */
function resyncOverlayPosition() {
    if (!canvas || !overlayCanvas) return;
    const rect = canvas.getBoundingClientRect();

    // Keep the overlay's internal pixel size equal to the main canvas's 2D size
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;

    // Match the overlay’s CSS position & size to the bounding box
    overlayCanvas.style.top = rect.top + 'px';
    overlayCanvas.style.left = rect.left + 'px';
    overlayCanvas.style.width = rect.width + 'px';
    overlayCanvas.style.height = rect.height + 'px';
}

// -----------------------------
// State
// -----------------------------
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
    clearOverlay();
    // When disabled, show 'not-allowed' inside the canvas
    canvas.style.cursor = 'not-allowed';
    console.log("Drawing disabled");
}

// -----------------------------
// Clearing / Exporting
// -----------------------------
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

/**
 * Returns PNG data URL of the current canvas.
 * @returns {string|null}
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

// -----------------------------
// Tool Settings
// -----------------------------
export function setTool(toolName) {
    currentTool = toolName;
    console.log("Tool set to:", currentTool);
    setCursorStyle();
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    } else {
        clearOverlay();
    }
}

export function setColor(color) {
    currentStrokeStyle = color;
    console.log("Color set to:", currentStrokeStyle);
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5;
    console.log("Line width set to:", currentLineWidth);
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

// -----------------------------
// History & Redraw
// -----------------------------
function clearHistory() {
    myDrawHistory = [];
    fullDrawHistory = [];
}

/**
 * Loads a list of commands (e.g. from the server’s lobby history) and redraws the canvas.
 * @param {Array} commands
 */
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

/**
 * Remove commands from local memory (either by exact cmdId list or strokeId) for the given player, then redraw.
 * @param {string[]} idsToRemove
 * @param {string|null} strokeIdToRemove
 * @param {string|null} ownerPlayerId
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    if (!ownerPlayerId) {
        // If no owner is specified, bail to avoid removing other players' stuff
        console.warn("removeCommands called with no ownerPlayerId. Skipping to avoid unwanted removal.");
        return;
    }

    let removedCount = 0;

    // If removing entire stroke by ID
    if (strokeIdToRemove) {
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId) {
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
    }
    // Else if removing by an array of cmdIds
    else if (idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId) {
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
        console.warn(`No commands found to remove (stroke=${strokeIdToRemove}, owner=${ownerPlayerId}).`);
    }
}

/**
 * Redraw everything from our fullDrawHistory.
 */
function redrawCanvasFromHistory() {
    if (!context || !canvas) return;
    console.log(`Redrawing canvas from ${fullDrawHistory.length} commands.`);
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    const origComposite = context.globalCompositeOperation;
    const origStroke    = context.strokeStyle;
    const origFill      = context.fillStyle;
    const origWidth     = context.lineWidth;
    const origCap       = context.lineCap;
    const origJoin      = context.lineJoin;

    fullDrawHistory.forEach(cmd => {
        try {
            executeCommand(cmd, context);
        } catch (error) {
            console.error("Error redrawing command:", cmd, error);
        }
    });

    // restore
    context.globalCompositeOperation = origComposite;
    context.strokeStyle = origStroke;
    context.fillStyle   = origFill;
    context.lineWidth   = origWidth;
    context.lineCap     = origCap;
    context.lineJoin    = origJoin;

    console.log("Canvas redraw complete.");
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

/**
 * Execute a single draw command on the provided 2D context.
 * @param {Object} cmd
 * @param {CanvasRenderingContext2D} ctx
 */
function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) return;

    // If it's an eraser, do 'destination-out'; else use color
    if (cmd.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
    }
    if (typeof cmd.color === 'string') {
        ctx.strokeStyle = cmd.color;
        ctx.fillStyle   = cmd.color;
    } else {
        // fallback black
        ctx.strokeStyle = '#000000';
        ctx.fillStyle   = '#000000';
    }
    ctx.lineWidth = (cmd.size != null) ? cmd.size : 5;

    switch (cmd.type) {
        case 'line':
            ctx.beginPath();
            ctx.moveTo(cmd.x0, cmd.y0);
            ctx.lineTo(cmd.x1, cmd.y1);
            ctx.stroke();
            ctx.closePath();
            break;

        case 'rect': {
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
            const cx = (cmd.x0 + cmd.x1) / 2;
            const cy = (cmd.y0 + cmd.y1) / 2;
            const rx = Math.abs(cmd.x1 - cmd.x0) / 2;
            const ry = Math.abs(cmd.y1 - cmd.y0) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, 2*Math.PI);
            ctx.stroke();
            ctx.closePath();
            break;
        }

        case 'fill':
            floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color || '#000000');
            break;

        case 'text': {
            const fontSize = (cmd.size || 5) * 4;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(cmd.text, cmd.x, cmd.y);
            break;
        }

        case 'clear':
            // We never “draw” a clear command; the code uses removeCommands
            break;

        default:
            console.warn("Unknown command type during redraw:", cmd.type);
    }
}

/**
 * Draw a command from another player. If it's ours, skip, since we already did it locally.
 */
export function drawExternalCommand(data) {
    if (data && data.playerId === myPlayerId) return; // skip double-adding
    if (!context || !data || !data.cmdId || !data.playerId) {
        console.warn("Invalid external command:", data);
        return;
    }
    if (data.type === 'clear') {
        return; // server handles removal, we handle re-draw from removeCommands
    }
    // Add to full history, draw on local
    fullDrawHistory.push({ ...data });
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift();
    }

    try {
        context.save();
        executeCommand(data, context);
        context.restore();
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

// -----------------------------
// Undo
// -----------------------------
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
    const cmdIdToUndo    = lastMyCommand.cmdId;

    console.log(`Requesting undo for stroke=${strokeIdToUndo} or cmd=${cmdIdToUndo}`);

    // Remove from local myDrawHistory
    if (strokeIdToUndo) {
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToUndo);
    } else {
        myDrawHistory.pop();
    }

    // notify server
    if (socket && socket.connected) {
        const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdId: cmdIdToUndo };
        socket.emit('undo last draw', undoData);
    } else {
        console.error("Cannot emit undo, no socket. Doing local redraw only.");
        redrawCanvasFromHistory();
    }
}

// -----------------------------
// Drawing Logic / Mouse & Touch
// -----------------------------
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

    // Convert screen coords -> “canvas drawing” coords
    const xRel = clientX - rect.left;
    const yRel = clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = xRel * scaleX;
    const canvasY = yRel * scaleY;
    return { x: canvasX, y: canvasY };
}

function setCursorStyle() {
    if (!canvas) return;
    if (!drawingEnabled) {
        // If not allowed to draw
        canvas.style.cursor = 'not-allowed';
        return;
    }
    // If drawing is enabled, inside the canvas we want the custom circle, so hide the system cursor:
    // We'll actually set to 'none' once we are sure the mouse is in the canvas.
    if (isMouseOverCanvas) {
        canvas.style.cursor = 'none';
    } else {
        canvas.style.cursor = 'default';
    }
}

/**
 * Clear the overlay canvas fully.
 */
function clearOverlay() {
    if (!overlayCtx || !overlayCanvas) return;
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
    }
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

/**
 * Draw a circle cursor preview on the overlay, based on the current line width & color.
 */
function drawCursorPreview(x, y) {
    if (!overlayCtx || !drawingEnabled || isDrawing) {
        clearOverlay();
        return;
    }
    clearOverlay();
    overlayCtx.beginPath();
    const radius = Math.max(1, currentLineWidth / 2);
    overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    overlayCtx.strokeStyle = (currentTool === 'eraser') ? '#888888' : currentStrokeStyle;
    overlayCtx.lineWidth = 1;
    overlayCtx.stroke();
    overlayCtx.closePath();
}

/**
 * Update the custom circle cursor if the mouse is inside and not currently drawing, etc.
 */
function updateCursorPreview(x, y) {
    if (!isMouseOverCanvas || !drawingEnabled || isDrawing) {
        clearOverlay();
    } else {
        drawCursorPreview(x, y);
    }
    setCursorStyle();
}

function handleMouseEnter(e) {
    isMouseOverCanvas = true;
    setCursorStyle();
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;
    updateCursorPreview(x, y);
}

function handleMouseLeave(e) {
    if (isDrawing) {
        // finalize the stroke if the mouse leaves mid-draw
        finishStroke();
    }
    isMouseOverCanvas = false;
    clearOverlay();
    setCursorStyle();
}

function handleMouseDown(e) {
    if (!drawingEnabled || !myPlayerId) return;
    if (e.button !== 0) return; // left-click only

    const { x, y } = getEventCoords(e);
    isMouseOverCanvas = true;
    isDrawing = true;
    startX = x;
    startY = y;
    lastX = x;
    lastY = y;
    currentMouseX = x;
    currentMouseY = y;

    clearOverlay();
    setCursorStyle();

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        // Start a new stroke
        currentStrokeId = generateStrokeId();
        context.lineWidth = currentLineWidth;
        context.strokeStyle = (currentTool === 'eraser') ? '#000000' : currentStrokeStyle;
        context.fillStyle   = currentStrokeStyle;
        context.globalCompositeOperation =
            (currentTool === 'eraser') ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(x, y);
    }
    else if (currentTool === 'text') {
        const strokeId = generateStrokeId();
        const userText = prompt("Enter text:");
        if (userText && userText.trim()) {
            const cmdId = generateCommandId();
            const command = {
                cmdId,
                strokeId,
                type: 'text',
                x, y,
                text: userText.trim(),
                color: currentStrokeStyle,
                size: currentLineWidth,
                tool: 'pencil' // treat text color same as pencil
            };
            executeCommand(command, context);
            addCommandToLocalHistory(command);
            if (emitDrawCallback) emitDrawCallback(command);
        }
        isDrawing = false;
    }
    else if (currentTool === 'fill') {
        // We'll do the fill on mouseUp
    }
    else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
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
        context.lineTo(x, y);
        context.stroke();
        emitDrawSegment(lastX, lastY, x, y);
        lastX = x;
        lastY = y;
    }
    else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        // shape preview on overlay
        clearOverlay();
        overlayCtx.globalCompositeOperation = 'source-over';
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;

        const x0 = shapeStartX;
        const y0 = shapeStartY;
        overlayCtx.beginPath();
        if (currentTool === 'rectangle') {
            const rx = Math.min(x0, x);
            const ry = Math.min(y0, y);
            const rw = Math.abs(x - x0);
            const rh = Math.abs(y - y0);
            overlayCtx.rect(rx, ry, rw, rh);
        } else {
            const cx = (x0 + x) / 2;
            const cy = (y0 + y) / 2;
            const rx = Math.abs(x - x0) / 2;
            const ry = Math.abs(y - y0) / 2;
            overlayCtx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        }
        overlayCtx.stroke();
        overlayCtx.closePath();
    }
}

function handleMouseUp(e) {
    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false;
        return;
    }
    if (!isDrawing) return;

    finishStroke();
}

/**
 * Finalize the stroke or shape on mouse/touch up.
 */
function finishStroke() {
    const x = currentMouseX;
    const y = currentMouseY;

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        // If user hardly moved, force a tiny line so we have something
        if (x === lastX && y === lastY) {
            context.lineTo(x + 0.01, y + 0.01);
            context.stroke();
            emitDrawSegment(x, y, x + 0.01, y + 0.01);
        }
        context.closePath();
    }
    else if (currentTool === 'fill') {
        const strokeId = generateStrokeId();
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId,
            type: 'fill',
            x, y,
            color: currentStrokeStyle,
            tool: 'pencil'
        };
        executeCommand(command, context);
        addCommandToLocalHistory(command);
        if (emitDrawCallback) emitDrawCallback(command);
    }
    else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        clearOverlay();
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId: currentStrokeId,
            type: (currentTool === 'rectangle') ? 'rect' : 'ellipse',
            x0: shapeStartX,
            y0: shapeStartY,
            x1: x,
            y1: y,
            color: currentStrokeStyle,
            size: currentLineWidth,
            tool: 'pencil'
        };
        executeCommand(command, context);
        addCommandToLocalHistory(command);
        if (emitDrawCallback) {
            emitDrawCallback(command);
        }
    }

    isDrawing = false;
    currentStrokeId = null;
    shapeStartX = null;
    shapeStartY = null;
    startX = null;
    startY = null;
    updateCursorPreview(x, y);
}

/**
 * Helper to record a command in local & full history (for immediate undo/redraw).
 */
function addCommandToLocalHistory(command) {
    fullDrawHistory.push(command);
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift();
    }
    if (command.playerId === myPlayerId && command.type !== 'clear') {
        myDrawHistory.push(command);
        if (myDrawHistory.length > MAX_HISTORY) {
            myDrawHistory.shift();
        }
    }
}

// -----------------------------
// Touch Events
// -----------------------------
function handleTouchStart(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled) return;
    if (e.touches.length > 0) {
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
    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false;
        return;
    }
    finishStroke();
    isMouseOverCanvas = false;
    setCursorStyle();
}

/**
 * Emit a 'line' command for each small pencil/eraser segment.
 */
function emitDrawSegment(x0, y0, x1, y1) {
    if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;
    const cmdId = generateCommandId();
    const command = {
        cmdId,
        strokeId: currentStrokeId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool,
        color: (currentTool === 'eraser') ? null : currentStrokeStyle,
        size: currentLineWidth,
        playerId: myPlayerId
    };
    // Record locally so we see our line immediately
    fullDrawHistory.push(command);
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift();
    }
    myDrawHistory.push(command);
    if (myDrawHistory.length > MAX_HISTORY) {
        myDrawHistory.shift();
    }
    // Then emit
    emitDrawCallback(command);
}
