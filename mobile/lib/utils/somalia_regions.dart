/// Somali regions (gobols) for Coach location pickers.
/// Keep in sync with frontend/src/utils/somaliaRegions.js
class SomaliaRegions {
  SomaliaRegions._();

  static const List<String> all = [
    'Banaadir',
    'Bari',
    'Bay',
    'Bakool',
    'Galgaduud',
    'Gedo',
    'Hiiraan',
    'Jubbada Dhexe',
    'Jubbada Hoose',
    'Mudug',
    'Nugaal',
    'Sanaag',
    'Shabeellaha Dhexe',
    'Shabeellaha Hoose',
    'Sool',
    'Togdheer',
  ];

  static const Map<String, String> _aliases = {
    'banadir': 'Banaadir',
    'banaadir': 'Banaadir',
    'bari': 'Bari',
    'bay': 'Bay',
    'bakool': 'Bakool',
    'galgaduud': 'Galgaduud',
    'gedo': 'Gedo',
    'hiiraan': 'Hiiraan',
    'hiran': 'Hiiraan',
    'jubbada dhexe': 'Jubbada Dhexe',
    'middle juba': 'Jubbada Dhexe',
    'jubbada hoose': 'Jubbada Hoose',
    'lower juba': 'Jubbada Hoose',
    'mudug': 'Mudug',
    'nugaal': 'Nugaal',
    'nugaaal': 'Nugaal',
    'sanaag': 'Sanaag',
    'shabeellaha dhexe': 'Shabeellaha Dhexe',
    'middle shabelle': 'Shabeellaha Dhexe',
    'shabeellaha hoose': 'Shabeellaha Hoose',
    'lower shabelle': 'Shabeellaha Hoose',
    'sool': 'Sool',
    'togdheer': 'Togdheer',
  };

  /// Canonical region if known. Does not invent a region for "Somalia" or cities.
  static String? match(String? value) {
    final raw = (value ?? '').trim();
    if (raw.isEmpty) return null;
    for (final region in all) {
      if (region.toLowerCase() == raw.toLowerCase()) return region;
    }
    return _aliases[raw.toLowerCase()];
  }

  static bool contains(String? value) => match(value) != null;

  static String? validate(String? value, {bool required = true}) {
    final raw = (value ?? '').trim();
    if (raw.isEmpty) {
      return required ? 'Please select your region.' : null;
    }
    if (!contains(raw)) return 'Please select your region.';
    return null;
  }
}
