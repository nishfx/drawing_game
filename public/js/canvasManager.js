// public/js/canvasManager.js
import { floodFill } from './drawing/fillUtil.js';

let canvas = null;
let context = null;
let overlayCanvas = null;
let overlayCtx = null;

let isDrawing = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0;
let currentMouseY = 0;
let isMouseOverCanvas = false;
let drawingEnabled = false;
let myPlayerId = null;

let currentTool = 'pencil';
let currentStrokeStyle = '#000000';
let currentLineWidth = 5;
const CANVAS_BACKGROUND_COLOR = "#FFFFFF";

let currentStrokeId = null;

let myDrawHistory = [];
let fullDrawHistory = [];
const MAX_HISTORY = 500;

let emitDrawCallback = null;

// The default font size for text commands (could also come from UI)
const DEFAULT_TEXT_SIZE = 24;

/**
 * Initialize the main drawing canvas and overlay for previews
 */
export function initCanvas(canvasId, drawEventEmitter) {
  canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error("Canvas element not found:", canvasId);
    return false;
  }
  context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    console.error("Failed to get 2D context");
    return false;
  }

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.top = canvas.offsetTop + 'px';
  overlayCanvas.style.left = canvas.offsetLeft + 'px';
  overlayCanvas.style.width = canvas.clientWidth + 'px';
  overlayCanvas.style.height = canvas.clientHeight + 'px';
  overlayCanvas.style.pointerEvents = 'none';
  canvas.parentNode.insertBefore(overlayCanvas, canvas);
  overlayCtx = overlayCanvas.getContext('2d');

  emitDrawCallback = drawEventEmitter;

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

  // Event listeners
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseenter', handleMouseEnter);
  canvas.addEventListener('mouseleave', handleMouseLeave);

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
  console.log("Drawing enabled");
  setCursorStyle();
  if (isMouseOverCanvas) {
    updateCursorPreview(currentMouseX, currentMouseY);
  }
}

export function disableDrawing() {
  if (!canvas) return;
  drawingEnabled = false;
  isDrawing = false;
  currentStrokeId = null;
  clearOverlay();
  canvas.style.cursor = 'not-allowed';
  console.log("Drawing disabled");
}

/**
 * Clear only your own lines
 */
export function clearCanvas(emitEvent = true) {
  if (!context || !canvas) return;

  const myCmdIds = [];
  for (const cmd of fullDrawHistory) {
    if (cmd.playerId === myPlayerId) {
      myCmdIds.push(cmd.cmdId);
    }
  }
  if (myCmdIds.length > 0) {
    removeCommands(myCmdIds, null);
  }

  console.log("Locally removed all my lines. Redrawing...");
  redrawCanvasFromHistory();

  if (emitEvent && emitDrawCallback && myPlayerId) {
    const cmdId = generateCommandId();
    const command = { cmdId, type: 'clear' };
    emitDrawCallback(command);
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

// --- Tools ---
export function setTool(toolName) {
  currentTool = toolName;
  console.log("Tool set to:", currentTool);
  if (context && currentTool !== 'eraser') {
    context.globalCompositeOperation = 'source-over';
  }
  if (isMouseOverCanvas) {
    updateCursorPreview(currentMouseX, currentMouseY);
  } else {
    setCursorStyle();
    clearOverlay();
  }
}

export function setColor(color) {
  currentStrokeStyle = color;
  if (context) context.strokeStyle = currentStrokeStyle;
  if (overlayCtx) overlayCtx.strokeStyle = currentStrokeStyle;
  console.log("Color set to:", currentStrokeStyle);
  if (isMouseOverCanvas && (
    currentTool === 'pencil' ||
    currentTool === 'eraser' ||
    currentTool === 'fill' ||
    currentTool === 'text' // -- TEXT TOOL ADDITIONS --
  )) {
    updateCursorPreview(currentMouseX, currentMouseY);
  }
}

export function setLineWidth(width) {
  currentLineWidth = parseInt(width, 10) || 5;
  if (context) context.lineWidth = currentLineWidth;
  if (overlayCtx) overlayCtx.lineWidth = currentLineWidth;
  console.log("Line width set to:", currentLineWidth);
  if (isMouseOverCanvas && (
    currentTool === 'pencil' ||
    currentTool === 'eraser' ||
    currentTool === 'fill' ||
    currentTool === 'text' // -- TEXT TOOL ADDITIONS --
  )) {
    updateCursorPreview(currentMouseX, currentMouseY);
  }
}

// --- History & Redraw ---
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
  context.fillStyle = CANVAS_BACKGROUND_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);
  clearHistory();
  fullDrawHistory = commands.map(cmd => ({ ...cmd }));

  myDrawHistory = fullDrawHistory
    .filter(cmd => cmd.playerId === myPlayerId && cmd.type !== 'clear')
    .map(({ playerId, ...rest }) => rest);

  redrawCanvasFromHistory();
}

export function removeCommands(idsToRemove = [], strokeIdToRemove = null) {
  let removedCount = 0;
  if (strokeIdToRemove) {
    fullDrawHistory = fullDrawHistory.filter(cmd => {
      if (cmd.strokeId === strokeIdToRemove) {
        removedCount++;
        return false;
      }
      return true;
    });
    myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToRemove);
    console.log(`Removed ${removedCount} commands for stroke ${strokeIdToRemove}.`);
  } else if (idsToRemove.length > 0) {
    const idSet = new Set(idsToRemove);
    fullDrawHistory = fullDrawHistory.filter(cmd => {
      if (idSet.has(cmd.cmdId)) {
        removedCount++;
        return false;
      }
      return true;
    });
    myDrawHistory = myDrawHistory.filter(cmd => !idSet.has(cmd.cmdId));
    console.log(`Removed ${removedCount} commands by ID(s).`);
  }

  if (removedCount > 0) {
    redrawCanvasFromHistory();
  } else {
    console.warn(`No commands found for removal (IDs: ${idsToRemove.join(', ')}, StrokeID: ${strokeIdToRemove}).`);
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
  const originalCap = context.lineCap;
  const originalJoin = context.lineJoin;

  for (const cmd of fullDrawHistory) {
    try {
      executeCommand(cmd, context);
    } catch (error) {
      console.error("Error redrawing command:", cmd, error);
    }
  }

  context.strokeStyle = originalStroke;
  context.fillStyle = originalFill;
  context.lineWidth = originalWidth;
  context.globalCompositeOperation = originalComposite;
  context.lineCap = originalCap;
  context.lineJoin = originalJoin;

  console.log("Canvas redraw complete.");
  if (isMouseOverCanvas) updateCursorPreview(currentMouseX, currentMouseY);
}

function executeCommand(cmd, ctx) {
  ctx.strokeStyle = cmd.color || currentStrokeStyle;
  ctx.lineWidth = cmd.size || currentLineWidth;
  ctx.fillStyle = cmd.color || currentStrokeStyle;

  switch (cmd.type) {
    case 'line':
      ctx.globalCompositeOperation = cmd.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(cmd.x0, cmd.y0);
      ctx.lineTo(cmd.x1, cmd.y1);
      ctx.stroke();
      ctx.closePath();
      ctx.globalCompositeOperation = 'source-over';
      break;
    case 'rect': {
      ctx.globalCompositeOperation = 'source-over';
      const x = Math.min(cmd.x0, cmd.x1);
      const y = Math.min(cmd.y0, cmd.y1);
      const width = Math.abs(cmd.x1 - cmd.x0);
      const height = Math.abs(cmd.y1 - cmd.y0);
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.stroke();
      ctx.closePath();
      break;
    }
    case 'ellipse': {
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.ellipse(cmd.cx, cmd.cy, cmd.rx, cmd.ry, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.closePath();
      break;
    }
    case 'fill':
      ctx.globalCompositeOperation = 'source-over';
      floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
      break;
    case 'clear':
      // do nothing; we handle removing from history
      break;

    // -- TEXT TOOL ADDITIONS --
    case 'text': {
      ctx.globalCompositeOperation = 'source-over';
      const fontSize = cmd.fontSize || DEFAULT_TEXT_SIZE;
      ctx.font = `${fontSize}px sans-serif`;
      // default baseline to 'top' or 'alphabetic'; up to you
      ctx.textBaseline = 'top';
      ctx.fillStyle = cmd.color || '#000000';
      ctx.fillText(cmd.text, cmd.x, cmd.y);
      break;
    }

    default:
      console.warn("Unknown command type:", cmd.type);
  }
}

/**
 * For external commands from the server
 */
export function drawExternalCommand(data) {
  if (!data || !data.cmdId || !data.playerId) {
    console.warn("Invalid external command:", data);
    return;
  }
  if (data.type === 'clear') {
    // do nothing, removal is handled by "lobby commands removed"
    return;
  }
  addCommandToHistory(data, data.playerId);
  try {
    const originalStroke = context.strokeStyle;
    const originalFill = context.fillStyle;
    const originalWidth = context.lineWidth;
    const originalComposite = context.globalCompositeOperation;
    const originalCap = context.lineCap;
    const originalJoin = context.lineJoin;

    executeCommand(data, context);

    context.strokeStyle = originalStroke;
    context.fillStyle = originalFill;
    context.lineWidth = originalWidth;
    context.globalCompositeOperation = originalComposite;
    context.lineCap = originalCap;
    context.lineJoin = originalJoin;

  } catch (error) {
    console.error("Error drawing external command:", error, data);
  }
}

/**
 * Undo your last stroke. Only affects your own lines
 */
export function undoLastAction(socket) {
  if (!myPlayerId) {
    console.warn("Cannot undo: Player ID not set.");
    return;
  }
  if (myDrawHistory.length === 0) {
    console.log("No local history to undo.");
    return;
  }

  const lastMyCommand = myDrawHistory[myDrawHistory.length - 1];
  if (!lastMyCommand || !lastMyCommand.cmdId) {
    console.error("Invalid command in local history for undo:", lastMyCommand);
    myDrawHistory.pop();
    redrawCanvasFromHistory();
    return;
  }

  const strokeIdToUndo = lastMyCommand.strokeId;
  const cmdIdToUndo = lastMyCommand.cmdId;

  if (strokeIdToUndo) {
    myDrawHistory = myDrawHistory.filter(cmd => cmd.strokeId !== strokeIdToUndo);
  } else {
    myDrawHistory.pop();
  }
  if (socket && socket.connected) {
    const undoData = strokeIdToUndo ? { strokeId: strokeIdToUndo } : { cmdId: cmdIdToUndo };
    socket.emit('undo last draw', undoData);
  } else {
    console.error("Cannot emit undo: socket not connected. Doing local redraw only.");
    redrawCanvasFromHistory();
  }
}

// --- Internal ---
function getEventCoords(e) {
  if (!canvas) return { x: 0, y: 0 };
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
  const xRelative = clientX - rect.left;
  const yRelative = clientY - rect.top;
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = xRelative * scaleX;
  const canvasY = yRelative * scaleY;
  return { x: canvasX, y: canvasY };
}

// We can define a more specialized set of cursors, but let's keep it simple
function setCursorForTool(tool) {
  if (!canvas) return;
  let cursorStyle = 'crosshair';
  switch (tool) {
    case 'eraser':
      cursorStyle = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="5" y="5" width="10" height="10" fill="white" stroke="black"/></svg>') 10 10, auto`;
      break;
    case 'fill':
      cursorStyle = `url("data:image/svg+xml;base64,...") 12 12, auto`; // Painted can icon
      break;
    case 'text': // -- TEXT TOOL ADDITIONS --
      cursorStyle = 'text';
      break;
    default:
      cursorStyle = 'crosshair';
      break;
  }
  canvas.style.cursor = cursorStyle;
}

function setCursorStyle() {
  if (!canvas) return;
  // Tools that need an overlay preview or a special style:
  const showPreview = isMouseOverCanvas && !isDrawing && (
    currentTool === 'pencil' ||
    currentTool === 'eraser' ||
    currentTool === 'fill' ||
    currentTool === 'text' // text
  );

  if (showPreview || isDrawing) {
    // For text, we might prefer just 'text' cursor, but let's do the "no system cursor + overlay" approach
    // Or we can conditionally do if(currentTool==='text') { canvas.style.cursor='text'; } ...
    canvas.style.cursor = 'none';
  } else if (!drawingEnabled) {
    canvas.style.cursor = 'not-allowed';
  } else {
    setCursorForTool(currentTool);
  }
}

function clearOverlay() {
  if (overlayCtx && overlayCanvas) {
    if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
      overlayCanvas.width = canvas.width;
      overlayCanvas.height = canvas.height;
    }
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
}

function drawCursorPreview(x, y) {
  if (!overlayCtx || !drawingEnabled || isDrawing) {
    clearOverlay();
    return;
  }
  clearOverlay();

  // For text, you might do a small line or an 'I-bar' shape. We'll do a circle for consistency
  const radius = currentLineWidth / 2;
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2);
  overlayCtx.strokeStyle = (currentTool === 'eraser') ? '#555555' : currentStrokeStyle;
  overlayCtx.lineWidth = 1;
  overlayCtx.stroke();
  overlayCtx.closePath();

  overlayCtx.lineWidth = currentLineWidth;
  overlayCtx.strokeStyle = currentStrokeStyle;
}

function updateCursorPreview(x, y) {
  if (!isMouseOverCanvas || isDrawing) {
    clearOverlay();
  } else if (
    currentTool === 'pencil' ||
    currentTool === 'eraser' ||
    currentTool === 'fill' ||
    currentTool === 'text'
  ) {
    drawCursorPreview(x, y);
  } else {
    clearOverlay();
  }
  setCursorStyle();
}

// Mouse / Touch
function handleMouseEnter(e) {
  isMouseOverCanvas = true;
  const coords = getEventCoords(e);
  currentMouseX = coords.x;
  currentMouseY = coords.y;
  updateCursorPreview(coords.x, coords.y);
}

function handleMouseLeave(e) {
  isMouseOverCanvas = false;
  clearOverlay();
  setCursorStyle();
}

function handleMouseDown(e) {
  if (e.target !== canvas) return;
  if (!drawingEnabled || !myPlayerId) return;
  isMouseOverCanvas = true;
  const coords = getEventCoords(e);
  startX = coords.x;
  startY = coords.y;
  lastX = coords.x;
  lastY = coords.y;
  currentMouseX = coords.x;
  currentMouseY = coords.y;

  context.strokeStyle = currentStrokeStyle;
  context.lineWidth = currentLineWidth;
  context.fillStyle = currentStrokeStyle;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  clearOverlay();
  setCursorStyle();

  // 1) If text tool, we do NOT do 'isDrawing=true' for a drag-based shape. Instead, we prompt for text:
  if (currentTool === 'text') {
    isDrawing = false;
    // Prompt user
    const userText = prompt("Enter text:");
    if (userText && userText.trim().length > 0) {
      const cmdId = generateCommandId();
      const command = {
        cmdId,
        type: 'text',
        x: startX,
        y: startY,
        color: currentStrokeStyle,
        fontSize: DEFAULT_TEXT_SIZE,
        text: userText.trim()
      };
      // Draw locally
      executeCommand(command, context);
      addCommandToHistory(command, myPlayerId);
      // Emit
      if (emitDrawCallback) emitDrawCallback(command);
    }
    return; // Return so we don't treat it like a shape
  }

  // Otherwise, for pencil/eraser/rectangle, etc.
  isDrawing = true;

  if (currentTool === 'pencil' || currentTool === 'eraser') {
    currentStrokeId = generateStrokeId();
    context.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
    context.beginPath();
    context.moveTo(startX, startY);
  } else if (currentTool === 'fill') {
    // Fill is single-click
    isDrawing = false;
    currentStrokeId = null;
  } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
    currentStrokeId = null;
    overlayCtx.strokeStyle = currentStrokeStyle;
    overlayCtx.lineWidth = currentLineWidth;
    overlayCtx.lineCap = 'round';
    overlayCtx.lineJoin = 'round';
  }
}

function handleMouseMove(e) {
  if (!drawingEnabled || !myPlayerId) return;
  const coords = getEventCoords(e);
  currentMouseX = coords.x;
  currentMouseY = coords.y;

  if (!isDrawing) {
    updateCursorPreview(coords.x, coords.y);
    return;
  }

  // Actually drawing
  switch (currentTool) {
    case 'pencil':
    case 'eraser':
      drawLocalSegment(lastX, lastY, coords.x, coords.y);
      emitDrawSegment(lastX, lastY, coords.x, coords.y);
      lastX = coords.x;
      lastY = coords.y;
      break;
    case 'rectangle':
      clearOverlay();
      {
        const rectX = Math.min(startX, coords.x);
        const rectY = Math.min(startY, coords.y);
        const rectW = Math.abs(coords.x - startX);
        const rectH = Math.abs(coords.y - startY);
        overlayCtx.beginPath();
        overlayCtx.rect(rectX, rectY, rectW, rectH);
        overlayCtx.stroke();
        overlayCtx.closePath();
      }
      break;
    case 'ellipse':
      clearOverlay();
      {
        const rx = Math.abs(coords.x - startX) / 2;
        const ry = Math.abs(coords.y - startY) / 2;
        const cx = startX + (coords.x - startX) / 2;
        const cy = startY + (coords.y - startY) / 2;
        overlayCtx.beginPath();
        overlayCtx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        overlayCtx.stroke();
        overlayCtx.closePath();
      }
      break;
  }
}

function handleMouseUp(e) {
  if (!drawingEnabled || !myPlayerId) {
    isDrawing = false;
    currentStrokeId = null;
    return;
  }
  const x = currentMouseX;
  const y = currentMouseY;
  const wasDrawing = isDrawing;
  isDrawing = false;

  if (currentTool === 'fill') {
    if (wasDrawing === false && startX !== null && startY !== null && e.target === canvas) {
      const cmdId = generateCommandId();
      const command = { cmdId, type: 'fill', x, y, color: currentStrokeStyle };
      executeCommand(command, context);
      addCommandToHistory(command, myPlayerId);
      if (emitDrawCallback) emitDrawCallback(command);
    }
  } else if (currentTool === 'rectangle' && wasDrawing) {
    clearOverlay();
    const cmdId = generateCommandId();
    const finalX0 = Math.min(startX, x);
    const finalY0 = Math.min(startY, y);
    const finalX1 = Math.max(startX, x);
    const finalY1 = Math.max(startY, y);
    if (finalX1 > finalX0 && finalY1 > finalY0) {
      const command = {
        cmdId,
        type: 'rect',
        x0: finalX0,
        y0: finalY0,
        x1: finalX1,
        y1: finalY1,
        color: currentStrokeStyle,
        size: currentLineWidth
      };
      executeCommand(command, context);
      addCommandToHistory(command, myPlayerId);
      if (emitDrawCallback) emitDrawCallback(command);
    }
  } else if (currentTool === 'ellipse' && wasDrawing) {
    clearOverlay();
    const cmdId = generateCommandId();
    const rx = Math.abs(x - startX) / 2;
    const ry = Math.abs(y - startY) / 2;
    const cx = startX + (x - startX) / 2;
    const cy = startY + (y - startY) / 2;
    if (rx > 0 && ry > 0) {
      const command = {
        cmdId,
        type: 'ellipse',
        cx, cy, rx, ry,
        color: currentStrokeStyle,
        size: currentLineWidth
      };
      executeCommand(command, context);
      addCommandToHistory(command, myPlayerId);
      if (emitDrawCallback) emitDrawCallback(command);
    }
  } else if ((currentTool === 'pencil' || currentTool === 'eraser') && wasDrawing) {
    // Single click => dot
    if (x === lastX && y === lastY) {
      drawLocalSegment(x, y, x + 0.01, y + 0.01);
      emitDrawSegment(x, y, x + 0.01, y + 0.01);
    } else {
      if (x !== lastX || y !== lastY) {
        drawLocalSegment(lastX, lastY, x, y);
        emitDrawSegment(lastX, lastY, x, y);
      }
    }
    context.closePath();
  }

  currentStrokeId = null;
  startX = null;
  startY = null;

  if (isMouseOverCanvas) {
    updateCursorPreview(x, y);
  } else {
    setCursorStyle();
  }
}

// Touch
function handleTouchStart(e) {
  if (e.target !== canvas) return;
  if (!drawingEnabled) return;
  if (e.touches.length > 0) {
    isMouseOverCanvas = true;
    handleMouseDown(e);
  }
}

function handleTouchMove(e) {
  if (!drawingEnabled) return;
  if (e.touches.length > 0) {
    handleMouseMove(e);
  }
}

function handleTouchEnd(e) {
  const wasDrawing = isDrawing;
  if (!drawingEnabled || !myPlayerId) {
    isDrawing = false;
    currentStrokeId = null;
    return;
  }
  if (e.changedTouches.length > 0) {
    const pseudoEvent = {
      clientX: e.changedTouches[0].clientX,
      clientY: e.changedTouches[0].clientY,
      preventDefault: () => {}
    };
    getEventCoords(pseudoEvent);
    handleMouseUp.call({ isDrawing: wasDrawing, currentTool }, pseudoEvent);
  } else {
    isDrawing = false;
    currentStrokeId = null;
    if (context) context.closePath();
    clearOverlay();
  }
  isMouseOverCanvas = false;
  setCursorStyle();
}

function emitDrawSegment(x0, y0, x1, y1) {
  if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;
  const cmdId = generateCommandId();
  const command = {
    cmdId,
    strokeId: currentStrokeId,
    type: 'line',
    x0, y0, x1, y1,
    tool: currentTool,
    color: currentTool === 'eraser' ? null : currentStrokeStyle,
    size: currentLineWidth
  };
  addCommandToHistory(command, myPlayerId);
  emitDrawCallback(command);
}

function drawLocalSegment(x0, y0, x1, y1) {
  if (!context) return;
  context.lineTo(x1, y1);
  context.stroke();
}

