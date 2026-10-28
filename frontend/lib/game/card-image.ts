// ─────────────────────────────────────────────────────────────────────────────
// MOVIEGOBLIN - Retro Collector Score Card Showcase Image Generator
// Generates the authentic 1080x1080 Retro Starfield Duo Card Showcase (Image 2)
// Featuring both Side A (Front Rank Badge) and Side B (Back Specification Ledger with Poster)
// ─────────────────────────────────────────────────────────────────────────────

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
  timeLabel?: string;
  flipped?: boolean;
  solved: boolean;
  format?: "sticker" | "duo";
}

// Pseudo-random deterministic number generator seeded by string
function pseudoRandom(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

// Safely loads poster image without tainting the canvas
async function getSafePosterImage(url?: string): Promise<CanvasImageSource | null> {
  if (!url || typeof window === "undefined") return null;

  // 1. Try DOM element if already present and complete
  if (typeof document !== "undefined") {
    const domImg = document.querySelector(".mg-sc-portrait-img") as HTMLImageElement | null;
    if (domImg && domImg.complete && domImg.naturalWidth > 0) {
      try {
        // Test if domImg is clean by drawing to a 1x1 test canvas
        const testCanvas = document.createElement("canvas");
        testCanvas.width = 1;
        testCanvas.height = 1;
        const testCtx = testCanvas.getContext("2d");
        if (testCtx) {
          testCtx.drawImage(domImg, 0, 0, 1, 1);
          testCanvas.toDataURL(); // Throws if tainted
          return domImg;
        }
      } catch {
        // tainted, fall through to fetch blob
      }
    }
  }

  // 2. Try fetching as blob to create safe same-origin ObjectURL
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = blobUrl;
      });
      return img;
    }
  } catch {
    // CORS fetch failed, fall through to Image crossOrigin
  }

  // 3. Fallback standard Image crossOrigin loader
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 2500);
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
 * Draws the Starfield Cosmic Retro CRT Background
 */
function drawCosmicStarfield(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string) {
  // Deep black void
  ctx.fillStyle = "#020202";
  ctx.fillRect(0, 0, w, h);

  const rand = pseudoRandom(seed || "moviegoblin");

  // Scatter ~140 pixel stars
  for (let i = 0; i < 140; i++) {
    const sx = Math.floor(rand() * w);
    const sy = Math.floor(rand() * h);
    const alpha = 0.35 + rand() * 0.6;
    const size = rand() > 0.85 ? 3 : rand() > 0.5 ? 2 : 1;

    ctx.fillStyle = rand() > 0.8 ? `rgba(255, 230, 200, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(sx, sy, size, size);

    // Cross twinkle on rare stars
    if (rand() > 0.94) {
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.75})`;
      ctx.fillRect(sx - 3, sy + 1, 7, 1);
      ctx.fillRect(sx + 1, sy - 3, 1, 7);
    }
  }
}

/**
 * Generates the 1080x1080 Retro Starfield Duo Showcase (Matching Image 2)
 */
export async function generateCollectorShowcaseBlob(opts: CardImageOptions): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Canvas generation requires browser environment");
  }

  // Ensure fonts are ready
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }

  // Resolve poster URL
  const posterUrl =
    opts.answer?.poster_url ||
    (opts.answer ? findLocalPoster(opts.answer.title, opts.answer.year) : undefined);
  const posterImg = await getSafePosterImage(posterUrl);

  const canvas = document.createElement("canvas");
  const W = 1080;
  const H = 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  const { breakdown, answer, dateLabel, solved } = opts;
  const INK = "#000000";
  const ORANGE = "#FF5500";
  const PIXEL_FONT = '"Press Start 2P", monospace, system-ui';
  const SANS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // ── 1. Cosmic Pixel Starfield Background ──
  drawCosmicStarfield(ctx, W, H, `${answer?.title ?? "movie"}-${dateLabel}`);

  // ── 2. Top Card: Side A (Front Rank Badge) ──
  const cardW = 860;
  const topCardH = 360;
  const cardX = (W - cardW) / 2; // 110px
  const topCardY = 70;

  // Solid black drop shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, cardX + 6, topCardY + 6, cardW, topCardH, 16);
  ctx.fill();

  // Card surface gradient
  const topGrad = ctx.createLinearGradient(cardX, topCardY, cardX + cardW, topCardY + topCardH);
  topGrad.addColorStop(0, "#FFF6ED");
  topGrad.addColorStop(0.45, "#FCD7B7");
  topGrad.addColorStop(1, "#EBB48A");
  ctx.fillStyle = topGrad;
  drawRoundedRect(ctx, cardX, topCardY, cardW, topCardH, 16);
  ctx.fill();

  // Border
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, cardX, topCardY, cardW, topCardH, 16);
  ctx.stroke();

  // Top Card Header
  ctx.fillStyle = INK;
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN · COLLECTOR ID", cardX + 28, topCardY + 36);

  ctx.textAlign = "right";
  ctx.fillText(dateLabel, cardX + cardW - 28, topCardY + 36);

  // Top Dashed Divider
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cardX + 26, topCardY + 54);
  ctx.lineTo(cardX + cardW - 26, topCardY + 54);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center Hero Wordmark
  const topCenterY = topCardY + 185;

  // Line 1: RANK <X>® (Chunky Orange Pixel with Black 3D Extrusion)
  const rankText = `RANK ${breakdown.rank}®`;
  ctx.font = `bold 48px ${PIXEL_FONT}`;
  ctx.textAlign = "center";

  // Black 3D Shadow
  ctx.fillStyle = INK;
  ctx.fillText(rankText, cardX + cardW / 2 + 5, topCenterY - 22 + 5);
  // Orange Fill
  ctx.fillStyle = ORANGE;
  ctx.fillText(rankText, cardX + cardW / 2, topCenterY - 22);
  // Black Stroke
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.strokeText(rankText, cardX + cardW / 2, topCenterY - 22);

  // Line 2: <TOTAL> PTS (Crisp White Pixel with Black 3D Shadow)
  const ptsText = `${breakdown.total} PTS`;
  ctx.font = `bold 38px ${PIXEL_FONT}`;

  // Black 3D Shadow
  ctx.fillStyle = INK;
  ctx.fillText(ptsText, cardX + cardW / 2 + 4, topCenterY + 40 + 4);
  // White Fill
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(ptsText, cardX + cardW / 2, topCenterY + 40);
  // Black Stroke
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.strokeText(ptsText, cardX + cardW / 2, topCenterY + 40);

  // Bottom Dashed Divider
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cardX + 26, topCardY + topCardH - 58);
  ctx.lineTo(cardX + cardW - 26, topCardY + topCardH - 58);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bottom Card Meta
  ctx.fillStyle = INK;
  ctx.font = `italic 900 17px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), cardX + 28, topCardY + topCardH - 24);

  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.guessCount} GUESSES`, cardX + cardW - 28, topCardY + topCardH - 24);

  // ── 3. Bottom Card: Side B (Back Specification Ledger with Poster) ──
  const botCardH = 550;
  const botCardY = 465;

  // Solid black drop shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, cardX + 6, botCardY + 6, cardW, botCardH, 16);
  ctx.fill();

  // Card surface gradient
  const botGrad = ctx.createLinearGradient(cardX, botCardY, cardX + cardW, botCardY + botCardH);
  botGrad.addColorStop(0, "#FFF6ED");
  botGrad.addColorStop(0.45, "#FCD7B7");
  botGrad.addColorStop(1, "#EBB48A");
  ctx.fillStyle = botGrad;
  drawRoundedRect(ctx, cardX, botCardY, cardW, botCardH, 16);
  ctx.fill();

  // Outer Border
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, cardX, botCardY, cardW, botCardH, 16);
  ctx.stroke();

  // Inner Framed Box
  const framePad = 12;
  const frameX = cardX + framePad;
  const frameY = botCardY + framePad;
  const frameW = cardW - framePad * 2; // 836px
  const frameH = botCardH - framePad * 2; // 526px

  ctx.fillStyle = "rgba(255, 248, 240, 0.88)";
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 10);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 10);
  ctx.stroke();

  // Clip content inside inner frame
  ctx.save();
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 10);
  ctx.clip();

  // Frame layout: Top section (Portrait + Ledger) & Bottom Tagline bar
  const taglineH = 54;
  const topH = frameH - taglineH;
  const portraitW = 290;
  const ledgerW = frameW - portraitW;

  // Left Portrait Box
  ctx.fillStyle = "#0B0B0B";
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
      // fallback
    }
  }

  // Portrait bottom pill badge: RANK <X>
  const pillW = 124;
  const pillH = 30;
  const pillX = frameX + (portraitW - pillW) / 2;
  const pillY = frameY + topH - 42;

  ctx.fillStyle = "rgba(11, 11, 11, 0.95)";
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ORANGE;
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6);
  ctx.stroke();

  ctx.fillStyle = ORANGE;
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`RANK ${breakdown.rank}`, pillX + pillW / 2, pillY + 19);

  // Vertical divider between portrait and ledger
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX + portraitW, frameY);
  ctx.lineTo(frameX + portraitW, frameY + topH);
  ctx.stroke();

  // Right Specification Ledger
  const ledgerX = frameX + portraitW;
  const rowH = Math.round(topH / 5.8);

  // Row 1: MOVIEGOBLIN ®
  ctx.fillStyle = "rgba(11, 11, 11, 0.05)";
  ctx.fillRect(ledgerX, frameY, ledgerW, rowH);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(ledgerX, frameY + rowH);
  ctx.lineTo(ledgerX + ledgerW, frameY + rowH);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `bold 15px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN ®", ledgerX + 16, frameY + rowH / 2 + 5);

  // Row 2: APEX ORACLE
  const r2Y = frameY + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r2Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r2Y + rowH);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `italic 900 15px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), ledgerX + 16, r2Y + rowH / 2 + 5);

  // Row 3: Base Solve +500
  const r3Y = r2Y + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r3Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r3Y + rowH);
  ctx.stroke();

  ctx.font = `italic 700 16px ${SANS_FONT}`;
  ctx.fillText("Base Solve", ledgerX + 16, r3Y + rowH / 2 + 6);
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.baseScore}`, ledgerX + ledgerW - 16, r3Y + rowH / 2 + 5);

  // Row 4: Efficiency (1g) +500
  const r4Y = r3Y + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r4Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r4Y + rowH);
  ctx.stroke();

  ctx.font = `italic 700 16px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`Efficiency (${breakdown.guessCount}g)`, ledgerX + 16, r4Y + rowH / 2 + 6);
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.efficiencyBonus}`, ledgerX + ledgerW - 16, r4Y + rowH / 2 + 5);

  // Row 5: 🔒 Case File +300 ★ (SOLID BLACK BAR WITH ORANGE TEXT WHEN BONUS!)
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
  ctx.font = `italic 700 16px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("🔒 Case File", ledgerX + 16, r5Y + rowH / 2 + 6);

  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  const caseVal = isCaseBonus ? `+${breakdown.noCaseFileBonus} ★` : solved ? "+0 (Open)" : "+0";
  ctx.fillText(caseVal, ledgerX + ledgerW - 16, r5Y + rowH / 2 + 5);

  // Row 6: Split Bottom (Left: No-Clue + Total; Right: Circular Guess Badge)
  const splitY = r5Y + rowH;
  const stampBoxW = 92;
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
  ctx.font = `italic 700 15px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("No-Clue Bonus", ledgerX + 16, splitY + halfSplitH / 2 + 5);
  ctx.font = `bold 11px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.noClueBonus}`, ledgerX + splitLeftW - 14, splitY + halfSplitH / 2 + 4);

  // Divider between sub-row A and sub-row B
  ctx.beginPath();
  ctx.moveTo(ledgerX, splitY + halfSplitH);
  ctx.lineTo(ledgerX + splitLeftW, splitY + halfSplitH);
  ctx.stroke();

  // Sub-row B: Total Score (Bold)
  ctx.font = `italic 900 16px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Total Score", ledgerX + 16, splitY + halfSplitH + halfSplitH / 2 + 5);
  ctx.font = `bold 13px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.total} PTS`, ledgerX + splitLeftW - 14, splitY + halfSplitH + halfSplitH / 2 + 4);

  // Circular Guess Stamp Badge
  const stampCX = ledgerX + splitLeftW + stampBoxW / 2;
  const stampCY = splitY + splitH / 2;
  const sRadius = 26;

  ctx.fillStyle = "rgba(255, 248, 240, 1)";
  ctx.beginPath();
  ctx.arc(stampCX, stampCY, sRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(stampCX, stampCY, sRadius - 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `bold 14px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(String(breakdown.guessCount).padStart(2, "0"), stampCX, stampCY + 5);

  // ── Bottom Full-Width Tagline Bar ──
  const tagY = frameY + topH;
  ctx.fillStyle = "rgba(253, 227, 207, 0.7)";
  ctx.fillRect(frameX, tagY, frameW, taglineH);

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX, tagY);
  ctx.lineTo(frameX + frameW, tagY);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `italic 700 14px ${SANS_FONT}`;
  ctx.textAlign = "center";
  const tagline = solved
    ? `Solved in ${breakdown.guessCount} ${breakdown.guessCount === 1 ? "guess" : "guesses"} with sharp cinema instinct!`
    : "Signal lost today — come back tomorrow for a new film!";
  ctx.fillText(`“${tagline}”`, frameX + frameW / 2, tagY + taglineH / 2 + 5);

  ctx.restore();

  // Convert to Blob
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export canvas to PNG blob"));
    }, "image/png");
  });
}

/**
 * Draws the 16x16 pixel TNT block on Canvas at (cx, cy)
 */
function drawCanvasPixelTnt(ctx: CanvasRenderingContext2D, cx: number, cy: number, pSize: number) {
  const startX = cx - (16 * pSize) / 2;
  const startY = cy - (16 * pSize) / 2;

  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(startX + x * pSize, startY + y * pSize, w * pSize, h * pSize);
  };

  // Black outline
  rect(3, 3, 10, 11, "#111111");
  // Fuse & Spark
  rect(7, 1, 2, 2, "#4A3B32");
  rect(9, 0, 2, 2, "#FFD600");
  rect(10, 1, 1, 1, "#FF5500");
  // Top Red Dynamite
  rect(4, 4, 8, 3, "#E52521");
  rect(5, 4, 1, 3, "#FF6B6B");
  rect(8, 4, 1, 3, "#B71C1C");
  // White TNT Center Band
  rect(4, 7, 8, 3, "#F8F8F8");
  // Pixel "TNT" Glyphs
  rect(5, 8, 1, 2, "#111111");
  rect(7, 8, 2, 2, "#111111");
  rect(10, 8, 1, 2, "#111111");
  // Bottom Red Dynamite
  rect(4, 10, 8, 3, "#D32F2F");
  rect(5, 10, 1, 3, "#FF6B6B");
  rect(8, 10, 1, 3, "#9A0007");
}

/**
 * Draws the 16x16 pixel Diamond Sword on Canvas at (cx, cy)
 */
function drawCanvasPixelSword(ctx: CanvasRenderingContext2D, cx: number, cy: number, pSize: number) {
  const startX = cx - (16 * pSize) / 2;
  const startY = cy - (16 * pSize) / 2;

  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(startX + x * pSize, startY + y * pSize, w * pSize, h * pSize);
  };

  // Cyan Diamond Blade
  rect(11, 2, 3, 3, "#00E5FF");
  rect(9, 4, 3, 3, "#00E5FF");
  rect(7, 6, 3, 3, "#00E5FF");
  rect(5, 8, 3, 3, "#00B8D4");
  // Blade Highlight
  rect(12, 2, 1, 1, "#E0FFFF");
  rect(10, 4, 1, 1, "#E0FFFF");
  rect(8, 6, 1, 1, "#E0FFFF");
  // Crossguard
  rect(3, 8, 2, 2, "#00838F");
  rect(6, 11, 2, 2, "#00838F");
  rect(4, 9, 3, 3, "#26C6DA");
  // Wood Hilt & Gold Pommel
  rect(3, 11, 2, 2, "#6D4C41");
  rect(2, 12, 2, 2, "#FFD600");
}

/**
 * Draws a Die-Cut Sticker Container on Canvas with authentic white contour and dark 3D drop shadow
 */
function drawDieCutStickerBase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 16,
  bgColor = "#161210"
) {
  // 1. Dark 3D Drop Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  drawRoundedRect(ctx, x + 5, y + 6, w, h, radius);
  ctx.fill();

  // 2. White Die-Cut Contour Outer Edge
  ctx.fillStyle = "#FFFFFF";
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fill();

  // 3. Black Inner Stroke
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "#000000";
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.stroke();

  // 4. Inner Surface
  ctx.fillStyle = bgColor;
  drawRoundedRect(ctx, x + 4, y + 4, w - 8, h - 8, radius - 3);
  ctx.fill();
}

/**
 * Generates the authentic 1080x1080 Arcade Die-Cut Sticker Deck Showcase Image
 * Features Date & Time, Site Branding, Solved Movie Dossier, the 4 Die-Cut Stickers, and Telemetry Rows!
 */
export async function generateStickerDeckBlob(opts: CardImageOptions): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Canvas generation requires browser environment");
  }

  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }

  const posterUrl =
    opts.answer?.poster_url ||
    (opts.answer ? findLocalPoster(opts.answer.title, opts.answer.year) : undefined);
  const posterImg = await getSafePosterImage(posterUrl);

  const canvas = document.createElement("canvas");
  const W = 1080;
  const H = 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  const { breakdown, answer, dateLabel, timeLabel, solved } = opts;
  const PIXEL_FONT = '"Press Start 2P", monospace, system-ui';
  const SANS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // ── 1. Dark Retro Arcade Console Background ──
  ctx.fillStyle = "#0E0B09";
  ctx.fillRect(0, 0, W, H);

  // Subtle warm radial corner glow
  const glow = ctx.createRadialGradient(W / 2, 200, 50, W / 2, 200, 750);
  glow.addColorStop(0, "rgba(255, 85, 0, 0.12)");
  glow.addColorStop(0.6, "rgba(255, 85, 0, 0.03)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Dotted Matrix Pegboard Pattern
  ctx.fillStyle = "rgba(253, 227, 207, 0.08)";
  for (let px = 24; px < W; px += 24) {
    for (let py = 24; py < H; py += 24) {
      ctx.fillRect(px, py, 2, 2);
    }
  }

  // Double Neo-Brutalist Outer Frame
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#FF5500";
  ctx.strokeRect(16, 16, W - 32, H - 32);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(253, 227, 207, 0.35)";
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // ── 2. Top Header Bar: Branding + Date/Time Stamp ──
  const barY = 56;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 22px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("★ MOVIEGOBLIN", 46, barY);

  ctx.fillStyle = "#FF5500";
  ctx.font = `bold 10px ${PIXEL_FONT}`;
  ctx.fillText("MOVIE-GOBLIN.VERCEL.APP // ARCADE TELEMETRY", 46, barY + 22);

  // Date and Time (Right side)
  const fullDateTime = timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;
  ctx.fillStyle = "rgba(253, 227, 207, 0.92)";
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(fullDateTime.toUpperCase(), W - 46, barY);

  // Status Indicator
  ctx.fillStyle = solved ? "#38ef7d" : "#FF5500";
  ctx.beginPath();
  ctx.arc(W - 46 - ctx.measureText(fullDateTime.toUpperCase()).width - 16, barY - 4, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(253, 227, 207, 0.65)";
  ctx.font = `bold 9.5px ${PIXEL_FONT}`;
  ctx.fillText(solved ? "AUTHENTICATED SOLVE ●" : "TERMINATED CASE ●", W - 46, barY + 22);

  // Top Divider
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(253, 227, 207, 0.3)";
  ctx.beginPath();
  ctx.moveTo(46, 96);
  ctx.lineTo(W - 46, 96);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── 3. Solved Movie Dossier Card ──
  const dosX = 46;
  const dosY = 114;
  const dosW = W - 92;
  const dosH = 176;

  // Dossier Drop Shadow
  ctx.fillStyle = "#000000";
  drawRoundedRect(ctx, dosX + 5, dosY + 5, dosW, dosH, 14);
  ctx.fill();

  // Dossier Surface
  ctx.fillStyle = "#FFF7EE";
  drawRoundedRect(ctx, dosX, dosY, dosW, dosH, 14);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#000000";
  drawRoundedRect(ctx, dosX, dosY, dosW, dosH, 14);
  ctx.stroke();

  // Poster Thumbnail (Left)
  const postW = 98;
  const postH = 144;
  const postX = dosX + 16;
  const postY = dosY + 16;

  ctx.fillStyle = "#120E0C";
  drawRoundedRect(ctx, postX + 3, postY + 3, postW, postH, 8);
  ctx.fill();

  ctx.save();
  drawRoundedRect(ctx, postX, postY, postW, postH, 8);
  ctx.clip();
  if (posterImg) {
    ctx.drawImage(posterImg, postX, postY, postW, postH);
  } else {
    ctx.fillStyle = "#161210";
    ctx.fillRect(postX, postY, postW, postH);
    ctx.fillStyle = "#FF5500";
    ctx.font = `bold 28px ${SANS_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("🎬", postX + postW / 2, postY + postH / 2 + 10);
  }
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#000000";
  drawRoundedRect(ctx, postX, postY, postW, postH, 8);
  ctx.stroke();

  // Dossier Info (Right)
  const infoX = postX + postW + 20;
  const movieTitle = answer?.title || "Unknown Film";
  const movieYear = answer?.year ? `(${answer.year})` : "";

  ctx.fillStyle = "#000000";
  ctx.font = `bold 27px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`${movieTitle} ${movieYear}`, infoX, dosY + 44);

  // Metadata pills
  const decade = answer?.year ? `${Math.floor(answer.year / 10) * 10}s ERA` : null;
  const pills = [
    answer?.language ? answer.language.toUpperCase() : null,
    answer?.runtime ? `${answer.runtime} MIN` : null,
    decade,
  ].filter(Boolean) as string[];

  let pillX = infoX;
  const pillY = dosY + 58;
  for (const pill of pills) {
    ctx.font = `bold 8.5px ${PIXEL_FONT}`;
    const pW = ctx.measureText(pill).width + 16;
    ctx.fillStyle = "#000000";
    drawRoundedRect(ctx, pillX, pillY, pW, 20, 5);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(pill, pillX + 8, pillY + 14);
    pillX += pW + 8;
  }

  // Movie Facts 2-column strip
  ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
  ctx.font = `600 14px ${SANS_FONT}`;
  if (answer?.director) {
    ctx.fillText(`Director: ${answer.director}`, infoX, dosY + 106);
  }
  if (answer?.cast?.length) {
    const castLine = `Starring: ${answer.cast.slice(0, 4).join(", ")}`;
    ctx.fillText(castLine.length > 58 ? castLine.slice(0, 55) + "..." : castLine, infoX, dosY + 130);
  }
  if (answer?.genres?.length) {
    ctx.fillText(`Genre: ${answer.genres.join(" · ")}`, infoX, dosY + 154);
  }

  // ── 4. Main Arcade Die-Cut Sticker Deck ──
  const deckX = 46;
  const deckY = 312;
  const deckW = W - 92;
  const deckH = 680;

  // Deck Shadow
  ctx.fillStyle = "#000000";
  drawRoundedRect(ctx, deckX + 6, deckY + 6, deckW, deckH, 16);
  ctx.fill();

  // Deck Surface (Pegboard Mat)
  const deckGrad = ctx.createLinearGradient(deckX, deckY, deckX, deckY + deckH);
  deckGrad.addColorStop(0, "#191412");
  deckGrad.addColorStop(1, "#271E1A");
  ctx.fillStyle = deckGrad;
  drawRoundedRect(ctx, deckX, deckY, deckW, deckH, 16);
  ctx.fill();

  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "#000000";
  drawRoundedRect(ctx, deckX, deckY, deckW, deckH, 16);
  ctx.stroke();

  // Deck Header Bar
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("★ ARCADE STICKER DECK // CASE TELEMETRY", deckX + 22, deckY + 38);

  // Status Badge
  const statusText = solved ? `RESPECT +${breakdown.total} PTS` : "STATUS: GAME OVER";
  ctx.font = `bold 11px ${PIXEL_FONT}`;
  const statW = ctx.measureText(statusText).width + 20;
  const statX = deckX + deckW - statW - 22;
  ctx.fillStyle = "rgba(255, 85, 0, 0.22)";
  drawRoundedRect(ctx, statX, deckY + 20, statW, 26, 6);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#FF5500";
  drawRoundedRect(ctx, statX, deckY + 20, statW, 26, 6);
  ctx.stroke();

  ctx.fillStyle = "#FF5500";
  ctx.fillText(statusText, statX + 10, deckY + 38);

  // Divider
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(253, 227, 207, 0.24)";
  ctx.beginPath();
  ctx.moveTo(deckX + 22, deckY + 58);
  ctx.lineTo(deckX + deckW - 22, deckY + 58);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── 5. The 4 Die-Cut Stickers in 2x2 Grid (Matching Screenshot) ──
  const gridGap = 18;
  const stkW = (deckW - 44 - gridGap) / 2; // ~460px
  const stkH = 146;

  const col1X = deckX + 22;
  const col2X = col1X + stkW + gridGap;
  const row1Y = deckY + 76;
  const row2Y = row1Y + stkH + gridGap;

  // ── Sticker 1 (Top Left): GTA "MISSION PASSED! RESPECT +" or "GAME OVER" ──
  drawDieCutStickerBase(ctx, col1X, row1Y, stkW, stkH, 16, "#140F0D");

  if (solved) {
    ctx.textAlign = "center";
    ctx.font = `900 28px ${SANS_FONT}`;
    // Black 3D Text Outline
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000000";
    ctx.strokeText("MISSION PASSED!", col1X + stkW / 2, row1Y + 62);
    ctx.fillStyle = "#FF9D00";
    ctx.fillText("MISSION PASSED!", col1X + stkW / 2, row1Y + 62);

    ctx.font = `900 30px ${SANS_FONT}`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000000";
    ctx.strokeText("RESPECT +", col1X + stkW / 2, row1Y + 108);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("RESPECT +", col1X + stkW / 2, row1Y + 108);
  } else {
    ctx.textAlign = "center";
    ctx.font = `bold 24px ${PIXEL_FONT}`;
    ctx.fillStyle = "#FFE600";
    ctx.fillText("GAME", col1X + stkW / 2, row1Y + 60);
    ctx.fillStyle = "#FF2233";
    ctx.fillText("OVER", col1X + stkW / 2, row1Y + 104);
  }

  // ── Sticker 2 (Top Right): "+1000 AURA" 8-Bit Pixel Die-Cut Sticker ──
  drawDieCutStickerBase(ctx, col2X, row1Y, stkW, stkH, 16, "#FFFFFF");

  const auraPoints = solved ? `+${breakdown.total}` : "+000";
  ctx.textAlign = "center";
  ctx.font = `bold 28px ${PIXEL_FONT}`;
  ctx.fillStyle = "#0B0B0B";
  ctx.fillText(auraPoints, col2X + stkW / 2, row1Y + 62);

  // Pixel AURA in golden yellow with black stroke
  ctx.font = `bold 30px ${PIXEL_FONT}`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#0B0B0B";
  ctx.strokeText("AURA", col2X + stkW / 2, row1Y + 112);
  ctx.fillStyle = "#FFB800";
  ctx.fillText("AURA", col2X + stkW / 2, row1Y + 112);

  // ── Sticker 3 (Bottom Left): 8-Bit Blocky TNT Block Die-Cut Sticker ──
  drawDieCutStickerBase(ctx, col1X, row2Y, stkW, stkH, 16, "#1A1513");
  drawCanvasPixelTnt(ctx, col1X + stkW / 2, row2Y + 54, 4.2);

  ctx.textAlign = "center";
  ctx.font = `bold 13px ${PIXEL_FONT}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(solved ? "MIND BLOWN" : "DETONATED", col1X + stkW / 2, row2Y + 124);

  // ── Sticker 4 (Bottom Right): 8-Bit Blocky Diamond Sword Die-Cut Sticker ──
  drawDieCutStickerBase(ctx, col2X, row2Y, stkW, stkH, 16, "#1A1513");
  drawCanvasPixelSword(ctx, col2X + stkW / 2, row2Y + 54, 4.2);

  const swordLabel = !solved
    ? "BROKEN BLADE"
    : breakdown.guessCount === 1
      ? "1-SHOT SLAYER"
      : breakdown.guessCount <= 3
        ? "DIAMOND EDGE"
        : "LOOT CLAIMED";

  ctx.textAlign = "center";
  ctx.font = `bold 13px ${PIXEL_FONT}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(swordLabel, col2X + stkW / 2, row2Y + 124);

  // ── 6. 3-Row Telemetry Drawer (Exact Match to Screenshot) ──
  const telemY = row2Y + stkH + 20;
  const telemW = deckW - 44;
  const rowH = 46;
  const rowGap = 9;

  const speedBadge = !solved
    ? "💀 SIGNAL LOST"
    : breakdown.guessCount === 1
      ? "⚡ FIRST-TRY SNIPE"
      : breakdown.guessCount <= 3
        ? "🔥 SHARP DETECTIVE"
        : breakdown.guessCount <= 6
          ? "🎬 TACTICAL SOLVE"
          : "🛡️ CLUTCH RECOVERY";

  const protocolBadge = !solved
    ? "⚠️ DOSSIER FORFEIT"
    : breakdown.noCaseFileBonus > 0
      ? "🔒 PURE INSTINCT (+300)"
      : breakdown.cluesUsed === 0
        ? "📂 CASE FILE OPENED"
        : `🔍 ${breakdown.cluesUsed} CLUES DECRYPTED`;

  const rankBadge = `🏆 RANK ${breakdown.rank} · ${breakdown.rankTitle}`;

  const telemetryRows = [
    { key: "SOLVE SPEED", val: speedBadge },
    { key: "CASE PROTOCOL", val: protocolBadge },
    { key: "ARCHIVE RANK", val: rankBadge },
  ];

  telemetryRows.forEach((row, idx) => {
    const curY = telemY + idx * (rowH + rowGap);
    ctx.fillStyle = "rgba(253, 227, 207, 0.08)";
    drawRoundedRect(ctx, col1X, curY, telemW, rowH, 8);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(253, 227, 207, 0.2)";
    drawRoundedRect(ctx, col1X, curY, telemW, rowH, 8);
    ctx.stroke();

    ctx.fillStyle = "rgba(253, 227, 207, 0.65)";
    ctx.font = `bold 10px ${PIXEL_FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(row.key, col1X + 16, curY + 28);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 16px ${SANS_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(row.val, col1X + telemW - 16, curY + 29);
  });

  // ── 7. Branded Footer Watermark ──
  ctx.fillStyle = "#FF5500";
  ctx.font = `bold 11.5px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(
    "★ PLAY DAILY AT MOVIE-GOBLIN.VERCEL.APP · CINEMA DETECTIVE DECK ★",
    W / 2,
    deckY + deckH + 42
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export sticker deck canvas to PNG blob"));
    }, "image/png");
  });
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
 * Copies the card PNG image directly to system clipboard.
 */
export async function copyCardImageToClipboard(opts: CardImageOptions): Promise<boolean> {
  try {
    const blob =
      opts.format === "duo"
        ? await generateCollectorShowcaseBlob(opts)
        : await generateStickerDeckBlob(opts);
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      downloadCardImage(blob, `MovieGoblin-${opts.dateLabel}-${opts.format || "StickerDeck"}.png`);
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
 * Opens Native OS Share Sheet with the card image.
 */
export async function shareCardImage(
  opts: CardImageOptions
): Promise<"shared" | "copied" | "downloaded"> {
  const blob =
    opts.format === "duo"
      ? await generateCollectorShowcaseBlob(opts)
      : await generateStickerDeckBlob(opts);
  const fileName = `MovieGoblin-${opts.dateLabel}-${opts.format || "StickerDeck"}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  const shareData = {
    files: [file],
    title: "MovieGoblin Arcade Sticker Deck",
    text: `I solved today's MovieGoblin in ${opts.breakdown.guessCount} ${
      opts.breakdown.guessCount === 1 ? "guess" : "guesses"
    }! [Rank ${opts.breakdown.rank} · ${opts.breakdown.total} PTS] 🎬 Play at https://movie-goblin.vercel.app`,
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
  const copied = await copyCardImageToClipboard(opts);
  if (copied) return "copied";

  // Fallback 2: Download PNG directly
  downloadCardImage(blob, fileName);
  return "downloaded";
}
