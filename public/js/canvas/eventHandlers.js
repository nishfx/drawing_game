/* public/js/canvas/eventHandlers.js */
// Manages all canvas event listeners (mouse, touch, window).

import {
    getCanvas, getContext, getPlayerId, isDrawingEnabled, getIsDrawing,
    setIsDrawing, getIsMouseOverCanvas, setIsMouseOverCanvas, CANVAS_BACKGROUND_COLOR,
    getEmitCallback, clearOverlay, setCursorStyle, getOverlayCtx
} from './canvasCore.js';
import { resyncOverlayPosition, updateCursorPreview } from './overlayManager.js';
import { getCurrentTool, getCurrentColor, getCurrentLineWidth } from './toolManager.js';
import { getEventCoords, generateStrokeId, generateCommandId } from './canvasUtils.js';
import { executeCommand } from './drawingExecutor.js';
import { addCommandToHistory } from './historyManager.js';

// --- State ---
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0;
let currentMouseY = 0;
let currentStrokeId = null; // One strokeId for the entire pencil/eraser drag or shape
let shapeStartX = null;
let shapeStartY = null;

export function initEventHandlers() {
    const canvas = getCanvas();
    if (!canvas) {
        console.error("Event Handlers: Canvas not found during init.");
        return;
    }

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

    // Listen for window resizes
    window.addEventListener('resize', () => requestAnimationFrame(resyncOverlayPosition));

    // Global mouseup if released outside the canvas
    window.addEventListener('mouseup', handleGlobalMouseUp, { capture: true });

    console.log("Event Handlers Initialized.");
}

function handleMouseEnter(e) {
    setIsMouseOverCanvas(true);
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;
    // console.log(`[MOUSEENTER] isDrawing=${getIsDrawing()}, x=${x}, y=${y}`); // Reduce noise

    if (e.buttons === 1 && getIsDrawing()) {
        // console.log("[MOUSEENTER] Re-entered with mouse down, continuing stroke"); // Reduce noise
        lastX = x;
        lastY = y;
        const ctx = getContext();
        if (ctx) {
            // Ensure correct state is reapplied on re-entry
            const tool = getCurrentTool();
            ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
            ctx.lineWidth = getCurrentLineWidth();
            ctx.strokeStyle = (tool === 'eraser') ? '#000000' : getCurrentColor();
            ctx.beginPath(); // Start a new path segment on re-entry
            ctx.moveTo(x, y);
        }
        clearOverlay();
        setCursorStyle();
    } else {
        updateCursorPreview(x, y);
    }
}

function handleMouseLeave(e) {
    setIsMouseOverCanvas(false);
    clearOverlay();
    setCursorStyle();
    // console.log(`[MOUSELEAVE] isDrawing=${getIsDrawing()}`); // Reduce noise
}

function handleMouseDown(e) {
    const myPlayerId = getPlayerId();
    if (!isDrawingEnabled() || !myPlayerId) return;
    if (e.button !== 0 && e.type !== 'touchstart') return;

    resyncOverlayPosition();
    const { x, y } = getEventCoords(e);
    const ctx = getContext();
    const tool = getCurrentTool();
    const lw = getCurrentLineWidth();
    const col = getCurrentColor();

    if (!ctx) return;

    setIsMouseOverCanvas(true);
    setIsDrawing(true);
    startX = x;
    startY = y;
    lastX = x;
    lastY = y;
    currentMouseX = x;
    currentMouseY = y;

    clearOverlay();
    setCursorStyle();
    console.log(`[MOUSEDOWN] tool=${tool}, x=${x}, y=${y}, isDrawing=${getIsDrawing()}`);

    switch (tool) {
        case 'pencil':
        case 'eraser':
            currentStrokeId = generateStrokeId();
            console.log(`[MOUSEDOWN] Created strokeId=${currentStrokeId} for pencil/eraser`);

            // Set the correct operation for the *entire* stroke from the start
            ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
            ctx.lineWidth = lw;
            ctx.strokeStyle = (tool === 'eraser') ? '#000000' : col; // Use black for eraser shape

            // Draw initial dot
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.01, y + 0.01); // Tiny segment
            ctx.stroke();
            emitDrawSegment(x, y, x + 0.01, y + 0.01); // Emit the dot
            // Keep the path open for mousemove
            ctx.beginPath(); // Start the *actual* path for mousemove
            ctx.moveTo(x, y);
            break;

        case 'text': {
            setIsDrawing(false); // Text is instant
            const userText = prompt("Enter text:");
            if (userText && userText.trim()) {
                const strokeId = generateStrokeId();
                const cmdId = generateCommandId();
                console.log(`[TEXT] strokeId=${strokeId}, cmdId=${cmdId}, x=${x}, y=${y}, text="${userText}"`);
                const command = {
                    cmdId, strokeId, playerId: myPlayerId, type: 'text',
                    x, y, text: userText.trim(), color: col, size: lw, tool: 'text'
                };
                executeCommand(command, ctx); // Draw locally
                addCommandToHistory(command);
                emitCommand(command);
            }
            updateCursorPreview(x, y); // Show preview again
            break;
        }

        case 'fill': {
            setIsDrawing(false); // Fill is instant
            const strokeId = generateStrokeId();
            const cmdId = generateCommandId();
            console.log(`[FILL] strokeId=${strokeId}, cmdId=${cmdId}, x=${x}, y=${y}, color=${col}`);
            const command = {
                cmdId, strokeId, playerId: myPlayerId, type: 'fill',
                x, y, color: col, tool: 'fill'
            };
            executeCommand(command, ctx); // Draw locally
            addCommandToHistory(command);
            emitCommand(command);
            updateCursorPreview(x, y); // Show preview again
            break;
        }

        case 'rectangle':
        case 'ellipse':
            currentStrokeId = generateStrokeId();
            shapeStartX = x;
            shapeStartY = y;
            console.log(`[SHAPE START] tool=${tool}, strokeId=${currentStrokeId}, start=(${x},${y})`);
            break;

        default:
            console.warn(`[MOUSEDOWN] Unrecognized tool=${tool}`);
            break;
    }
}

function handleMouseMove(e) {
    resyncOverlayPosition();
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;

    if (!isDrawingEnabled() || !getPlayerId()) return;
    if (!getIsDrawing()) {
        updateCursorPreview(x, y);
        return;
    }

    const ctx = getContext();
    const overlayCtx = getOverlayCtx();
    const tool = getCurrentTool();
    if (!ctx || !overlayCtx) return;

    switch (tool) {
        case 'pencil':
        case 'eraser':
            // console.log(`[MOUSEMOVE] pencil/eraser from (${lastX},${lastY}) to (${x},${y}), strokeId=${currentStrokeId}`); // Reduce noise
            // State (compositeOp, lineWidth, strokeStyle) should already be set from mousedown
            ctx.lineTo(x, y);
            ctx.stroke();
            // Emit segment using the strokeId created on mousedown
            emitDrawSegment(lastX, lastY, x, y, currentStrokeId);
            // Update last position *after* emitting segment using previous last position
            lastX = x;
            lastY = y;
            // Keep the path going for the next segment
            ctx.beginPath(); // Start new segment path
            ctx.moveTo(x, y); // Move to current point
            break;

        case 'rectangle':
        case 'ellipse':
            clearOverlay();
            overlayCtx.save();
            overlayCtx.globalCompositeOperation = 'source-over';
            overlayCtx.strokeStyle = getCurrentColor();
            overlayCtx.lineWidth = getCurrentLineWidth();
            overlayCtx.beginPath();
            if (tool === 'rectangle') {
                const rx = Math.min(shapeStartX, x);
                const ry = Math.min(shapeStartY, y);
                const rw = Math.abs(x - shapeStartX);
                const rh = Math.abs(y - shapeStartY);
                overlayCtx.rect(rx, ry, rw, rh);
            } else { // ellipse
                const cx = (shapeStartX + x) / 2;
                const cy = (shapeStartY + y) / 2;
                const rx = Math.abs(x - shapeStartX) / 2;
                const ry = Math.abs(y - shapeStartY) / 2;
                overlayCtx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
            }
            overlayCtx.stroke();
            overlayCtx.restore();
            break;

        default:
            break;
    }
}

function handleGlobalMouseUp(e) {
    if (getIsDrawing()) {
        // console.log("[GLOBAL MOUSEUP] finishing stroke"); // Reduce noise
        const finalX = currentMouseX;
        const finalY = currentMouseY;
        setIsDrawing(false); // Set state BEFORE finishing stroke logic
        finishStroke(finalX, finalY);
        clearOverlay();
        setCursorStyle(); // Reset cursor style (e.g., remove 'none')
    }
}

function handleMouseUp(e) {
    // Let handleGlobalMouseUp handle the logic to ensure it fires even if mouse leaves canvas
}

function finishStroke(finalX, finalY) {
    const tool = getCurrentTool();
    const ctx = getContext();
    const myPlayerId = getPlayerId();
    console.log(`[FINISH STROKE] tool=${tool}, final=(${finalX},${finalY}), strokeId=${currentStrokeId}`);

    if (!ctx || !myPlayerId) return;

    if (tool === 'pencil' || tool === 'eraser') {
        // Stroke segments already drawn and emitted.
        ctx.beginPath(); // End the current path explicitly.
        // Reset composite operation to default after finishing the stroke.
        ctx.globalCompositeOperation = 'source-over';
    }
    else if (tool === 'rectangle' || tool === 'ellipse') {
        clearOverlay(); // Clear the temporary shape preview
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId: currentStrokeId, // Use the strokeId generated on mousedown
            playerId: myPlayerId,
            type: (tool === 'rectangle') ? 'rect' : 'ellipse',
            x0: shapeStartX,
            y0: shapeStartY,
            x1: finalX,
            y1: finalY,
            color: getCurrentColor(),
            size: getCurrentLineWidth(),
            tool // Include the specific tool used
        };
        executeCommand(command, ctx); // Draw the final shape on the main canvas
        addCommandToHistory(command);
        emitCommand(command);
    }

    // Reset stroke-specific state
    currentStrokeId = null;
    shapeStartX = null;
    shapeStartY = null;
    startX = 0;
    startY = 0;
}

// --- Touch equivalents ---
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
        setIsDrawing(false); // Ensure drawing state is reset if touch ends unexpectedly
        return;
    }
    // Use changedTouches for touchend/touchcancel
    if (e.changedTouches.length > 0) {
        resyncOverlayPosition(); // Ensure overlay is correct before getting final coords
        const { x, y } = getEventCoords(e); // Get coords from the ended touch
        currentMouseX = x; // Update final position
        currentMouseY = y;
        if (getIsDrawing()) { // Check if we were actually drawing
            handleGlobalMouseUp(e); // Trigger the same cleanup/finish logic
        }
    } else {
        // Fallback if changedTouches isn't available, though it should be
        if (getIsDrawing()) {
            handleGlobalMouseUp(e);
        }
    }
}

// -------------------------------------------------------------------
// Emit Drawing Data
// -------------------------------------------------------------------
function emitDrawSegment(x0, y0, x1, y1, forcedStrokeId = null) {
    const myPlayerId = getPlayerId();
    const emitCallback = getEmitCallback();
    if (!emitCallback || !myPlayerId) return;

    const cmdId = generateCommandId();
    const currentTool = getCurrentTool();

    // Use existing strokeId from handleMouseDown or fallback (shouldn't happen often)
    const segStrokeId = forcedStrokeId || currentStrokeId;
    if (!segStrokeId) {
        console.warn("[EMIT SEGMENT] Missing strokeId!");
        return; // Don't emit if strokeId is missing
    }

    // console.log(`[EMIT SEGMENT] tool=${currentTool}, strokeId=${segStrokeId}, cmdId=${cmdId}, from=(${x0},${y0}) to=(${x1},${y1})`); // Reduce noise

    const command = {
        cmdId,
        strokeId: segStrokeId,
        playerId: myPlayerId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool, // Ensure the correct tool is sent
        // Color is only relevant for non-eraser tools, but send consistently
        color: (currentTool === 'eraser') ? '#000000' : getCurrentColor(),
        size: getCurrentLineWidth()
    };

    addCommandToHistory(command);
    emitCallback(command);
}

function emitCommand(command) {
    const emitCallback = getEmitCallback();
    if (emitCallback && command) {
        // console.log("[EMIT COMMAND] =>", command); // Reduce noise
        emitCallback(command);
    }
}