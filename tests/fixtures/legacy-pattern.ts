export const legacyPattern = () => ({
  schema_version: 1, name: "旧版导入测试", width: 3, height: 2,
  palette_system: "MARD 221", orientation: "front",
  coordinate_system: { origin: "top-left", index_base: 0, grid_access: "grid[y][x]" },
  empty_cell: null, color_count: 3, total_beads: 5,
  palette: {
    H2: { hex: "#FFFFFF", rgb: [255, 255, 255], count: 2 },
    H7: { hex: "#000000", rgb: [0, 0, 0], count: 2 },
    H6: { hex: "#2C2C2C", rgb: [44, 44, 44], count: 1 },
  },
  grid: [["H2", "H7", null], ["H6", "H2", "H7"]],
});
