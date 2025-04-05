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

// --- Exported Functions ---

export function initCanvas(canvasId, drawEventEmitter) {
    canvas = document.getElementById(canvasId);
    if (!canvas) { console.error("Canvas element not found:", canvasId); return false; }
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { console.error("Failed to get 2D context"); return false; }

    overlayCanvas = document.createElement('canvas');
    // ** Match internal resolution initially **
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    // Style overlay for exact positioning
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.width = canvas.clientWidth + 'px'; // Match visual size
    overlayCanvas.style.height = canvas.clientHeight + 'px';
    overlayCanvas.style.pointerEvents = 'none';
    if (getComputedStyle(canvas.parentNode).position === 'static') {
        canvas.parentNode.style.position = 'relative';
    }
    canvas.parentNode.insertBefore(overlayCanvas, canvas);
    overlayCtx = overlayCanvas.getContext('2d');

    emitDrawCallback = drawEventEmitter;

    // Set initial defaults
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

    // Add event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseenter', handleMouseEnter);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    // Resize Observer to keep overlay aligned and scaled
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (entry.target === canvas && overlayCanvas) {
                const { width, height } = entry.contentRect;
                // Update CSS size
                overlayCanvas.style.width = width + 'px';
                overlayCanvas.style.height = height + 'px';
                // ** Update internal resolution to match main canvas **
                // This assumes main canvas internal resolution might change if its
                // attributes are updated elsewhere. If not, this might be redundant.
                if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
                    overlayCanvas.width = canvas.width;
                    overlayCanvas.height = canvas.height;
                    console.log("Overlay resolution updated to:", canvas.width, canvas.height);
                    // Re-apply overlay context settings if needed after resize
                    overlayCtx.strokeStyle = currentStrokeStyle;
                    overlayCtx.lineWidth = currentLineWidth;
                    overlayCtx.lineCap = 'round';
                    overlayCtx.lineJoin = 'round';
                }
            }
        }
    });
    resizeObserver.observe(canvas);


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
    // Set initial cursor style based on current state (tool, mouse position)
    setCursorStyle();
    // Trigger a preview update in case mouse is already over canvas
    if (isMouseOverCanvas) {
        updateCursorPreview();
    }
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false;
    currentStrokeId = null;
    clearOverlay();
    canvas.style.cursor = 'not-allowed'; // Explicitly set disabled cursor
    console.log("Drawing disabled");
}

export function clearCanvas(emitEvent = true) {
    if (!context || !canvas) return;
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();
    console.log("Canvas cleared locally");

    if (emitEvent && emitDrawCallback && myPlayerId) {
        const cmdId = generateCommandId();
        const command = { cmdId, type: 'clear' };
        clearHistory();
        addCommandToHistory(command, myPlayerId);
        emitDrawCallback(command);
        console.log("Dispatched clear event");
    } else if (!emitEvent) {
        clearHistory();
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

// --- Tool Setting Functions ---
export function setTool(toolName) {
    currentTool = toolName;
    console.log("Tool set to:", currentTool);
    if (context && currentTool !== 'eraser') {
        context.globalCompositeOperation = 'source-over';
    }
    if (isMouseOverCanvas) {
        updateCursorPreview(); // This will also call setCursorStyle
    } else {
        setCursorStyle(); // Update cursor even if mouse isn't over
        clearOverlay();
    }
}

export function setColor(color) {
    currentStrokeStyle = color;
    if (context) context.strokeStyle = currentStrokeStyle;
    if (overlayCtx) overlayCtx.strokeStyle = currentStrokeStyle;
    console.log("Color set to:", currentStrokeStyle);
    if (isMouseOverCanvas && (currentTool === 'pencil' || currentTool === 'eraser')) {
        updateCursorPreview();
    }
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5;
    if (context) context.lineWidth = currentLineWidth;
    if (overlayCtx) overlayCtx.lineWidth = currentLineWidth;
    console.log("Line width set to:", currentLineWidth);
    if (isMouseOverCanvas && (currentTool === 'pencil' || currentTool === 'eraser')) {
        updateCursorPreview();
    }
}

// --- History and Redrawing ---
// ... (generateCommandId, generateStrokeId, addCommandToHistory, clearHistory, loadAndDrawHistory, removeCommands, redrawCanvasFromHistory, executeCommand, drawExternalCommand, undoLastAction remain unchanged from previous correct version) ...
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
    clearCanvas(false);
    clearHistory();
    fullDrawHistory = commands.map(cmd => ({ ...cmd }));

    myDrawHistory = fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear')
        .map(({ playerId, ...rest }) => rest);

    redrawCanvasFromHistory();
}

export function removeCommands(idsToRemove = [], strokeIdToRemove = null) {
    const initialLength = fullDrawHistory.length;
    let removedCount = 0;

    if (strokeIdToRemove) {
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove) {
                removedCount++; return false;
            } return true;
        });
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToRemove);
        console.log(`Removed ${removedCount} commands for stroke ${strokeIdToRemove}.`);
    } else if (idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId)) {
                removedCount++; return false;
            } return true;
        });
        myDrawHistory = myDrawHistory.filter(cmd => !idSet.has(cmd.cmdId));
        console.log(`Removed ${removedCount} commands by ID(s).`);
    }

    if (removedCount > 0) {
        redrawCanvasFromHistory();
    } else {
        console.warn(`No commands found in history for removal (IDs: ${idsToRemove.join(', ')}, StrokeID: ${strokeIdToRemove}).`);
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
    if (isMouseOverCanvas) updateCursorPreview();
}

function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) return;

    ctx.strokeStyle = cmd.color || currentStrokeStyle;
    ctx.lineWidth = cmd.size || currentLineWidth;
    ctx.fillStyle = cmd.color || currentStrokeStyle;

    if (cmd.type === 'line' || cmd.type === 'rect' || cmd.type === 'ellipse') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

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
        case 'rect':
            ctx.globalCompositeOperation = 'source-over';
            const x = Math.min(cmd.x0, cmd.x1);
            const y = Math.min(cmd.y0, cmd.y1);
            const width = Math.abs(cmd.x1 - cmd.x0);
            const height = Math.abs(cmd.y1 - cmd.y0);
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.stroke();
            ctx.closePath();
            break;
        case 'ellipse':
             ctx.globalCompositeOperation = 'source-over';
             ctx.beginPath();
             ctx.ellipse(cmd.cx, cmd.cy, cmd.rx, cmd.ry, 0, 0, 2 * Math.PI);
             ctx.stroke();
             ctx.closePath();
             break;
        case 'fill':
            ctx.globalCompositeOperation = 'source-over';
            floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
            break;
        case 'clear':
            ctx.fillStyle = CANVAS_BACKGROUND_COLOR;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            break;
        default:
            console.warn("Unknown command type during redraw:", cmd.type);
    }
}

export function drawExternalCommand(data) {
    if (!context || !data || !data.cmdId || !data.playerId) {
        console.warn("Received invalid external command:", data);
        return;
    }

    if (data.type === 'clear') {
        console.log("Received external clear command. Clearing history and canvas.");
        clearCanvas(false);
        clearHistory();
        addCommandToHistory(data, data.playerId);
        return;
    }

    addCommandToHistory(data, data.playerId);

    try {
        const originalStroke = context.strokeStyle;
        const originalFill = context.fillStyle;
        const originalWidth = context.lineWidth;
        const originalComposite = context.globalCompositeOperation;
        const originalCap = context.lineCap;
        const originalJoin = context.lineJoin;

        executeCommand(data, context);

        context.strokeStyle = originalStroke;
        context.fillStyle = originalFill;
        context.lineWidth = originalWidth;
        context.globalCompositeOperation = originalComposite;
        context.lineCap = originalCap;
        context.lineJoin = originalJoin;

    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

export function undoLastAction(socket) {
    if (!myPlayerId) { console.warn("Cannot undo: Player ID not set."); return; }
    if (myDrawHistory.length === 0) {
        console.log("Nothing in local history to undo.");
        return;
    }

    const lastMyCommand = myDrawHistory[myDrawHistory.length - 1];

    if (!lastMyCommand || !lastMyCommand.cmdId) {
        console.error("Invalid command found in local history for undo:", lastMyCommand);
        myDrawHistory.pop();
        redrawCanvasFromHistory();
        return;
    }

    const strokeIdToUndo = lastMyCommand.strokeId;
    const cmdIdToUndo = lastMyCommand.cmdId;

    console.log(`Requesting undo for ${strokeIdToUndo ? `stroke ${strokeIdToUndo}` : `command ${cmdIdToUndo}`}`);

    if (strokeIdToUndo) {
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToUndo);
    } else {
        myDrawHistory.pop();
    }

    if (socket && socket.connected) {
        const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdId: cmdIdToUndo };
        socket.emit('undo last draw', undoData);
    } else {
        console.error("Cannot emit undo: Socket not available or connected.");
        redrawCanvasFromHistory();
    }
}


// --- Internal Drawing Logic ---

function getEventCoords(e) {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; e.preventDefault();
    } else {
        clientX = e.clientX; clientY = e.clientY;
    }
    const xRelativeToRect = clientX - rect.left;
    const yRelativeToRect = clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = xRelativeToRect * scaleX;
    const canvasY = yRelativeToRect * scaleY;
    return { x: canvasX, y: canvasY };
}

// ** Updated Cursor Style Logic **
function setCursorStyle() {
    if (!canvas) return;
    // Determine if the preview should be shown (mouse over, not drawing, correct tool)
    const showPreview = isMouseOverCanvas && !isDrawing && (currentTool === 'pencil' || currentTool === 'eraser');

    if (showPreview || isDrawing) { // Hide default cursor if preview shown OR if actively drawing
        canvas.style.cursor = 'none';
    } else if (!drawingEnabled) { // Explicitly set disabled cursor
         canvas.style.cursor = 'not-allowed';
    }
    else {
        // Set cursor based on the tool when preview is not shown and not drawing
        switch (currentTool) {
            case 'eraser':
                canvas.style.cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="5" y="5" width="10" height="10" fill="white" stroke="black"/></svg>') 10 10, auto`;
                break;
            case 'fill':
                canvas.style.cursor = 'copy'; break;
            case 'rectangle':
            case 'ellipse':
                canvas.style.cursor = 'crosshair'; break;
            case 'pencil':
            default:
                canvas.style.cursor = 'crosshair'; break;
        }
    }
}

function clearOverlay() {
    if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
}

// --- Cursor Preview ---
function drawCursorPreview(x, y) {
    if (!overlayCtx || !drawingEnabled || isDrawing) {
        clearOverlay(); return;
    }
    clearOverlay();

    const radius = currentLineWidth / 2;
    overlayCtx.beginPath();
    // ** Use integer coordinates for arc drawing to avoid subpixel issues **
    overlayCtx.arc(Math.round(x), Math.round(y), Math.max(1, radius), 0, Math.PI * 2);
    overlayCtx.strokeStyle = currentTool === 'eraser' ? '#555555' : currentStrokeStyle;
    overlayCtx.lineWidth = 1;
    overlayCtx.stroke();
    overlayCtx.closePath();

    overlayCtx.lineWidth = currentLineWidth; // Restore for shape previews
    overlayCtx.strokeStyle = currentStrokeStyle;
}

function updateCursorPreview() {
    if (!isMouseOverCanvas || isDrawing) {
        clearOverlay();
    } else if (currentTool === 'pencil' || currentTool === 'eraser') {
        drawCursorPreview(currentMouseX, currentMouseY);
    } else {
        clearOverlay();
    }
    // Always update the cursor style after potentially drawing/clearing the preview
    setCursorStyle();
}

// --- Event Handlers ---

function handleMouseEnter(e) {
    isMouseOverCanvas = true;
    const { x, y } = getEventCoords(e);
    currentMouseX = x; currentMouseY = y;
    updateCursorPreview(); // Update preview and cursor style
}

function handleMouseLeave(e) {
    isMouseOverCanvas = false;
    clearOverlay();
    setCursorStyle(); // Restore default cursor
}

function handleMouseDown(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled || !myPlayerId) return;

    isMouseOverCanvas = true;
    const { x, y } = getEventCoords(e); // Get precise coords on down
    isDrawing = true;
    startX = x; startY = y;
    lastX = x; lastY = y;
    currentMouseX = x; currentMouseY = y;

    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.fillStyle = currentStrokeStyle;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    clearOverlay(); // Clear previews
    setCursorStyle(); // Hide default cursor

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        currentStrokeId = generateStrokeId();
        context.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(startX, startY);
    } else if (currentTool === 'fill') {
        isDrawing = false; currentStrokeId = null;
    } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        currentStrokeId = null;
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;
        overlayCtx.lineCap = 'round';
        overlayCtx.lineJoin = 'round';
    } else {
        currentStrokeId = null;
    }
}

function handleMouseMove(e) {
    if (!drawingEnabled || !myPlayerId) return;

    const { x, y } = getEventCoords(e);
    currentMouseX = x; currentMouseY = y;

    if (!isDrawing) {
        updateCursorPreview();
        return;
    }

    // --- Drawing logic ---
    switch (currentTool) {
        case 'pencil':
        case 'eraser':
            drawLocalSegment(lastX, lastY, x, y);
            emitDrawSegment(lastX, lastY, x, y);
            lastX = x; lastY = y;
            break;
        case 'rectangle':
            clearOverlay();
            const rectX = Math.min(startX, x);
            const rectY = Math.min(startY, y);
            const rectW = Math.abs(x - startX);
            const rectH = Math.abs(y - startY);
            overlayCtx.beginPath();
            overlayCtx.rect(rectX, rectY, rectW, rectH);
            overlayCtx.stroke();
            overlayCtx.closePath();
            break;
        case 'ellipse':
             clearOverlay();
             const rx = Math.abs(x - startX) / 2;
             const ry = Math.abs(y - startY) / 2;
             const cx = startX + (x - startX) / 2;
             const cy = startY + (y - startY) / 2;
             overlayCtx.beginPath();
             overlayCtx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
             overlayCtx.stroke();
             overlayCtx.closePath();
             break;
    }
}

// Attached to WINDOW
function handleMouseUp(e) {
    const wasDrawing = isDrawing;
    const toolUsed = currentTool;

    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false; currentStrokeId = null; return;
    }

    const { x, y } = getEventCoords(e);
    currentMouseX = x; currentMouseY = y;

    if (toolUsed === 'fill') {
        if (!wasDrawing && startX !== null && startY !== null) {
            console.log(`Fill tool used at (${Math.round(x)}, ${Math.round(y)})`);
            const cmdId = generateCommandId();
            const command = { cmdId, type: 'fill', x: x, y: y, color: currentStrokeStyle };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (toolUsed === 'rectangle') {
        if (!wasDrawing) return;
        clearOverlay();
        const cmdId = generateCommandId();
        const finalX0 = Math.min(startX, x); const finalY0 = Math.min(startY, y);
        const finalX1 = Math.max(startX, x); const finalY1 = Math.max(startY, y);
        if (finalX1 > finalX0 && finalY1 > finalY0) {
            const command = { cmdId, type: 'rect', x0: finalX0, y0: finalY0, x1: finalX1, y1: finalY1, color: currentStrokeStyle, size: currentLineWidth };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (toolUsed === 'ellipse') {
        if (!wasDrawing) return;
        clearOverlay();
        const cmdId = generateCommandId();
        const rx = Math.abs(x - startX) / 2;
        const ry = Math.abs(y - startY) / 2;
        const cx = startX + (x - startX) / 2;
        const cy = startY + (y - startY) / 2;
        if (rx > 0 && ry > 0) {
            const command = { cmdId, type: 'ellipse', cx, cy, rx, ry, color: currentStrokeStyle, size: currentLineWidth };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (toolUsed === 'pencil' || toolUsed === 'eraser') {
        if (!wasDrawing) return;
        // Ensure the very last segment is drawn and emitted if mouse moved fast
        if (x !== lastX || y !== lastY) {
             drawLocalSegment(lastX, lastY, x, y);
             emitDrawSegment(lastX, lastY, x, y);
        }
        context.closePath();
    }

    isDrawing = false;
    currentStrokeId = null;
    startX = null; startY = null;

    // Update cursor preview/style
    if (isMouseOverCanvas) {
        updateCursorPreview();
    } else {
        setCursorStyle(); // Ensure cursor resets if mouse is outside
    }
}

// --- Touch Handlers ---
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
        const { x, y } = getEventCoords(e);
        currentMouseX = x; currentMouseY = y;
        if (isDrawing) {
            handleMouseMove(e);
        }
    }
}

// Attached to WINDOW
function handleTouchEnd(e) {
    const wasDrawing = isDrawing;
    const toolUsed = currentTool;

    if (!drawingEnabled || !myPlayerId) {
         isDrawing = false; currentStrokeId = null; return;
    }

    if (e.changedTouches.length > 0) {
       const pseudoEvent = {
           clientX: e.changedTouches[0].clientX,
           clientY: e.changedTouches[0].clientY,
           preventDefault: () => {}
       };
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

// Emits drawing data for a line segment
function emitDrawSegment(x0, y0, x1, y1) {
    if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;
    const cmdId = generateCommandId();
    const command = {
        cmdId, strokeId: currentStrokeId, type: 'line',
        x0: x0, y0: y0, x1: x1, y1: y1,
        tool: currentTool,
        color: currentTool === 'eraser' ? null : currentStrokeStyle,
        size: currentLineWidth
    };
    addCommandToHistory(command, myPlayerId);
    emitDrawCallback(command);
}

// Draws a line segment locally
function drawLocalSegment(x0, y0, x1, y1) {
    if (!context) return;
    context.lineTo(x1, y1);
    context.stroke();
}