import type { SprocketAccessory } from "@rails/shared";

export const ACCESSORY_NAMES: Record<SprocketAccessory, string> = {
  beanie: "Beanie",
  cap: "Cap",
  bow: "Bow",
  crown: "Crown",
  headphones: "Headphones",
  sunglasses: "Sunglasses",
  glasses: "Glasses",
  scarf: "Scarf",
};

export const SLOT_NAMES = { head: "Head", eyes: "Eyes", neck: "Neck" } as const;
