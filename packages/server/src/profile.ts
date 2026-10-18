// The profile: the name and avatar at the foot of the sidebar (Settings → Account). Rails has one user
// (ADR 0001), so there's one profile, kept with the app settings and shared by every device. Until it's set,
// it's the name of the computer Rails runs on, which tells apart the Rails of different machines.
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { PROFILE_AVATARS, PROFILE_NAME_MAX, type Profile, type ProfileAvatar } from "@rails/shared";
import { settings } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { listeners } from "./util.ts";

/** "Michael’s MacBook Pro" on macOS (its hostname is "Michaels-MacBook-Pro.local"), else the hostname. */
function computerName(): string {
  if (process.platform === "darwin") {
    try {
      const name = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 2000 }).trim();
      if (name) return name;
    } catch {}
  }
  return hostname().split(".")[0] || "Rails";
}

const machineName = computerName().slice(0, PROFILE_NAME_MAX);

const isAvatar = (x: unknown): x is ProfileAvatar => PROFILE_AVATARS.includes(x as ProfileAvatar);

/** Until one is picked, each machine gets its own avatar, from a hash of its name. */
let hash = 0;
for (const c of machineName) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
const defaultAvatar = PROFILE_AVATARS[hash % PROFILE_AVATARS.length];

const changes = listeners<[Profile]>();
export const onProfileChanged = changes.on;

export function getProfile(): Profile {
  const avatar = settings.get("profile.avatar");
  return { name: settings.get("profile.name") ?? machineName, avatar: isAvatar(avatar) ? avatar : defaultAvatar, machineName };
}

/** Change the name, the avatar or both (ProfileChange, not yet checked). Checks everything before saving. */
export function updateProfile(input: { name?: unknown; avatar?: unknown } | null): Profile {
  const { name, avatar } = input ?? {};
  if (name !== undefined && typeof name !== "string") throw new ServiceError("The name must be text.", 400);
  if (name && name.trim().length > PROFILE_NAME_MAX) throw new ServiceError(`Keep the name to ${PROFILE_NAME_MAX} characters.`, 400);
  if (avatar !== undefined && !isAvatar(avatar)) throw new ServiceError("Unknown avatar.", 400);
  if (name !== undefined) settings.set("profile.name", name.trim() || null);
  if (avatar !== undefined) settings.set("profile.avatar", avatar);
  const profile = getProfile();
  changes.emit(profile);
  return profile;
}
