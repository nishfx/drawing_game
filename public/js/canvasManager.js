// public/js/canvasManager.js

let canvas = null;
let context = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let drawingEnabled = false; // Control whether drawing is allowed

// --- Tool State ---
let currentTool = 'pencil'; // 'pencil', 'eraser'
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;
const CANVAS_BACKGROUND_COLOR = "#FFFFFF"; // Define background color constant

// --- Exported Functions ---

export function initCanvas(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) { console.error("Canvas element not found:", canvasId); return false; }
    context = canvas.getContext('2d');
    if (!context) { console.error("Failed to get 2D context"); return false; }

    // Set initial defaults
    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';

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
    clearCanvas(false); // Clear on init, don't emit event initially
    disableDrawing(); // Start disabled by default
    return true; // Indicate success
}

export function enableDrawing() {
    if (!canvas) return;
    drawingEnabled = true;
    canvas.style.cursor = 'crosshair'; // Default cursor
    // Set cursor based on current tool if needed (e.g., specific eraser cursor)
    setCursorForTool(currentTool);
    console.log("Drawing enabled");
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false; // Ensure drawing stops if disabled mid-stroke
    canvas.style.cursor = 'not-allowed';
    console.log("Drawing disabled");
}

export function clearCanvas(emitEvent = true) {
    if (!context || !canvas) return;
    context.fillStyle = CANVAS_BACKGROUND_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    console.log("Canvas cleared");
    if (emitEvent) {
        const clearEvent = new CustomEvent('lobbyDraw', { detail: { type: 'clear' } });
        canvas.dispatchEvent(clearEvent);
        console.log("Dispatched clear event");
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
    // Reset composite operation when switching away from eraser
    if (context && currentTool !== 'eraser') {
        context.globalCompositeOperation = 'source-over';
    }
}

export function setColor(color) {
    currentStrokeStyle = color;
    console.log("Color set to:", currentStrokeStyle);
}

export function setLineWidth(width) {
    currentLineWidth = parseInt(width, 10) || 5; // Ensure it's a number, default 5
    console.log("Line width set to:", currentLineWidth);
}

// --- Function to draw commands received from others ---
export function drawExternalCommand(data) {
    if (!context || !data) return;

    // Save current local context settings
    const originalStrokeStyle = context.strokeStyle;
    const originalLineWidth = context.lineWidth;
    const originalCompositeOp = context.globalCompositeOperation;

    try {
        if (data.type === 'line' && data.x0 !== undefined) {
            // Use data from the event
            const drawColor = data.color || originalStrokeStyle; // Fallback to current if missing
            const drawWidth = data.size || originalLineWidth;
            const toolUsed = data.tool || 'pencil'; // Assume pencil if missing

            context.strokeStyle = drawColor;
            context.lineWidth = drawWidth;

            // Handle eraser for external commands
            if (toolUsed === 'eraser') {
                context.globalCompositeOperation = 'destination-out';
                // Optional: Use background color if destination-out isn't desired/supported everywhere
                // context.strokeStyle = CANVAS_BACKGROUND_COLOR;
            } else {
                context.globalCompositeOperation = 'source-over';
            }

            drawLocalLine(data.x0, data.y0, data.x1, data.y1);

        } else if (data.type === 'clear') {
            console.log("Received external clear command");
            clearCanvas(false); // Clear locally, don't re-emit
        }
    } catch (error) {
        console.error("Error drawing external command:", error, data);
    } finally {
        // Restore local context settings
        context.strokeStyle = originalStrokeStyle;
        context.lineWidth = originalLineWidth;
        context.globalCompositeOperation = originalCompositeOp;
    }
}


// --- Internal Drawing Logic ---

function getEventCoords(e) {
    // (Function remains the same as previous step)
    if (!canvas) return [0, 0];
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
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return [x, y];
}

function setCursorForTool(tool) {
    if (!canvas) return;
    switch (tool) {
        case 'eraser':
            // Consider a custom eraser cursor if desired
            canvas.style.cursor = 'cell'; // Example: cell cursor for eraser
            break;
        case 'fill':
            canvas.style.cursor = 'copy'; // Example: copy cursor for fill
            break;
        case 'pencil':
        default:
            canvas.style.cursor = 'crosshair';
            break;
    }
}


function handleMouseDown(e) {
    if (!drawingEnabled) return;
    isDrawing = true;
    [lastX, lastY] = getEventCoords(e);

    // Apply tool-specific settings *before* starting to draw
    if (currentTool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
        // If not using destination-out, set strokeStyle to background here
        // context.strokeStyle = CANVAS_BACKGROUND_COLOR;
    } else {
        context.globalCompositeOperation = 'source-over';
        context.strokeStyle = currentStrokeStyle; // Ensure pencil uses selected color
    }
    context.lineWidth = currentLineWidth; // Always use selected width

    // Optional: Draw a single point on mousedown for better feedback
    // drawLocalLine(lastX, lastY, lastX, lastY);
    // emitDrawData(lastX, lastY, lastX, lastY); // Emit the single point too
}

function handleMouseMove(e) {
    if (!isDrawing || !drawingEnabled) return;
    const [currentX, currentY] = getEventCoords(e);

    // Settings (color, width, compositeOp) should already be set from mousedown/tool change
    drawLocalLine(lastX, lastY, currentX, currentY);
    emitDrawData(lastX, lastY, currentX, currentY); // Emit data with current tool settings

    [lastX, lastY] = [currentX, currentY];
}

function handleMouseUp() {
    if (!drawingEnabled) return;
    isDrawing = false;
    // Optional: Reset composite operation if needed, though setting it on mousedown is usually sufficient
    // if (currentTool === 'eraser') {
    //     context.globalCompositeOperation = 'source-over';
    // }
}

function handleMouseOut() {
    if (!drawingEnabled) return;
    isDrawing = false; // Stop drawing if mouse leaves canvas
}

// --- Touch Event Handlers ---
function handleTouchStart(e) {
    if (!drawingEnabled) return;
    isDrawing = true;
    [lastX, lastY] = getEventCoords(e);

    // Apply tool settings (same as mousedown)
    if (currentTool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
    } else {
        context.globalCompositeOperation = 'source-over';
        context.strokeStyle = currentStrokeStyle;
    }
    context.lineWidth = currentLineWidth;

    // Optional: Draw initial point
    // drawLocalLine(lastX, lastY, lastX, lastY);
    // emitDrawData(lastX, lastY, lastX, lastY);
}

function handleTouchMove(e) {
    if (!isDrawing || !drawingEnabled) return;
    const [currentX, currentY] = getEventCoords(e);

    drawLocalLine(lastX, lastY, currentX, currentY);
    emitDrawData(lastX, lastY, currentX, currentY);

    [lastX, lastY] = [currentX, currentY];
}

function handleTouchEnd() {
    if (!drawingEnabled) return;
    isDrawing = false;
}

// Emits drawing data with current tool settings
function emitDrawData(x0, y0, x1, y1) {
    const drawEvent = new CustomEvent('lobbyDraw', {
        detail: {
            type: 'line',
            x0: x0, y0: y0, x1: x1, y1: y1,
            tool: currentTool, // Include current tool
            color: currentTool === 'eraser' ? null : currentStrokeStyle, // Don't send color for eraser if using destination-out
            size: currentLineWidth
        }
    });
    canvas.dispatchEvent(drawEvent);
}

// Draws locally using current context settings
function drawLocalLine(x0, y0, x1, y1) {
    if (!context) return;
    // Settings (color, width, compositeOp) are assumed to be set correctly before calling this
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
    context.closePath();
}