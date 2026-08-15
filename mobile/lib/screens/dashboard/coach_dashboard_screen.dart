import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import '../../services/api_service.dart';
import '../../models/user_model.dart';
import '../auth/login_screen.dart';

import 'tabs/coach_home_tab.dart';
import 'tabs/coach_clients_tab.dart';
import 'tabs/coach_classes_tab.dart';
import 'tabs/coach_chat_tab.dart';
import 'tabs/coach_settings_tab.dart';
import 'tabs/coach_assignments_tab.dart';
import 'tabs/coach_progress_tab.dart';
import 'tabs/coach_reports_tab.dart';
import 'tabs/coach_workout_review_tab.dart';
import 'tabs/coach_notifications_tab.dart';
import 'tabs/coach_diet_plans_tab.dart';
import 'tabs/coach_appointments_tab.dart';
import 'tabs/coach_attendance_tab.dart';
import 'widgets/coach_home/coach_dashboard_theme.dart';
import '../auth/auth_landing_theme.dart';
import '../../utils/coach_thread_utils.dart';
import '../../widgets/animations/animations.dart';

class CoachDashboardScreen extends StatefulWidget {
  final User coachUser;

  const CoachDashboardScreen({super.key, required this.coachUser});

  @override
  State<CoachDashboardScreen> createState() => _CoachDashboardScreenState();
}

class _CoachDashboardScreenState extends State<CoachDashboardScreen> {
  late User _currentCoach;
  int _currentIndex = 0;
  int _pendingClientRequestCount = 0;
  int _unreadMessageCount = 0;
  final ApiService _apiService = ApiService();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final GlobalKey<CoachClientsTabState> _clientsTabKey = GlobalKey<CoachClientsTabState>();
  final GlobalKey<CoachHomeTabState> _homeTabKey = GlobalKey<CoachHomeTabState>();
  final GlobalKey<CoachClassesTabState> _classesTabKey = GlobalKey<CoachClassesTabState>();

  static const _navIcons = [
    (Icons.home_outlined, Icons.home_rounded),
    (Icons.people_alt_outlined, Icons.people_alt_rounded),
    (Icons.fitness_center_outlined, Icons.fitness_center_rounded),
    (Icons.fact_check_outlined, Icons.fact_check_rounded),
    (Icons.settings_outlined, Icons.settings_rounded),
  ];

  List<String> _navLabels(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return [l10n.home, l10n.clients, l10n.classes, 'Attendance', l10n.settings];
  }

  @override
  void initState() {
    super.initState();
    _currentCoach = widget.coachUser;
    _loadPendingRequestCount();
    _loadUnreadMessageCount();
  }

  Future<void> _loadPendingRequestCount() async {
    try {
      final requests = await _apiService.getCoachRequests();
      if (mounted) {
        setState(() => _pendingClientRequestCount = requests.length);
      }
    } catch (_) {}
  }

  Future<void> _loadUnreadMessageCount() async {
    try {
      final threads = await _apiService.getChatThreads();
      var total = 0;
      for (final t in threads) {
        total += CoachThreadUtils.unreadCount(Map<String, dynamic>.from(t as Map));
      }
      if (mounted) setState(() => _unreadMessageCount = total);
    } catch (_) {}
  }

  void _openClientRequests() {
    setState(() => _currentIndex = 1);
    _clientsTabKey.currentState?.openRequestsTab();
    _loadPendingRequestCount();
  }

  void _onTabSelected(int index) {
    setState(() => _currentIndex = index);
    // Soft refresh (isRefresh) keeps existing content visible — no full-screen spinner.
    if (index == 0) {
      _homeTabKey.currentState?.refresh();
    } else if (index == 1) {
      _clientsTabKey.currentState?.refresh().then((_) {
        if (mounted) {
          setState(() => _pendingClientRequestCount = _clientsTabKey.currentState?.pendingRequestCount ?? 0);
        }
      });
    } else if (index == 2) {
      _classesTabKey.currentState?.refresh();
    }
  }

  Future<void> _handleLogout() async {
    try {
      await _apiService.clearAuth();
      if (!mounted) return;
      AppNavigator.pushAndRemoveUntil(
        context,
        const LoginScreen(),
        (route) => false,
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Logout failed: $e'), backgroundColor: CoachDashboardTheme.danger),
      );
    }
  }

  void _onNavigate(int index) => _onTabSelected(index);

  void _openSection(Widget screen) {
    AppNavigator.push(context, screen);
  }

  void _onCoachUpdated(User updated) => setState(() => _currentCoach = updated);

  List<Widget> _buildTabs() => [
        CoachHomeTab(
          key: _homeTabKey,
          coach: _currentCoach,
          onNavigate: _onNavigate,
          onOpenSection: _openSection,
          onViewClientRequests: _openClientRequests,
        ),
        CoachClientsTab(
          key: _clientsTabKey,
          onPendingCountChanged: _loadPendingRequestCount,
          onClientsChanged: () {
            _classesTabKey.currentState?.refresh();
            _homeTabKey.currentState?.refresh();
            _loadPendingRequestCount();
          },
        ),
        CoachClassesTab(key: _classesTabKey),
        const CoachAttendanceTab(),
        CoachSettingsTab(
          coach: _currentCoach,
          onLogout: _handleLogout,
          onCoachUpdated: _onCoachUpdated,
        ),
      ];

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final initial = _currentCoach.name.isNotEmpty ? _currentCoach.name[0].toUpperCase() : 'C';

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      drawer: _buildSidebar(isDark, initial),
      body: SafeArea(
        child: IndexedStack(index: _currentIndex, children: _buildTabs()),
      ),
      bottomNavigationBar: AnimatedBottomNav(
        currentIndex: _currentIndex,
        onTap: _onTabSelected,
        isDark: isDark,
        activeColor: CoachDashboardTheme.primary,
        inactiveColor: AuthLandingTheme.footer,
        items: List.generate(_navIcons.length, (i) {
          final (inactive, active) = _navIcons[i];
          int? badge;
          if (i == 1) badge = _pendingClientRequestCount;
          return AnimatedNavItem(
            inactiveIcon: inactive,
            activeIcon: active,
            label: _navLabels(context)[i],
            badge: badge != null && badge > 0 ? badge : null,
          );
        }),
      ),
    );
  }

  Widget _buildSidebar(bool isDark, String initial) {
    return Drawer(
      backgroundColor: CoachDashboardTheme.drawerBackground(isDark),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(topRight: Radius.circular(16), bottomRight: Radius.circular(16)),
      ),
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(20, 52, 20, 24),
            decoration: const BoxDecoration(gradient: CoachDashboardTheme.headerGradient),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    initial,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: CoachDashboardTheme.primary,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  _currentCoach.name,
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                Text(
                  _currentCoach.email,
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13),
                ),
                const SizedBox(height: 10),
                if (_currentCoach.role == 'coach')
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text('COACH', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
                  ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(vertical: 8),
              children: [
                _drawerLabel('PROGRAMS', isDark),
                _buildDrawerPush(Icons.assignment_rounded, 'Workout Management', const CoachAssignmentsTab(), isDark),
                _buildDrawerPush(Icons.restaurant_menu_rounded, 'Diet Plans', const CoachDietPlansTab(), isDark),
                _buildDrawerPush(Icons.task_alt_rounded, 'Workout Review', const CoachWorkoutReviewTab(), isDark),
                const SizedBox(height: 8),
                _drawerLabel('INSIGHTS', isDark),
                _buildDrawerPush(Icons.show_chart_rounded, 'Client Progress', const CoachProgressTab(), isDark),
                _buildDrawerPush(Icons.analytics_rounded, 'Reports', const CoachReportsTab(), isDark),
                _buildDrawerPush(
                  Icons.chat_bubble_rounded,
                  'Messages',
                  CoachChatTab(onUnreadChanged: _loadUnreadMessageCount),
                  isDark,
                  badge: _unreadMessageCount,
                ),
                const SizedBox(height: 8),
                _drawerLabel('GENERAL', isDark),
                _buildDrawerPush(Icons.event_available_rounded, 'Appointments', const CoachAppointmentsTab(), isDark),
                _buildDrawerPush(Icons.notifications_rounded, 'Notifications', const CoachNotificationsTab(), isDark),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _drawerLabel(String text, bool isDark) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      child: Text(text, style: CoachDashboardTheme.sectionLabel(isDark)),
    );
  }

  Widget _buildDrawerPush(
    IconData icon,
    String title,
    Widget screen,
    bool isDark, {
    int badge = 0,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
      child: ListTile(
        dense: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        leading: Icon(icon, size: 20, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
        title: Text(title, style: TextStyle(fontSize: 14, color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary)),
        trailing: badge > 0
            ? Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: CoachDashboardTheme.warning,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  badge > 99 ? '99+' : '$badge',
                  style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
                ),
              )
            : Icon(Icons.chevron_right_rounded, size: 18, color: isDark ? Colors.white24 : Colors.black26),
        onTap: () {
          Navigator.pop(context);
          _openSection(screen);
        },
      ),
    );
  }
}
