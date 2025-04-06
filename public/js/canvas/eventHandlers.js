/* public/js/canvas/eventHandlers.js */
// Manages all canvas event listeners (mouse, touch, window).

// Import UI update functions from canvasCore now
import { getCanvas, getContext, getPlayerId, isDrawingEnabled, getIsDrawing, setIsDrawing, getIsMouseOverCanvas, setIsMouseOverCanvas, CANVAS_BACKGROUND_COLOR, getEmitCallback, clearOverlay, setCursorStyle } from './canvasCore.js';
// Import overlay functions needed for drawing previews
import { getOverlayCtx, resyncOverlayPosition, updateCursorPreview } from './overlayManager.js';
import { getCurrentTool, getCurrentColor, getCurrentLineWidth } from './toolManager.js';
import { getEventCoords, generateStrokeId, generateCommandId } from './canvasUtils.js';
import { executeCommand } from './drawingExecutor.js';
import { addCommandToLocalHistory, removeCommands, redrawCanvasFromHistory } from './historyManager.js';

// --- State specific to event handling ---
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0; // Tracks the latest *canvas* coordinates
let currentMouseY = 0;
let currentStrokeId = null; // ID for the current continuous stroke/shape
let shapeStartX = null;
let shapeStartY = null;

// --- Initialization ---
export function initEventHandlers() {
    const canvas = getCanvas();
    if (!canvas) {
        console.error("Event Handlers: Canvas not found during init.");
        return;
    }

    // --- Event Listeners ---
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp); // Listener on canvas itself
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mouseenter', handleMouseEnter);

    // Touch events
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd); // Treat cancel like end

    // Listen for window resizes, re-sync overlay using requestAnimationFrame
    window.addEventListener('resize', () => {
        requestAnimationFrame(resyncOverlayPosition);
    });

    // Global mouseup listener to catch mouse release outside canvas
    window.addEventListener('mouseup', handleGlobalMouseUp, { capture: true });

    // Optional: Listen for scroll events if the canvas position might change on scroll
    // window.addEventListener('scroll', () => {
    //    requestAnimationFrame(resyncOverlayPosition);
    // }, true); // Use capture phase if scrolling container is higher up

    console.log("Event Handlers Initialized.");

    // TODO: Add cleanup for the global mouseup listener if the canvas/component is ever destroyed.
    // e.g., in a cleanup function: window.removeEventListener('mouseup', handleGlobalMouseUp, { capture: true });
}

// -------------------------------------------------------------------
// Mouse Event Handlers
// -------------------------------------------------------------------
function handleMouseEnter(e) {
    setIsMouseOverCanvas(true);
    const { x, y } = getEventCoords(e);
    currentMouseX = x; // Update current position
    currentMouseY = y;

    // Check if button is still pressed and resume drawing path
    if (e.buttons === 1 && getIsDrawing()) {
        console.log("Mouse re-entered canvas while drawing.");
        // Resume the drawing path from the entry point
        lastX = x;
        lastY = y;
        const context = getContext();
        if (context) {
            context.beginPath(); // Start a new path segment visually connected
            context.moveTo(x, y);
        }
        clearOverlay(); // Ensure preview is hidden as drawing resumes
        setCursorStyle(); // Ensure cursor is 'none'
    } else {
        // If not drawing or button not pressed, just update the preview
        updateCursorPreview(x, y);
    }
}

function handleMouseLeave(e) {
    setIsMouseOverCanvas(false);
    clearOverlay(); // Hide preview when mouse leaves
    setCursorStyle(); // Set cursor to default (since it's outside)
    // Note: isDrawing remains true if the mouse button is still down
}

function handleMouseDown(e) {
    const myPlayerId = getPlayerId();
    if (!isDrawingEnabled() || !myPlayerId) return;
    // Only respond to main button (left-click or primary touch)
    if (e.button !== 0 && e.type !== 'touchstart') return;

    // Sync overlay position before getting coordinates
    resyncOverlayPosition();
    const { x, y } = getEventCoords(e);
    const context = getContext();
    const currentTool = getCurrentTool();
    const currentLineWidth = getCurrentLineWidth();
    const currentStrokeStyle = getCurrentColor();

    if (!context) return;

    setIsMouseOverCanvas(true); // Ensure flag is set
    setIsDrawing(true); // *** Set drawing flag ***
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
        context.strokeStyle = (currentTool === 'eraser') ? CANVAS_BACKGROUND_COLOR : currentStrokeStyle; // Eraser uses background color
        context.fillStyle = currentStrokeStyle;
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
        setIsDrawing(false); // Text placement is instantaneous, reset drawing flag
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
            emitCommand(command); // Emit to server
        }
        updateCursorPreview(x, y); // Show preview again after text placement

    } else if (currentTool === 'fill') {
        // Fill happens on mouse down (like paint bucket tool)
        setIsDrawing(false); // Fill is instantaneous, reset drawing flag
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
        emitCommand(command); // Emit to server
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

    // Get current coordinates *after* potential resync
    const { x, y } = getEventCoords(e);

    // Update current mouse position regardless of drawing state
    currentMouseX = x;
    currentMouseY = y;

    // Only process move if drawing is enabled and allowed
    if (!isDrawingEnabled() || !getPlayerId()) return;

    // If not actively drawing, just update the cursor preview
    if (!getIsDrawing()) {
        updateCursorPreview(x, y);
        return;
    }

    const context = getContext();
    const overlayCtx = getOverlayCtx();
    const currentTool = getCurrentTool();

    if (!context || !overlayCtx) return;

    // --- Tool-Specific Actions on Mouse Move (if isDrawing is true) ---
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
        overlayCtx.strokeStyle = getCurrentColor();
        overlayCtx.lineWidth = getCurrentLineWidth();

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
        overlayCtx.restore(); // Restore overlay context state
    }
}

// Global handler for mouseup anywhere on the page
function handleGlobalMouseUp(e) {
    if (getIsDrawing()) {
        console.log("Global mouse up detected, finishing stroke.");
        // isDrawing flag indicates that a drawing operation was in progress.

        // Use the last known coordinates *on the canvas* (currentMouseX/Y)
        const finalX = currentMouseX;
        const finalY = currentMouseY;

        setIsDrawing(false); // Set flag FIRST to prevent race conditions

        // Finish the stroke operation (draws final shape, emits command)
        finishStroke(finalX, finalY);

        // Reset overlay and cursor style AFTER finishing stroke
        clearOverlay();
        setCursorStyle(); // Update cursor based on current state (likely default now)
    }
}

// Mouse up *specifically over the canvas*
function handleMouseUp(e) {
    // We let the handleGlobalMouseUp function handle the core logic.
    // This canvas-specific listener might become redundant.
}

/**
 * Finalizes the current drawing operation (stroke, shape) based on the tool.
 * Draws the final shape, emits the command, and resets drawing state.
 * Called by the global mouseup handler.
 * @param {number} finalX - The final X coordinate (last known on canvas).
 * @param {number} finalY - The final Y coordinate (last known on canvas).
 */
function finishStroke(finalX, finalY) {
    // Assumes isDrawing has just been set to false externally
    const currentTool = getCurrentTool();
    const context = getContext();
    const myPlayerId = getPlayerId();

    if (!context || !myPlayerId) return;

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        // If the mouse didn't move (it was a click/dot), ensure the segment was emitted
        if (finalX === startX && finalY === startY) {
            // The dot was already drawn and emitted on mousedown
        }
        // Make sure the path is committed visually
        context.beginPath(); // Start new path to prevent connecting future strokes
    }
    // Fill and Text tools complete on mouse down, no action needed here.

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
            color: getCurrentColor(),
            size: getCurrentLineWidth(),
            tool: currentTool // Specify tool used
        };
        // Draw the final shape onto the main canvas
        executeCommand(command, context);
        // Add the command to local history
        addCommandToLocalHistory(command);
        // Emit the command to the server
        emitCommand(command);
    }

    // Reset drawing state variables *except* isDrawing (already false)
    currentStrokeId = null;
    shapeStartX = null;
    shapeStartY = null;
    startX = 0; // Reset start coords
    startY = 0;

    // Update cursor preview for the current position
    if (getIsMouseOverCanvas()) {
         updateCursorPreview(finalX, finalY);
    } else {
         clearOverlay(); // Ensure overlay is clear if mouse ended up outside
    }
}

// -------------------------------------------------------------------
// Touch Event Handlers (Map to Mouse Handlers)
// -------------------------------------------------------------------
function handleTouchStart(e) {
    const canvas = getCanvas();
    if (e.target !== canvas || !isDrawingEnabled()) return;
    if (e.touches.length > 0) {
        handleMouseDown(e);
    }
}

function handleTouchMove(e) {
    const canvas = getCanvas();
    if (e.target !== canvas || !isDrawingEnabled()) return;
    if (e.touches.length > 0) {
        handleMouseMove(e);
    }
}

function handleTouchEnd(e) {
    const canvas = getCanvas();
    if (e.target !== canvas || !isDrawingEnabled() || !getPlayerId()) {
        setIsDrawing(false);
        return;
    }
    if (e.changedTouches.length > 0) {
        resyncOverlayPosition();
        const { x, y } = getEventCoords(e);
        currentMouseX = x;
        currentMouseY = y;
        if (getIsDrawing()) {
             handleGlobalMouseUp(e); // Simulate global mouse up
        }
    } else {
        if (getIsDrawing()) {
             handleGlobalMouseUp(e); // Simulate global mouse up
        }
    }
    // Reset flags after touch ends - Global handler should do this
    // setIsDrawing(false); // Ensure drawing stops
    // setIsMouseOverCanvas(false); // Treat touch end like mouse leave for cursor state
    // setCursorStyle(); // Update cursor style
}


// -------------------------------------------------------------------
// Emit Drawing Data
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
    const myPlayerId = getPlayerId();
    const emitCallback = getEmitCallback();
    // Ensure drawing is active and necessary IDs are set
    if (!emitCallback || !myPlayerId || !currentStrokeId) return;

    const cmdId = generateCommandId(); // Unique ID for this specific segment command
    const currentTool = getCurrentTool();
    const command = {
        cmdId,
        strokeId: currentStrokeId, // Link segments of the same stroke
        playerId: myPlayerId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool, // 'pencil' or 'eraser'
        color: (currentTool === 'eraser') ? CANVAS_BACKGROUND_COLOR : getCurrentColor(),
        size: getCurrentLineWidth()
    };

    // Add this command segment to local history immediately
    addCommandToLocalHistory(command);

    // Emit the command to the server
    emitCallback(command);
}

/**
 * Emits a complete drawing command (e.g., shape, fill, text).
 * @param {Object} command - The command object to emit.
 */
function emitCommand(command) {
    const emitCallback = getEmitCallback();
    if (emitCallback && command) {
        emitCallback(command);
    }
}