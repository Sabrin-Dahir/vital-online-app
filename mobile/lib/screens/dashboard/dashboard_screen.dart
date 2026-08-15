import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import '../../models/user_model.dart';
import '../../services/api_service.dart';
import '../../utils/coach_thread_utils.dart';
import '../../widgets/animations/animations.dart';
import '../auth/login_screen.dart';
import '../../main.dart';
import 'tabs/home_tab.dart';
import 'assignments_screen.dart';
import 'notifications_screen.dart';
import 'user_appointments_screen.dart';
import 'user_sessions_screen.dart';
import 'tabs/user_attendance_screen.dart';
import 'tabs/user_schedule_tab.dart';
import 'user_diet_plan_screen.dart';
import 'tabs/user_progress_tab.dart';
import 'tabs/user_coaches_tab.dart';
import 'tabs/user_settings_tab.dart';
import 'widgets/user_sidebar.dart';
import 'widgets/coach_home/coach_dashboard_theme.dart';
import '../auth/auth_landing_theme.dart';

class DashboardScreen extends StatefulWidget {
  final User initialUser;
  final int initialTabIndex;

  const DashboardScreen({
    super.key,
    required this.initialUser,
    this.initialTabIndex = 0,
  });

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late User _currentUser;
  late int _currentIndex;
  int _unreadCoachMessages = 0;
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final ApiService _apiService = ApiService();
  final GlobalKey<HomeTabState> _homeTabKey = GlobalKey<HomeTabState>();
  final GlobalKey<UserDietPlanScreenState> _dietTabKey = GlobalKey<UserDietPlanScreenState>();
  late final GlobalKey<UserProgressTabState> _progressTabKey;
  final GlobalKey<UserSettingsTabState> _settingsTabKey = GlobalKey<UserSettingsTabState>();
  final GlobalKey _coachesTabKey = GlobalKey();
  List<Widget>? _tabs;

  static const _navIcons = [
    (Icons.home_outlined, Icons.home_rounded),
    (Icons.restaurant_menu_outlined, Icons.restaurant_menu_rounded),
    (Icons.bar_chart_outlined, Icons.bar_chart_rounded),
    (Icons.person_pin_circle_outlined, Icons.person_pin_circle_rounded),
    (Icons.settings_outlined, Icons.settings_rounded),
  ];

  List<String> _navLabels(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return [l10n.home, l10n.dietPlan, l10n.progress, l10n.coaches, l10n.settings];
  }

  @override
  void initState() {
    super.initState();
    _currentUser = widget.initialUser;
    _currentIndex = widget.initialTabIndex.clamp(0, _navIcons.length - 1);
    _progressTabKey = GlobalKey<UserProgressTabState>();
    _loadUnreadCoachMessages();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _tabs ??= _createTabs();
  }

  Future<void> _loadUnreadCoachMessages() async {
    try {
      final threads = await _apiService.getChatThreads();
      var total = 0;
      for (final t in threads) {
        total += CoachThreadUtils.unreadCount(Map<String, dynamic>.from(t as Map));
      }
      if (mounted) setState(() => _unreadCoachMessages = total);
    } catch (_) {}
  }

  void _onScheduleDataChanged() {
    _homeTabKey.currentState?.refresh();
    _progressTabKey.currentState?.refreshFromParent();
  }

  void _onDietDataChanged() {
    _homeTabKey.currentState?.refresh();
    _progressTabKey.currentState?.refreshFromParent();
  }

  void _onTabSelected(int index) {
    final wasIndex = _currentIndex;
    setState(() => _currentIndex = index);
    // Soft background refresh only when re-selecting a tab (not on first paint).
    if (index == wasIndex) return;
    if (index == 0) {
      _homeTabKey.currentState?.refresh();
    } else if (index == 1) {
      _dietTabKey.currentState?.refreshQuietly();
    } else if (index == 2) {
      _progressTabKey.currentState?.refreshFromParent();
    } else if (index == 3) {
      _loadUnreadCoachMessages();
    } else if (index == 4) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _settingsTabKey.currentState?.scrollToTop();
      });
    }
  }

  void _openCoachSchedule({DateTime? weekStart}) {
    _openSection(_scheduleScreen(initialWeekStart: weekStart));
  }

  void _onUserUpdated(User updatedUser) {
    setState(() {
      _currentUser = updatedUser;
      _tabs = _createTabs();
    });
  }

  Future<void> _handleLogout() async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);

    try {
      await _apiService.clearAuth();
      AppNavigator.pushAndRemoveUntil(
        context,
        const LoginScreen(),
        (route) => false,
      );
    } catch (e) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text("Failed to log out: $e"),
          backgroundColor: CoachDashboardTheme.danger,
        ),
      );
    }
  }

  List<Widget> _createTabs() {
    final myAppState = MyApp.of(context);
    final isDark = myAppState?.isDark ?? false;
    Future<void> toggleTheme(bool value) async {
      final app = MyApp.of(context);
      if (app != null) {
        await app.toggleTheme(value);
      }
    }

    return [
      HomeTab(
        key: _homeTabKey,
        user: _currentUser,
        onOpenDietPlan: () => _onTabSelected(1),
        onOpenProgress: () => _onTabSelected(2),
        onOpenWorkouts: () => _openSection(_scheduleScreen()),
        onOpenMenu: () => _scaffoldKey.currentState?.openDrawer(),
      ),
      UserDietPlanScreen(key: _dietTabKey, onDietDataChanged: _onDietDataChanged),
      UserProgressTab(key: _progressTabKey, user: _currentUser),
      UserCoachesTab(key: _coachesTabKey, user: _currentUser, onUnreadChanged: _loadUnreadCoachMessages),
      UserSettingsTab(
        key: _settingsTabKey,
        user: _currentUser,
        onUserUpdated: _onUserUpdated,
        onLogout: _handleLogout,
        onThemeToggle: toggleTheme,
        isDark: isDark,
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final tabs = _tabs ?? _createTabs();

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      drawer: UserSidebar(
        user: _currentUser,
        onOpenAppointments: () => _openSection(const UserAppointmentsScreen()),
        onOpenSessions: () => _openSection(const UserSessionsScreen()),
        onOpenWorkouts: _openWorkouts,
        onOpenAttendance: () => _openSection(const UserAttendanceScreen()),
        onOpenNotifications: () => _openSection(NotificationsScreen(onOpenCoachSchedule: _openCoachSchedule)),
      ),
      body: SafeArea(
        child: IndexedStack(
          index: _currentIndex,
          children: tabs,
        ),
      ),
      bottomNavigationBar: AnimatedBottomNav(
        currentIndex: _currentIndex,
        onTap: _onTabSelected,
        isDark: isDark,
        activeColor: CoachDashboardTheme.primary,
        inactiveColor: isDark ? AuthLandingTheme.footer : AuthLandingTheme.footer,
        items: List.generate(_navIcons.length, (i) {
          final (inactive, active) = _navIcons[i];
          return AnimatedNavItem(
            inactiveIcon: inactive,
            activeIcon: active,
            label: _navLabels(context)[i],
            badge: i == 3 ? _unreadCoachMessages : null,
          );
        }),
      ),
    );
  }

  void _openSection(Widget screen) {
    AppNavigator.push(context, screen);
  }

  Future<void> _openWorkouts() async {
    Map<String, dynamic>? coachingData;
    try {
      coachingData = await _apiService.getUserCoaching();
    } catch (_) {}
    if (!mounted) return;
    _openSection(AssignmentsScreen(
      coachingData: coachingData,
      onDataChanged: _onScheduleDataChanged,
    ));
  }

  Widget _scheduleScreen({DateTime? initialWeekStart}) {
    return UserScheduleTab(
      user: _currentUser,
      onScheduleDataChanged: _onScheduleDataChanged,
      initialWeekStart: initialWeekStart,
    );
  }
}
