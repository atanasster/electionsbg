// Composed per-candidate OG card. Replaces the bare parliament.bg headshot
// (or the generic site image) that candidate pages used to advertise to
// social crawlers — a name + party + result-tile card converts far better
// when a candidate page is shared on Facebook / Telegram, which is how these
// pages spread.
//
// 1200x630, webp. Layout: party-ringed photo (or initials placeholder) on the
// left, name + role/party on the right, up to three result tiles below.

import fs from "node:fs";
import {
  createCanvas,
  loadImage,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  W,
  H,
  PALETTE,
  FONT_STACK,
  drawTile,
  drawFooter,
  type Tile,
} from "./cardRenderer";
import { formatElectionDateBg, type CandidateCardData } from "./candidateData";

const formatThousands = (n: number): string =>
  n.toLocaleString("bg-BG").replace(/\s/g, ",");

const ROLE_LABEL: Record<CandidateCardData["role"], string> = {
  current_mp: "Народен представител",
  former_mp: "Бивш народен представител",
  candidate: "Кандидат за народен представител",
};

// First + last initial — used for the placeholder circle when an MP photo
// isn't on disk (every non-MP candidate, plus MPs the scraper hasn't reached).
const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const PHOTO_SIZE = 200;
const PHOTO_X = 60;
const PHOTO_Y = 44;

// Decodes the MP photo if one is on disk. @napi-rs/canvas only draws images
// loaded through the async loadImage() path — assigning a Buffer to
// Image.src sets the dimensions but draws nothing.
const loadPhoto = async (card: CandidateCardData): Promise<Image | null> => {
  if (!card.mp?.photoPath) return null;
  try {
    const img = await loadImage(fs.readFileSync(card.mp.photoPath));
    return img.width && img.height ? img : null;
  } catch {
    return null;
  }
};

const drawPhoto = (
  ctx: SKRSContext2D,
  card: CandidateCardData,
  ringColor: string,
  img: Image | null,
): void => {
  const cx = PHOTO_X + PHOTO_SIZE / 2;
  const cy = PHOTO_Y + PHOTO_SIZE / 2;

  // Party-colour ring behind the portrait.
  ctx.beginPath();
  ctx.arc(cx, cy, PHOTO_SIZE / 2 + 6, 0, Math.PI * 2);
  ctx.fillStyle = ringColor;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, PHOTO_SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    // cover-fit: scale so the shorter side fills the circle, crop the rest
    const ar = img.width / img.height;
    let dw = PHOTO_SIZE;
    let dh = PHOTO_SIZE;
    let dx = PHOTO_X;
    let dy = PHOTO_Y;
    if (ar > 1) {
      dw = PHOTO_SIZE * ar;
      dx = PHOTO_X - (dw - PHOTO_SIZE) / 2;
    } else {
      dh = PHOTO_SIZE / ar;
      dy = PHOTO_Y - (dh - PHOTO_SIZE) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    // Initials placeholder on a tinted party-colour fill.
    ctx.fillStyle = ringColor;
    ctx.fillRect(PHOTO_X, PHOTO_Y, PHOTO_SIZE, PHOTO_SIZE);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 88px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(card.name), cx, cy + 4);
  }
  ctx.restore();
};

export const renderCandidateCard = async (
  card: CandidateCardData,
): Promise<Buffer> => {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as SKRSContext2D;

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PALETTE.brand;
  ctx.fillRect(0, 0, W, 6);

  const partyColor =
    card.facts?.party.color || card.candidacy?.partyColor || PALETTE.brand;
  const photo = await loadPhoto(card);
  drawPhoto(ctx, card, partyColor, photo);

  const textX = PHOTO_X + PHOTO_SIZE + 40;
  const nameMaxW = W - textX - 60;

  // Name — auto-shrink to fit the column right of the portrait.
  ctx.fillStyle = PALETTE.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let nameSize = 58;
  do {
    ctx.font = `800 ${nameSize}px ${FONT_STACK}`;
    if (ctx.measureText(card.name).width <= nameMaxW) break;
    nameSize -= 2;
  } while (nameSize > 30);
  const nameY = 76;
  ctx.fillText(card.name, textX, nameY);

  // Subtitle — role · party group / list.
  const partyLabel =
    card.mp?.partyGroupShort ||
    card.facts?.party.nickName ||
    card.candidacy?.partyNickName;
  const subtitle = [ROLE_LABEL[card.role], partyLabel]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `500 26px ${FONT_STACK}`;
  ctx.fillText(subtitle, textX, nameY + nameSize + 16);

  // Result tiles — preference results when available, else the current
  // candidacy (region / list number / party).
  const tiles: Tile[] = [];
  if (card.facts) {
    tiles.push({
      label: "преференции",
      value: formatThousands(card.facts.totalPreferences),
    });
    tiles.push({
      label: "най-силна област",
      value: card.facts.topOblastName,
      delta: `${formatThousands(card.facts.topOblastPreferences)} преференции`,
      deltaColor: PALETTE.muted,
    });
    tiles.push({
      label: "партия",
      value: card.facts.party.nickName,
      accent: card.facts.party.color,
    });
  } else if (card.candidacy) {
    tiles.push({ label: "област", value: card.candidacy.oblastName });
    tiles.push({
      label: "номер в листата",
      value: `№ ${card.candidacy.pref}`,
    });
    if (card.candidacy.partyNickName) {
      tiles.push({
        label: "партия",
        value: card.candidacy.partyNickName,
        accent: card.candidacy.partyColor,
      });
    }
  } else if (partyLabel) {
    tiles.push({ label: "парламентарна група", value: partyLabel });
  }

  const drawn = tiles.slice(0, 4);
  if (drawn.length) {
    const top = 290;
    const bottom = H - 80;
    const innerH = bottom - top;
    const sideMargin = 60;
    const gap = 20;
    const tileW =
      (W - 2 * sideMargin - (drawn.length - 1) * gap) / drawn.length;
    drawn.forEach((tile, i) => {
      drawTile(ctx, sideMargin + i * (tileW + gap), top, tileW, innerH, tile);
    });
  }

  drawFooter(
    ctx,
    "electionsbg.com",
    card.facts ? formatElectionDateBg(card.facts.electionDate) : "",
  );

  return canvas.toBuffer("image/webp", 90);
};
