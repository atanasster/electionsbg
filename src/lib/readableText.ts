// Pick black or white text for AA-ish contrast over an arbitrary background colour. Party
// colours arrive as "rgb(r, g, b)" or "#rrggbb"; light-branded parties (yellow/cyan) get
// black text instead of a hardcoded white that would fall below the 4.5:1 threshold.
export const readableText = (color?: string | null): "#000" | "#fff" => {
  if (!color) return "#fff";
  let r = 0;
  let g = 0;
  let b = 0;
  const rgb = /rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color);
  if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else {
    const hex = color.replace("#", "");
    if (hex.length < 6) return "#fff";
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  // Perceived luminance (sRGB weights), 0..1.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000" : "#fff";
};
