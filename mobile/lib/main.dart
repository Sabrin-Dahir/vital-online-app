import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'l10n/app_localizations.dart';
import 'l10n/locale_service.dart';
import 'services/api_service.dart';
import 'services/theme_service.dart';
import 'models/user_model.dart';
import 'screens/auth/auth_home.dart';
import 'screens/dashboard/widgets/coach_home/coach_dashboard_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await LocaleService.init();
  await ThemeService.init();
  final apiService = ApiService();
  await apiService.init();

  // Never block app launch on a hung /auth/me — show login if session check fails.
  User? initialUser;
  try {
    initialUser = await apiService.getMe().timeout(const Duration(seconds: 15));
  } catch (_) {
    initialUser = null;
  }

  runApp(MyApp(initialUser: initialUser));
}

class MyApp extends StatefulWidget {
  final User? initialUser;

  const MyApp({super.key, this.initialUser});

  static _MyAppState? of(BuildContext context) =>
      context.findAncestorStateOfType<_MyAppState>();

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  bool _isDark = ThemeService.isDark;
  Locale _locale = LocaleService.locale;

  bool get isDark => _isDark;
  Locale get locale => _locale;

  Future<void> toggleTheme(bool isDark) async {
    if (_isDark == isDark) return;
    setState(() => _isDark = isDark);
    await ThemeService.save(isDark);
    _syncSystemUi(isDark);
  }

  Future<void> setLocale(Locale locale) async {
    await LocaleService.save(locale);
    setState(() => _locale = locale);
  }

  void _syncSystemUi(bool isDark) {
    SystemChrome.setSystemUIOverlayStyle(
      SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
        statusBarBrightness: isDark ? Brightness.dark : Brightness.light,
        systemNavigationBarColor:
            isDark ? const Color(0xFF181B24) : Colors.white,
        systemNavigationBarIconBrightness:
            isDark ? Brightness.light : Brightness.dark,
      ),
    );
  }

  ThemeData _buildLightTheme() {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: CoachDashboardTheme.primary,
        brightness: Brightness.light,
      ),
      fontFamily: 'Roboto',
    );
    return base.copyWith(
      scaffoldBackgroundColor: const Color(0xFFF3F4F8),
      appBarTheme: const AppBarTheme(
        elevation: 0,
        centerTitle: true,
        backgroundColor: Color(0xFFF3F4F8),
        foregroundColor: CoachDashboardTheme.textPrimary,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),
      cardColor: Colors.white,
      dividerColor: const Color(0xFFE5E7EB),
      dialogTheme: const DialogThemeData(
        backgroundColor: Colors.white,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Colors.white,
        selectedItemColor: CoachDashboardTheme.primary,
        unselectedItemColor: CoachDashboardTheme.textSecondary,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFF9FAFB),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  ThemeData _buildDarkTheme() {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: ColorScheme.fromSeed(
        seedColor: CoachDashboardTheme.primary,
        brightness: Brightness.dark,
      ),
      fontFamily: 'Roboto',
    );
    return base.copyWith(
      scaffoldBackgroundColor: const Color(0xFF0F1117),
      appBarTheme: const AppBarTheme(
        elevation: 0,
        centerTitle: true,
        backgroundColor: Color(0xFF0F1117),
        foregroundColor: Colors.white,
        systemOverlayStyle: SystemUiOverlayStyle.light,
      ),
      cardColor: const Color(0xFF181B24),
      dividerColor: const Color(0xFF2A2F3D),
      dialogTheme: const DialogThemeData(
        backgroundColor: Color(0xFF181B24),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Color(0xFF181B24),
        selectedItemColor: Color(0xFF5B6FD6),
        unselectedItemColor: Colors.white54,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF0F1117),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Widget _buildHome() => AuthHome(user: widget.initialUser);

  @override
  void initState() {
    super.initState();
    _syncSystemUi(_isDark);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'VitalFitness',
      locale: _locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: _buildLightTheme(),
      darkTheme: _buildDarkTheme(),
      // Explicit mode — never follow the OS when the user picked a preference.
      themeMode: _isDark ? ThemeMode.dark : ThemeMode.light,
      home: _buildHome(),
    );
  }
}
