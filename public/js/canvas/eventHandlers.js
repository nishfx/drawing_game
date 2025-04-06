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
    console.log(`[MOUSEENTER] isDrawing=${getIsDrawing()}, x=${x}, y=${y}`);

    if (e.buttons === 1 && getIsDrawing()) {
        console.log("[MOUSEENTER] Re-entered with mouse down, continuing stroke");
        lastX = x;
        lastY = y;
        const ctx = getContext();
        if (ctx) {
            ctx.beginPath();
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
    console.log(`[MOUSELEAVE] isDrawing=${getIsDrawing()}`);
}

function handleMouseDown(e) {
    const myPlayerId = getPlayerId();
    if (!isDrawingEnabled() || !myPlayerId) return;
    if (e.button !== 0 && e.type !== 'touchstart') return;

    // Sync overlay before coords
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
            // Create a single strokeId for the entire mouse-drag
            currentStrokeId = generateStrokeId();
            console.log(`[MOUSEDOWN] Created strokeId=${currentStrokeId} for pencil/eraser`);

            // Draw a tiny dot immediately
            ctx.lineWidth = lw;
            ctx.strokeStyle = (tool === 'eraser') ? CANVAS_BACKGROUND_COLOR : col;
            ctx.globalCompositeOperation = 'source-over';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.01, y + 0.01);
            ctx.stroke();
            // Emit that single dot
            emitDrawSegment(x, y, x + 0.01, y + 0.01);
            break;

        case 'text': {
            // Single instant action with a new strokeId
            setIsDrawing(false);
            const userText = prompt("Enter text:");
            if (userText && userText.trim()) {
                const strokeId = generateStrokeId();
                const cmdId = generateCommandId();
                console.log(`[TEXT] strokeId=${strokeId}, cmdId=${cmdId}, x=${x}, y=${y}, text="${userText}"`);
                const command = {
                    cmdId,
                    strokeId,
                    playerId: myPlayerId,
                    type: 'text',
                    x, y,
                    text: userText.trim(),
                    color: col,
                    size: lw,
                    tool: 'text'
                };
                executeCommand(command, ctx);
                addCommandToHistory(command);
                emitCommand(command);
            }
            updateCursorPreview(x, y);
            break;
        }

        case 'fill': {
            // Single instant action with a new strokeId
            setIsDrawing(false);
            const strokeId = generateStrokeId();
            const cmdId = generateCommandId();
            console.log(`[FILL] strokeId=${strokeId}, cmdId=${cmdId}, x=${x}, y=${y}, color=${col}`);
            const command = {
                cmdId,
                strokeId,
                playerId: myPlayerId,
                type: 'fill',
                x, y,
                color: col,
                tool: 'fill'
            };
            executeCommand(command, ctx);
            addCommandToHistory(command);
            emitCommand(command);
            updateCursorPreview(x, y);
            break;
        }

        case 'rectangle':
        case 'ellipse':
            // Create strokeId for the entire shape
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
            console.log(`[MOUSEMOVE] pencil/eraser from (${lastX},${lastY}) to (${x},${y}), strokeId=${currentStrokeId}`);
            ctx.lineTo(x, y);
            ctx.stroke();
            // All segments in this drag share currentStrokeId
            emitDrawSegment(lastX, lastY, x, y, currentStrokeId);
            lastX = x;
            lastY = y;
            break;

        case 'rectangle':
        case 'ellipse':
            clearOverlay();
            overlayCtx.save();
            overlayCtx.globalCompositeOperation = 'source-over';
            overlayCtx.strokeStyle = getCurrentColor();
            overlayCtx.lineWidth = getCurrentLineWidth();

            const x0 = shapeStartX;
            const y0 = shapeStartY;
            overlayCtx.beginPath();
            if (tool === 'rectangle') {
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
            overlayCtx.restore();
            break;

        // text/fill do nothing on mousemove
        default:
            break;
    }
}

function handleGlobalMouseUp(e) {
    if (getIsDrawing()) {
        console.log("[GLOBAL MOUSEUP] finishing stroke");
        const finalX = currentMouseX;
        const finalY = currentMouseY;
        setIsDrawing(false);
        finishStroke(finalX, finalY);
        clearOverlay();
        setCursorStyle();
    }
}

function handleMouseUp(e) {
    // Just let handleGlobalMouseUp do the actual finishing
}

function finishStroke(finalX, finalY) {
    const tool = getCurrentTool();
    const ctx = getContext();
    const myPlayerId = getPlayerId();
    console.log(`[FINISH STROKE] tool=${tool}, final=(${finalX},${finalY}), strokeId=${currentStrokeId}`);

    if (!ctx || !myPlayerId) return;

    if (tool === 'pencil' || tool === 'eraser') {
        // The entire drag's lines are already emitted with currentStrokeId
        ctx.beginPath(); // break the path
    }
    else if (tool === 'rectangle' || tool === 'ellipse') {
        // Save a single shape command
        clearOverlay();
        const cmdId = generateCommandId();
        const command = {
            cmdId,
            strokeId: currentStrokeId,
            playerId: myPlayerId,
            type: (tool === 'rectangle') ? 'rect' : 'ellipse',
            x0: shapeStartX,
            y0: shapeStartY,
            x1: finalX,
            y1: finalY,
            color: getCurrentColor(),
            size: getCurrentLineWidth(),
            tool
        };
        executeCommand(command, ctx);
        addCommandToHistory(command);
        emitCommand(command);
    }

    // Reset stroke data
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
        setIsDrawing(false);
        return;
    }
    if (e.changedTouches.length > 0) {
        resyncOverlayPosition();
        const { x, y } = getEventCoords(e);
        currentMouseX = x;
        currentMouseY = y;
        if (getIsDrawing()) {
            handleGlobalMouseUp(e);
        }
    } else {
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

    // Use existing strokeId from handleMouseDown or fallback (edge cases)
    const segStrokeId = forcedStrokeId || currentStrokeId || generateStrokeId();

    console.log(`[EMIT SEGMENT] tool=${currentTool}, strokeId=${segStrokeId}, cmdId=${cmdId}, from=(${x0},${y0}) to=(${x1},${y1})`);

    const command = {
        cmdId,
        strokeId: segStrokeId,
        playerId: myPlayerId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool,
        color: (currentTool === 'eraser') ? CANVAS_BACKGROUND_COLOR : getCurrentColor(),
        size: getCurrentLineWidth()
    };

    addCommandToHistory(command);
    emitCallback(command);
}

function emitCommand(command) {
    const emitCallback = getEmitCallback();
    if (emitCallback && command) {
        console.log("[EMIT COMMAND] =>", command);
        emitCallback(command);
    }
}
