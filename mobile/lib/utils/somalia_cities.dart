/// Compatibility shim — prefer SomaliaRegions.
library;

import 'somalia_regions.dart' show SomaliaRegions;

export 'somalia_regions.dart' show SomaliaRegions;

@Deprecated('Use SomaliaRegions')
typedef SomaliaCities = SomaliaRegions;
