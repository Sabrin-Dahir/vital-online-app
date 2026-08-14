import 'package:flutter/foundation.dart';

/// Central API configuration for Flutter (Android / iOS / web / desktop).
///
/// **Release / profile builds always use the production Contabo API** — never
/// localhost. That is required so an installed Android APK can reach the
/// backend from a real device.
///
/// **Debug builds** (`flutter run`, simulator) use the local API by default.
/// Override anytime with `--dart-define`:
///   flutter run --dart-define=API_URL=http://10.0.2.2:5050/api
///   flutter run --dart-define=API_HOST=192.168.1.10 --dart-define=API_PORT=5050
///   flutter run --dart-define=API_URL=https://169.58.179.28.sslip.io/api
class ApiConfig {
  /// Full base URL override, e.g. `https://host/api`. Wins over everything else.
  static const String _urlOverride = String.fromEnvironment('API_URL');
  static const String _hostOverride = String.fromEnvironment('API_HOST');
  static const String _portOverride = String.fromEnvironment('API_PORT');
  static const String _schemeOverride = String.fromEnvironment('API_SCHEME');

  /// Production API (Contabo VPS, HTTPS via Let's Encrypt + sslip.io).
  static const String _prodHost = '169.58.179.28.sslip.io';

  /// Local API for `flutter run` / debug (simulator, desktop, Chrome).
  static const String _localHost = '127.0.0.1';

  static const int defaultPort = 5050;

  static bool get _hasUrlOverride => _urlOverride.isNotEmpty;
  static bool get _hasHostOverride => _hostOverride.isNotEmpty;

  /// True when pointing at a non-production host (local / LAN / emulator).
  static bool get isLocalOverride =>
      _hasUrlOverride ||
      _hasHostOverride ||
      (kDebugMode && !_hasUrlOverride);

  static int get port {
    if (_portOverride.isNotEmpty) {
      return int.tryParse(_portOverride) ?? defaultPort;
    }
    return defaultPort;
  }

  static String get host {
    if (_hasHostOverride) return _hostOverride;
    if (kDebugMode && !_hasUrlOverride) return _localHost;
    return _prodHost;
  }

  /// http vs https. Explicit override wins; production Render is always HTTPS.
  static String get scheme {
    if (_schemeOverride.isNotEmpty) return _schemeOverride;
    if (_hasHostOverride) {
      return port == 443 ? 'https' : 'http';
    }
    if (_hasUrlOverride) {
      final lower = _urlOverride.toLowerCase();
      if (lower.startsWith('http://')) return 'http';
      if (lower.startsWith('https://')) return 'https';
    }
    if (kDebugMode) return 'http';
    return 'https';
  }

  /// True when the effective host:port needs an explicit port in the URL.
  static bool get _includePort {
    if (_hasUrlOverride) return false;
    if (_hasHostOverride || (kDebugMode && !_hasUrlOverride)) {
      return !(port == 443 || port == 80);
    }
    return false; // production https on 443
  }

  static String get _authority => _includePort ? '$host:$port' : host;

  /// Base API URL, e.g. `https://host/api` or `http://127.0.0.1:5050/api`.
  static String get baseUrl {
    if (_hasUrlOverride) {
      return _urlOverride.replaceAll(RegExp(r'/+$'), '');
    }
    return '$scheme://$_authority/api';
  }

  static String get healthUrl => '$baseUrl/health';

  /// Socket origin without the `/api` suffix.
  static String get socketUrl {
    if (_hasUrlOverride) {
      return baseUrl.replaceAll(RegExp(r'/api$'), '');
    }
    return '$scheme://$_authority';
  }

  /// Health / cold-start timeout. Local Mongo can be slow; Render free tier needs longer wakes.
  static Duration get healthTimeout =>
      isLocalOverride ? const Duration(seconds: 15) : const Duration(seconds: 45);

  /// Default timeout for authenticated API calls (prevents infinite loading).
  static Duration get requestTimeout =>
      isLocalOverride ? const Duration(seconds: 30) : const Duration(seconds: 45);
}
