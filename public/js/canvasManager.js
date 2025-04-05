// public/js/canvasManager.js
import { floodFill, getPixelColor } from './drawing/fillUtil.js';

let canvas = null;
let context = null;
let overlayCanvas = null; // For shape previews
let overlayCtx = null;

let isDrawing = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let drawingEnabled = false; // Control whether drawing is allowed
let myPlayerId = null; // Store the current player's ID

// --- Tool State ---
let currentTool = 'pencil'; // 'pencil', 'eraser', 'fill', 'rectangle'
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;
const CANVAS_BACKGROUND_COLOR = "#FFFFFF"; // Define background color constant

// --- Stroke Grouping for Undo ---
let currentStrokeId = null; // ID for the current continuous stroke

// --- History ---
let myDrawHistory = []; // Commands initiated by this client { cmdId, type, strokeId?, ... } - Excludes 'clear'
let fullDrawHistory = []; // All commands executed { cmdId, playerId, type, strokeId?, ... }
const MAX_HISTORY = 500; // Increased history size slightly

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
    // Match canvas position dynamically if needed, or use CSS
    overlayCanvas.style.top = canvas.offsetTop + 'px';
    overlayCanvas.style.left = canvas.offsetLeft + 'px';
    overlayCanvas.style.pointerEvents = 'none';
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
    // ** Attach mouseup/touchend to window to catch events outside canvas **
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseOut); // Keep mouseout on canvas
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
    currentStrokeId = null; // Reset stroke ID
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
        clearHistory(); // Clear local history on clear
        addCommandToHistory(command, myPlayerId); // Add clear to full history
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
}

export function setColor(color) {
    currentStrokeStyle = color;
    if (context) context.strokeStyle = currentStrokeStyle;
    if (overlayCtx) overlayCtx.strokeStyle = currentStrokeStyle;
    console.log("Color set to:", currentStrokeStyle);
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5;
    if (context) context.lineWidth = currentLineWidth;
    if (overlayCtx) overlayCtx.lineWidth = currentLineWidth;
    console.log("Line width set to:", currentLineWidth);
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
    // Only add non-clear commands from self to own history
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

    // Rebuild own history from the full history, excluding 'clear'
    myDrawHistory = fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear')
        .map(({ playerId, ...rest }) => rest); // Store without playerId

    redrawCanvasFromHistory();
}

// Modified to handle removing single command or multiple by strokeId
export function removeCommands(idsToRemove = [], strokeIdToRemove = null) {
    const initialLength = fullDrawHistory.length;
    let removedCount = 0;

    if (strokeIdToRemove) {
        // Remove all commands matching the strokeId
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove) {
                removedCount++;
                return false; // Remove
            }
            return true; // Keep
        });
        // Also remove from local history
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToRemove);
        console.log(`Removed ${removedCount} commands for stroke ${strokeIdToRemove}.`);

    } else if (idsToRemove.length > 0) {
        // Remove specific command IDs
        const idSet = new Set(idsToRemove);
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId)) {
                removedCount++;
                return false; // Remove
            }
            return true; // Keep
        });
        // Also remove from local history
        myDrawHistory = myDrawHistory.filter(cmd => !idSet.has(cmd.cmdId));
        console.log(`Removed ${removedCount} commands by ID(s).`);
    }

    if (removedCount > 0) {
        redrawCanvasFromHistory(); // Redraw after removal
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
}

// Executes a single command on the provided context
function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) return;

    ctx.strokeStyle = cmd.color || currentStrokeStyle;
    ctx.lineWidth = cmd.size || currentLineWidth;
    ctx.fillStyle = cmd.color || currentStrokeStyle;

    switch (cmd.type) {
        case 'line':
            if (cmd.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
            } else {
                ctx.globalCompositeOperation = 'source-over';
            }
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
            ctx.strokeRect(x, y, width, height);
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
    // console.log(`Received external command: ${data.type} (${data.cmdId}) from ${data.playerId}`);

    // Handle external clear command - it resets history
    if (data.type === 'clear') {
        console.log("Received external clear command. Clearing history and canvas.");
        clearCanvas(false);
        clearHistory();
        addCommandToHistory(data, data.playerId); // Add clear to full history
        return;
    }

    // Add to full history
    addCommandToHistory(data, data.playerId);

    // Execute the command locally
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

    // Get the last command added by this player from THEIR history
    const lastMyCommand = myDrawHistory[myDrawHistory.length - 1];

    if (!lastMyCommand || !lastMyCommand.cmdId) {
        console.error("Invalid command found in local history for undo:", lastMyCommand);
        myDrawHistory.pop(); // Remove the bad entry
        redrawCanvasFromHistory();
        return;
    }

    // Determine if it's part of a stroke or a single action
    const strokeIdToUndo = lastMyCommand.strokeId; // Will be undefined for fill/rect

    console.log(`Requesting undo for ${strokeIdToUndo ? `stroke ${strokeIdToUndo}` : `command ${lastMyCommand.cmdId}`}`);

    // Optimistically remove from local history
    if (strokeIdToUndo) {
        // Remove all parts of the stroke from local history
        myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToUndo);
    } else {
        // Remove just the single command
        myDrawHistory.pop();
    }

    // Emit undo request to server WITH the specific stroke ID or command ID
    if (socket && socket.connected) {
        // Send strokeId if available, otherwise send cmdId
        const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdId: lastMyCommand.cmdId };
        socket.emit('undo last draw', undoData);
        // Don't redraw locally yet. Wait for 'lobby commands removed' confirmation.
    } else {
        console.error("Cannot emit undo: Socket not available or connected.");
        // If no socket, just redraw based on the optimistic local removal
        redrawCanvasFromHistory();
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
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        e.preventDefault();
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
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
            canvas.style.cursor = 'copy';
            break;
        case 'rectangle':
            canvas.style.cursor = 'crosshair';
            break;
        case 'pencil':
        default:
            canvas.style.cursor = 'crosshair';
            break;
    }
}

function clearOverlay() {
    if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
}

function handleMouseDown(e) {
    // Prevent starting draw if clicking on tools/UI elements over the canvas
    if (e.target !== canvas) return;

    if (!drawingEnabled || !myPlayerId) return;
    const { x, y } = getEventCoords(e);
    isDrawing = true;
    startX = x;
    startY = y;
    lastX = x;
    lastY = y;

    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.fillStyle = currentStrokeStyle;

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        currentStrokeId = generateStrokeId(); // Start a new stroke
        context.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
        context.beginPath();
        context.moveTo(startX, startY);
        // Optional: Draw a dot on mousedown for immediate feedback
        // drawLocalSegment(startX, startY, startX, startY);
        // emitDrawSegment(startX, startY, startX, startY);
    } else if (currentTool === 'fill') {
        isDrawing = false; // Fill happens on mouseup (click)
        currentStrokeId = null;
    } else if (currentTool === 'rectangle') {
        currentStrokeId = null;
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;
    } else {
        currentStrokeId = null; // Reset for other potential tools
    }
}

function handleMouseMove(e) {
    // Only process if drawing is enabled, we have an ID, AND the drawing flag is set
    if (!isDrawing || !drawingEnabled || !myPlayerId) return;

    const { x, y } = getEventCoords(e);

    switch (currentTool) {
        case 'pencil':
        case 'eraser':
            // Only draw & emit if the mouse has moved significantly (optional optimization)
            // if (Math.abs(x - lastX) > 1 || Math.abs(y - lastY) > 1) {
                drawLocalSegment(lastX, lastY, x, y);
                emitDrawSegment(lastX, lastY, x, y); // Includes currentStrokeId
                lastX = x;
                lastY = y;
            // }
            break;
        case 'rectangle':
            clearOverlay();
            const rectX = Math.min(startX, x);
            const rectY = Math.min(startY, y);
            const rectW = Math.abs(x - startX);
            const rectH = Math.abs(y - startY);
            overlayCtx.strokeRect(rectX, rectY, rectW, rectH);
            break;
    }

    // Update lastX, lastY only for tools that use it for segments (pencil/eraser)
    // if (currentTool === 'pencil' || currentTool === 'eraser') {
    //     lastX = x;
    //     lastY = y;
    // }
}

// Attached to WINDOW now
function handleMouseUp(e) {
    // Check if drawing was actually active
    if (!isDrawing && currentTool !== 'fill') { // Allow fill tool to work even if isDrawing is false
         // If mouseup happens outside canvas and wasn't drawing, do nothing
         return;
    }
     // If drawing was active but mouse is outside canvas, still finalize
     if (!drawingEnabled || !myPlayerId) {
         isDrawing = false; // Ensure state is reset
         currentStrokeId = null;
         return;
     }

    // Get coordinates relative to the canvas, even if event is on window
    const { x, y } = getEventCoords(e); // This calculates relative to canvas bounds

    if (currentTool === 'fill') {
        // Fill only triggers if mousedown was on canvas and no drag occurred
        // isDrawing is false for fill, so we check if startX/Y are valid
        if (startX !== null && startY !== null) {
            console.log(`Fill tool clicked at (${Math.round(x)}, ${Math.round(y)}) with color ${currentStrokeStyle}`);
            const cmdId = generateCommandId();
            const command = { cmdId, type: 'fill', x: x, y: y, color: currentStrokeStyle };
            executeCommand(command, context);
            addCommandToHistory(command, myPlayerId);
            if (emitDrawCallback) emitDrawCallback(command);
        }
    } else if (currentTool === 'rectangle') {
        if (!isDrawing) return; // Don't draw rect if mouse wasn't down
        clearOverlay();
        const cmdId = generateCommandId();
        const finalX0 = Math.min(startX, x);
        const finalY0 = Math.min(startY, y);
        const finalX1 = Math.max(startX, x);
        const finalY1 = Math.max(startY, y);
        const command = { cmdId, type: 'rect', x0: finalX0, y0: finalY0, x1: finalX1, y1: finalY1, color: currentStrokeStyle, size: currentLineWidth };
        executeCommand(command, context);
        addCommandToHistory(command, myPlayerId);
        if (emitDrawCallback) emitDrawCallback(command);
    } else if (currentTool === 'pencil' || currentTool === 'eraser') {
        if (!isDrawing) return; // Don't finalize if mouse wasn't down
        context.closePath();
    }

    // Reset drawing state AFTER processing the action
    isDrawing = false;
    currentStrokeId = null; // Clear stroke ID for next action
    startX = null; // Reset start coords
    startY = null;
}

// Keep on CANVAS
function handleMouseOut(e) {
    // Don't set isDrawing = false here anymore
    // Only clear overlay if we were drawing a shape
    if (isDrawing && currentTool === 'rectangle') {
        clearOverlay();
    }
    // We might want to stop emitting points if the mouse is out,
    // but the drawing state (isDrawing=true) should persist until mouseup.
}

// --- Touch Event Handlers ---
function handleTouchStart(e) {
    if (e.target !== canvas) return; // Prevent starting draw on UI elements
    if (!drawingEnabled) return;
    if (e.touches.length > 0) {
        handleMouseDown(e); // Reuse mouse down logic
    }
}

function handleTouchMove(e) {
    if (!isDrawing || !drawingEnabled) return;
    if (e.touches.length > 0) {
        handleMouseMove(e); // Reuse mouse move logic
    }
}

// Attached to WINDOW now
function handleTouchEnd(e) {
    // Check if drawing was active before processing touchend
    if (!isDrawing && currentTool !== 'fill') {
        return; // No drawing was in progress (unless it's a fill tap)
    }
     if (!drawingEnabled || !myPlayerId) {
         isDrawing = false; // Ensure state is reset
         currentStrokeId = null;
         return;
     }

    // Use changedTouches for the final position
    if (e.changedTouches.length > 0) {
       const pseudoEvent = {
           clientX: e.changedTouches[0].clientX,
           clientY: e.changedTouches[0].clientY,
           preventDefault: () => {}
       };
       handleMouseUp(pseudoEvent); // Reuse mouse up logic
    } else {
       // Fallback if changedTouches is empty for some reason
       isDrawing = false;
       currentStrokeId = null;
       context.closePath();
       clearOverlay();
    }
}

// Emits drawing data for a line segment
function emitDrawSegment(x0, y0, x1, y1) {
    if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return; // Need stroke ID
    const cmdId = generateCommandId();
    const command = {
        cmdId,
        strokeId: currentStrokeId, // Include the stroke ID
        type: 'line',
        x0: x0, y0: y0, x1: x1, y1: y1,
        tool: currentTool,
        color: currentTool === 'eraser' ? null : currentStrokeStyle,
        size: currentLineWidth
    };
    addCommandToHistory(command, myPlayerId);
    emitDrawCallback(command);
}

// Draws a line segment locally using current context settings
function drawLocalSegment(x0, y0, x1, y1) {
    if (!context) return;
    context.lineTo(x1, y1);
    context.stroke();
}