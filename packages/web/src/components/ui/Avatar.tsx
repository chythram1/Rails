import type { ProfileAvatar } from "@rails/shared";
import burst from "../../assets/avatars/six-ray-burst.svg";
import crown from "../../assets/avatars/crown.svg";
import paths from "../../assets/avatars/interlocking-paths.svg";
import petals from "../../assets/avatars/four-petals.svg";
import shield from "../../assets/avatars/split-shield.svg";
import sparkle from "../../assets/avatars/sparkle.svg";
import spiral from "../../assets/avatars/interlocking-spiral.svg";
import squares from "../../assets/avatars/linked-squares.svg";

const IMAGES: Record<ProfileAvatar, string> = {
  "interlocking-spiral": spiral,
  crown,
  "linked-squares": squares,
  "four-petals": petals,
  sparkle,
  "interlocking-paths": paths,
  "split-shield": shield,
  "six-ray-burst": burst,
};

/** Names for screen readers (the picker's radio buttons). */
export const AVATAR_LABELS: Record<ProfileAvatar, string> = {
  "interlocking-spiral": "Interlocking spiral",
  crown: "Crown",
  "linked-squares": "Linked squares",
  "four-petals": "Four petals",
  sparkle: "Sparkle",
  "interlocking-paths": "Interlocking paths",
  "split-shield": "Split shield",
  "six-ray-burst": "Six-ray burst",
};

/** A profile avatar: a pixel pattern in a coloured circle. Decorative; the name beside it says who. */
export function Avatar({ avatar, size }: { avatar: ProfileAvatar; size: number }) {
  return <img className="avatar" src={IMAGES[avatar]} alt="" width={size} height={size} draggable={false} />;
}
