// public/js/canvasManager.js
import { floodFill, getPixelColor } from './drawing/fillUtil.js';

let canvas = null;
let context = null;
let overlayCanvas = null; // For shape previews & cursor preview
let overlayCtx = null;

let isDrawing = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0; // Track mouse position for cursor preview
let currentMouseY = 0;
let isMouseOverCanvas = false; // Track if mouse is over canvas
let drawingEnabled = false;
let myPlayerId = null;

// --- Tool State ---
let currentTool = 'pencil'; // 'pencil', 'eraser', 'fill', 'rectangle', 'ellipse'
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;
const CANVAS_BACKGROUND_COLOR = "#FFFFFF";

// --- Stroke Grouping for Undo ---
let currentStrokeId = null;

// --- History ---
let myDrawHistory = [];
let fullDrawHistory = [];
const MAX_HISTORY = 500;

// --- Callback for emitting events ---
let emitDrawCallback = null;

// --- Exported Functions ---

export function initCanvas(canvasId, drawEventEmitter) {
    canvas = document.getElementById(canvasId);
    if (!canvas) { console.error("Canvas element not found:", canvasId); return false; }
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { console.error("Failed to get 2D context"); return false; }

    // Create overlay canvas
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = canvas.offsetTop + 'px';
    overlayCanvas.style.left = canvas.offsetLeft + 'px';
    overlayCanvas.style.pointerEvents = 'none'; // Overlay doesn't capture events
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
    canvas.addEventListener('mousemove', handleMouseMove); // Tracks movement over canvas
    window.addEventListener('mouseup', handleMouseUp); // Catch mouseup anywhere
    canvas.addEventListener('mouseenter', handleMouseEnter); // For cursor preview
    canvas.addEventListener('mouseleave', handleMouseLeave); // For cursor preview
    // canvas.addEventListener('mouseout', handleMouseOut); // Not needed if mouseup is global

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
    canvas.style.cursor = 'crosshair';
    setCursorForTool(currentTool);
    console.log("Drawing enabled");
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
    setCursorForTool(currentTool);
    if (context && currentTool !== 'eraser') {
        context.globalCompositeOperation = 'source-over';
    }
    // Update cursor preview visibility
    if (isMouseOverCanvas) {
        updateCursorPreview();
    } else {
        clearOverlay(); // Clear if mouse isn't over canvas
    }
}

export function setColor(color) {
    currentStrokeStyle = color;
    if (context) context.strokeStyle = currentStrokeStyle;
    if (overlayCtx) overlayCtx.strokeStyle = currentStrokeStyle;
    console.log("Color set to:", currentStrokeStyle);
    // Update cursor preview color if visible
    if (isMouseOverCanvas && (currentTool === 'pencil' || currentTool === 'eraser')) {
        updateCursorPreview();
    }
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5;
    if (context) context.lineWidth = currentLineWidth;
    if (overlayCtx) overlayCtx.lineWidth = currentLineWidth;
    console.log("Line width set to:", currentLineWidth);
    // Update cursor preview size if visible
    if (isMouseOverCanvas && (currentTool === 'pencil' || currentTool === 'eraser')) {
        updateCursorPreview();
    }
}

// --- History and Redrawing ---

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

// Modified to handle removing single command or multiple by strokeId
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
    clearOverlay(); // Clear overlay during full redraw

    const originalStroke = context.strokeStyle;
    const originalFill = context.fillStyle;
    const originalWidth = context.lineWidth;
    const originalComposite = context.globalCompositeOperation;

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
    console.log("Canvas redraw complete.");
    // Restore cursor preview if needed after redraw
    if (isMouseOverCanvas) updateCursorPreview();
}

// Executes a single command on the provided context
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
        case 'rect':
            ctx.globalCompositeOperation = 'source-over';
            const x = Math.min(cmd.x0, cmd.x1);
            const y = Math.min(cmd.y0, cmd.y1);
            const width = Math.abs(cmd.x1 - cmd.x0);
            const height = Math.abs(cmd.y1 - cmd.y0);
            // Draw rectangle slightly differently to potentially avoid snapping
            ctx.beginPath(); // Start path
            ctx.rect(x, y, width, height); // Define rect path
            ctx.stroke(); // Stroke the path
            ctx.closePath(); // Close path
            break;
        case 'ellipse': // New case for ellipse
             ctx.globalCompositeOperation = 'source-over';
             ctx.beginPath();
             ctx.ellipse(cmd.cx, cmd.cy, cmd.rx, cmd.ry, 0, 0, 2 * Math.PI); // Rotation = 0
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


// --- Function to draw commands received from others ---
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

        executeCommand(data, context);

        context.strokeStyle = originalStroke;
        context.fillStyle = originalFill;
        context.lineWidth = originalWidth;
        context.globalCompositeOperation = originalComposite;

    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

// --- Undo ---
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
    const cmdIdToUndo = lastMyCommand.cmdId; // Keep cmdId for single actions

    console.log(`Requesting undo for ${strokeIdToUndo ? `stroke ${strokeIdToUndo}` : `command ${cmdIdToUndo}`}`);

    // Optimistically remove from local history
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
        redrawCanvasFromHistory(); // Redraw based on local removal if no socket
    }
}


// --- Internal Drawing Logic ---

function getEventCoords(e) {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; e.preventDefault();
    } else {
        clientX = e.clientX; clientY = e.clientY;
    }
    // Return precise coordinates, avoid rounding here
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    return { x: canvasX, y: canvasY };
}

function setCursorForTool(tool) {
    if (!canvas) return;
    switch (tool) {
        case 'eraser':
            canvas.style.cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="5" y="5" width="10" height="10" fill="white" stroke="black"/></svg>') 10 10, auto`;
            break;
        case 'fill':
            canvas.style.cursor = 'copy'; break;
        case 'rectangle':
        case 'ellipse': // Use crosshair for ellipse too
            canvas.style.cursor = 'crosshair'; break;
        case 'pencil':
        default:
            canvas.style.cursor = 'crosshair'; break;
    }
}

function clearOverlay() {
    if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
}

// --- Cursor Preview ---
function drawCursorPreview(x, y) {
    if (!overlayCtx || !drawingEnabled || isDrawing) { // Don't draw if actively drawing line
        clearOverlay(); // Ensure it's clear if conditions not met
        return;
    }
    clearOverlay(); // Clear previous preview

    const radius = currentLineWidth / 2;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    overlayCtx.strokeStyle = currentTool === 'eraser' ? '#888888' : currentStrokeStyle; // Gray for eraser, tool color for pencil
    overlayCtx.lineWidth = 1; // Thin outline for preview
    overlayCtx.stroke();
    overlayCtx.closePath();

    // Restore overlay settings for shape previews if needed
    overlayCtx.lineWidth = currentLineWidth;
    overlayCtx.strokeStyle = currentStrokeStyle;
}

function updateCursorPreview() {
    if (!isMouseOverCanvas || isDrawing) {
        clearOverlay();
        return;
    }
    if (currentTool === 'pencil' || currentTool === 'eraser') {
        drawCursorPreview(currentMouseX, currentMouseY);
    } else {
        clearOverlay(); // Clear preview if tool is not pencil/eraser
    }
}

// --- Event Handlers ---

function handleMouseEnter(e) {
    isMouseOverCanvas = true;
    // Update position immediately on enter
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;
    updateCursorPreview(); // Show preview if applicable tool is selected
}

function handleMouseLeave(e) {
    isMouseOverCanvas = false;
    clearOverlay(); // Clear preview when mouse leaves
}

function handleMouseDown(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled || !myPlayerId) return;

    isMouseOverCanvas = true; // Mouse must be over to mousedown
    const { x, y } = getEventCoords(e);
    isDrawing = true;
    startX = x; startY = y;
    lastX = x; lastY = y;
    currentMouseX = x; currentMouseY = y; // Update position

    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.fillStyle = currentStrokeStyle;

    clearOverlay(); // Clear any previews (cursor or shape) when drawing starts

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        currentStrokeId = generateStrokeId();
        context.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(startX, startY);
    } else if (currentTool === 'fill') {
        isDrawing = false; // Fill happens on mouseup
        currentStrokeId = null;
    } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        currentStrokeId = null;
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;
    } else {
        currentStrokeId = null;
    }
}

function handleMouseMove(e) {
    if (!drawingEnabled || !myPlayerId) return;

    const { x, y } = getEventCoords(e);
    currentMouseX = x; currentMouseY = y; // Update tracked mouse position

    if (!isDrawing) {
        // If not actively drawing a line/shape, update cursor preview
        updateCursorPreview();
        return; // Don't process drawing logic if not isDrawing
    }

    // --- Drawing logic (only runs if isDrawing is true) ---
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
            overlayCtx.strokeRect(rectX, rectY, rectW, rectH);
            break;
        case 'ellipse': // Ellipse preview
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
    const wasDrawing = isDrawing; // Store state before resetting
    const toolUsed = currentTool; // Store tool used

    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false; currentStrokeId = null; return;
    }

    // Get coordinates relative to canvas, needed for drawing logic
    const { x, y } = getEventCoords(e);
    currentMouseX = x; currentMouseY = y; // Update position

    if (toolUsed === 'fill') {
        // Fill only triggers if mousedown was on canvas and no drag occurred (isDrawing is false)
        if (!wasDrawing && startX !== null && startY !== null) {
            console.log(`Fill tool used at (${Math.round(x)}, ${Math.round(y)})`);
            const cmdId = generateCommandId();
            const command = { cmdId, type: 'fill', x: x, y: y, color: currentStrokeStyle };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (toolUsed === 'rectangle') {
        if (!wasDrawing) return; // Don't draw rect if mouse wasn't down
        clearOverlay();
        const cmdId = generateCommandId();
        const finalX0 = Math.min(startX, x); const finalY0 = Math.min(startY, y);
        const finalX1 = Math.max(startX, x); const finalY1 = Math.max(startY, y);
        const command = { cmdId, type: 'rect', x0: finalX0, y0: finalY0, x1: finalX1, y1: finalY1, color: currentStrokeStyle, size: currentLineWidth };
        executeCommand(command, context);
        addCommandToHistory(command, myPlayerId);
        if (emitDrawCallback) emitDrawCallback(command);
    } else if (toolUsed === 'ellipse') {
        if (!wasDrawing) return; // Don't draw ellipse if mouse wasn't down
        clearOverlay();
        const cmdId = generateCommandId();
        const rx = Math.abs(x - startX) / 2;
        const ry = Math.abs(y - startY) / 2;
        const cx = startX + (x - startX) / 2;
        const cy = startY + (y - startY) / 2;
        // Ensure radii are not zero
        if (rx > 0 && ry > 0) {
            const command = { cmdId, type: 'ellipse', cx, cy, rx, ry, color: currentStrokeStyle, size: currentLineWidth };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (toolUsed === 'pencil' || toolUsed === 'eraser') {
        if (!wasDrawing) return;
        context.closePath();
    }

    // Reset drawing state AFTER processing
    isDrawing = false;
    currentStrokeId = null;
    startX = null; startY = null;

    // Update cursor preview if mouse is still over canvas
    if (isMouseOverCanvas) {
        updateCursorPreview();
    }
}

// --- Touch Handlers ---
// (Adaptations for touch, reusing core logic)
function handleTouchStart(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled) return;
    if (e.touches.length > 0) {
        handleMouseDown(e); // Reuse mouse down logic
    }
}

function handleTouchMove(e) {
    // No need to check isDrawing here, handleMouseMove does it
    if (!drawingEnabled) return;
    if (e.touches.length > 0) {
        handleMouseMove(e); // Reuse mouse move logic
    }
}

// Attached to WINDOW
function handleTouchEnd(e) {
    // Check if drawing was active before processing touchend
    const wasDrawing = isDrawing;
    const toolUsed = currentTool;

    if (!drawingEnabled || !myPlayerId) {
         isDrawing = false; currentStrokeId = null; return;
    }

    // Use changedTouches for the final position
    if (e.changedTouches.length > 0) {
       const pseudoEvent = {
           clientX: e.changedTouches[0].clientX,
           clientY: e.changedTouches[0].clientY,
           preventDefault: () => {}
       };
       // Call handleMouseUp with the stored state, not the potentially reset state
       handleMouseUp.call({ isDrawing: wasDrawing, currentTool: toolUsed }, pseudoEvent);
    } else {
       // Fallback if changedTouches is empty
       isDrawing = false;
       currentStrokeId = null;
       context.closePath(); // Ensure path is closed
       clearOverlay();
       if (isMouseOverCanvas) updateCursorPreview(); // Update preview if needed
    }
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