// public/js/canvasManager.js
// Import necessary functions
import { floodFill, getPixelColor } from './drawing/fillUtil.js';

// --- Module Variables ---
let canvas = null;
let context = null;
let overlayCanvas = null; // For cursor preview and shape drawing previews
let overlayCtx = null;

// Drawing state
let isDrawing = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0; // Tracks the latest *canvas* coordinates
let currentMouseY = 0;
let isMouseOverCanvas = false;
let drawingEnabled = false;
let myPlayerId = null;

// Tool settings
let currentTool = 'pencil';
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;
const CANVAS_BACKGROUND_COLOR = "#FFFFFF";

// Identifiers
let currentStrokeId = null; // ID for the current continuous stroke/shape

// Shape drawing state
let shapeStartX = null;
let shapeStartY = null;

// History
let myDrawHistory = []; // Stores command objects initiated by the local user
let fullDrawHistory = []; // Stores all command objects from all users
const MAX_HISTORY = 500; // Limit history size

// Callback for emitting draw events
let emitDrawCallback = null;

// -------------------------------------------------------------------
// ID Helpers
// -------------------------------------------------------------------
function generateStrokeId() {
    return `${myPlayerId}-stroke-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
function generateCommandId() {
    return `${myPlayerId}-cmd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// -------------------------------------------------------------------
// Initialization
// -------------------------------------------------------------------
export function initCanvas(canvasId, drawEventEmitter) {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error("Canvas element not found:", canvasId);
        return false;
    }
    context = canvas.getContext('2d', { willReadFrequently: true }); // willReadFrequently needed for fill tool
    if (!context) {
        console.error("Failed to get 2D context");
        return false;
    }

    const parent = canvas.parentNode;
    if (!parent) {
        console.error("Canvas must have a parent node for overlay positioning.");
        return false;
    }

    // Create an overlay canvas for cursor preview and shape drawing previews
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width; // Match internal resolution
    overlayCanvas.height = canvas.height;
    overlayCanvas.style.position = 'absolute'; // Position relative to nearest positioned ancestor
    overlayCanvas.style.pointerEvents = 'none'; // Allow clicks to pass through to the main canvas
    overlayCanvas.style.zIndex = '10'; // Ensure it's visually on top of the main canvas if needed
    overlayCanvas.id = `${canvasId}-overlay`; // Give it an ID for debugging

    // Insert the overlay into the DOM *before* the main canvas
    parent.insertBefore(overlayCanvas, canvas);
    overlayCtx = overlayCanvas.getContext('2d');

    // --- Positioning ---
    // Ensure parent has relative positioning (CSS should handle this via #drawing-controls/#lobby-canvas-area)
    if (getComputedStyle(parent).position === 'static') {
        console.warn(`Canvas parent node for #${canvasId} should have position:relative for overlay.`);
        // Avoid modifying style directly if possible, rely on CSS: parent.style.position = 'relative';
    }

    // Initial sync using the dedicated function, wrapped in rAF
    // This ensures layout is calculated after insertion and styles are applied
    requestAnimationFrame(resyncOverlayPosition);

    emitDrawCallback = drawEventEmitter;

    // Set initial canvas styles
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineJoin = 'round';
    context.lineCap = 'round';

    // Set initial overlay styles
    overlayCtx.lineJoin = 'round';
    overlayCtx.lineCap = 'round';

    // --- Event Listeners ---
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove); // resync is called inside here
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mouseenter', handleMouseEnter);

    // Touch events
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false }); // passive:false to allow preventDefault
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false }); // passive:false to allow preventDefault
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd); // Treat cancel like end

    // Listen for window resizes, re-sync overlay using requestAnimationFrame
    window.addEventListener('resize', () => {
        requestAnimationFrame(resyncOverlayPosition);
    });

    // Optional: Listen for scroll events if the canvas position might change on scroll
    // This requires careful consideration of the scrolling container.
    // window.addEventListener('scroll', () => {
    //    requestAnimationFrame(resyncOverlayPosition);
    // }, true); // Use capture phase if scrolling container is higher up

    console.log(`Canvas "${canvasId}" initialized successfully.`);
    clearHistory(); // Reset history on init
    disableDrawing(); // Start disabled
    return true;
}

// -------------------------------------------------------------------
// Overlay Position Synchronization (Crucial for Cursor Accuracy)
// -------------------------------------------------------------------
/**
 * Recalculates and applies the correct position and size for the overlay canvas
 * to ensure it perfectly matches the main canvas's position and dimensions,
 * relative to their common parent container. Uses getBoundingClientRect for robustness.
 */
function resyncOverlayPosition() {
    if (!canvas || !overlayCanvas) return;
    const parent = canvas.parentNode;
    if (!parent) return; // Should not happen if init succeeded

    // Check parent positioning (optional, CSS should handle)
    // if (getComputedStyle(parent).position === 'static') {
    //     console.warn("Canvas parent node should have position:relative for overlay.");
    // }

    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    // Update overlay internal dimensions if canvas dimensions changed (less common but possible)
    // Note: canvas.width/height are the internal drawing resolution,
    // canvasRect.width/height are the CSS display size.
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
        console.log("Overlay internal dimensions resynced.");
    }

    // Calculate the offset of the canvas *within* the parent's coordinate system.
    // This determines the 'top' and 'left' for the absolutely positioned overlay.
    const newTop = canvasRect.top - parentRect.top;
    const newLeft = canvasRect.left - parentRect.left;

    // Get the display dimensions from the canvas's bounding rectangle.
    // This ensures the overlay visually covers the same area as the canvas.
    const newWidth = canvasRect.width;
    const newHeight = canvasRect.height;

    // Apply styles only if they have actually changed to minimize layout thrashing.
    // Compare with current style values.
    let changed = false;
    if (overlayCanvas.style.top !== `${newTop}px`) {
        overlayCanvas.style.top = `${newTop}px`;
        changed = true;
    }
    if (overlayCanvas.style.left !== `${newLeft}px`) {
        overlayCanvas.style.left = `${newLeft}px`;
        changed = true;
    }
    if (overlayCanvas.style.width !== `${newWidth}px`) {
        overlayCanvas.style.width = `${newWidth}px`;
        changed = true;
    }
    if (overlayCanvas.style.height !== `${newHeight}px`) {
        overlayCanvas.style.height = `${newHeight}px`;
        changed = true;
    }

    // if (changed) {
    //     console.log(`Overlay resynced: T:${newTop.toFixed(1)} L:${newLeft.toFixed(1)} W:${newWidth.toFixed(1)} H:${newHeight.toFixed(1)}`);
    // }
}


// -------------------------------------------------------------------
// State Management
// -------------------------------------------------------------------
export function setPlayerId(playerId) {
    myPlayerId = playerId;
    console.log("CanvasManager: Player ID set to:", myPlayerId);
}

export function enableDrawing() {
    if (!canvas) return;
    drawingEnabled = true;
    console.log("Drawing enabled");
    setCursorStyle(); // Update cursor style (might change to 'none')
    // If mouse is already over canvas, show preview immediately
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false; // Ensure drawing stops if disabled mid-stroke
    clearOverlay(); // Remove cursor preview
    canvas.style.cursor = 'not-allowed'; // Show 'not-allowed' cursor inside canvas
    console.log("Drawing disabled");
}

// -------------------------------------------------------------------
// Clearing & Data Export
// -------------------------------------------------------------------
export function clearCanvas(emitEvent = true) {
    if (!context || !canvas) return;

    // Find all command IDs belonging to the current player
    const myCmdIds = [];
    fullDrawHistory.forEach(cmd => {
        if (cmd.playerId === myPlayerId) {
            myCmdIds.push(cmd.cmdId);
        }
    });

    // If any commands were found, remove them locally and redraw
    if (myCmdIds.length > 0) {
        removeCommands(myCmdIds, null, myPlayerId); // Remove by IDs, specify owner
        console.log("Locally removed all my drawing commands. Redrawing canvas...");
        redrawCanvasFromHistory(); // Redraw without the removed commands
    } else {
        console.log("No local drawing commands to clear.");
    }

    // Emit a 'clear' event to the server if requested and possible
    if (emitEvent && emitDrawCallback && myPlayerId) {
        const cmdId = generateCommandId();
        const command = { cmdId, type: 'clear', playerId: myPlayerId }; // Include playerId
        emitDrawCallback(command);
        console.log("Emitted 'clear' command to server.");
    }
}

export function getDrawingDataURL() {
    if (!canvas) return null;
    try {
        // Ensure background is white before exporting if needed (redraw does this)
        // redrawCanvasFromHistory(); // Optional: Force redraw if state might be inconsistent
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Error getting canvas data URL:", e);
        // Could be due to tainted canvas if external images were drawn (not applicable here)
        return null;
    }
}

// -------------------------------------------------------------------
// Tools & Settings
// -------------------------------------------------------------------
export function setTool(toolName) {
    currentTool = toolName;
    console.log("Tool set to:", currentTool);
    setCursorStyle(); // Update cursor based on tool/state
    // Update preview if mouse is over canvas
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    } else {
        clearOverlay(); // Clear preview if mouse is outside
    }
}

export function setColor(color) {
    currentStrokeStyle = color;
    console.log("Color set to:", currentStrokeStyle);
    // Update preview color if mouse is over canvas
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5; // Ensure it's a number, default 5
    console.log("Line width set to:", currentLineWidth);
    // Update preview size if mouse is over canvas
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

// -------------------------------------------------------------------
// History & Redraw Logic
// -------------------------------------------------------------------
function clearHistory() {
    myDrawHistory = [];
    fullDrawHistory = [];
    console.log("Local drawing history cleared.");
}

/**
 * Loads a complete history of drawing commands (e.g., from the server)
 * and redraws the entire canvas based on this history.
 * @param {Array<Object>} commands - An array of drawing command objects.
 */
export function loadAndDrawHistory(commands) {
    if (!context || !canvas) return;
    console.log(`Loading ${commands.length} commands from history.`);

    // Clear existing history and canvas content
    clearHistory();
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay();

    // Populate local history arrays
    fullDrawHistory = commands.map(cmd => ({ ...cmd })); // Deep copy commands
    myDrawHistory = fullDrawHistory
        .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear') // Filter my non-clear commands
        .map(x => ({ ...x })); // Deep copy

    // Redraw everything
    redrawCanvasFromHistory();
}

/**
 * Removes specific drawing commands from the local history arrays based on
 * command IDs or a stroke ID, but only if they belong to the specified ownerPlayerId.
 * After removal, it triggers a full canvas redraw.
 * @param {Array<string>} [idsToRemove=[]] - An array of command IDs to remove.
 * @param {string|null} [strokeIdToRemove=null] - A stroke ID; all commands with this ID will be removed.
 * @param {string|null} ownerPlayerId - The ID of the player whose commands should be removed. Crucial to prevent removing others' work.
 */
export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
    if (!ownerPlayerId) {
        console.warn("removeCommands called without ownerPlayerId. Skipping removal.");
        return;
    }
    let removedCount = 0;
    const initialFullLength = fullDrawHistory.length;
    const initialMyLength = myDrawHistory.length;

    if (strokeIdToRemove) {
        // Filter based on strokeId and ownerPlayerId
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId) {
                removedCount++;
                return false; // Exclude this command
            }
            return true; // Keep this command
        });
        myDrawHistory = myDrawHistory.filter(cmd => {
            return !(cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId);
        });
        console.log(`Removed ${removedCount} commands for stroke=${strokeIdToRemove} from player=${ownerPlayerId}.`);

    } else if (idsToRemove.length > 0) {
        const idSet = new Set(idsToRemove);
        // Filter based on command ID set and ownerPlayerId
        fullDrawHistory = fullDrawHistory.filter(cmd => {
            if (idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId) {
                removedCount++;
                return false; // Exclude this command
            }
            return true; // Keep this command
        });
        myDrawHistory = myDrawHistory.filter(cmd => {
            return !(idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId);
        });
        console.log(`Removed ${removedCount} commands by cmdId(s) from player=${ownerPlayerId}.`);
    }

    // If any commands were actually removed, redraw the canvas
    if (removedCount > 0) {
        console.log(`History lengths changed: Full ${initialFullLength}->${fullDrawHistory.length}, My ${initialMyLength}->${myDrawHistory.length}. Redrawing.`);
        redrawCanvasFromHistory();
    } else {
        console.warn(`No commands found to remove for stroke=${strokeIdToRemove}, cmdIds=${idsToRemove.length}, owner=${ownerPlayerId}.`);
    }
}

/**
 * Clears the canvas and redraws all commands currently stored in `fullDrawHistory`.
 */
function redrawCanvasFromHistory() {
    if (!context || !canvas) return;
    console.log(`Redrawing canvas from ${fullDrawHistory.length} commands.`);

    // Save current context state
    context.save();

    // Clear canvas with background color
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    clearOverlay(); // Also clear the overlay

    // Execute each command in the history
    fullDrawHistory.forEach(cmd => {
        try {
            executeCommand(cmd, context);
        } catch (error) {
            console.error("Error redrawing command:", cmd, error);
            // Optionally remove the faulty command from history here
        }
    });

    // Restore context state
    context.restore();

    console.log("Canvas redraw complete.");
    // Restore cursor preview if mouse is still over canvas
    if (isMouseOverCanvas) {
        updateCursorPreview(currentMouseX, currentMouseY);
    }
}

/**
 * Executes a single drawing command on the provided canvas context.
 * @param {Object} cmd - The drawing command object.
 * @param {CanvasRenderingContext2D} ctx - The context to draw on.
 */
function executeCommand(cmd, ctx) {
    if (!cmd || !cmd.type) {
        console.warn("executeCommand called with invalid command:", cmd);
        return;
    }

    // Save context state before applying command-specific settings
    ctx.save();

    // Set composite operation based on tool (eraser uses destination-out)
    ctx.globalCompositeOperation = (cmd.tool === 'eraser') ? 'destination-out' : 'source-over';

    // Set styles and line width
    // For eraser, strokeStyle/fillStyle aren't directly used by destination-out,
    // but we set them anyway for consistency. The *shape* drawn matters.
    ctx.strokeStyle = (cmd.color && cmd.tool !== 'eraser') ? cmd.color : '#000000'; // Default black if color missing/eraser
    ctx.fillStyle = (cmd.color && cmd.tool !== 'eraser') ? cmd.color : '#000000';
    ctx.lineWidth = (cmd.size != null) ? cmd.size : 5; // Default 5 if size missing

    // Execute command based on type
    switch (cmd.type) {
        case 'line':
            if (cmd.x0 != null && cmd.y0 != null && cmd.x1 != null && cmd.y1 != null) {
                ctx.beginPath();
                ctx.moveTo(cmd.x0, cmd.y0);
                ctx.lineTo(cmd.x1, cmd.y1);
                ctx.stroke();
                // No closePath for single lines
            } else {
                console.warn("Invalid 'line' command data:", cmd);
            }
            break;

        case 'rect':
            if (cmd.x0 != null && cmd.y0 != null && cmd.x1 != null && cmd.y1 != null) {
                const x = Math.min(cmd.x0, cmd.x1);
                const y = Math.min(cmd.y0, cmd.y1);
                const w = Math.abs(cmd.x1 - cmd.x0);
                const h = Math.abs(cmd.y1 - cmd.y0);
                // Use strokeRect for outline, fillRect for filled (currently only stroke)
                ctx.strokeRect(x, y, w, h);
            } else {
                console.warn("Invalid 'rect' command data:", cmd);
            }
            break;

        case 'ellipse':
             if (cmd.x0 != null && cmd.y0 != null && cmd.x1 != null && cmd.y1 != null) {
                const cx = (cmd.x0 + cmd.x1) / 2;
                const cy = (cmd.y0 + cmd.y1) / 2;
                const rx = Math.abs(cmd.x1 - cmd.x0) / 2;
                const ry = Math.abs(cmd.y1 - cmd.y0) / 2;
                ctx.beginPath();
                // Ellipse needs beginPath/stroke/closePath
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.closePath();
            } else {
                console.warn("Invalid 'ellipse' command data:", cmd);
            }
            break;

        case 'fill':
            if (cmd.x != null && cmd.y != null && cmd.color != null) {
                // floodFill handles its own context manipulation internally
                floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
            } else {
                console.warn("Invalid 'fill' command data:", cmd);
            }
            break;

        case 'text':
            if (cmd.x != null && cmd.y != null && cmd.text != null && cmd.color != null) {
                const fontSize = Math.max(5, (cmd.size || 5) * 4); // Scale line width to font size
                ctx.font = `${fontSize}px sans-serif`;
                ctx.textBaseline = 'top'; // Align text from top-left corner
                ctx.fillText(cmd.text, cmd.x, cmd.y);
            } else {
                console.warn("Invalid 'text' command data:", cmd);
            }
            break;

        case 'clear':
            // The 'clear' command is handled by removing history items in `removeCommands`.
            // No drawing action needed here during redraw.
            break;

        default:
            console.warn("Unknown command type encountered during redraw:", cmd.type, cmd);
    }

    // Restore context state to before this command
    ctx.restore();
}

/**
 * Adds a command received from another player to the history and draws it.
 * Skips the command if it originated from the local player.
 * @param {Object} data - The drawing command object received from the server.
 */
export function drawExternalCommand(data) {
    // Skip if the command is from the local player (already drawn) or invalid
    if (!data || !data.cmdId || !data.playerId) {
        console.warn("Invalid external command received:", data);
        return;
    }
    if (data.playerId === myPlayerId) {
        // console.log("Skipping own external command:", data.cmdId);
        return;
    }

    // Handle 'clear' command from others by removing their history
    if (data.type === 'clear') {
        console.log(`Received 'clear' command from player ${data.playerId}. Removing their history.`);
        const theirCmdIds = [];
        fullDrawHistory.forEach(cmd => {
            if (cmd.playerId === data.playerId) {
                theirCmdIds.push(cmd.cmdId);
            }
        });
        if (theirCmdIds.length > 0) {
            removeCommands(theirCmdIds, null, data.playerId); // Remove their commands
            redrawCanvasFromHistory(); // Redraw after removal
        }
        return; // Don't add the 'clear' command itself to history
    }

    // Add the valid external command to the full history
    fullDrawHistory.push({ ...data }); // Store a copy
    // Prune history if it exceeds the maximum size
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift(); // Remove the oldest command
    }

    // Execute the command on the main canvas context
    try {
        executeCommand(data, context);
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    }
}

// -------------------------------------------------------------------
// Undo Functionality
// -------------------------------------------------------------------
export function undoLastAction(socket) {
    if (!myPlayerId) {
        console.warn("Cannot undo: Player ID not set.");
        return;
    }
    if (myDrawHistory.length === 0) {
        console.log("Nothing in local history to undo.");
        return;
    }

    // Get the most recent command added by the local player
    const lastMyCommand = myDrawHistory.pop(); // Remove from local undo history immediately

    if (!lastMyCommand || !lastMyCommand.cmdId) {
        console.error("Invalid command found during undo:", lastMyCommand);
        // Attempt to redraw anyway to potentially fix state
        redrawCanvasFromHistory();
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
        removeCommands(idsToRemoveFromFull, null, myPlayerId); // Use the removal function
        redrawCanvasFromHistory(); // Redraw the canvas locally immediately

        // Ask the server to remove these commands for other players
        if (socket && socket.connected) {
            // Send either the strokeId (if available) or the list of cmdIds
            const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdIds: idsToRemoveFromFull };
            socket.emit('undo last draw', undoData);
            console.log("Sent undo request to server:", undoData);
        } else {
            console.error("Cannot send undo request: No socket connected.");
        }
    } else {
        console.warn("Undo failed: Could not find commands to remove from full history for:", lastMyCommand);
        // Put the command back into myDrawHistory if removal failed? Maybe not needed.
        redrawCanvasFromHistory(); // Redraw anyway to be safe
    }
}


// -------------------------------------------------------------------
// Coordinate Calculation
// -------------------------------------------------------------------
/**
 * Calculates the canvas-internal coordinates (x, y) from a mouse or touch event.
 * Accounts for canvas scaling and position relative to the viewport.
 * @param {MouseEvent|TouchEvent} e - The event object.
 * @returns {{x: number, y: number}} Canvas coordinates.
 */
function getEventCoords(e) {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect(); // Gets position and size relative to viewport

    let clientX, clientY;
    // Check if it's a touch event
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        // Prevent default touch actions like scrolling when drawing on canvas
        e.preventDefault();
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        // Handle touchend/touchcancel
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        // Assume mouse event
        clientX = e.clientX;
        clientY = e.clientY;
    }

    // Calculate position relative to the canvas element's top-left corner
    const xRel = clientX - rect.left;
    const yRel = clientY - rect.top;

    // Calculate scaling factor between display size and internal resolution
    // rect.width is the CSS display width, canvas.width is the internal drawing width
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Apply scaling to get coordinates within the canvas's internal system
    const canvasX = xRel * scaleX;
    const canvasY = yRel * scaleY;

    // Clamp coordinates to be within the canvas bounds
    const clampedX = Math.max(0, Math.min(canvasX, canvas.width));
    const clampedY = Math.max(0, Math.min(canvasY, canvas.height));

    return { x: clampedX, y: clampedY };
}


// -------------------------------------------------------------------
// Cursor and Overlay Management
// -------------------------------------------------------------------
/** Sets the CSS cursor style for the main canvas element. */
function setCursorStyle() {
    if (!canvas) return;
    if (!drawingEnabled) {
        canvas.style.cursor = 'not-allowed';
    } else if (isMouseOverCanvas) {
        // Hide the default system cursor when the custom preview is active
        canvas.style.cursor = 'none';
    } else {
        // Show the default cursor when the mouse is outside the canvas
        canvas.style.cursor = 'default';
    }
}

/** Clears the entire overlay canvas. */
function clearOverlay() {
    if (!overlayCtx || !overlayCanvas) return;
    // Ensure overlay dimensions match canvas (might have changed)
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
    }
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

/** Draws the circular cursor preview on the overlay canvas. */
function drawCursorPreview(x, y) {
    if (!overlayCtx || !drawingEnabled || isDrawing) {
        // Don't draw preview if drawing is disabled or currently drawing a line/shape
        clearOverlay();
        return;
    }
    clearOverlay(); // Clear previous preview frame

    overlayCtx.beginPath();
    // Calculate radius based on line width, ensure minimum size
    const radius = Math.max(1, currentLineWidth / 2);
    // Determine color (gray for eraser, current color otherwise)
    const previewColor = (currentTool === 'eraser') ? '#888888' : currentStrokeStyle;

    // Draw the circle outline
    overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    overlayCtx.strokeStyle = previewColor;
    overlayCtx.lineWidth = 1; // Use a thin line for the preview outline
    overlayCtx.stroke();
    // overlayCtx.closePath(); // Not needed for stroke()
}

/** Updates the cursor preview position and style. */
function updateCursorPreview(x, y) {
    // Only draw the preview if mouse is over canvas, drawing is enabled, and not actively drawing
    if (isMouseOverCanvas && drawingEnabled && !isDrawing) {
        drawCursorPreview(x, y);
    } else {
        clearOverlay(); // Clear preview otherwise
    }
    setCursorStyle(); // Ensure CSS cursor style is correct
}

// -------------------------------------------------------------------
// Mouse Event Handlers
// -------------------------------------------------------------------
function handleMouseEnter(e) {
    isMouseOverCanvas = true;
    // Get initial coordinates on enter
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;
    // Update cursor style and potentially show preview
    setCursorStyle();
    updateCursorPreview(x, y);
}

function handleMouseLeave(e) {
    // If drawing was in progress when mouse left, finish the stroke
    if (isDrawing) {
        // Use the last known coordinates before leaving
        finishStroke(currentMouseX, currentMouseY);
    }
    isMouseOverCanvas = false;
    clearOverlay(); // Remove preview
    setCursorStyle(); // Restore default cursor outside canvas
}

function handleMouseDown(e) {
    if (!drawingEnabled || !myPlayerId) return;
    // Only respond to main button (left-click or primary touch)
    if (e.button !== 0 && e.type !== 'touchstart') return;

    // Sync overlay position before getting coordinates
    resyncOverlayPosition();
    const { x, y } = getEventCoords(e);

    isMouseOverCanvas = true; // Ensure flag is set
    isDrawing = true;
    startX = x; // Record start position for shapes/lines
    startY = y;
    lastX = x; // Initialize last position for line segments
    lastY = y;
    currentMouseX = x; // Update current position
    currentMouseY = y;

    clearOverlay(); // Hide cursor preview while drawing
    setCursorStyle(); // Ensure cursor remains 'none'

    // --- Tool-Specific Actions on Mouse Down ---
    if (currentTool === 'pencil' || currentTool === 'eraser') {
        currentStrokeId = generateStrokeId(); // Start a new stroke sequence
        // Set context properties for drawing
        context.lineWidth = currentLineWidth;
        context.strokeStyle = (currentTool === 'eraser') ? CANVAS_BACKGROUND_COLOR : currentStrokeStyle; // Eraser uses background color with source-over
        context.fillStyle = currentStrokeStyle; // For potential future use (e.g., filled shapes)
        context.globalCompositeOperation = 'source-over'; // Use source-over for eraser with background color
        // Start the path
        context.beginPath();
        context.moveTo(x, y);
        // Draw a tiny dot immediately for single clicks
        context.lineTo(x + 0.01, y + 0.01); // Tiny line to ensure dot appears
        context.stroke();
        emitDrawSegment(x, y, x + 0.01, y + 0.01); // Emit the dot

    } else if (currentTool === 'text') {
        // Text is placed on mouse down, not dragged
        isDrawing = false; // Text placement is instantaneous
        const userText = prompt("Enter text:");
        if (userText && userText.trim()) {
            const strokeId = generateStrokeId(); // Text is a single "stroke"
            const cmdId = generateCommandId();
            const command = {
                cmdId, strokeId, playerId: myPlayerId,
                type: 'text', x, y,
                text: userText.trim(),
                color: currentStrokeStyle,
                size: currentLineWidth,
                tool: 'text' // Specify tool used
            };
            executeCommand(command, context); // Draw locally
            addCommandToLocalHistory(command); // Add to history
            if (emitDrawCallback) emitDrawCallback(command); // Emit to server
        }
        updateCursorPreview(x, y); // Show preview again after text placement

    } else if (currentTool === 'fill') {
        // Fill happens on mouse down (like paint bucket tool)
        isDrawing = false; // Fill is instantaneous
        const strokeId = generateStrokeId(); // Fill is a single "stroke"
        const cmdId = generateCommandId();
        const command = {
            cmdId, strokeId, playerId: myPlayerId,
            type: 'fill', x, y,
            color: currentStrokeStyle,
            tool: 'fill' // Specify tool used
        };
        executeCommand(command, context); // Execute fill locally
        addCommandToLocalHistory(command); // Add to history
        if (emitDrawCallback) emitDrawCallback(command); // Emit to server
        updateCursorPreview(x, y); // Show preview again after fill

    } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        // Start drawing a shape, record start coordinates
        currentStrokeId = generateStrokeId(); // Shapes are a single "stroke"
        shapeStartX = x;
        shapeStartY = y;
        // Preview will be drawn on the overlay during mouse move
    }
}

function handleMouseMove(e) {
    // Sync overlay position *first* in case layout changed since last move
    resyncOverlayPosition();

    if (!drawingEnabled || !myPlayerId) return;

    // Get current coordinates *after* potential resync
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;

    // If not actively drawing, just update the cursor preview
    if (!isDrawing) {
        updateCursorPreview(x, y);
        return;
    }

    // --- Tool-Specific Actions on Mouse Move ---
    if (currentTool === 'pencil' || currentTool === 'eraser') {
        // Draw line segment on main canvas
        context.lineTo(x, y);
        context.stroke();
        // Emit the segment to the server
        emitDrawSegment(lastX, lastY, x, y);
        // Update last coordinates
        lastX = x;
        lastY = y;

    } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        // Draw shape preview on the overlay canvas
        clearOverlay(); // Clear previous shape preview
        overlayCtx.save(); // Save overlay context state
        overlayCtx.globalCompositeOperation = 'source-over';
        overlayCtx.strokeStyle = currentStrokeStyle;
        overlayCtx.lineWidth = currentLineWidth;

        const x0 = shapeStartX;
        const y0 = shapeStartY;
        overlayCtx.beginPath();
        if (currentTool === 'rectangle') {
            const rectX = Math.min(x0, x);
            const rectY = Math.min(y0, y);
            const rectW = Math.abs(x - x0);
            const rectH = Math.abs(y - y0);
            overlayCtx.rect(rectX, rectY, rectW, rectH);
        } else { // Ellipse
            const cx = (x0 + x) / 2;
            const cy = (y0 + y) / 2;
            const rx = Math.abs(x - x0) / 2;
            const ry = Math.abs(y - y0) / 2;
            overlayCtx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        }
        overlayCtx.stroke();
        // overlayCtx.closePath(); // Not needed for stroke()
        overlayCtx.restore(); // Restore overlay context state
    }
}

function handleMouseUp(e) {
    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false; // Ensure drawing stops if disabled during drag
        return;
    }
    if (!isDrawing) return; // Only process if drawing was active

    // Sync overlay position before getting final coordinates
    resyncOverlayPosition();
    const { x, y } = getEventCoords(e);
    currentMouseX = x; // Update final position
    currentMouseY = y;

    // Finish the current drawing operation
    finishStroke(x, y);
}

/**
 * Finalizes the current drawing operation (stroke, shape) based on the tool.
 * Draws the final shape, emits the command, and resets drawing state.
 * @param {number} finalX - The final X coordinate.
 * @param {number} finalY - The final Y coordinate.
 */
function finishStroke(finalX, finalY) {
    if (!isDrawing) return; // Should only be called if drawing was active

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        // If the mouse didn't move (it was a click/dot), ensure the segment was emitted
        if (finalX === startX && finalY === startY) {
            // The dot was already drawn and emitted on mousedown
        }
        // Close the path for the stroke (though visually may not change much for lines)
        // context.closePath(); // Not strictly necessary for line strokes
    }
    // Fill and Text tools complete on mouse down, no action needed on mouse up.

    else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
        clearOverlay(); // Clear the shape preview from the overlay
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId: currentStrokeId, // Use the stroke ID generated on mousedown
            playerId: myPlayerId,
            type: (currentTool === 'rectangle') ? 'rect' : 'ellipse',
            x0: shapeStartX, // Use start coordinates recorded on mousedown
            y0: shapeStartY,
            x1: finalX, // Use final coordinates from mouseup
            y1: finalY,
            color: currentStrokeStyle,
            size: currentLineWidth,
            tool: currentTool // Specify tool used
        };
        // Draw the final shape onto the main canvas
        executeCommand(command, context);
        // Add the command to local history
        addCommandToLocalHistory(command);
        // Emit the command to the server
        if (emitDrawCallback) {
            emitDrawCallback(command);
        }
    }

    // Reset drawing state variables
    isDrawing = false;
    currentStrokeId = null;
    shapeStartX = null;
    shapeStartY = null;
    startX = 0; // Reset start coords
    startY = 0;

    // Update cursor preview for the current position
    updateCursorPreview(finalX, finalY);
}

// -------------------------------------------------------------------
// Local Command Recording
// -------------------------------------------------------------------
/**
 * Adds a completed drawing command to the local history arrays.
 * @param {Object} command - The command object to add.
 */
function addCommandToLocalHistory(command) {
    // Add to the full history (used for redraws)
    fullDrawHistory.push(command);
    if (fullDrawHistory.length > MAX_HISTORY) {
        fullDrawHistory.shift(); // Prune oldest if history exceeds max size
    }

    // If it's a command initiated by the local player and not 'clear',
    // add it to the separate history used for the undo function.
    if (command.playerId === myPlayerId && command.type !== 'clear') {
        myDrawHistory.push(command);
        if (myDrawHistory.length > MAX_HISTORY) {
            myDrawHistory.shift(); // Prune oldest undoable command
        }
    }
}

// -------------------------------------------------------------------
// Touch Event Handlers (Map to Mouse Handlers)
// -------------------------------------------------------------------
function handleTouchStart(e) {
    // Only handle touch events directly on the canvas
    if (e.target !== canvas) return;
    if (!drawingEnabled) return;
    // If at least one touch point exists, treat it like a mouse down
    if (e.touches.length > 0) {
        // Need to pass the event object itself for getEventCoords
        handleMouseDown(e);
    }
}

function handleTouchMove(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled) return;
    // If at least one touch point is moving, treat it like mouse move
    if (e.touches.length > 0) {
        // handleMouseMove calls resyncOverlayPosition internally
        handleMouseMove(e);
    }
}

function handleTouchEnd(e) {
    if (e.target !== canvas) return;
    if (!drawingEnabled || !myPlayerId) {
        isDrawing = false;
        return;
    }
    // Use the coordinates from changedTouches for the final position
    if (e.changedTouches.length > 0) {
         // Sync overlay position before getting final coordinates
        resyncOverlayPosition();
        const { x, y } = getEventCoords(e); // Get coords from the ended touch
        currentMouseX = x;
        currentMouseY = y;
        // Finish stroke only if drawing was active
        if (isDrawing) {
            finishStroke(x, y);
        }
    } else {
        // If no changedTouches, might be a cancel event, just stop drawing
        if (isDrawing) {
             finishStroke(currentMouseX, currentMouseY); // Finish with last known coords
        }
    }

    // Reset flags after touch ends
    isDrawing = false; // Ensure drawing stops
    isMouseOverCanvas = false; // Treat touch end like mouse leave for cursor state
    setCursorStyle(); // Update cursor style
}


// -------------------------------------------------------------------
// Emit Drawing Data (for Pencil/Eraser)
// -------------------------------------------------------------------
/**
 * Creates and emits a 'line' command object for a segment of a pencil/eraser stroke.
 * Also adds the command to local history immediately.
 * @param {number} x0 - Start X coordinate of the segment.
 * @param {number} y0 - Start Y coordinate of the segment.
 * @param {number} x1 - End X coordinate of the segment.
 * @param {number} y1 - End Y coordinate of the segment.
 */
function emitDrawSegment(x0, y0, x1, y1) {
    // Ensure drawing is active and necessary IDs are set
    if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;

    const cmdId = generateCommandId(); // Unique ID for this specific segment command
    const command = {
        cmdId,
        strokeId: currentStrokeId, // Link segments of the same stroke
        playerId: myPlayerId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool, // 'pencil' or 'eraser'
        // Color is null for eraser (handled by composite op), otherwise use current color
        color: (currentTool === 'eraser') ? null : currentStrokeStyle,
        size: currentLineWidth
    };

    // Add this command segment to local history immediately for undo purposes
    // Note: We don't need to add to fullDrawHistory here because the actual drawing
    // happens directly on the context during mousemove. Redraws will use the
    // history which *will* include these segments if an undo happens.
    // However, for consistency and simpler undo logic, let's add it to both.
    addCommandToLocalHistory(command);

    // Emit the command to the server
    emitDrawCallback(command);
}