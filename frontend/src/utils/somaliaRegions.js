/** Somali regions (gobols) for Coach location — keep in sync with mobile/lib/utils/somalia_regions.dart */

export const SOMALIA_REGIONS = [
  "Banaadir",
  "Bari",
  "Bay",
  "Bakool",
  "Galgaduud",
  "Gedo",
  "Hiiraan",
  "Jubbada Dhexe",
  "Jubbada Hoose",
  "Mudug",
  "Nugaal",
  "Sanaag",
  "Shabeellaha Dhexe",
  "Shabeellaha Hoose",
  "Sool",
  "Togdheer",
];

const REGION_ALIASES = {
  banadir: "Banaadir",
  banaadir: "Banaadir",
  bari: "Bari",
  bay: "Bay",
  bakool: "Bakool",
  galgaduud: "Galgaduud",
  gedo: "Gedo",
  hiiraan: "Hiiraan",
  hiran: "Hiiraan",
  "jubbada dhexe": "Jubbada Dhexe",
  "middle juba": "Jubbada Dhexe",
  "jubbada hoose": "Jubbada Hoose",
  "lower juba": "Jubbada Hoose",
  mudug: "Mudug",
  nugaal: "Nugaal",
  nugaaal: "Nugaal",
  sanaag: "Sanaag",
  "shabeellaha dhexe": "Shabeellaha Dhexe",
  "middle shabelle": "Shabeellaha Dhexe",
  "shabeellaha hoose": "Shabeellaha Hoose",
  "lower shabelle": "Shabeellaha Hoose",
  sool: "Sool",
  togdheer: "Togdheer",
};

/**
 * Return canonical region label if value matches the predefined list.
 * Does NOT map "Somalia" or city names to a region.
 */
export function matchSomaliaRegion(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const exact = SOMALIA_REGIONS.find((region) => region.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  return REGION_ALIASES[raw.toLowerCase()] || "";
}

export function validateSomaliaRegion(value, { required = true } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return required ? "Please select your region." : null;
  }
  if (!matchSomaliaRegion(raw)) {
    return "Please select your region.";
  }
  return null;
}
