import { PROFILE_AVATARS } from "@rails/shared";
import { describe, expect, it, vi } from "vitest";
import { getProfile, onProfileChanged, updateProfile } from "./profile.ts";

describe("profile", () => {
  it("starts as this computer, with one of the avatars", () => {
    const p = getProfile();
    expect(p.name).toBe(p.machineName);
    expect(p.machineName).not.toBe("");
    expect(PROFILE_AVATARS).toContain(p.avatar);
  });

  it("saves a trimmed name and an avatar, and tells listeners", () => {
    const seen = vi.fn();
    onProfileChanged(seen);
    expect(updateProfile({ name: "  Studio Mac ", avatar: "crown" })).toMatchObject({ name: "Studio Mac", avatar: "crown" });
    expect(getProfile()).toMatchObject({ name: "Studio Mac", avatar: "crown" });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ name: "Studio Mac" }));
  });

  it("goes back to the computer's name when the name is cleared", () => {
    updateProfile({ name: "Studio Mac" });
    expect(updateProfile({ name: " " }).name).toBe(getProfile().machineName);
  });

  it("rejects a long name or an unknown avatar, changing nothing", () => {
    updateProfile({ name: "Studio Mac", avatar: "crown" });
    expect(() => updateProfile({ name: "x".repeat(41) })).toThrow("40 characters");
    expect(() => updateProfile({ name: "New", avatar: "dragon" })).toThrow("Unknown avatar");
    expect(() => updateProfile({ name: null })).toThrow("text");
    expect(updateProfile(null)).toMatchObject({ name: "Studio Mac", avatar: "crown" }); // a JSON null body
    expect(getProfile()).toMatchObject({ name: "Studio Mac", avatar: "crown" });
  });
});
