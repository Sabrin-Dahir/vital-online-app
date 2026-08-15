/// Compatibility shim — prefer SomaliaRegions.
library;

export 'somalia_regions.dart' show SomaliaRegions;

@Deprecated('Use SomaliaRegions')
typedef SomaliaCities = SomaliaRegions;
