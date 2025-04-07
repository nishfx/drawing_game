/* public/js/canvas/drawingExecutor.js */
// Executes drawing commands on a given context.

import { floodFill } from '../drawing/fillUtil.js'; // Keep fillUtil separate
import { CANVAS_BACKGROUND_COLOR } from './canvasCore.js';

/**
 * Executes a single drawing command on the provided canvas context.
 * @param {Object} cmd - The drawing command object.
 * @param {CanvasRenderingContext2D} ctx - The context to draw on.
 */
export function executeCommand(cmd, ctx) {
    if (!ctx) {
        console.error("executeCommand called without context.");
        return;
    }
    if (!cmd || !cmd.type) {
        console.warn("executeCommand called with invalid command:", cmd);
        return;
    }

    // Save context state before applying command-specific settings
    ctx.save();

    // --- Set composite operation and styles based explicitly on the command's tool ---
    if (cmd.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        // Color doesn't visually matter for destination-out, but use black for the shape
        ctx.strokeStyle = '#000000';
        ctx.fillStyle = '#000000'; // For consistency if eraser somehow used fill
        ctx.lineWidth = (cmd.size != null) ? cmd.size : 5;
    } else if (cmd.type === 'fill') {
        // Fill needs source-over and uses fillStyle
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = cmd.color || '#000000';
        // lineWidth/strokeStyle are not directly used by floodFill
    } else if (cmd.type === 'text') {
        // Text needs source-over and uses fillStyle
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = cmd.color || '#000000';
        // lineWidth/strokeStyle are not directly used by fillText
    } else {
        // Default for pencil, rect, ellipse (line-based tools)
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = cmd.color || '#000000';
        ctx.fillStyle = cmd.color || '#000000'; // Set fillStyle too for potential future filled shapes
        ctx.lineWidth = (cmd.size != null) ? cmd.size : 5;
    }
    // --- End composite/style setting ---


    // Execute command based on type
    switch (cmd.type) {
        case 'line':
            if (cmd.x0 != null && cmd.y0 != null && cmd.x1 != null && cmd.y1 != null) {
                ctx.beginPath();
                ctx.moveTo(cmd.x0, cmd.y0);
                ctx.lineTo(cmd.x1, cmd.y1);
                ctx.stroke();
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
                ctx.strokeRect(x, y, w, h); // Assumes outline only for now
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
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                ctx.stroke();
                // No closePath needed for stroke-only ellipse
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
            // Handled by historyManager.removeCommands during redraw prep.
            break;

        default:
            console.warn("Unknown command type encountered during redraw:", cmd.type, cmd);
    }

    // Restore context state to before this command
    // This implicitly resets globalCompositeOperation, strokeStyle, fillStyle, lineWidth etc.
    ctx.restore();
}