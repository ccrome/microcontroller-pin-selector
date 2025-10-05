## Microcontroller Pin Selector

A lightweight, static web app for exploring MCU peripheral-to-pad mux options and planning board pin assignments. Works on any static host (including GitHub Pages) and offline.

### What it does
- Lets you pick a CPU and browse all instance/port pad options
- Optionally pick a board profile to filter to only pads exposed on that board and map pads to board pin numbers
- Prevents selecting conflicting board pins across instances
- Persists selections and hardware choice in localStorage

### Getting started
1. Serve the repository root with any static server (or publish it with GitHub Pages).
2. Open `index.html` in a browser.
3. Use the header controls to select a Board (optional) and/or CPU.

### Repository layout
```
boards/        # Board definitions (metadata + pad→board pin map)
cpus/          # CPU pin-mux databases
assets/        # UI code and styles
  app.js       # Main application logic
  styles.css   # Styles
index.html     # App shell
```

### Board discovery and format

Boards are discovered via a simple manifest at `boards/index.json`. The manifest lists file paths only; all descriptive metadata lives in each board file.

`boards/index.json` example:
```json
{
  "files": [
    "boards/teensy4.1.json"
  ]
}
```

Each board JSON must include an id, a human-friendly name, the CPU id it targets, and its pad→pin mapping:
```json
{
  "id": "teensy4.1",
  "board": "Teensy 4.1",
  "cpu": "i.mxrt1062",
  "pins": [
    { "pin": 0,  "aliases": [],       "pad": "GPIO_AD_B0_03" },
    { "pin": 1,  "aliases": [],       "pad": "GPIO_AD_B0_02" }
    // ... more pins ...
  ]
}
```

- **id**: stable identifier used in the UI
- **board**: display name
- **cpu**: must match a CPU id in `cpus/index.json`
- **pins[]**: links board pin numbers to MCU pads; optional `aliases` are display-only

When a board is selected, the app:
- Filters all combos to the set of pads present in the board's `pins[]`
- Maps a selected pad to one or more board pin numbers for display and conflict detection
- Locks the CPU dropdown to the board's `cpu`

### CPU discovery and format

CPUs are listed in `cpus/index.json` with an id, name, and the path to their pin database file.

`cpus/index.json` example:
```json
{
  "cpus": [
    { "id": "i.mxrt1062", "name": "NXP i.MX RT1062", "file": "cpus/i.mxrt1062.pins.json" }
  ]
}
```

CPU pin database format is a simple nested object:
```json
{
  "LPUART1": {
    "LPUART1_TXD": [["GPIO_AD_B0_12", "ALT2"]],
    "LPUART1_RXD": [["GPIO_AD_B0_13", "ALT2"]]
  },
  "I2C1": {
    "I2C1_SCL": [["GPIO_AD_B1_00", "ALT3"]],
    "I2C1_SDA": [["GPIO_AD_B1_01", "ALT3"]]
  }
}
```

Shape details:
- Top level keys are peripheral instances (e.g., `LPUART1`, `LPI2C1`)
- Each instance has ports (e.g., `LPUART1_TXD`)
- Each port is an array of `[pad, alt]` tuples; `alt` can be `"-"` if not applicable

### Adding a new board
1. Create a new file under `boards/` following the Board JSON schema shown above.
2. Add the file path to `boards/index.json` under `files`.
3. Ensure the board's `cpu` id exists in `cpus/index.json`.

### Adding a new CPU
1. Add a new `<cpu-id>.pins.json` file under `cpus/` following the CPU format above.
2. Add an entry to `cpus/index.json` with the `id`, `name`, and `file` path.

### State and clearing
- The app saves `boardId`, `cpuId`, the active instance, and all selections to localStorage (`pinSelectorState.v1`).
- Use the header "Clear selections" button to remove all selections (state updates immediately).

### Notes
- This is a static, dependency-free app. No build step is required.
- JSON files are fetched relative to the site root; paths in the manifests should be correct from the deployed root.


