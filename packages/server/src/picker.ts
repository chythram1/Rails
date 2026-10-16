// Opens the operating system's own folder picker on the machine running the server (ADR 0004).
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { ServiceError } from "./errors.ts";

// macOS: the standard "choose folder" dialog, run through JavaScript for Automation. The window is brought
// to the front with NSApplication (~0.1s); AppleScript's `activate` does the same but takes ~2s.
// (A raw NSOpenPanel opened faster but couldn't navigate into subfolders.)
const MAC_CHOOSE_FOLDER = [
  'ObjC.import("AppKit");',
  "$.NSApplication.sharedApplication.activateIgnoringOtherApps(true);",
  "const app = Application.currentApplication();",
  "app.includeStandardAdditions = true;",
  "app.chooseFolder().toString();",
].join(" ");

interface Picker {
  cmd: string;
  args: string[];
  /** Whether a failed run means the user pressed Cancel (rather than a real error). */
  cancelled(code: number | null, stderr: string): boolean;
}

function pickers(): Picker[] {
  switch (process.platform) {
    case "darwin":
      // Cancel is error -128 ("User canceled").
      return [{ cmd: "osascript", args: ["-l", "JavaScript", "-e", MAC_CHOOSE_FOLDER], cancelled: (_, stderr) => stderr.includes("-128") }];
    case "win32":
      // rails itself needs tmux (so WSL on Windows), but the picker works natively too. Cancel prints nothing.
      return [
        {
          cmd: "powershell.exe",
          args: [
            "-NoProfile",
            "-STA",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
              "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
          ],
          cancelled: () => false,
        },
      ];
    default:
      // Linux and other Unixes: GNOME's zenity, else KDE's kdialog. Both exit 1 on Cancel.
      return [
        { cmd: "zenity", args: ["--file-selection", "--directory"], cancelled: (code) => code === 1 },
        { cmd: "kdialog", args: ["--getexistingdirectory", process.env.HOME ?? "/"], cancelled: (code) => code === 1 },
      ];
  }
}

let open = false;

/**
 * Show a native folder picker on the server and wait for the user. Returns the chosen folder, or null if
 * they cancelled. Only one picker can be open at a time.
 */
export async function pickFolder(): Promise<string | null> {
  if (process.platform !== "darwin" && process.platform !== "win32" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new ServiceError("The server has no desktop session, so it can't show a folder picker.", 400);
  }
  if (open) throw new ServiceError(`A folder picker is already open on ${hostname()}.`, 409);
  open = true;
  try {
    for (const picker of pickers()) {
      const result = await run(picker);
      if (result === "missing") continue;
      return result;
    }
    throw new ServiceError("No folder picker found on the server. Install zenity or kdialog.", 503);
  } finally {
    open = false;
  }
}

function run(p: Picker): Promise<string | null | "missing"> {
  return new Promise((resolve, reject) => {
    execFile(p.cmd, p.args, (err, stdout, stderr) => {
      const path = String(stdout).trim();
      if (!err) return resolve(path || null); // empty output: cancelled (PowerShell)
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return resolve("missing");
      if (p.cancelled(typeof err.code === "number" ? err.code : null, String(stderr))) return resolve(null);
      reject(new ServiceError(`The folder picker failed: ${String(stderr).trim() || err.message}`, 503));
    });
  });
}
