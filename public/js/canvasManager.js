// public/js/canvasManager.js
import { floodFill } from './drawing/fillUtil.js';

let canvas = null;
let context = null;
let overlayCanvas = null;
let overlayCtx = null;

let isDrawing = false;
let isMouseOverCanvas = false;
let drawingEnabled = false;
let myPlayerId = null;

let currentTool = 'pencil';
let currentColor = '#000000';
let currentLineWidth = 5;
let currentStrokeId = null;

let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let currentMouseX = 0;
let currentMouseY = 0;
let shapeStartX = null;
let shapeStartY = null;

const CANVAS_BG_COLOR = '#FFFFFF';
const MAX_HISTORY = 500;

let emitDrawCallback = null;

// For local undo
let myDrawHistory = [];
// For rendering everything
let fullDrawHistory = [];

// -----------------------------------------------------------
// Init
// -----------------------------------------------------------
export function initCanvas(canvasId, drawEventEmitter) {
  canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error('Canvas not found:', canvasId);
    return false;
  }
  context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    console.error('Failed to get context for canvas:', canvasId);
    return false;
  }

  // Create overlay for the preview cursor & shape outlines
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

  // Fill background
  context.fillStyle = CANVAS_BG_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Basic attributes
  context.lineJoin = 'round';
  context.lineCap = 'round';
  overlayCtx.lineJoin = 'round';
  overlayCtx.lineCap = 'round';

  // Attach events to the canvas
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

  // Also re-sync overlay on every resize or scroll
  window.addEventListener('resize', syncOverlayPosition);
  document.addEventListener('scroll', syncOverlayPosition, true);

  console.log(`Canvas "${canvasId}" initialized`);
  clearHistory();
  disableDrawing();
  syncOverlayPosition();
  return true;
}

// Keep overlay pinned to the right place:
function syncOverlayPosition() {
  if (!canvas || !overlayCanvas) return;
  const rect = canvas.getBoundingClientRect();
  overlayCanvas.style.top = rect.top + 'px';
  overlayCanvas.style.left = rect.left + 'px';
  overlayCanvas.style.width = rect.width + 'px';
  overlayCanvas.style.height = rect.height + 'px';

  // Also fix resolution if needed:
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
}

// -----------------------------------------------------------
// Basic Controls
// -----------------------------------------------------------
export function setPlayerId(pid) {
  myPlayerId = pid;
  console.log('CanvasManager => Player ID set:', pid);
}

export function enableDrawing() {
  if (!canvas) return;
  drawingEnabled = true;
  // We rely on our custom circle cursor => hide OS cursor
  canvas.style.cursor = 'none';
  console.log('Canvas => drawing enabled');
}

export function disableDrawing() {
  if (!canvas) return;
  drawingEnabled = false;
  isDrawing = false;
  currentStrokeId = null;
  clearOverlay();
  canvas.style.cursor = 'not-allowed';
  console.log('Canvas => drawing disabled');
}

function clearOverlay() {
  if (!overlayCtx) return;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// -----------------------------------------------------------
// Tool + Style
// -----------------------------------------------------------
export function setTool(tool) {
  currentTool = tool;
  console.log('Tool =>', tool);
}

export function setColor(color) {
  currentColor = color;
  console.log('Color =>', color);
}

export function setLineWidth(width) {
  currentLineWidth = parseInt(width, 10) || 5;
  console.log('LineWidth =>', currentLineWidth);
}

// -----------------------------------------------------------
// Clear + Export
// -----------------------------------------------------------
export function clearCanvas(emitEvent = true) {
  if (!context || !canvas) return;

  // remove my commands
  const myCmdIds = fullDrawHistory
    .filter(cmd => cmd.playerId === myPlayerId)
    .map(cmd => cmd.cmdId);

  if (myCmdIds.length) {
    removeCommands(myCmdIds, null, myPlayerId);
  }
  console.log('Cleared local lines, redrawing...');
  redrawFromHistory();

  if (emitEvent && emitDrawCallback && myPlayerId) {
    const cmdId = genCmdId();
    emitDrawCallback({ cmdId, type: 'clear' });
  }
}

export function getDrawingDataURL() {
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('Error => getDrawingDataURL:', e);
    return null;
  }
}

// -----------------------------------------------------------
// History + Redraw
// -----------------------------------------------------------
function genCmdId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

function genStrokeId() {
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

function addCommandToHistory(cmd, playerId) {
  const combined = { ...cmd, playerId };
  fullDrawHistory.push(combined);
  if (fullDrawHistory.length > MAX_HISTORY) {
    fullDrawHistory.shift();
  }
  if (playerId === myPlayerId && cmd.type !== 'clear') {
    myDrawHistory.push(combined);
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
  console.log('Loading', commands.length, 'commands from server...');
  clearHistory();
  context.fillStyle = CANVAS_BG_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);

  fullDrawHistory = commands.map(c => ({ ...c }));
  myDrawHistory = fullDrawHistory.filter(c => c.playerId === myPlayerId && c.type !== 'clear');

  redrawFromHistory();
}

export function removeCommands(idsToRemove = [], strokeIdToRemove = null, ownerPlayerId = null) {
  let removed = 0;
  if (strokeIdToRemove) {
    fullDrawHistory = fullDrawHistory.filter(cmd => {
      if (cmd.strokeId === strokeIdToRemove && (!ownerPlayerId || cmd.playerId === ownerPlayerId)) {
        removed++;
        return false;
      }
      return true;
    });
    myDrawHistory = myDrawHistory.filter(cmd => !(cmd.strokeId === strokeIdToRemove && cmd.playerId === ownerPlayerId));
    console.log(`Removed ${removed} commands for stroke ${strokeIdToRemove} from ${ownerPlayerId}`);
  } else if (idsToRemove.length) {
    const idSet = new Set(idsToRemove);
    fullDrawHistory = fullDrawHistory.filter(cmd => {
      if (idSet.has(cmd.cmdId) && (!ownerPlayerId || cmd.playerId === ownerPlayerId)) {
        removed++;
        return false;
      }
      return true;
    });
    myDrawHistory = myDrawHistory.filter(cmd => !(idSet.has(cmd.cmdId) && cmd.playerId === ownerPlayerId));
    console.log(`Removed ${removed} commands by ID from ${ownerPlayerId}`);
  }
  if (removed) {
    redrawFromHistory();
  } else {
    console.warn('No commands found to remove for', strokeIdToRemove, idsToRemove);
  }
}

function redrawFromHistory() {
  if (!context || !canvas) return;
  console.log(`Redraw => ${fullDrawHistory.length} commands.`);
  context.fillStyle = CANVAS_BG_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);
  clearOverlay();

  const savedComp = context.globalCompositeOperation;
  const savedStroke = context.strokeStyle;
  const savedFill = context.fillStyle;
  const savedLineWidth = context.lineWidth;

  for (const cmd of fullDrawHistory) {
    try {
      renderCommand(cmd, context);
    } catch (err) {
      console.error('Redraw error =>', cmd, err);
    }
  }

  context.globalCompositeOperation = savedComp;
  context.strokeStyle = savedStroke;
  context.fillStyle = savedFill;
  context.lineWidth = savedLineWidth;
  console.log('Redraw done.');
}

// Actually render a command
function renderCommand(cmd, ctx) {
  // If eraser => destination-out
  if (cmd.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }

  // color if available
  if (typeof cmd.color === 'string') {
    ctx.strokeStyle = cmd.color;
    ctx.fillStyle = cmd.color;
  } else {
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
  }
  // size if available
  ctx.lineWidth = cmd.size != null ? cmd.size : 5;

  switch (cmd.type) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(cmd.x0, cmd.y0);
      ctx.lineTo(cmd.x1, cmd.y1);
      ctx.stroke();
      ctx.closePath();
      break;

    case 'rect': {
      const x = Math.min(cmd.x0, cmd.x1);
      const y = Math.min(cmd.y0, cmd.y1);
      const w = Math.abs(cmd.x1 - cmd.x0);
      const h = Math.abs(cmd.y1 - cmd.y0);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
      ctx.closePath();
      break;
    }
    case 'ellipse': {
      const cx = (cmd.x0 + cmd.x1) / 2;
      const cy = (cmd.y0 + cmd.y1) / 2;
      const rx = Math.abs(cmd.x1 - cmd.x0) / 2;
      const ry = Math.abs(cmd.y1 - cmd.y0) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.closePath();
      break;
    }
    case 'fill':
      floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color || '#000000');
      break;

    case 'text': {
      const fontSize = (cmd.size || 5) * 4;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(cmd.text, cmd.x, cmd.y);
      break;
    }
    case 'clear':
      // server removes actual commands from hist
      break;
    default:
      console.warn('Unknown command type =>', cmd.type);
  }
}

// -----------------------------------------------------------
// External Commands (from server -> client)
// -----------------------------------------------------------
export function drawExternalCommand(cmd) {
  // skip if command is from me => prevents double storing
  if (cmd && cmd.playerId === myPlayerId) {
    return;
  }
  if (!context || !cmd || !cmd.cmdId || !cmd.playerId) {
    console.warn('Ignoring invalid external cmd =>', cmd);
    return;
  }
  if (cmd.type === 'clear') {
    // server will remove from history => do nothing
    return;
  }
  // Add to local history & render
  addCommandToHistory(cmd, cmd.playerId);
  try {
    renderCommand(cmd, context);
  } catch (err) {
    console.error('Ext cmd error =>', cmd, err);
  }
}

// -----------------------------------------------------------
// Undo
// -----------------------------------------------------------
export function undoLastAction(socket) {
  if (!myPlayerId) {
    console.warn('Undo => No player ID');
    return;
  }
  if (myDrawHistory.length === 0) {
    console.log('Undo => no local history');
    return;
  }
  const last = myDrawHistory[myDrawHistory.length - 1];
  if (!last || !last.cmdId) {
    console.warn('Undo => invalid last command');
    myDrawHistory.pop();
    redrawFromHistory();
    return;
  }

  const strokeId = last.strokeId;
  const cmdId = last.cmdId;
  console.log('Undo => stroke:', strokeId, 'cmd:', cmdId);

  if (strokeId) {
    // remove all that share strokeId
    myDrawHistory = myDrawHistory.filter(c => c.strokeId !== strokeId);
  } else {
    myDrawHistory.pop();
  }

  if (socket && socket.connected) {
    // notify server
    const data = strokeId ? { strokeId } : { cmdId };
    socket.emit('undo last draw', data);
  } else {
    console.warn('Undo => no socket, local only');
    redrawFromHistory();
  }
}

// -----------------------------------------------------------
// Mouse / Touch Flow
// -----------------------------------------------------------
function handleMouseEnter(e) {
  isMouseOverCanvas = true;
  updateCursor(e);
}
function handleMouseLeave(e) {
  // if user drags out => finalize stroke
  if (isDrawing) finishStroke();
  isMouseOverCanvas = false;
  clearOverlay();
}

function handleMouseDown(e) {
  if (!drawingEnabled || !myPlayerId) return;
  if (e.button !== 0) return;

  const { x, y } = getCoords(e);
  isDrawing = true;
  startX = x;
  startY = y;
  lastX = x;
  lastY = y;
  currentStrokeId = genStrokeId();
  clearOverlay();

  if (currentTool === 'pencil' || currentTool === 'eraser') {
    // set local stroke style so user sees correct thickness/color right away
    context.globalCompositeOperation =
      (currentTool === 'eraser') ? 'destination-out' : 'source-over';
    context.strokeStyle = (currentTool === 'eraser') ? '#000000' : currentColor;
    context.lineWidth = currentLineWidth;
    context.beginPath();
    context.moveTo(x, y);
  } else if (currentTool === 'fill') {
    // do fill on mouseUp
  } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
    shapeStartX = x;
    shapeStartY = y;
  } else if (currentTool === 'text') {
    const userText = prompt('Enter text:');
    if (userText && userText.trim()) {
      const cmdId = genCmdId();
      const textCmd = {
        cmdId,
        strokeId: currentStrokeId,
        type: 'text',
        x, y,
        text: userText.trim(),
        color: currentColor,
        size: currentLineWidth,
        tool: 'pencil'
      };
      renderCommand(textCmd, context);
      addCommandToHistory(textCmd, myPlayerId);
      if (emitDrawCallback) {
        emitDrawCallback(textCmd);
      }
    }
    isDrawing = false;
    currentStrokeId = null;
  }
}

function handleMouseMove(e) {
  if (!drawingEnabled) return;
  updateCursor(e);

  if (!isDrawing) return;

  if (currentTool === 'pencil' || currentTool === 'eraser') {
    const { x, y } = getCoords(e);
    // local draw
    context.lineTo(x, y);
    context.stroke();

    // broadcast
    emitSegment(lastX, lastY, x, y);

    lastX = x;
    lastY = y;
  } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
    // preview shape
    const { x, y } = getCoords(e);
    clearOverlay();
    overlayCtx.globalCompositeOperation = 'source-over';
    overlayCtx.strokeStyle = currentColor;
    overlayCtx.lineWidth = currentLineWidth;
    overlayCtx.beginPath();
    if (currentTool === 'rectangle') {
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
    overlayCtx.closePath();
  }
}

function handleMouseUp(e) {
  if (!drawingEnabled || !isDrawing) return;
  finishStroke();
}

// finalize
function finishStroke() {
  if (!isDrawing) return;
  isDrawing = false;

  const { x, y } = { x: lastX, y: lastY };

  if (currentTool === 'pencil' || currentTool === 'eraser') {
    // close path
    context.closePath();
  } else if (currentTool === 'fill') {
    const cmdId = genCmdId();
    const fillCmd = {
      cmdId,
      strokeId: currentStrokeId,
      type: 'fill',
      x, y,
      color: currentColor,
      tool: 'pencil'
    };
    renderCommand(fillCmd, context);
    addCommandToHistory(fillCmd, myPlayerId);
    if (emitDrawCallback) {
      emitDrawCallback(fillCmd);
    }
  } else if (currentTool === 'rectangle' || currentTool === 'ellipse') {
    clearOverlay();
    const cmdId = genCmdId();
    const shapeCmd = {
      cmdId,
      strokeId: currentStrokeId,
      type: (currentTool === 'rectangle') ? 'rect' : 'ellipse',
      x0: shapeStartX,
      y0: shapeStartY,
      x1: x,
      y1: y,
      color: currentColor,
      size: currentLineWidth,
      tool: 'pencil'
    };
    renderCommand(shapeCmd, context);
    addCommandToHistory(shapeCmd, myPlayerId);
    if (emitDrawCallback) {
      emitDrawCallback(shapeCmd);
    }
  }

  currentStrokeId = null;
  shapeStartX = null;
  shapeStartY = null;
}

// -----------------------------------------------------------
// Touch
// -----------------------------------------------------------
function handleTouchStart(e) {
  if (!drawingEnabled || e.touches.length === 0) return;
  handleMouseDown(e);
}
function handleTouchMove(e) {
  if (!drawingEnabled || e.touches.length === 0) return;
  handleMouseMove(e);
}
function handleTouchEnd(e) {
  finishStroke();
  isMouseOverCanvas = false;
  clearOverlay();
}

// -----------------------------------------------------------
// Utility
// -----------------------------------------------------------
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches.length) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
    e.preventDefault();
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  const xRel = clientX - rect.left;
  const yRel = clientY - rect.top;
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: xRel * scaleX, y: yRel * scaleY };
}

// Draw our circle cursor
function updateCursor(e) {
  if (!drawingEnabled) {
    clearOverlay();
    return;
  }
  const { x, y } = getCoords(e);
  currentMouseX = x;
  currentMouseY = y;
  isMouseOverCanvas = true;

  clearOverlay();
  overlayCtx.beginPath();
  const r = Math.max(1, currentLineWidth / 2);
  overlayCtx.arc(x, y, r, 0, 2 * Math.PI);
  overlayCtx.strokeStyle = (currentTool === 'eraser') ? '#888' : currentColor;
  overlayCtx.lineWidth = 1;
  overlayCtx.stroke();
  overlayCtx.closePath();
}

// -----------------------------------------------------------
// Emitting line segments
// -----------------------------------------------------------
function emitSegment(x0, y0, x1, y1) {
  if (!emitDrawCallback || !myPlayerId || !currentStrokeId) return;
  const cmdId = genCmdId();
  const segCmd = {
    cmdId,
    strokeId: currentStrokeId,
    type: 'line',
    x0, y0, x1, y1,
    tool: currentTool,
    color: (currentTool === 'eraser') ? null : currentColor,
    size: currentLineWidth
  };
  addCommandToHistory(segCmd, myPlayerId);
  emitDrawCallback(segCmd);
}
