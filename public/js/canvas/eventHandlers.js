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

let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0;
let currentMouseY = 0;
let currentStrokeId = null;
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

    // Window resize
    window.addEventListener('resize', () => requestAnimationFrame(resyncOverlayPosition));

    // If mouse released outside the window, finish stroke
    window.addEventListener('mouseup', handleGlobalMouseUp, { capture: true });

    console.log("Event Handlers Initialized.");
}

function handleMouseEnter(e) {
    setIsMouseOverCanvas(true);
    const { x, y } = getEventCoords(e);
    currentMouseX = x;
    currentMouseY = y;

    if (e.buttons === 1 && getIsDrawing()) {
        // If we left the canvas while drawing and came back
        lastX = x;
        lastY = y;
        const ctx = getContext();
        if (ctx) {
            const tool = getCurrentTool();
            ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
            ctx.lineWidth = getCurrentLineWidth();
            ctx.strokeStyle = (tool === 'eraser') ? '#000000' : getCurrentColor();
            // Start a new subpath so we don’t connect from weird coords
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

    // Always begin a fresh path for a brand-new stroke
    ctx.beginPath();

    clearOverlay();
    setCursorStyle();
    console.log(`[MOUSEDOWN] tool=${tool}, x=${x}, y=${y}, isDrawing=${getIsDrawing()}`);

    switch (tool) {
        case 'pencil':
        case 'eraser':
            currentStrokeId = generateStrokeId();
            console.log(`[MOUSEDOWN] Created strokeId=${currentStrokeId} for pencil/eraser`);

            ctx.globalCompositeOperation = (tool === 'eraser') ? 'destination-out' : 'source-over';
            ctx.lineWidth = lw;
            ctx.strokeStyle = (tool === 'eraser') ? '#000000' : col;

            // Draw a tiny line to produce the “dot”
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.01, y + 0.01);
            ctx.stroke();

            // End that mini stroke & start a fresh path for actual drawing:
            ctx.beginPath();
            ctx.moveTo(x, y);
            break;

        case 'text': {
            setIsDrawing(false);
            const userText = prompt("Enter text:");
            if (userText && userText.trim()) {
                const strokeId = generateStrokeId();
                const cmdId = generateCommandId();
                console.log(`[TEXT] strokeId=${strokeId}, cmdId=${cmdId}, x=${x}, y=${y}, text="${userText}"`);
                const command = {
                    cmdId, strokeId, playerId: myPlayerId, type: 'text',
                    x, y, text: userText.trim(), color: col, size: lw, tool: 'text'
                };
                executeCommand(command, ctx);
                addCommandToHistory(command);
                emitCommand(command);
            }
            updateCursorPreview(x, y);
            break;
        }

        case 'fill': {
            setIsDrawing(false);
            const strokeId = generateStrokeId();
            const cmdId = generateCommandId();
            console.log(`[FILL] strokeId=${strokeId}, cmdId=${cmdId}, x=${x}, y=${y}, color=${col}`);
            const command = {
                cmdId, strokeId, playerId: myPlayerId, type: 'fill',
                x, y, color: col, tool: 'fill'
            };
            executeCommand(command, ctx);
            addCommandToHistory(command);
            emitCommand(command);
            updateCursorPreview(x, y);
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
            ctx.lineTo(x, y);
            ctx.stroke();
            emitDrawSegment(lastX, lastY, x, y, currentStrokeId);
            lastX = x;
            lastY = y;
            ctx.beginPath();
            ctx.moveTo(x, y);
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
            } else {
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
        const finalX = currentMouseX;
        const finalY = currentMouseY;
        setIsDrawing(false);
        finishStroke(finalX, finalY);
        clearOverlay();
        setCursorStyle();
    }
}

function handleMouseUp(e) {
    // Let handleGlobalMouseUp do the real finishing logic
}

function finishStroke(finalX, finalY) {
    const tool = getCurrentTool();
    const ctx = getContext();
    const myPlayerId = getPlayerId();
    console.log(`[FINISH STROKE] tool=${tool}, final=(${finalX},${finalY}), strokeId=${currentStrokeId}`);

    if (!ctx || !myPlayerId) return;

    if (tool === 'pencil' || tool === 'eraser') {
        // We were doing freehand lines
        // Optionally ensure a fresh path so bridging can’t happen later
        ctx.beginPath();
        ctx.globalCompositeOperation = 'source-over';
    }
    else if (tool === 'rectangle' || tool === 'ellipse') {
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

    currentStrokeId = null;
    shapeStartX = null;
    shapeStartY = null;
    startX = 0;
    startY = 0;
}

// Touch equivalents
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

// Emitting
function emitDrawSegment(x0, y0, x1, y1, forcedStrokeId = null) {
    const myPlayerId = getPlayerId();
    const emitCallback = getEmitCallback();
    if (!emitCallback || !myPlayerId) return;

    const cmdId = generateCommandId();
    const currentTool = getCurrentTool();
    const segStrokeId = forcedStrokeId || currentStrokeId;
    if (!segStrokeId) {
        console.warn("[EMIT SEGMENT] Missing strokeId!");
        return;
    }

    const command = {
        cmdId,
        strokeId: segStrokeId,
        playerId: myPlayerId,
        type: 'line',
        x0, y0, x1, y1,
        tool: currentTool,
        color: (currentTool === 'eraser') ? '#000000' : getCurrentColor(),
        size: getCurrentLineWidth()
    };

    addCommandToHistory(command);
    emitCallback(command);
}

function emitCommand(command) {
    const emitCallback = getEmitCallback();
    if (emitCallback && command) {
        emitCallback(command);
    }
}
