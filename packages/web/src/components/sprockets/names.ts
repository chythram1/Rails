import type { SprocketAccessory, SprocketColor } from "@rails/shared";

export const ACCESSORY_NAMES: Record<SprocketAccessory, string> = {
  party: "Party hat",
  beanie: "Beanie",
  cap: "Cap",
  bow: "Bow",
  flower: "Flower clip",
  crown: "Crown",
  bucket: "Bucket hat",
};

export const COLOR_NAMES: Record<SprocketColor, string> = {
  brown: "Brown",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  grey: "Grey",
};
