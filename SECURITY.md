# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use **Report a vulnerability** on the
repository's [Security](https://github.com/CaYatur/SoundVisualizer/security) tab. The report stays
private until a fix is released.

A useful report says:

- the version (shown under Setup → Settings → Updates) and the operating system;
- which switch has to be on (for example the stream server, *Open to local network*, MCP, the
  audio bridge) and whether Token protection was on;
- the steps, and what an attacker gains.

You will get an answer in the advisory thread. This is a small project maintained in spare time, so
there is no guaranteed response time and no bounty; credit is given in the changelog unless you ask
otherwise.

## Supported versions

Fixes go into the next release. Only the latest release is supported; older installers are not
patched. The app checks GitHub for a newer release unless updates are set to *Off*.

## What is in scope

- The desktop application and everything it serves: the stream server (OBS overlay, phone remote),
  the MCP and REST endpoints, the audio bridge, the update installer, and the file importers
  (settings backups, show packages, MilkDrop presets, lyrics, LUTs).
- The release artifacts and the build scripts in this repository.

## What the app opens, and when

Nothing listens on the network until you turn a feature on. The
[Privacy and security](README.md#privacy-and-security) section of the README lists what each switch
opens, on which address, and how it is protected. A report that depends on a switch being on is
still welcome; please name the switch.

## Out of scope

- Anything that needs an attacker who already runs code as your user on the same computer.
- A web page you add yourself as a web layer: it runs in a sandboxed, separate session, but it is
  still a page you chose to load.
- Findings in build-time tools that are not shipped in the installer (`npm audit` lists some).
