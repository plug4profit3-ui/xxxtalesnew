# OpenClaw opzetten

Deze repository bevat een helper-script om OpenClaw automatisch te clonen en te bouwen.

## Vereisten

- `git`
- `cmake`
- een C++ toolchain (`g++`/`clang++`, `make`/`ninja`)

## Gebruik

```bash
./scripts/setup-openclaw.sh
```

Optioneel kun je een doelmap meegeven:

```bash
./scripts/setup-openclaw.sh ~/projects/openclaw
```

## Build type aanpassen

Standaard gebruikt het script `Release`. Voor `Debug`:

```bash
BUILD_TYPE=Debug ./scripts/setup-openclaw.sh
```

## Wat het script doet

1. Clone (of update) `https://github.com/openclaw/openclaw.git`
2. Draait CMake configuratie
3. Bouwt het project via CMake
