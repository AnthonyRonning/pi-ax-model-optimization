{
  description = "Nix flake for pi-monorepo development";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  };

  outputs = { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forEachSystem = f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            pkgs = import nixpkgs { inherit system; };
          }
        );
    in
    {
      devShells = forEachSystem (
        { pkgs }:
        {
          default = pkgs.mkShell {
            packages =
              (with pkgs; [
                bashInteractive
                bun
                cacert
                fd
                git
                gnumake
                nodejs_22
                openssh
                pkg-config
                python3
                ripgrep
                stdenv.cc
                tmux
                unzip
                zip
              ])
              ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
                pkgs.docker-client
                pkgs.wl-clipboard
                pkgs.xclip
                pkgs.xsel
              ];

            buildInputs =
              (with pkgs; [
                cairo
                giflib
                glib
                libjpeg
                librsvg
                pango
                pixman
              ])
              ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
                pkgs.libiconv
              ];

            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"
              export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              export npm_config_python="${pkgs.python3}/bin/python3"

              if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
                current_hooks_path="$(git config --local --get core.hooksPath 2>/dev/null || true)"
                if [ "$current_hooks_path" != ".husky/_" ]; then
                  git config --local core.hooksPath .husky/_ >/dev/null 2>&1 || true
                fi
              fi

              cat <<'EOF'
pi-mono dev shell ready

Bootstrap once per checkout:
  npm install
  npm run build

Validation:
  npm run check

Git hooks:
  core.hooksPath is set to .husky/_ for this checkout
EOF
            '';
          };
        }
      );
    };
}
