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
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('touchcancel', handleTouchEnd);

    console.log(`Canvas "${canvasId}" initialized`);
    clearCanvas(); // Clear on init
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

export function clearCanvas() {
    if (!context || !canvas) return;
    context.fillStyle = "#FFFFFF"; // Set fill color to white
    context.fillRect(0, 0, canvas.width, canvas.height); // Fill the canvas
    console.log("Canvas cleared");
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
// *** THIS IS THE SINGLE CORRECT DEFINITION ***
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
         clearCanvas();
    }
    // Add more command types as needed
}
// *** END SINGLE CORRECT DEFINITION ***


// --- Internal Drawing Logic ---

function getEventCoords(e) {
    let x, y;
    if (e.touches && e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
    } else {
        x = e.offsetX;
        y = e.offsetY;
    }
    return [x, y];
}


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
            // color: currentStrokeStyle, size: currentLineWidth // Add if needed
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
    if (!drawingEnabled) return;
    isDrawing = false;
}

// --- Touch Event Handlers ---
function handleTouchStart(e) {
    if (!drawingEnabled) return;
    e.preventDefault();
    isDrawing = true;
    [lastX, lastY] = getEventCoords(e);
}

function handleTouchMove(e) {
    if (!isDrawing || !drawingEnabled) return;
    e.preventDefault();
    const [currentX, currentY] = getEventCoords(e);
    drawLocalLine(lastX, lastY, currentX, currentY);

     // Emit drawing data for lobby/shared canvas
     const drawEvent = new CustomEvent('lobbyDraw', {
        detail: { type: 'line', x0: lastX, y0: lastY, x1: currentX, y1: currentY }
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
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
    context.closePath();
}

// --- NO DUPLICATE FUNCTIONS BELOW THIS LINE ---