{
  # Optional, pinned development shell (`nix develop`). `make` stays the main entry point; this only
  # provides the system tools `make system-deps` would otherwise install. JS dependencies come from npm
  # (package-lock.json), and the agent CLIs (claude, codex, pi) come from your own PATH.
  description = "rails development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24 # node:sqlite needs Node 24+
            pkgs.tmux # every panel runs in tmux (ADR 0003); needs >= 3.2
          ]
          # node-pty has no Linux prebuilds, so `npm install` compiles it there.
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.python3 pkgs.gnumake pkgs.gcc ];
        };
      });
    };
}
