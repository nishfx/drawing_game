// public/js/canvasManager.js

let canvas = null;
let context = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let drawingEnabled = false; // Control whether drawing is allowed
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;

// --- Exported Functions ---

export function initCanvas(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) { console.error("Canvas element not found:", canvasId); return false; }
    context = canvas.getContext('2d');
    if (!context) { console.error("Failed to get 2D context"); return false; }

    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    // Add event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseout', handleMouseOut);
    // Use passive: false for touch events to allow preventDefault if needed
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
    canvas.style.cursor = 'crosshair';
    console.log("Drawing enabled");
}

export function disableDrawing() {
    if (!canvas) return;
    drawingEnabled = false;
    isDrawing = false; // Ensure drawing stops if disabled mid-stroke
    canvas.style.cursor = 'not-allowed';
    console.log("Drawing disabled");
}

// Modified clearCanvas to optionally emit an event
export function clearCanvas(emitEvent = true) {
    if (!context || !canvas) return;
    context.fillStyle = "#FFFFFF"; // Set fill color to white
    context.fillRect(0, 0, canvas.width, canvas.height); // Fill the canvas
    console.log("Canvas cleared");
    // Emit clear event if needed for lobby canvas synchronization
    if (emitEvent) {
        const clearEvent = new CustomEvent('lobbyDraw', { detail: { type: 'clear' } });
        canvas.dispatchEvent(clearEvent);
        console.log("Dispatched clear event");
    }
}


export function getDrawingDataURL() {
    if (!canvas) return null;
    try {
        return canvas.toDataURL('image/png'); // Specify PNG format
    } catch (e) {
        console.error("Error getting canvas data URL:", e);
        return null; // Return null on error
    }
}

// --- Function to draw commands received from others ---
export function drawExternalCommand(data) {
    if (!context || !data) return;
    // console.log("Drawing external command:", data); // Uncomment for debugging
    if (data.type === 'line' && data.x0 !== undefined) {
         // Optional: Set color/size from data if included
         // const oldStyle = context.strokeStyle; const oldWidth = context.lineWidth;
         // context.strokeStyle = data.color || currentStrokeStyle;
         // context.lineWidth = data.size || currentLineWidth;
         drawLocalLine(data.x0, data.y0, data.x1, data.y1);
         // context.strokeStyle = oldStyle; context.lineWidth = oldWidth; // Restore if changed
    } else if (data.type === 'clear') {
         console.log("Received external clear command");
         clearCanvas(false); // Clear locally, don't re-emit
    }
    // Add more command types as needed
}


// --- Internal Drawing Logic ---

// *** UPDATED getEventCoords function ***
function getEventCoords(e) {
    if (!canvas) return [0, 0]; // Should not happen if initialized
    const rect = canvas.getBoundingClientRect(); // Get canvas position/size relative to viewport
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
        // Touch event: Use the first touch point's client coordinates
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        // Prevent default scroll/zoom behavior on touch move within canvas
        e.preventDefault();
    } else {
        // Mouse event: Use the mouse's client coordinates
        clientX = e.clientX;
        clientY = e.clientY;
    }

    // Calculate coordinates relative to the canvas element
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Optional: Clamp coordinates to canvas bounds if needed, though drawing outside usually just gets clipped
    // const clampedX = Math.max(0, Math.min(x, canvas.width));
    // const clampedY = Math.max(0, Math.min(y, canvas.height));
    // return [clampedX, clampedY];

    return [x, y];
}
// *** END UPDATED getEventCoords function ***


function handleMouseDown(e) {
    if (!drawingEnabled) return;
    isDrawing = true;
    [lastX, lastY] = getEventCoords(e);
}

function handleMouseMove(e) {
    if (!isDrawing || !drawingEnabled) return;
    const [currentX, currentY] = getEventCoords(e);
    drawLocalLine(lastX, lastY, currentX, currentY);

    // Emit drawing data for lobby/shared canvas
    const drawEvent = new CustomEvent('lobbyDraw', { // Use a consistent event name
        detail: {
            type: 'line',
            x0: lastX, y0: lastY, x1: currentX, y1: currentY,
            // TODO: Add color and size when implemented
            // color: currentStrokeStyle,
            // size: currentLineWidth
        }
    });
    canvas.dispatchEvent(drawEvent);

    [lastX, lastY] = [currentX, currentY];
}

function handleMouseUp() {
    if (!drawingEnabled) return;
    isDrawing = false;
}

function handleMouseOut() {
    // We might want to stop drawing if the mouse leaves the canvas
    // Or continue if the button is still held (depends on desired behavior)
    // For simplicity, let's stop drawing on mouse out.
    if (!drawingEnabled) return;
    isDrawing = false;
}

// --- Touch Event Handlers ---
function handleTouchStart(e) {
    if (!drawingEnabled) return;
    // e.preventDefault(); // Already called in getEventCoords for touchmove
    isDrawing = true;
    [lastX, lastY] = getEventCoords(e);
}

function handleTouchMove(e) {
    if (!isDrawing || !drawingEnabled) return;
    // e.preventDefault(); // Already called in getEventCoords
    const [currentX, currentY] = getEventCoords(e);
    drawLocalLine(lastX, lastY, currentX, currentY);

     // Emit drawing data for lobby/shared canvas
     const drawEvent = new CustomEvent('lobbyDraw', {
        detail: {
            type: 'line',
            x0: lastX, y0: lastY, x1: currentX, y1: currentY
            // TODO: Add color and size when implemented
        }
    });
    canvas.dispatchEvent(drawEvent);

    [lastX, lastY] = [currentX, currentY];
}

function handleTouchEnd() {
    if (!drawingEnabled) return;
    isDrawing = false;
}


// Draws locally
function drawLocalLine(x0, y0, x1, y1) {
    if (!context) return;
    // TODO: Use currentStrokeStyle and currentLineWidth when implemented
    context.strokeStyle = currentStrokeStyle;
    context.lineWidth = currentLineWidth;
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
    context.closePath();
}

// --- TODO: Add functions for setting tool, color, width, undo ---
// export function setTool(toolName) { ... }
// export function setColor(color) { currentStrokeStyle = color; }
// export function setLineWidth(width) { currentLineWidth = width; }
// export function undo() { ... }