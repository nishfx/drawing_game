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

    // --- FIX: Set composite operation based on tool ---
    if (cmd.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        // When using destination-out, the actual stroke color doesn't matter visually,
        // but setting it helps avoid potential state issues if not restored properly.
        // Using black is fine, or even the intended background color.
        ctx.strokeStyle = '#000000'; // Or CANVAS_BACKGROUND_COLOR, doesn't visually matter here
        ctx.fillStyle = '#000000';   // Same for fillStyle if eraser somehow used fill
    } else {
        // Default for pencil, shapes, fill, text
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = cmd.color || '#000000';
        ctx.fillStyle = cmd.color || '#000000';
    }
    // --- End FIX ---

    ctx.lineWidth = (cmd.size != null) ? cmd.size : 5; // Default 5 if size missing

    // Execute command based on type
    switch (cmd.type) {
        case 'line':
            if (cmd.x0 != null && cmd.y0 != null && cmd.x1 != null && cmd.y1 != null) {
                ctx.beginPath();
                ctx.moveTo(cmd.x0, cmd.y0);
                ctx.lineTo(cmd.x1, cmd.y1);
                ctx.stroke();
                // No closePath for single lines
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
                // Use strokeRect for outline, fillRect for filled (currently only stroke)
                ctx.strokeRect(x, y, w, h);
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
                // Ellipse needs beginPath/stroke/closePath
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.closePath(); // ClosePath for ellipse makes sense
            } else {
                console.warn("Invalid 'ellipse' command data:", cmd);
            }
            break;

        case 'fill':
            // Fill tool needs 'source-over' regardless of the current tool setting
            // It operates on pixel data directly, not path stroking/filling.
            // Ensure composite operation is correct before calling floodFill.
            ctx.globalCompositeOperation = 'source-over'; // Override for fill
            ctx.fillStyle = cmd.color || '#000000'; // Ensure fillStyle is set correctly

            if (cmd.x != null && cmd.y != null && cmd.color != null) {
                // floodFill handles its own context manipulation internally
                floodFill(ctx, Math.round(cmd.x), Math.round(cmd.y), cmd.color);
            } else {
                console.warn("Invalid 'fill' command data:", cmd);
            }
            break;

        case 'text':
            // Text also needs 'source-over'
            ctx.globalCompositeOperation = 'source-over'; // Override for text
            ctx.fillStyle = cmd.color || '#000000'; // Ensure fillStyle is set correctly

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
            // The 'clear' command is handled by removing history items in `removeCommands`.
            // No drawing action needed here during redraw.
            break;

        default:
            console.warn("Unknown command type encountered during redraw:", cmd.type, cmd);
    }

    // Restore context state to before this command
    ctx.restore();
}