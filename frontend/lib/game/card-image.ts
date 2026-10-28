// ─────────────────────────────────────────────────────────────────────────────
// MOVIEGOBLIN - Retro Collector Score Card Image Capture & Share Engine
// Produces pixel-perfect images matching the on-screen card (Image 4)
// ─────────────────────────────────────────────────────────────────────────────

import { toBlob } from "html-to-image";
import type { RevealedAnswer } from "./client";
import { findLocalPoster } from "./local-search";

export interface CardImageOptions {
  breakdown: {
    baseScore: number;
    efficiencyBonus: number;
    noCaseFileBonus: number;
    noClueBonus: number;
    total: number;
    rank: string;
    rankTitle: string;
    guessCount: number;
    cluesUsed: number;
    usedCaseFile?: boolean;
  };
  answer?: RevealedAnswer;
  dateLabel: string;
  flipped: boolean;
  solved: boolean;
}

/**
 * Capture the live rendered DOM card element directly using html-to-image.
 * Overrides 3D flip rotation so the card is rendered flat, upright, and razor-sharp.
 */
export async function exportCardElementToBlob(element: HTMLElement): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore font loading timeouts
    }
  }

  const blob = await toBlob(element, {
    pixelRatio: 2.5,
    cacheBust: true,
    style: {
      transform: "none",
      webkitTransform: "none",
      backfaceVisibility: "visible",
      webkitBackfaceVisibility: "visible",
      position: "static",
      margin: "0",
      display: "flex",
      boxSizing: "border-box",
      maxWidth: "none",
    },
  });

  if (!blob) throw new Error("Could not capture card element to blob");
  return blob;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
  }
  ctx.closePath();
}

/**
 * Canvas 2D Fallback: Render Side B (Back Specification Card)
 * Matches the on-screen card (Image 4) 100% pixel-perfect.
 */
function drawBackCardExact(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: CardImageOptions,
  posterImg: CanvasImageSource | null
) {
  const { breakdown, solved } = opts;
  const INK = "#0B0B0B";
  const ORANGE = "#FF5500";
  const PIXEL_FONT = '"Press Start 2P", monospace, system-ui';
  const SANS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const pad = 14;
  const cardX = pad;
  const cardY = pad;
  const cardW = w - pad * 2 - 4;
  const cardH = h - pad * 2 - 4;

  // 1. Solid Black Drop Shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, cardX + 5, cardY + 5, cardW, cardH, 16);
  ctx.fill();

  // 2. Card Body Gradient (#fff5eb to #fde0c6 to #f3c49f)
  const grad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  grad.addColorStop(0, "#FFF5EB");
  grad.addColorStop(0.5, "#FDE0C6");
  grad.addColorStop(1, "#F3C49F");
  ctx.fillStyle = grad;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.fill();

  // 3. Card Outer Border
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.stroke();

  // 4. Inner Framed Box (border-radius: 9px, background: rgba(255, 248, 240, 0.75))
  const innerPad = 10;
  const frameX = cardX + innerPad;
  const frameY = cardY + innerPad;
  const frameW = cardW - innerPad * 2;
  const frameH = cardH - innerPad * 2;

  ctx.fillStyle = "rgba(255, 248, 240, 0.75)";
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 9);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 9);
  ctx.stroke();

  // Clip content inside inner frame
  ctx.save();
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 9);
  ctx.clip();

  // Inner Frame Split: Top section (Portrait + Ledger) & Bottom Tagline bar
  const taglineH = 50;
  const topH = frameH - taglineH;
  const portraitW = Math.round(frameW * 0.36);
  const ledgerW = frameW - portraitW;

  // 5. Left Portrait
  ctx.fillStyle = INK;
  ctx.fillRect(frameX, frameY, portraitW, topH);

  if (posterImg) {
    const pW = (posterImg as HTMLImageElement).naturalWidth || (posterImg as HTMLCanvasElement).width || 300;
    const pH = (posterImg as HTMLImageElement).naturalHeight || (posterImg as HTMLCanvasElement).height || 450;
    const imgAspect = pW / pH;
    const boxAspect = portraitW / topH;
    let sW, sH, sX, sY;

    if (imgAspect > boxAspect) {
      sH = pH;
      sW = sH * boxAspect;
      sX = (pW - sW) / 2;
      sY = 0;
    } else {
      sW = pW;
      sH = sW / boxAspect;
      sX = 0;
      sY = (pH - sH) / 2;
    }
    try {
      ctx.drawImage(posterImg, sX, sY, sW, sH, frameX, frameY, portraitW, topH);
    } catch {
      // fallback if drawing failed
    }
  }

  // Portrait bottom pill badge: RANK <X>
  const pillW = 104;
  const pillH = 26;
  const pillX = frameX + (portraitW - pillW) / 2;
  const pillY = frameY + topH - 34;

  ctx.fillStyle = "rgba(11, 11, 11, 0.92)";
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 5);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ORANGE;
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 5);
  ctx.stroke();

  ctx.fillStyle = ORANGE;
  ctx.font = `bold 10px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`RANK ${breakdown.rank}`, pillX + pillW / 2, pillY + 17);

  // Vertical border between portrait & ledger
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX + portraitW, frameY);
  ctx.lineTo(frameX + portraitW, frameY + topH);
  ctx.stroke();

  // 6. Right Ledger
  const ledgerX = frameX + portraitW;
  const rowCount = 5.6;
  const rowH = Math.round(topH / rowCount);

  // Row 1: MOVIEGOBLIN ®
  ctx.fillStyle = "rgba(11, 11, 11, 0.05)";
  ctx.fillRect(ledgerX, frameY, ledgerW, rowH);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(ledgerX, frameY + rowH);
  ctx.lineTo(ledgerX + ledgerW, frameY + rowH);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `bold 12.5px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN ®", ledgerX + 12, frameY + rowH / 2 + 5);

  // Row 2: Rank Subtitle (APEX ORACLE / CHIEF ARCHIVIST)
  const r2Y = frameY + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r2Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r2Y + rowH);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `italic 900 13px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), ledgerX + 12, r2Y + rowH / 2 + 5);

  // Row 3: Base Solve +500
  const r3Y = r2Y + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r3Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r3Y + rowH);
  ctx.stroke();

  ctx.font = `italic 700 14px ${SANS_FONT}`;
  ctx.fillText("Base Solve", ledgerX + 12, r3Y + rowH / 2 + 5);
  ctx.font = `bold 10px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.baseScore}`, ledgerX + ledgerW - 12, r3Y + rowH / 2 + 4);

  // Row 4: Efficiency (1g) +500
  const r4Y = r3Y + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r4Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r4Y + rowH);
  ctx.stroke();

  ctx.font = `italic 700 14px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`Efficiency (${breakdown.guessCount}g)`, ledgerX + 12, r4Y + rowH / 2 + 5);
  ctx.font = `bold 10px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.efficiencyBonus}`, ledgerX + ledgerW - 12, r4Y + rowH / 2 + 4);

  // Row 5: 🔒 Case File +300 ★ (BLACK HIGHLIGHT WITH ORANGE TEXT WHEN BONUS!)
  const r5Y = r4Y + rowH;
  const isCaseBonus = breakdown.noCaseFileBonus > 0;

  if (isCaseBonus) {
    ctx.fillStyle = INK;
    ctx.fillRect(ledgerX, r5Y, ledgerW, rowH);
  }
  ctx.beginPath();
  ctx.moveTo(ledgerX, r5Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r5Y + rowH);
  ctx.stroke();

  ctx.fillStyle = isCaseBonus ? ORANGE : INK;
  ctx.font = `italic 700 14px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("🔒 Case File", ledgerX + 12, r5Y + rowH / 2 + 5);

  ctx.font = `bold 10px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  const caseVal = isCaseBonus ? `+${breakdown.noCaseFileBonus} ★` : solved ? "+0 (Open)" : "+0";
  ctx.fillText(caseVal, ledgerX + ledgerW - 12, r5Y + rowH / 2 + 4);

  // Row 6: Split Bottom (Left: No-Clue + Total; Right: Circular Guess Badge)
  const splitY = r5Y + rowH;
  const stampBoxW = 72;
  const splitLeftW = ledgerW - stampBoxW;
  const splitH = topH - (splitY - frameY);
  const halfSplitH = Math.round(splitH / 2);

  // Vertical border separating circular guess badge
  ctx.beginPath();
  ctx.moveTo(ledgerX + splitLeftW, splitY);
  ctx.lineTo(ledgerX + splitLeftW, frameY + topH);
  ctx.stroke();

  // Sub-row A: No-Clue Bonus
  ctx.fillStyle = INK;
  ctx.font = `italic 700 13px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("No-Clue Bonus", ledgerX + 12, splitY + halfSplitH / 2 + 4);
  ctx.font = `bold 9.5px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.noClueBonus}`, ledgerX + splitLeftW - 10, splitY + halfSplitH / 2 + 4);

  // Divider between sub-row A and sub-row B
  ctx.beginPath();
  ctx.moveTo(ledgerX, splitY + halfSplitH);
  ctx.lineTo(ledgerX + splitLeftW, splitY + halfSplitH);
  ctx.stroke();

  // Sub-row B: Total Score (Bold)
  ctx.font = `italic 900 14px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Total Score", ledgerX + 12, splitY + halfSplitH + halfSplitH / 2 + 4);
  ctx.font = `bold 11px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.total} PTS`, ledgerX + splitLeftW - 10, splitY + halfSplitH + halfSplitH / 2 + 4);

  // Circular Guess Stamp Badge
  const stampCX = ledgerX + splitLeftW + stampBoxW / 2;
  const stampCY = splitY + splitH / 2;
  const sRadius = 24;

  ctx.fillStyle = "rgba(255, 248, 240, 1)";
  ctx.beginPath();
  ctx.arc(stampCX, stampCY, sRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(stampCX, stampCY, sRadius - 3.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `bold 13px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(String(breakdown.guessCount).padStart(2, "0"), stampCX, stampCY + 5);

  // 7. Full-Width Bottom Tagline Bar
  const tagY = frameY + topH;
  ctx.fillStyle = "rgba(253, 227, 207, 0.65)";
  ctx.fillRect(frameX, tagY, frameW, taglineH);

  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX, tagY);
  ctx.lineTo(frameX + frameW, tagY);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `italic 700 13px ${SANS_FONT}`;
  ctx.textAlign = "center";
  const tagline = solved
    ? `Solved in ${breakdown.guessCount} ${breakdown.guessCount === 1 ? "guess" : "guesses"} with sharp cinema instinct!`
    : "Signal lost today — come back tomorrow for a new film!";
  ctx.fillText(`“${tagline}”`, frameX + frameW / 2, tagY + taglineH / 2 + 4);

  ctx.restore();
}

/**
 * Canvas 2D Fallback: Render Side A (Front Hero Badge Card)
 * Matches the on-screen card (Image 1) 100% pixel-perfect.
 */
function drawFrontCardExact(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: CardImageOptions
) {
  const { breakdown, dateLabel } = opts;
  const INK = "#0B0B0B";
  const ORANGE = "#FF5500";
  const PIXEL_FONT = '"Press Start 2P", monospace, system-ui';
  const SANS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const pad = 14;
  const cardX = pad;
  const cardY = pad;
  const cardW = w - pad * 2 - 4;
  const cardH = h - pad * 2 - 4;

  // 1. Drop Shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, cardX + 5, cardY + 5, cardW, cardH, 16);
  ctx.fill();

  // 2. Card Surface Gradient
  const grad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  grad.addColorStop(0, "#FFF6ED");
  grad.addColorStop(0.5, "#F9D8BC");
  grad.addColorStop(1, "#ECB991");
  ctx.fillStyle = grad;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.fill();

  // 3. Border
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.stroke();

  // 4. Top Meta
  ctx.fillStyle = INK;
  ctx.font = `bold 10px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN · ID", cardX + 20, cardY + 28);
  ctx.textAlign = "right";
  ctx.fillText(dateLabel, cardX + cardW - 20, cardY + 28);

  // 5. Hero Wordmark Center
  const centerY = cardY + cardH / 2;

  // RANK <X>® (Pixel font with solid black drop shadow)
  ctx.font = `bold 32px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.fillText(`RANK ${breakdown.rank}®`, cardX + cardW / 2 + 3, centerY - 15 + 3);
  ctx.fillStyle = ORANGE;
  ctx.fillText(`RANK ${breakdown.rank}®`, cardX + cardW / 2, centerY - 15);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeText(`RANK ${breakdown.rank}®`, cardX + cardW / 2, centerY - 15);

  // Total Points
  ctx.font = `bold 24px ${PIXEL_FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(`${breakdown.total} PTS`, cardX + cardW / 2 + 2, centerY + 32 + 2);
  ctx.fillStyle = "#FFF";
  ctx.fillText(`${breakdown.total} PTS`, cardX + cardW / 2, centerY + 32);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.strokeText(`${breakdown.total} PTS`, cardX + cardW / 2, centerY + 32);

  // 6. Bottom Meta
  ctx.font = `italic 900 13px ${SANS_FONT}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), cardX + 20, cardY + cardH - 20);

  ctx.font = `bold 9.5px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("SIDE A · RANK BADGE", cardX + cardW - 20, cardY + cardH - 20);
}

/**
 * Generates a high-precision Canvas 2D image matching Image 4
 */
export async function generateCardImageBlob(opts: CardImageOptions): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Canvas generation requires browser environment");
  }

  // Try locating poster image from live DOM or local catalog
  let posterImg: CanvasImageSource | null = null;
  if (typeof document !== "undefined") {
    const domImg = document.querySelector(".mg-sc-portrait-img") as HTMLImageElement | null;
    if (domImg && domImg.complete && domImg.naturalWidth > 0) {
      posterImg = domImg;
    }
  }

  if (!posterImg && opts.answer) {
    const url = opts.answer.poster_url || findLocalPoster(opts.answer.title, opts.answer.year);
    if (url) {
      posterImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const timer = setTimeout(() => resolve(null), 2000);
        img.onload = () => {
          clearTimeout(timer);
          resolve(img);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        img.src = url;
      });
    }
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  if (opts.flipped) {
    // Back Card (Specification Ledger, Image 4)
    canvas.width = 700;
    canvas.height = 480;
    drawBackCardExact(ctx, canvas.width, canvas.height, opts, posterImg);
  } else {
    // Front Card (Hero Wordmark, Image 1)
    canvas.width = 700;
    canvas.height = 420;
    drawFrontCardExact(ctx, canvas.width, canvas.height, opts);
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export canvas to PNG blob"));
    }, "image/png");
  });
}

/**
 * Primary Card Capture: Captures the live card element, with Canvas 2D fallback.
 * Ensures the exported picture is ALWAYS identical to Image 4.
 */
export async function captureCardImage(
  cardElement: HTMLElement | null,
  opts: CardImageOptions
): Promise<Blob> {
  // 1. First priority: Capture the live DOM card element directly
  if (cardElement) {
    try {
      const blob = await exportCardElementToBlob(cardElement);
      if (blob && blob.size > 2000) {
        return blob;
      }
    } catch (err) {
      console.warn("DOM card capture failed, using canvas fallback:", err);
    }
  }

  // 2. High-precision Canvas 2D fallback matching Image 4
  return await generateCardImageBlob(opts);
}

/**
 * Downloads a card Blob as a PNG file.
 */
export function downloadCardImage(blob: Blob, filename = "MovieGoblin-Card.png") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Copies the card PNG image to the system clipboard.
 */
export async function copyCardImageToClipboard(
  cardElement: HTMLElement | null,
  opts: CardImageOptions
): Promise<boolean> {
  try {
    const blob = await captureCardImage(cardElement, opts);
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      downloadCardImage(blob, `MovieGoblin-${opts.dateLabel}-Card.png`);
      return false;
    }
    const item = new ClipboardItem({ "image/png": blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch (err) {
    console.warn("Clipboard image write failed:", err);
    return false;
  }
}

/**
 * Native OS Share Sheet for the card image.
 */
export async function shareCardImage(
  cardElement: HTMLElement | null,
  opts: CardImageOptions
): Promise<"shared" | "copied" | "downloaded"> {
  const blob = await captureCardImage(cardElement, opts);
  const fileName = `MovieGoblin-${opts.dateLabel}-Card.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  const shareData = {
    files: [file],
    title: "MovieGoblin Score Card",
    text: `I solved today's MovieGoblin in ${opts.breakdown.guessCount} ${
      opts.breakdown.guessCount === 1 ? "guess" : "guesses"
    }! [Rank ${opts.breakdown.rank} · ${opts.breakdown.total} PTS] 🎬`,
  };

  if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        return "shared";
      }
    }
  }

  // Fallback 1: Try copying image to clipboard
  const copied = await copyCardImageToClipboard(cardElement, opts);
  if (copied) return "copied";

  // Fallback 2: Download PNG directly
  downloadCardImage(blob, fileName);
  return "downloaded";
}
