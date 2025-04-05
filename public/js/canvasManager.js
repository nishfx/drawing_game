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

// --- History ---
let myDrawHistory = []; // Commands initiated by this client { cmdId, type, ... } - Excludes 'clear'
let fullDrawHistory = []; // All commands executed { cmdId, playerId, type, ... }
const MAX_HISTORY = 200; // Limit history size

// --- Callback for emitting events ---
let emitDrawCallback = null;

// --- Exported Functions ---

export function initCanvas(canvasId, drawEventEmitter) {
    canvas = document.getElementById(canvasId);
    if (!canvas) { console.error("Canvas element not found:", canvasId); return false; }
    context = canvas.getContext('2d', { willReadFrequently: true }); // willReadFrequently for fill tool
    if (!context) { console.error("Failed to get 2D context"); return false; }

    // Create overlay canvas for previews
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = canvas.offsetTop + 'px';
    overlayCanvas.style.left = canvas.offsetLeft + 'px';
    overlayCanvas.style.pointerEvents = 'none'; // Ignore mouse events
    // Insert overlay *before* the main canvas in the DOM if possible, or adjust z-index
    canvas.parentNode.insertBefore(overlayCanvas, canvas);
    overlayCtx = overlayCanvas.getContext('2d');

    emitDrawCallback = drawEventEmitter; // Store the callback

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
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseOut);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    console.log(`Canvas "${canvasId}" initialized`);
    clearHistory();
    disableDrawing(); // Start disabled by default
    return true; // Indicate success
}

export function setPlayerId(playerId) {
    myPlayerId = playerId;
    console.log("CanvasManager Player ID set to:", myPlayerId);
}

export function enableDrawing() {
    if (!canvas) return;
    drawingEnabled = true;
    canvas.style.cursor = 'crosshair'; // Default cursor
    setCursorForTool(currentTool);
    console.log("Drawing enabled");
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false; // Ensure drawing stops if disabled mid-stroke
    clearOverlay(); // Clear any previews
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
        // Clear command resets history on server and other clients
        // We also clear local history when executing the clear command
        clearHistory();
        // Add the clear command itself to the full history locally for consistency during redraws
        addCommandToHistory(command, myPlayerId);
        emitDrawCallback(command); // Emit the clear command
        console.log("Dispatched clear event");
    } else if (!emitEvent) {
        // If clearing locally without emitting (e.g., initial load), clear histories too
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
    // Reset composite operation for non-eraser tools
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
    // Use a more robust ID generator (e.g., combining timestamp and random string)
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

function addCommandToHistory(command, playerId) {
    const fullCommand = { ...command, playerId };
    fullDrawHistory.push(fullCommand);
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift(); // Limit history size
    }
    // Only add to own history if it's our command AND not a 'clear' command
    // (Clear resets history, shouldn't be individually undone this way)
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
    clearCanvas(false); // Clear canvas locally without emitting
    clearHistory();
    fullDrawHistory = commands.map(cmd => ({ ...cmd })); // Store full history

    // Rebuild own history from the full history, excluding 'clear'
    myDrawHistory = fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear')
        .map(({ playerId, ...rest }) => rest); // Store without playerId

    redrawCanvasFromHistory();
}

export function removeCommandById(cmdId) {
    const initialLength = fullDrawHistory.length;
    fullDrawHistory = fullDrawHistory.filter(cmd => cmd.cmdId !== cmdId);
    // Also remove from local history if present (it might have been added optimistically)
    myDrawHistory = myDrawHistory.filter(cmd => cmd.cmdId !== cmdId);

    if (fullDrawHistory.length < initialLength) {
        console.log(`Removed command ${cmdId} from history.`);
        redrawCanvasFromHistory(); // Redraw after removal
    } else {
        console.warn(`Command ${cmdId} not found in history for removal.`);
    }
}

function redrawCanvasFromHistory() {
    if (!context || !canvas) return;
    console.log(`Redrawing canvas from ${fullDrawHistory.length} commands.`);
    // Clear canvas locally first
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    // Store original settings
    const originalStroke = context.strokeStyle;
    const originalFill = context.fillStyle;
    const originalWidth = context.lineWidth;
    const originalComposite = context.globalCompositeOperation;

    // Execute all commands in order
    fullDrawHistory.forEach(cmd => {
        try {
            executeCommand(cmd, context); // Use main context
        } catch (error) {
            console.error("Error redrawing command:", cmd, error);
        }
    });

    // Restore original settings
    context.strokeStyle = originalStroke;
    context.fillStyle = originalFill;
    context.lineWidth = originalWidth;
    context.globalCompositeOperation = originalComposite;
    console.log("Canvas redraw complete.");
}

// Executes a single command on the provided context
function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) return;

    // Set styles for the command
    ctx.strokeStyle = cmd.color || currentStrokeStyle;
    ctx.lineWidth = cmd.size || currentLineWidth;
    ctx.fillStyle = cmd.color || currentStrokeStyle; // Fill uses same color for shapes/fill tool

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
            // Restore default composite op after drawing
            ctx.globalCompositeOperation = 'source-over';
            break;
        case 'rect':
            ctx.globalCompositeOperation = 'source-over';
            // Ensure width/height are positive for strokeRect
            const x = Math.min(cmd.x0, cmd.x1);
            const y = Math.min(cmd.y0, cmd.y1);
            const width = Math.abs(cmd.x1 - cmd.x0);
            const height = Math.abs(cmd.y1 - cmd.y0);
            ctx.strokeRect(x, y, width, height);
            break;
        case 'fill':
            ctx.globalCompositeOperation = 'source-over';
            // Flood fill needs the context to read pixels, so pass it
            floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
            break;
        case 'clear':
            // Clear is handled by the initial clear in redrawCanvasFromHistory
            // Or when receiving an external 'clear' command
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
    console.log(`Received external command: ${data.type} (${data.cmdId}) from ${data.playerId}`);

    // Handle external clear command - it resets history
    if (data.type === 'clear') {
        console.log("Received external clear command. Clearing history and canvas.");
        clearCanvas(false); // Clear locally
        clearHistory();     // Clear history
        // Add the clear command itself to the history (optional, but consistent)
        addCommandToHistory(data, data.playerId);
        return; // Don't execute further for clear
    }

    // Add to full history
    addCommandToHistory(data, data.playerId);

    // Execute the command locally
    try {
        // Store original settings
        const originalStroke = context.strokeStyle;
        const originalFill = context.fillStyle;
        const originalWidth = context.lineWidth;
        const originalComposite = context.globalCompositeOperation;

        executeCommand(data, context);

        // Restore original settings
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
        // Optionally provide user feedback (e.g., button disabled state or message)
        return;
    }

    // Get the last command added by this player from THEIR history
    const commandToUndo = myDrawHistory.pop(); // Remove from local history optimistically

    if (!commandToUndo || !commandToUndo.cmdId) {
        console.error("Invalid command found in local history for undo:", commandToUndo);
        // Attempt to redraw without the potentially bad local command
        redrawCanvasFromHistory();
        return;
    }

    console.log(`Requesting undo for command: ${commandToUndo.cmdId}`);

    // Emit undo request to server WITH the specific command ID
    if (socket && socket.connected) {
        socket.emit('undo last draw', { cmdId: commandToUndo.cmdId });
        // Don't redraw locally yet. Wait for 'lobby command removed' confirmation
        // which triggers redraw for everyone, ensuring sync.
    } else {
        console.error("Cannot emit undo: Socket not available or connected.");
        // If no socket, put the command back into local history and redraw
        myDrawHistory.push(commandToUndo); // Put it back
        redrawCanvasFromHistory(); // Redraw current state
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
        e.preventDefault(); // Prevent scroll/zoom on touch move
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
            // Use a custom cursor or a more indicative one if possible
            canvas.style.cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="5" y="5" width="10" height="10" fill="white" stroke="black"/></svg>') 10 10, auto`;
            break;
        case 'fill':
            canvas.style.cursor = 'copy'; // Or use a paint bucket icon cursor
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
    if (!drawingEnabled || !myPlayerId) return;
    const { x, y } = getEventCoords(e);
    isDrawing = true;
    startX = x;
    startY = y;
    lastX = x;
    lastY = y;

    // Set context properties based on current tool
    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.fillStyle = currentStrokeStyle; // Fill uses the stroke color

    if (currentTool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
        context.beginPath();
        context.moveTo(startX, startY);
    } else if (currentTool === 'fill') {
        isDrawing = false; // Prevent mouseMove drawing for fill
    } else if (currentTool === 'rectangle') {
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;
        overlayCtx.fillStyle = currentStrokeStyle; // Might want fill preview later
    } else { // Pencil
        context.globalCompositeOperation = 'source-over';
        context.beginPath();
        context.moveTo(startX, startY);
    }
}

function handleMouseMove(e) {
    if (!isDrawing || !drawingEnabled || !myPlayerId) return;
    const { x, y } = getEventCoords(e);

    switch (currentTool) {
        case 'pencil':
        case 'eraser':
            // Draw segment locally first for responsiveness
            drawLocalSegment(lastX, lastY, x, y);
            // Then emit the command for the server/others
            emitDrawSegment(lastX, lastY, x, y);
            break;
        case 'rectangle':
            clearOverlay();
            // Draw preview on overlay
            const rectX = Math.min(startX, x);
            const rectY = Math.min(startY, y);
            const rectW = Math.abs(x - startX);
            const rectH = Math.abs(y - startY);
            overlayCtx.strokeRect(rectX, rectY, rectW, rectH);
            break;
    }

    lastX = x;
    lastY = y;
}

function handleMouseUp(e) {
    if (!drawingEnabled || !myPlayerId) return;
    const { x, y } = getEventCoords(e);

    if (currentTool === 'fill') {
        if (isDrawing) return; // Don't fill if mouse was dragged
        console.log(`Fill tool clicked at (${Math.round(x)}, ${Math.round(y)}) with color ${currentStrokeStyle}`);
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            type: 'fill',
            x: x, y: y,
            color: currentStrokeStyle,
        };
        // Execute locally first for immediate feedback
        executeCommand(command, context);
        // Add to history
        addCommandToHistory(command, myPlayerId);
        // Emit
        if (emitDrawCallback) emitDrawCallback(command);

    } else if (currentTool === 'rectangle') {
        if (!isDrawing) return; // Only finalize if mouse was down
        clearOverlay();
        const cmdId = generateCommandId();
        // Ensure coordinates are consistent (e.g., x0,y0 is top-left) - not strictly necessary for server/redraw
        const finalX0 = Math.min(startX, x);
        const finalY0 = Math.min(startY, y);
        const finalX1 = Math.max(startX, x);
        const finalY1 = Math.max(startY, y);
        const command = {
            cmdId,
            type: 'rect',
            x0: finalX0, y0: finalY0,
            x1: finalX1, y1: finalY1, // Store final coords
            color: currentStrokeStyle,
            size: currentLineWidth,
        };
        // Execute locally
        executeCommand(command, context);
        // Add to history
        addCommandToHistory(command, myPlayerId);
        // Emit
        if (emitDrawCallback) emitDrawCallback(command);

    } else if (currentTool === 'pencil' || currentTool === 'eraser') {
        if (!isDrawing) return; // Only finalize if mouse was down
        // Optional: Draw the final point if needed (usually covered by mousemove)
        // drawLocalSegment(lastX, lastY, x, y);
        // emitDrawSegment(lastX, lastY, x, y);
        context.closePath();
    }

    isDrawing = false;
}

function handleMouseOut(e) {
    if (!isDrawing || !drawingEnabled) return;
    // If drawing shape, finalize on mouse out? Or cancel? Let's finalize.
    if (currentTool === 'rectangle') {
        handleMouseUp(e); // Treat mouse out like mouse up for shapes
    }
    isDrawing = false;
    context.closePath(); // Close any open path
    clearOverlay();
}

// --- Touch Event Handlers ---
function handleTouchStart(e) {
    if (!drawingEnabled) return;
    // Use first touch point
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

function handleTouchEnd(e) {
    if (!drawingEnabled) return;
    // Need to use changedTouches for the final position
    if (e.changedTouches.length > 0) {
       // Create a pseudo event object for handleMouseUp
       const pseudoEvent = {
           clientX: e.changedTouches[0].clientX,
           clientY: e.changedTouches[0].clientY,
           preventDefault: () => {} // Mock preventDefault
       };
       handleMouseUp(pseudoEvent);
    } else {
       isDrawing = false; // Ensure drawing stops
       context.closePath();
       clearOverlay();
    }
}

// Emits drawing data for a line segment
function emitDrawSegment(x0, y0, x1, y1) {
    if (!emitDrawCallback || !myPlayerId) return;
    const cmdId = generateCommandId();
    const command = {
        cmdId,
        type: 'line',
        x0: x0, y0: y0, x1: x1, y1: y1,
        tool: currentTool, // Include tool type (pencil/eraser)
        color: currentTool === 'eraser' ? null : currentStrokeStyle, // Eraser doesn't need color
        size: currentLineWidth
    };
    // Add own command to history immediately
    addCommandToHistory(command, myPlayerId);
    // Emit the command
    emitDrawCallback(command);
}

// Draws a line segment locally using current context settings
function drawLocalSegment(x0, y0, x1, y1) {
    if (!context) return;
    // Settings (color, width, compositeOp) are assumed to be set correctly before calling this
    // For pencil/eraser, path is already begun in mousedown/mousemove
    context.lineTo(x1, y1);
    context.stroke();
}