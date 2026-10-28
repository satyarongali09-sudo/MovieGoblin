// ─────────────────────────────────────────────────────────────────────────────
// MOVIEGOBLIN - High-Res Retro Collector Score Card Image Generator & Sharer
// Creates canvas-rendered PNGs for Instagram Stories, WhatsApp, Twitter, etc.
// ─────────────────────────────────────────────────────────────────────────────

import type { RevealedAnswer } from "./client";

export type CardShareFormat = "current" | "story";

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
  format?: CardShareFormat;
}

// Safe cross-origin image loader with timeout
function loadPosterImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url || typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 2200);

    img.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(img);
      }
    };

    img.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    };

    img.src = url;
  });
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

// Fallback retro pixel mascot drawn onto canvas
function drawPixelMascot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale = 3,
  color = "#FF5500"
) {
  // 16x16 pixel goblin matrix
  const pixelMap = [
    "....XXXXXXXX....",
    "...XX......XX...",
    "..X..XX..XX..X..",
    ".X....XXXX....X.",
    ".X...XXXXXX...X.",
    "XX..XXXXXXXX..XX",
    "XX..XXXXXXXX..XX",
    "XX..XX.XX.XX..XX",
    ".X..XXXXXXXX..X.",
    ".X...X....X...X.",
    "..X...XXXX...X..",
    "...XX......XX...",
    "....XXXXXXXX....",
    ".....XX..XX.....",
    "....XXX..XXX....",
    "....XX....XX....",
  ];

  ctx.save();
  ctx.fillStyle = color;
  const startX = cx - (8 * scale);
  const startY = cy - (8 * scale);

  for (let r = 0; r < pixelMap.length; r++) {
    const row = pixelMap[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "X") {
        ctx.fillRect(startX + c * scale, startY + r * scale, scale, scale);
      }
    }
  }
  ctx.restore();
}

/**
 * Draws the Back Specification Ledger Card (Side B)
 */
function drawBackCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: CardImageOptions,
  posterImg: HTMLImageElement | null
) {
  const { breakdown, answer, dateLabel, solved } = opts;
  const INK = "#0B0B0B";
  const ORANGE = "#FF5500";

  // Card Shadow
  ctx.save();
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, x + 8, y + 8, w, h, 20);
  ctx.fill();

  // Card Body Background (warm gradient)
  const cardGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  cardGrad.addColorStop(0, "#FFF7EE");
  cardGrad.addColorStop(0.5, "#F9D8BC");
  cardGrad.addColorStop(1, "#ECB991");
  ctx.fillStyle = cardGrad;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.fill();

  // Outer Border
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.stroke();

  // Top Meta Header
  ctx.fillStyle = INK;
  ctx.font = 'bold 15px "Courier New", monospace, system-ui';
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN · ARCHIVE SPEC", x + 24, y + 36);

  ctx.textAlign = "right";
  ctx.fillText(`ID // ${dateLabel}`, x + w - 24, y + 36);

  // Inner Framed Box
  const frameX = x + 20;
  const frameY = y + 54;
  const frameW = w - 40;
  const frameH = h - 100;

  ctx.fillStyle = "rgba(255, 248, 240, 0.9)";
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 12);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 12);
  ctx.stroke();

  // Split inner box: Left Portrait (36%) + Right Ledger (64%)
  const portraitW = Math.round(frameW * 0.36);
  const ledgerW = frameW - portraitW;
  const topH = frameH - 58; // Bottom 58px for tagline bar

  // Left Portrait Box
  ctx.save();
  drawRoundedRect(ctx, frameX, frameY, portraitW, topH, 0);
  ctx.clip();

  ctx.fillStyle = INK;
  ctx.fillRect(frameX, frameY, portraitW, topH);

  if (posterImg) {
    // Draw cropped poster
    const imgAspect = posterImg.naturalWidth / posterImg.naturalHeight;
    const boxAspect = portraitW / topH;
    let sW, sH, sX, sY;

    if (imgAspect > boxAspect) {
      sH = posterImg.naturalHeight;
      sW = sH * boxAspect;
      sX = (posterImg.naturalWidth - sW) / 2;
      sY = 0;
    } else {
      sW = posterImg.naturalWidth;
      sH = sW / boxAspect;
      sX = 0;
      sY = (posterImg.naturalHeight - sH) / 2;
    }
    ctx.drawImage(posterImg, sX, sY, sW, sH, frameX, frameY, portraitW, topH);

    // Subtle dark gradient overlay at bottom of poster
    const pGrad = ctx.createLinearGradient(frameX, frameY + topH - 80, frameX, frameY + topH);
    pGrad.addColorStop(0, "rgba(11, 11, 11, 0)");
    pGrad.addColorStop(1, "rgba(11, 11, 11, 0.85)");
    ctx.fillStyle = pGrad;
    ctx.fillRect(frameX, frameY + topH - 80, portraitW, 80);
  } else {
    // Fallback Pixel Mascot
    drawPixelMascot(ctx, frameX + portraitW / 2, frameY + topH / 2 - 20, 3.2, ORANGE);
    ctx.fillStyle = "#FFF";
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.fillText(answer?.title ?? "MOVIE ARCHIVE", frameX + portraitW / 2, frameY + topH / 2 + 50);
  }

  // Rank Pill inside portrait
  const pillW = 100;
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
  ctx.font = 'bold 12px "Courier New", monospace, system-ui';
  ctx.textAlign = "center";
  ctx.fillText(`RANK ${breakdown.rank}`, pillX + pillW / 2, pillY + 17);
  ctx.restore();

  // Vertical border between portrait & ledger
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX + portraitW, frameY);
  ctx.lineTo(frameX + portraitW, frameY + topH);
  ctx.stroke();

  // Right Ledger
  const ledgerX = frameX + portraitW;
  const rowH = Math.round(topH / 6.5);

  const drawLedgerRow = (
    rIdx: number,
    label: string,
    val: string,
    isBrand = false,
    isHighlight = false,
    isMuted = false
  ) => {
    const rY = frameY + (rIdx * rowH);

    if (isBrand) {
      ctx.fillStyle = "rgba(11, 11, 11, 0.05)";
      ctx.fillRect(ledgerX, rY, ledgerW, rowH);
    }
    if (isHighlight) {
      ctx.fillStyle = INK;
      ctx.fillRect(ledgerX, rY, ledgerW, rowH);
    }

    // Bottom border
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(ledgerX, rY + rowH);
    ctx.lineTo(ledgerX + ledgerW, rY + rowH);
    ctx.stroke();

    // Text
    const textY = rY + Math.round(rowH / 2) + 5;
    if (isBrand) {
      ctx.fillStyle = INK;
      ctx.font = 'bold 18px "Courier New", monospace, system-ui';
      ctx.textAlign = "left";
      ctx.fillText(label, ledgerX + 14, textY);
    } else if (rIdx === 1) {
      // Rank Title Subtitle
      ctx.fillStyle = INK;
      ctx.font = 'italic 900 15px system-ui, -apple-system, sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(label.toUpperCase(), ledgerX + 14, textY);
    } else {
      // Normal stat row
      ctx.fillStyle = isHighlight ? ORANGE : isMuted ? "rgba(11,11,11,0.6)" : INK;
      ctx.font = 'italic 700 15px system-ui, -apple-system, sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(label, ledgerX + 14, textY);

      ctx.fillStyle = isHighlight ? ORANGE : INK;
      ctx.font = 'bold 14px "Courier New", monospace, system-ui';
      ctx.textAlign = "right";
      ctx.fillText(val, ledgerX + ledgerW - 14, textY);
    }
  };

  drawLedgerRow(0, "MOVIEGOBLIN ®", "", true);
  drawLedgerRow(1, breakdown.rankTitle, "");
  drawLedgerRow(2, "Base Solve", `+${breakdown.baseScore}`);
  drawLedgerRow(3, `Efficiency (${breakdown.guessCount}g)`, `+${breakdown.efficiencyBonus}`);

  const caseFileBonusVal =
    breakdown.noCaseFileBonus > 0
      ? `+${breakdown.noCaseFileBonus} ★`
      : solved
        ? "+0 (Open)"
        : "+0";
  drawLedgerRow(4, "🔒 Case File", caseFileBonusVal, false, false, breakdown.noCaseFileBonus <= 0);

  // Split Row at bottom: Left stats (No-Clue + Total) & Right circular guess badge
  const splitY = frameY + (5 * rowH);
  const stampBoxW = 76;
  const splitLeftW = ledgerW - stampBoxW;

  // Horizontal divider above split
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(ledgerX, splitY);
  ctx.lineTo(ledgerX + ledgerW, splitY);
  ctx.stroke();

  // Vertical border separating circle stamp
  ctx.beginPath();
  ctx.moveTo(ledgerX + splitLeftW, splitY);
  ctx.lineTo(ledgerX + splitLeftW, frameY + topH);
  ctx.stroke();

  // Left sub-row 1: No-Clue Bonus
  const halfRowH = Math.round((frameY + topH - splitY) / 2);
  const sub1Y = splitY + Math.round(halfRowH / 2) + 4;
  ctx.fillStyle = INK;
  ctx.font = 'italic 700 13.5px system-ui, -apple-system, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("No-Clue Bonus", ledgerX + 12, sub1Y);

  ctx.font = 'bold 13px "Courier New", monospace, system-ui';
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.noClueBonus}`, ledgerX + splitLeftW - 10, sub1Y);

  // Divider between sub-row 1 and sub-row 2
  ctx.beginPath();
  ctx.moveTo(ledgerX, splitY + halfRowH);
  ctx.lineTo(ledgerX + splitLeftW, splitY + halfRowH);
  ctx.stroke();

  // Left sub-row 2: Total Score (Bold)
  const sub2Y = splitY + halfRowH + Math.round(halfRowH / 2) + 4;
  ctx.fillStyle = INK;
  ctx.font = 'italic 900 14px system-ui, -apple-system, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("Total Score", ledgerX + 12, sub2Y);

  ctx.fillStyle = INK;
  ctx.font = 'bold 15px "Courier New", monospace, system-ui';
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.total} PTS`, ledgerX + splitLeftW - 10, sub2Y);

  // Right Compartment: Circular Number Stamp Badge
  const stampCenterX = ledgerX + splitLeftW + stampBoxW / 2;
  const stampCenterY = splitY + (frameY + topH - splitY) / 2;
  const stampRadius = 24;

  ctx.fillStyle = "rgba(255, 248, 240, 1)";
  ctx.beginPath();
  ctx.arc(stampCenterX, stampCenterY, stampRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // Inner ring
  ctx.beginPath();
  ctx.arc(stampCenterX, stampCenterY, stampRadius - 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = 'bold 16px "Courier New", monospace, system-ui';
  ctx.textAlign = "center";
  ctx.fillText(String(breakdown.guessCount).padStart(2, "0"), stampCenterX, stampCenterY + 6);

  // Bottom Tagline Bar
  const tagY = frameY + topH;
  ctx.fillStyle = "#F8D5B8";
  ctx.fillRect(frameX, tagY, frameW, 58);

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX, tagY);
  ctx.lineTo(frameX + frameW, tagY);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = 'italic 600 14px system-ui, -apple-system, sans-serif';
  ctx.textAlign = "center";
  const tagline = solved
    ? `Solved in ${breakdown.guessCount} ${breakdown.guessCount === 1 ? "guess" : "guesses"} with sharp cinema instinct!`
    : "Signal lost today — come back tomorrow for a new film!";
  ctx.fillText(`“${tagline}”`, frameX + frameW / 2, tagY + 34);

  // Outer Footer Watermark
  ctx.fillStyle = INK;
  ctx.font = 'bold 13px "Courier New", monospace, system-ui';
  ctx.textAlign = "center";
  const footerAnswer = answer ? `${answer.title} (${answer.year})` : "DAILY CASE ARCHIVE";
  ctx.fillText(`🎬 ${footerAnswer} · MOVIEGOBLIN.COM`, x + w / 2, y + h - 14);
  ctx.restore();
}

/**
 * Draws the Front Rank Wordmark Card (Side A)
 */
function drawFrontCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: CardImageOptions
) {
  const { breakdown, dateLabel } = opts;
  const INK = "#0B0B0B";
  const ORANGE = "#FF5500";

  ctx.save();
  // Drop Shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, x + 8, y + 8, w, h, 20);
  ctx.fill();

  // Card Surface Gradient
  const cardGrad = ctx.createLinearGradient(x, y, x + w, y + h);
  cardGrad.addColorStop(0, "#FFF9F2");
  cardGrad.addColorStop(0.5, "#FCD7B7");
  cardGrad.addColorStop(1, "#EBB48A");
  ctx.fillStyle = cardGrad;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.fill();

  // Border
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.stroke();

  // Top Meta
  ctx.fillStyle = INK;
  ctx.font = 'bold 15px "Courier New", monospace, system-ui';
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN · COLLECTOR ID", x + 24, y + 38);

  ctx.textAlign = "right";
  ctx.fillText(dateLabel, x + w - 24, y + 38);

  // Decorative Horizontal Dashed Separator
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x + 24, y + 54);
  ctx.lineTo(x + w - 24, y + 54);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center Hero Wordmark
  const heroCenterY = y + (h / 2) - 10;

  // Big Rank Wordmark (Shadow + Fill)
  ctx.font = 'bold 64px "Courier New", monospace, system-ui';
  ctx.textAlign = "center";

  // Shadow
  ctx.fillStyle = INK;
  ctx.fillText(`RANK ${breakdown.rank}®`, x + w / 2 + 5, heroCenterY - 15);
  // Main Fill (Orange with black stroke)
  ctx.fillStyle = ORANGE;
  ctx.fillText(`RANK ${breakdown.rank}®`, x + w / 2, heroCenterY - 20);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.strokeText(`RANK ${breakdown.rank}®`, x + w / 2, heroCenterY - 20);

  // Total Points Wordmark
  ctx.font = 'bold 44px "Courier New", monospace, system-ui';
  ctx.fillStyle = INK;
  ctx.fillText(`${breakdown.total} PTS`, x + w / 2 + 4, heroCenterY + 44);
  ctx.fillStyle = "#FFFBF5";
  ctx.fillText(`${breakdown.total} PTS`, x + w / 2, heroCenterY + 40);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeText(`${breakdown.total} PTS`, x + w / 2, heroCenterY + 40);

  // Decorative Rule
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x + 24, y + h - 70);
  ctx.lineTo(x + w - 24, y + h - 70);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bottom Role Title & Guess Count
  ctx.fillStyle = INK;
  ctx.font = 'italic 900 17px system-ui, -apple-system, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), x + 24, y + h - 34);

  ctx.font = 'bold 15px "Courier New", monospace, system-ui';
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.guessCount} GUESSES`, x + w - 24, y + h - 34);

  ctx.restore();
}

/**
 * Main Generator: Produces a high-res PNG Blob for either the current card face or full 9:16 Instagram Story
 */
export async function generateCardImageBlob(opts: CardImageOptions): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Canvas generation requires browser environment");
  }

  const posterUrl = opts.answer?.poster_url;
  const posterImg = await loadPosterImage(posterUrl);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  const isStory = opts.format === "story";

  if (isStory) {
    // 9:16 Vertical Instagram Story Format (1080 x 1920)
    canvas.width = 1080;
    canvas.height = 1920;

    // Dark Console CRT Background
    ctx.fillStyle = "#080706";
    ctx.fillRect(0, 0, 1080, 1920);

    // Warm radial glow in center
    const bgGlow = ctx.createRadialGradient(540, 960, 100, 540, 960, 800);
    bgGlow.addColorStop(0, "rgba(255, 85, 0, 0.16)");
    bgGlow.addColorStop(1, "rgba(8, 7, 6, 0)");
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, 1080, 1920);

    // Subtle CRT Scanline overlay
    ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
    for (let y = 0; y < 1920; y += 8) {
      ctx.fillRect(0, y, 1080, 4);
    }

    // Top Story Header
    ctx.fillStyle = "#FF5500";
    ctx.font = 'bold 36px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.fillText("MOVIEGOBLIN DAILY", 540, 130);

    ctx.fillStyle = "#FDE3CF";
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText(`OFFICIAL CASE ARCHIVE // ${opts.dateLabel}`, 540, 175);

    // Upper Card: Side A (Front Hero Badge) - Width 920, Height 430
    drawFrontCard(ctx, 80, 230, 920, 430, opts);

    // Lower Card: Side B (Back Specification Ledger) - Width 920, Height 980
    drawBackCard(ctx, 80, 710, 920, 980, opts, posterImg);

    // Bottom Story Footer Call-To-Action
    ctx.fillStyle = "#FF5500";
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.fillText("CAN YOU GUESS TODAY'S MOVIE?", 540, 1780);

    ctx.fillStyle = "rgba(253, 227, 207, 0.85)";
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText("PLAY AT MOVIEGOBLIN.COM · #MovieGoblin", 540, 1825);
  } else {
    // Standalone Card Image (Current Face)
    if (opts.flipped) {
      // Back Face
      canvas.width = 720;
      canvas.height = 860;
      // Transparent background so card floats cleanly on stickers or stories
      drawBackCard(ctx, 20, 20, 680, 810, opts, posterImg);
    } else {
      // Front Face
      canvas.width = 720;
      canvas.height = 460;
      drawFrontCard(ctx, 20, 20, 680, 410, opts);
    }
  }

  // Convert to Blob with safety fallback if CORS tainted
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create blob from canvas"));
      }, "image/png");
    });
  } catch {
    // If remote poster caused CORS canvas tainting, retry without the remote image
    if (posterImg) {
      return generateCardImageBlob({
        ...opts,
        answer: opts.answer ? { ...opts.answer, poster_url: undefined } : undefined,
      });
    }
    throw new Error("Canvas export failed");
  }
}

/**
 * Copies the card PNG image directly to the system clipboard
 */
export async function copyCardImageToClipboard(opts: CardImageOptions): Promise<boolean> {
  try {
    const blob = await generateCardImageBlob(opts);
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
 * Direct file download trigger
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
 * Native OS Share Sheet (opens Instagram Stories, WhatsApp, Twitter, Save Image, etc.)
 */
export async function shareCardImage(
  opts: CardImageOptions
): Promise<"shared" | "copied" | "downloaded"> {
  const blob = await generateCardImageBlob(opts);
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
        return "shared"; // User cancelled share sheet
      }
    }
  }

  // Fallback 1: Try copying image blob to clipboard
  const copied = await copyCardImageToClipboard(opts);
  if (copied) return "copied";

  // Fallback 2: Download the PNG file
  downloadCardImage(blob, fileName);
  return "downloaded";
}
