import { createContext, useContext } from "react";
import type { SettingsSection } from "./search.ts";

/** Opens Settings, at a section or the one shown last. Provided by the app shell. */
export const SettingsContext = createContext<(section?: SettingsSection) => void>(() => {});
export const useOpenSettings = () => useContext(SettingsContext);
